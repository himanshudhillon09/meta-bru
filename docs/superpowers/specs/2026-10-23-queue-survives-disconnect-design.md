# Queue Survives Page Disconnect — Design

**Date:** 2026-10-23
**Status:** Approved
**Branch:** `feat/account-security`

## Goal

Disconnecting a Facebook Page must stop publishing without destroying queued posts or published history. The Page remains a durable destination record, and its queue resumes when the same Facebook Page is reconnected.

A disconnect must never move queued content to a different Page automatically.

## Scope

In scope:

- A reversible Page disconnect that removes publishing credentials.
- Queued, draft, failed, and published posts survive disconnect.
- The Connections page keeps a disconnected Page card with a queue count and a Reconnect action.
- Reconnecting the same Page reuses its existing record so posts rebind automatically.
- Multiple Pages and their linked Instagram accounts remain independent.
- Manual publish and retry actions fail clearly while a Page is disconnected.
- The scheduler skips disconnected Pages.
- Published history remains visible for disconnected Pages.

Out of scope:

- Permanent deletion of a Page and its history.
- Automatically moving queued posts to another Page.
- Transferring a queue between Meta-Bru user accounts.
- Standalone Instagram accounts that are not linked to a Facebook Page.
- Fixing the Render Meta OAuth redirect-URI rejection.

## Behavior Model

`SocialConnection` is the durable identity for one Facebook Page owned by one Meta-Bru user. Credentials are a replaceable part of that record, not the record's reason to exist.

```text
User account
  └── SocialConnection (userId + pageId, stable _id)
        ├── Page identity: pageName, pageId, instagram
        ├── Preferences: dailyTime, timezone, targets, isActive
        ├── Credentials: pageAccessTokenEnc, tokenStatus
        └── Posts: Post.connectionId -> SocialConnection._id
```

A queued post therefore already belongs to both the user account and the specific Facebook Page. The only missing property is that the connection record must survive disconnection.

### Disconnect

Disconnecting a Page:

1. Verifies the connection belongs to the authenticated user.
2. Refuses if a post is actively publishing or the scheduler holds a fresh lock.
3. Clears the Page token.
4. Marks the connection `disconnected`.
5. Clears `nextRunAt`, `lockedAt`, and `lastError`.
6. Keeps `pageName`, `pageId`, `instagram`, schedule preferences, publish targets, and `isActive`.
7. Does not delete or modify any posts.

`isActive` is preserved as the user's schedule preference. A disconnected Page with an active schedule is still disconnected and cannot publish; when reconnected, the schedule resumes automatically. A Page that was paused before disconnect remains paused after reconnect.

### Reconnect

The existing Meta OAuth flow returns the Pages managed by the Facebook account that completed OAuth. `upsertPagesForUser()` matches each returned Page by `(userId, pageId)`.

For an existing Page record:

- Update `pageName`, token, and Instagram identity.
- Set `tokenStatus = 'active'`.
- Clear `lastError` and `lockedAt`.
- If the Page was not active before this connection (`disconnected` or `needs_reauth`):
  - If `isActive` is true, compute a fresh `nextRunAt`.
  - If `isActive` is false, leave `nextRunAt` null.
- If the Page was already active, preserve its existing schedule.

The connection `_id` does not change, so every post that referenced the Page continues to reference it. No post migration is needed.

If OAuth returns a different Facebook Page, the disconnected Page stays disconnected and its queue stays with the original Page.

## Data Model Changes

### SocialConnection

File: `backend/src/models/socialConnectionModel.ts`

- Extend `ConnectionTokenStatus`:

```ts
export type ConnectionTokenStatus = 'active' | 'needs_reauth' | 'disconnected';
```

- Make the token optional and empty by default:

```ts
pageAccessTokenEnc: { type: String, default: '', select: false }
```

Do not add a schema-level “required when active” validator. Because the token is `select: false`, many code paths load and save a connection without selecting it. Enforce a non-empty token in the OAuth upsert path instead.

- Extend the `tokenStatus` schema enum with `'disconnected'`.

No index changes are required. The unique `(userId, pageId)` index remains the reconnect key.

### Post

File: `backend/src/models/postModel.ts`

No schema change. `connectionId` remains required and now points at a durable Page record.

## Backend Changes

### Connection controller

File: `backend/src/controllers/connectionController.ts`

#### Disconnect

Rename the handler to `disconnectConnection`; keep the existing route.

```text
DELETE /api/connections/:id
```

The operation is idempotent. If the connection is already `disconnected`, return it with its queue count.

Before updating:

- Check for a post with `status: 'publishing'` whose `updatedAt` is within the scheduler's 15-minute stale-lock window.
- Check for a fresh `connection.lockedAt` within the same window.

If either is true, return:

```json
{
  "success": false,
  "code": "POST_IN_PROGRESS",
  "message": "Wait for the current post to finish before disconnecting this Page."
}
```

Apply the disconnect with one update:

```ts
{
  $set: {
    pageAccessTokenEnc: '',
    tokenStatus: 'disconnected',
    nextRunAt: null,
    lockedAt: null,
    lastError: '',
  },
}
```

Do not call `Post.deleteMany`.

Response:

```json
{
  "success": true,
  "message": "Page disconnected. Queued posts are kept.",
  "connection": { "...": "connection fields without pageAccessTokenEnc" },
  "queuedCount": 3
}
```

All connection responses must explicitly omit `pageAccessTokenEnc`, including after disconnect.

#### Queued count

Add a helper that counts queued posts for one connection:

```ts
Post.countDocuments({ connectionId, status: 'queued' })
```

`listConnections`, `updateConnection`, and `disconnectConnection` include `queuedCount` in their connection payloads so the card count does not disappear after an edit.

#### Reconnect

In `upsertPagesForUser()`:

- Capture whether the existing record was inactive:

```ts
const wasInactive = existing.tokenStatus !== 'active';
```

- Update the token, page name, Instagram data, status, `lastError`, and `lockedAt`.
- Recompute the schedule only when `wasInactive && existing.isActive`.
- When `!existing.isActive`, leave `nextRunAt` null.

#### Update connection

File: `backend/src/controllers/connectionController.ts`

- Allow schedule and target edits while disconnected.
- Only compute `nextRunAt` when `tokenStatus === 'active'` and `isActive` is true.
- Keep `nextRunAt` null while disconnected or paused.
- Return the connection with `queuedCount`.

### Scheduler

File: `backend/src/services/schedulerService.ts`

- `ensureSchedules()` must only initialize schedules for connections with `tokenStatus: 'active'`.
- The due query and `processConnection()` already require `tokenStatus: 'active'`; retain those filters.
- A disconnected Page with `isActive: true` must never be picked up.

### Post controller

File: `backend/src/controllers/postController.ts`

Add a shared status check used by `createPost`, `publishNow`, and `retryPost`:

- `disconnected` → `409 PAGE_DISCONNECTED`:
  `"This Page is disconnected. Reconnect it before publishing."`
- `needs_reauth` → `409 RECONNECT_REQUIRED`:
  `"This Page needs to be reconnected before publishing."`

Rules:

- New posts require an active Page.
- Existing queued, draft, and failed posts remain editable and deletable while disconnected.
- `publishNow` and `retryPost` are blocked while disconnected.
- No automatic reassignment to another Page.

`listPosts()` must also populate `tokenStatus` from the connection:

```ts
.populate('connectionId', 'pageName pageId instagram tokenStatus')
```

This lets the Queue page identify posts whose Page needs reconnecting.

### Credential service

File: `backend/src/services/credentialService.ts`

`markConnectionsForReconnect()` must skip already-disconnected Pages:

```ts
{ userId, tokenStatus: { $ne: 'disconnected' } }
```

Changing Meta app credentials should not convert an intentional disconnect into “reconnect needed.”

### Admin controller

File: `backend/src/controllers/adminController.ts`

No behavioral change is required. Disconnected Page records remain visible to admins. The frontend status badge must display them correctly.

## API Contract

### List connections

```text
GET /api/connections
```

Each connection includes:

```ts
{
  _id: string;
  pageId: string;
  pageName: string;
  tokenStatus: 'active' | 'needs_reauth' | 'disconnected';
  instagram: { id, username, profilePictureUrl } | null;
  dailyTime: string;
  timezone: string;
  publishToFacebook: boolean;
  publishToInstagram: boolean;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string;
  queuedCount: number;
}
```

`pageAccessTokenEnc` is never returned.

### Disconnect

```text
DELETE /api/connections/:id
```

Returns the disconnected connection and `queuedCount`.

### Reconnect

Uses the existing flow:

```text
GET  /api/connections/meta/start
POST /api/connections/meta/complete
```

No new endpoint is required.

## Frontend Changes

### Types

File: `frontend/src/lib/types.ts`

- `TokenStatus` adds `'disconnected'`.
- `SocialConnection` adds `queuedCount?: number`.
- `PostConnection` adds `tokenStatus: TokenStatus`.
- Add a helper for “destination cannot publish” if useful across Queue and other views.

### Connections page

File: `frontend/src/app/connections/page.tsx`

- Replace `removeConnection` with `disconnectConnection` that updates the existing card instead of filtering it out.
- Notice: “Page disconnected. Queued posts will resume when you reconnect this Page.”
- Keep the card in the list.

### Connection card

File: `frontend/src/components/ConnectionCard.tsx`

- Prop change: `onRemoved` becomes `onDisconnected(connection)`.
- Status priority:
  1. `disconnected` → gray “Disconnected”
  2. `needs_reauth` → amber “Reconnect needed”
  3. `!isActive` → “Paused”
  4. Otherwise → “Active”
- Show queued post count:
  - `"N posts waiting for this Page"` when N > 0.
  - `"No posts waiting"` when N is 0.
- Disconnected banner:
  `"This Page is disconnected. Reconnect the Facebook account that manages it to resume."`
- Show a Reconnect button in the header/banner when disconnected.
- Hide the Disconnect action when already disconnected.
- Confirm dialog message:
  `"Disconnect {pageName}? Your queued posts and published history will be kept. If the schedule is active, it will resume when you reconnect this same Page."`
- Schedule/timezone/targets remain editable.
- “Next slot” shows `"Waiting for reconnect"` while disconnected.
- Last-error block only appears for active connections.

### Queue page

File: `frontend/src/app/queue/page.tsx`

- Show a small “Page disconnected” or “Reconnect needed” badge next to the Page name.
- Keep queued posts in the Queue tab.
- Disable “Post now” and “Retry failed” for posts whose destination is not active.
- Show a link to `/connections` for reconnect.
- Keep Edit and Delete enabled.
- No change to post statuses or order.

### Composer

File: `frontend/src/app/composer/page.tsx`

- Only list connections with `tokenStatus === 'active'`.
- If none are active, show an empty state:
  `"No active Pages. Reconnect a Page under Connections to create a new post."`
- Defensively block submit if the selected connection is no longer active.
- Existing queued, draft, and failed posts remain editable from the Queue page.

### Admin connection status

File: `frontend/src/components/Dashboards.tsx`

Update `ConnectionStatus` priority so `disconnected` renders as a gray “Disconnected” badge rather than “Paused” or “Active.”

### API client

File: `frontend/src/lib/apiClient.ts`

Rename the connection removal wrapper to `disconnect` for clarity while keeping the same `DELETE` endpoint. Keep a compatibility alias only if other callers need it.

## Edge Cases

### Disconnect while publishing

Reject with `409 POST_IN_PROGRESS`. The user can retry after the current publish finishes.

### Disconnect an already-disconnected Page

Idempotent: return the existing connection and queue count.

### Page reconnected while paused

Reconnect refreshes credentials but leaves the schedule paused and `nextRunAt` null. The user must activate the schedule when ready.

### Page never reconnected

Queued posts remain safe and visible. They stay assigned to that Page and never move to another destination. The user can edit or delete them manually.

### Different Facebook account reconnects the same Page

If the same Meta-Bru user reconnects and OAuth returns the same `pageId`, the Page record is reused and the queue resumes. If OAuth returns different Pages, the disconnected Page and its queue remain untouched.

### Different Meta-Bru user

A queue never transfers to another Meta-Bru account. User ownership is enforced by `Post.userId` and the connection lookup.

### Instagram

A Page's linked Instagram account is part of the same Page record. Disconnecting one Page does not affect another Page's Instagram account. Reconnect refreshes the linked Instagram identity and keeps the existing Instagram target behavior.

## Migration and Rollout

No database migration is needed:

- Existing `Post.connectionId` references remain valid.
- Existing connections remain `active` or `needs_reauth`.
- The new `disconnected` status only applies to future disconnects.
- `pageAccessTokenEnc` becomes optional but existing records already have tokens.

Deploy the backend and frontend together. An old frontend calling `DELETE` against the new backend will still remove the card locally, but the backend keeps the Page, posts, and history, so there is no data loss. The new frontend shows the disconnected card.

## Testing

Automated:

- Backend `npm test`.
- Backend `npm run build`.
- Frontend build and lint.

Manual end-to-end:

1. Queue a post for Page A.
2. Disconnect Page A.
3. Verify the post remains in Queue and in the database.
4. Verify published history for Page A remains visible.
5. Verify the Connections card shows Disconnected with the correct queued count.
6. Verify Post now and Retry fail with a clear reconnect message.
7. Reconnect Page A.
8. Verify the card becomes active and the queued post can publish.
9. Disconnect Page A, then connect Page B.
10. Verify Page A's queue does not move to Page B.
11. Pause Page A, disconnect, reconnect; verify it stays paused.
12. Verify the scheduler does not process a disconnected Page and computes a fresh slot after reconnect.
13. Verify a second Page's schedule and Instagram account are unaffected by Page A's disconnect.

## Non-Goals and Follow-Ups

- A permanent “remove Page and history” action is not included. If added later, it must explicitly archive or delete posts.
- A manual “move queued post to another Page” action is not included.
- Standalone Instagram Login is not included.
- The Render Meta OAuth callback issue is separate and still requires the callback URI to be accepted in the Meta app dashboard.
