# Post Analytics — Design

**Date:** 2026-10-24
**Status:** Approved
**Branch:** `feat/composer-ai-fixes`

## Goal

Give each Meta-Bru user a dedicated Analytics tab that shows:

- When each published post went live, in **IST**.
- How much time has passed since it was published.
- Facebook and Instagram engagement for published posts.
- Stored engagement history for later analysis.
- Publishing-volume and engagement graphs.
- A live engagement monitor scoped to a Page.
- A per-Page calendar of post dates and times.
- Rule-based and optional AI-generated engagement tips.

Only the authenticated account holder can read their analytics. No other
Meta-Bru user, admin, or API caller can read another user's post analytics
through this feature.

## Scope

In scope:

- A new `Analytics` navigation tab.
- Overview, Live monitor, Post tracker, and AI analysis sub-tabs.
- IST publish times and elapsed-time labels.
- Published and partially published posts.
- Facebook and Instagram engagement metrics.
- Stored metric snapshots per Page, post, platform, and capture time.
- A live monitor that refreshes the UI every 30 seconds and syncs Meta every
  5 minutes while active and visible.
- Publishing-activity and engagement graphs built without a chart dependency.
- A per-Page month calendar of published posts.
- Rule-based tips and cached, on-demand Gemini tips.
- Insight scopes, reconnect prompts, and graceful missing-metric states.
- Backend tests, frontend type/lint/build verification, and a manual Meta check.

Out of scope:

- A 24/7 background analytics collector.
- True real-time Meta data. Meta insights can lag by up to 48 hours.
- Video, Reels, Stories, ads, boosted-post, and demographic metrics.
- Follower growth and Page-level audience insights.
- Cloudinary storage-growth history.
- CSV/Excel export.
- Cross-user or admin-wide analytics.
- Editing, deleting, or publishing posts from Analytics.
- Alerts, notifications, or email digests.

## Access Control

All analytics routes require `protect`.

The backend must use `req.user.id` for every query and mutation. It must never
accept a `userId` from the request body, query string, or headers.

```text
authenticated user
  └── their posts
        └── their connections
              └── decrypted Page access token
                    └── Meta insights for that Page's posts
```

Ownership checks:

1. Post queries always include `userId: req.user.id`.
2. A supplied `connectionId` must belong to the authenticated user.
3. A sync target must belong to a post owned by the authenticated user.
4. The backend chooses the connection and Page token; the client cannot supply
   a token, Page ID, or external post ID for a sync.
5. Admins use the existing admin area for cross-user data. The Analytics tab is
   always scoped to the signed-in account.

## User Experience

### Navigation

Add an `Analytics` item to the sidebar and mobile navigation, between Queue and
Activity, with a chart icon.

Add `/analytics` to `PRIVATE_PATHS` in `AuthContext`.

### Header and filters

The Analytics page header contains:

- Range presets: `7 days`, `30 days` (default), `60 days`, `90 days`, `Custom`.
- Custom range: `From` and `To` date inputs plus an `Apply` action.
- Page filter: `All Pages` or one connected Page.
- Platform filter: `All`, `Facebook`, `Instagram`.
- `Refresh insights` button.
- Last-synced text, e.g. `Last synced 2m ago`.
- A persistent note: `All publish times are shown in IST (Asia/Kolkata).`

Custom dates are interpreted as IST days. `From` cannot be after `To`, the range
cannot exceed 730 days, and a future `To` date is clamped to today in IST.

### Sub-tabs

The page has four sub-tabs. The selected sub-tab is stored in the URL as
`?tab=overview`, `?tab=monitor`, `?tab=tracker`, or `?tab=ai` so a refresh keeps
the user in the same view.

#### Overview

- Summary cards:
  - Published posts
  - Total reach
  - Total views
  - Total interactions
  - Average engagement rate
  - Facebook vs Instagram split
- `Publishing activity` chart: posts published per IST day, stacked by
  Facebook and Instagram.
- `Engagement by publish date` chart: reach and interactions for posts published
  in each bucket.
- `Best posting times` heatmap: IST weekday × 3-hour block, coloured by average
  engagement rate.
- A compact rule-based tips card.
- A compact AI tips card with cached results and a link to the AI sub-tab.
- Published-post list.

For ranges longer than 60 days, activity and engagement charts aggregate by
week starting Monday in IST. Daily buckets are zero-filled so the graph has a
continuous time axis.

#### Live monitor

- Page selector. `All Pages` shows combined data; a single Page shows only that
  Page.
- Live badge with `Last synced …`, `Next sync in …`, and a `Live` toggle.
- KPI strip for the selected scope: reach, views, interactions, engagement rate,
  and published posts.
- `Engagement over time` graph with a series selector:
  - Reach
  - Interactions
  - Engagement rate
- Platform comparison bars.
- Top posts by reach and by engagement rate.
- Recent published posts.
- A note: `Meta insights can lag up to 48 hours.`

Live behaviour:

- While `Live` is on and the browser tab is visible, stored data refreshes every
  30 seconds and Meta syncs every 5 minutes.
- Polling and syncing pause when the browser tab is hidden and resume when it is
  visible.
- Turning `Live` off stops both timers.
- If the user changes the Page, platform, or range, the monitor reloads and
  restarts its timers for the new scope.
- If the user has no published posts in range, show an empty state instead of a
  blank graph.

There is no 24/7 collector in this version. The graph is built from snapshots
captured while the monitor is open or when the user presses Refresh. This
limitation is stated in the UI.

#### Post tracker

- Month calendar in IST with previous, next, and `Today` controls.
- Each day shows the number of published posts and Facebook/Instagram dots.
- Clicking a day shows its posts with:
  - IST publish time.
  - Page name.
  - Platform.
  - Reach, interactions, and engagement rate.
  - Elapsed time since posting.
- Page filter applies.
- The header shows the selected Page's next scheduled slot and queued count from
  the existing connection data, with a link to Queue.
- With `All Pages`, days show the total and the day detail includes the Page name.
- Days with no posts are muted but remain clickable for context.
- The calendar fetches the visible month's posts through the existing posts
  analytics endpoint; no separate calendar collection is needed.

#### AI analysis

- Rule-based tips are always shown first.
- AI tips are generated only on demand.
- Cached AI tips appear automatically when they exist and are not expired.
- The action is `Run AI analysis` when there is no cache and `Refresh AI analysis`
  when a cache exists.
- If Gemini is not configured, show a link to Profile.
- Each AI tip has a title, body, severity, and optional action link.
- The AI card shows the generation time and `Cached for 6 hours`.
- If the AI request fails, keep the rule-based tips and show a non-blocking error.

### Published-post list

Each post card shows:

- Thumbnail, caption preview, Page name, and status.
- Per-platform target chips.
- Per published target:
  - `Published 24 Oct 2026, 14:51 IST`.
  - `2h 14m ago`, refreshed every minute.
  - Reach, views, likes/reactions, comments, shares, saves, clicks, and
    engagement rate.
  - Snapshot age or sync state.
- Partial posts show only targets that actually published. Failed targets are
  not displayed as analytics rows.
- If a metric is unavailable, show `—` with a tooltip explaining why.
- If insights need permission, show `Reconnect for insights` with a link to
  `/connections`.
- If Meta has no data yet, show `Meta has not reported insights yet.`

The list is paginated with `Load more`. Page size defaults to 25 and is capped at
100. The list is sorted by latest publish time, newest first.

### Queue change

Published and partial Queue cards will show the actual publish time in IST
instead of only `createdAt`:

```text
Published 24 Oct 2026, 14:51 IST · 2h 14m ago
```

Unpublished cards keep their existing created/scheduled display.

### IST and elapsed-time helpers

Add shared frontend helpers:

- `formatIstDateTime(value)`:
  - Uses `Asia/Kolkata`.
  - 24-hour format.
  - Output example: `24 Oct 2026, 14:51 IST`.
- `formatElapsed(value, now?)`:
  - `Just now`
  - `14m ago`
  - `2h 14m ago`
  - `3d 4h ago`
  - `2mo ago`
  - `1y ago`

The elapsed label updates every minute while the Analytics page is mounted.

The existing `formatDate` helper remains unchanged for non-analytics screens.

### Reconnect and empty states

- If a sync reports missing insight permission, show a page-level banner:
  `2 Pages need to be reconnected to load engagement insights.`
  The banner links to `/connections`.
- The affected post cards show `Reconnect for insights`.
- If a Page has fewer than 100 likes and Meta returns no Page insights, show
  `Meta has not reported reach for this Page yet.` rather than an error.
- If no Meta app or Page connection exists, show a link to Profile/Connections.
- If no posts are published in the selected range, show a composer link and a
  prompt to widen the range.

## Data Model

### `PostMetricSnapshot`

File: `backend/src/models/postMetricSnapshotModel.ts`

One document per Page, post, platform, and capture time. This is the stored
history used for the monitor and for later analysis.

```ts
interface IPostMetricSnapshot {
    userId: mongoose.Types.ObjectId;
    connectionId: mongoose.Types.ObjectId;
    pageId: string;
    pageName: string;
    postId: mongoose.Types.ObjectId;
    platform: 'facebook' | 'instagram';
    externalId: string;
    publishedAt: Date;
    capturedAt: Date;
    metrics: {
        likes: number | null;
        comments: number | null;
        shares: number | null;
        saves: number | null;
        reach: number | null;
        views: number | null;
        clicks: number | null;
        interactions: number | null;
        engagementRate: number | null;
    };
    availableMetrics: string[];
    status: 'ok' | 'partial' | 'unavailable' | 'permission_error';
    error: string;
    createdAt: Date;
    updatedAt: Date;
}
```

Semantics:

- `null` means the metric was not available from Meta. `0` is a real value.
- `interactions` is the sum of available `likes + comments + shares + saves`. It
  is `null` only when all four are unavailable.
- `engagementRate` is a percentage:
  `(likes + comments + shares + saves) / reach * 100`.
  If reach is unavailable, use views. If neither denominator is available or is
  zero, store `null`.
- `availableMetrics` lists the metric keys that Meta actually returned, so the UI
  can distinguish `0` from `—`.
- `status`:
  - `ok`: all requested metrics were available.
  - `partial`: some metrics were available.
  - `unavailable`: Meta returned no usable metrics.
  - `permission_error`: the Page token lacks insight permission.

Indexes:

```text
{ userId: 1, publishedAt: -1 }
{ userId: 1, connectionId: 1, publishedAt: -1 }
{ postId: 1, platform: 1, capturedAt: -1 }
{ userId: 1, platform: 1, publishedAt: -1 }
```

Snapshot deduplication:

- If a snapshot for the same `postId + platform` was captured less than
  1 minute ago, update it instead of creating another document.
- Otherwise create a new snapshot.
- This allows the 5-minute live monitor to build a real time series without
  duplicate rows from a double-click.

Retention:

- Snapshots are retained for later analysis.
- No TTL is added in this version. A future cleanup job can archive or remove
  snapshots older than Meta's 2-year insights window.

### `AnalyticsAiInsight`

File: `backend/src/models/analyticsAiInsightModel.ts`

Cached AI analysis, separate from metric snapshots.

```ts
interface IAnalyticsAiInsight {
    userId: mongoose.Types.ObjectId;
    scopeKey: string;          // 'all' or a connection id
    connectionId: mongoose.Types.ObjectId | null;
    rangeKey: string;          // normalized from/to + platform
    dataHash: string;          // hash of the aggregate payload sent to Gemini
    tips: Array<{
        title: string;
        body: string;
        severity: 'info' | 'success' | 'warning';
        actionLabel: string;
        actionHref: string;
    }>;
    model: string;
    generatedAt: Date;
    expiresAt: Date;
}
```

Indexes:

```text
{ userId: 1, scopeKey: 1, rangeKey: 1, generatedAt: -1 }
{ expiresAt: 1 } with expireAfterSeconds: 0
```

Cache behaviour:

- Cache key: `userId + scopeKey + rangeKey + dataHash`.
- If a matching, unexpired cache entry exists, return it with `cached: true`.
- If the aggregate data hash changes, generate a new entry.
- TTL is 6 hours.
- AI tips are never used as the only tips; rule-based tips remain available.

## Backend

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/analytics/overview` | Summary cards, charts, best times, sync state |
| `GET` | `/api/analytics/monitor` | Per-Page time series, summary, recent posts |
| `GET` | `/api/analytics/posts` | Paginated post list and calendar data |
| `POST` | `/api/analytics/sync` | Stale or live Meta sync |
| `GET` | `/api/analytics/tips` | Rule-based tips and cached AI insight |
| `POST` | `/api/analytics/tips` | Generate and cache AI insight |

All routes use `protect`. The read routes use an analytics read limiter. The sync
route uses a stricter sync limiter. The tips route uses the existing AI limiter.

Suggested limits:

```text
analyticsReadLimiter: 120 requests / 15 minutes / user
analyticsSyncLimiter: 20 requests / 15 minutes / user
AI tips: existing aiLimiter (20 requests / hour / user)
```

### Common query parameters

```text
from=YYYY-MM-DD       required, inclusive IST day
to=YYYY-MM-DD         required, inclusive IST day
connectionId=<id>     optional, must belong to the user
platform=facebook|instagram  optional
```

Validation:

- `from` and `to` must be valid `YYYY-MM-DD` dates.
- `from <= to`.
- Range must be at most 730 days.
- A future `to` is clamped to today in IST.
- `connectionId` must be a 24-character ObjectId owned by the user.
- `platform` must be one of the allowed values.
- No `userId` parameter is accepted.

### Date handling

- IST is `Asia/Kolkata`, a fixed UTC+05:30 offset with no daylight saving.
- `from` becomes `00:00:00.000+05:30`.
- `to` becomes `23:59:59.999+05:30`.
- Stored timestamps remain UTC.
- Day and week grouping uses IST.
- Weeks start Monday.
- The backend returns ISO timestamps; the frontend formats them in IST.

### `GET /api/analytics/overview`

Response:

```json
{
  "success": true,
  "range": {
    "from": "2026-09-25",
    "to": "2026-10-24",
    "preset": "30d",
    "timezone": "Asia/Kolkata"
  },
  "totals": {
    "posts": 12,
    "facebookPosts": 12,
    "instagramPosts": 8,
    "reach": 12345,
    "views": 18000,
    "interactions": 640,
    "likes": 400,
    "comments": 90,
    "shares": 70,
    "saves": 80,
    "clicks": 120,
    "engagementRate": 5.2
  },
  "byPlatform": {
    "facebook": {
      "posts": 12,
      "reach": 8000,
      "views": 11000,
      "interactions": 410,
      "engagementRate": 5.1
    },
    "instagram": {
      "posts": 8,
      "reach": 4345,
      "views": 7000,
      "interactions": 230,
      "engagementRate": 5.3
    }
  },
  "activity": [
    {
      "date": "2026-10-01",
      "label": "1 Oct",
      "posts": 2,
      "facebook": 2,
      "instagram": 1,
      "reach": 1000,
      "interactions": 50
    }
  ],
  "bestTimes": [
    {
      "day": 3,
      "dayLabel": "Wed",
      "block": 6,
      "label": "18:00–21:00 IST",
      "posts": 4,
      "avgEngagementRate": 4.8
    }
  ],
  "sync": {
    "lastSyncedAt": "2026-10-24T09:21:00.000Z",
    "staleTargets": 6,
    "remainingTargets": 0,
    "permissionErrors": [
      {
        "connectionId": "…",
        "pageName": "My Page",
        "platform": "instagram"
      }
    ]
  }
}
```

Aggregation rules:

- Only posts with `status` `published` or `partial` are included.
- Only targets with `status: 'published'` and a publish time in range are
  included.
- Target `publishedAt` is authoritative. If a legacy target has no
  `publishedAt`, fall back to the post's `publishedAt`.
- The latest snapshot per post/platform is used for totals.
- Totals sum only available metrics. A missing metric does not become zero.
- Average engagement rate is the weighted rate across posts with a valid
  denominator, not an average of percentages.
- `activity` is zero-filled for every day or week bucket.
- `bestTimes` groups by IST weekday and 3-hour block. Blocks with fewer than two
  posts are returned with `avgEngagementRate: null` and a `not enough data` state.

### `GET /api/analytics/monitor`

Response:

```json
{
  "success": true,
  "scope": {
    "connectionId": null,
    "pageName": "All Pages"
  },
  "summary": {
    "posts": 12,
    "reach": 12345,
    "views": 18000,
    "interactions": 640,
    "engagementRate": 5.2
  },
  "series": {
    "all": [
      {
        "capturedAt": "2026-10-24T09:21:00.000Z",
        "reach": 12345,
        "views": 18000,
        "interactions": 640,
        "engagementRate": 5.2
      }
    ],
    "facebook": [],
    "instagram": []
  },
  "seriesTruncated": false,
  "recentPosts": [],
  "sync": {
    "lastSyncedAt": "2026-10-24T09:21:00.000Z",
    "nextSyncAt": "2026-10-24T09:26:00.000Z",
    "staleTargets": 0,
    "permissionErrors": []
  }
}
```

Series rules:

- One point per capture time.
- The all-platform series sums metrics across platforms at the same capture time.
- Platform series are separate.
- Snapshots are sorted oldest to newest for charting.
- If there are fewer than two points, the chart shows a single-point state with a
  note that history builds while the monitor is open.
- `recentPosts` contains the latest five published targets in scope.
- The live monitor series covers at most the 100 most recent targets in the
  selected scope, using up to 50,000 snapshots from the last 90 days. The
  summary and `recentPosts` still cover the full selected scope.
- `seriesTruncated` is `true` when older targets are omitted from the series,
  so the UI can explain why the series is partial.

### `GET /api/analytics/posts`

Query:

```text
from, to, connectionId?, platform?, page=1, limit=25
```

Response:

```json
{
  "success": true,
  "posts": [
    {
      "postId": "…",
      "caption": "…",
      "mediaUrl": "…",
      "status": "published",
      "connection": {
        "id": "…",
        "pageId": "…",
        "pageName": "My Page",
        "instagramUsername": "mypage"
      },
      "targets": [
        {
          "platform": "facebook",
          "externalId": "…",
          "publishedAt": "2026-10-24T09:21:00.000Z",
          "metrics": {
            "likes": 120,
            "comments": 14,
            "shares": 8,
            "saves": null,
            "reach": 2400,
            "views": 3100,
            "clicks": 32,
            "interactions": 142,
            "engagementRate": 5.9
          },
          "availableMetrics": ["likes", "comments", "shares", "reach", "views", "clicks"],
          "snapshotAt": "2026-10-24T09:21:00.000Z",
          "status": "ok",
          "error": ""
        }
      ]
    }
  ],
  "page": 1,
  "limit": 25,
  "total": 12,
  "hasMore": false
}
```

Rules:

- Sort by latest publish time descending.
- Return only published targets.
- If a post has no published target in range, it is omitted.
- `total` is the number of matching posts, not targets.
- Calendar views call this endpoint with the visible month's IST range.

### `POST /api/analytics/sync`

Request:

```json
{
  "from": "2026-09-25",
  "to": "2026-10-24",
  "connectionId": "…",
  "platform": "facebook",
  "mode": "stale"
}
```

Modes:

- `stale`: process up to 20 stale targets (no snapshot or snapshot older than
  15 minutes).
- `live`: process up to 10 targets for the selected Page/scope that are older
  than 5 minutes. If `connectionId` is omitted, process the latest targets across
  all Pages.

Response:

```json
{
  "success": true,
  "synced": 12,
  "failed": 1,
  "skipped": 0,
  "remaining": 4,
  "permissionErrors": [],
  "lastSyncedAt": "2026-10-24T09:21:00.000Z"
}
```

Sync flow:

1. Query owned posts and targets in range.
2. Load the latest snapshot per target.
3. Select stale targets, newest published first.
4. Decrypt the owning Page token once per connection for the request.
5. Fetch metrics with concurrency 3 and a 20-second per-request timeout.
6. Upsert snapshots, updating a snapshot less than 1 minute old.
7. On token error, mark the connection as `needs_reauth`.
8. On insight-permission error, record a `permission_error` snapshot and return
   the Page in `permissionErrors`.
9. Return counts and the number of targets still waiting.

The sync endpoint is the only endpoint that calls Meta. Read endpoints never
block on Meta.

### `GET /api/analytics/tips`

Returns rule-based tips and any unexpired cached AI insight for the scope.

```json
{
  "success": true,
  "ruleBased": [
    {
      "id": "best-time",
      "title": "Wednesday evenings work best",
      "body": "Your Wednesday 18:00–21:00 IST posts average 4.8% engagement, 1.9× your Page average.",
      "severity": "success",
      "actionLabel": "Open composer",
      "actionHref": "/composer"
    }
  ],
  "ai": {
    "cached": true,
    "generatedAt": "2026-10-24T08:00:00.000Z",
    "expiresAt": "2026-10-24T14:00:00.000Z",
    "model": "gemini-2.5-flash",
    "tips": []
  }
}
```

If no AI cache exists, `ai` is `null`.

### `POST /api/analytics/tips`

Generates a new AI insight, or returns the cached one when the data hash matches.

Request:

```json
{
  "from": "2026-09-25",
  "to": "2026-10-24",
  "connectionId": "…"
}
```

Response:

```json
{
  "success": true,
  "cached": false,
  "insight": {
    "generatedAt": "2026-10-24T09:30:00.000Z",
    "expiresAt": "2026-10-24T15:30:00.000Z",
    "model": "gemini-2.5-flash",
    "tips": [
      {
        "title": "Double down on Wednesday evenings",
        "body": "Your 18:00–21:00 IST posts outperform your average by 1.9×.",
        "severity": "success",
        "actionLabel": "Open composer",
        "actionHref": "/composer"
      }
    ]
  }
}
```

If Gemini is not configured, return `400` with a clear
`GEMINI_NOT_CONFIGURED` error. If Gemini fails, return a `502` and leave the
existing cache untouched.

### Service responsibilities

`analyticsService.ts`:

- Validate and convert IST date ranges.
- Query owned posts and published targets.
- Load latest snapshots.
- Build overview totals, platform splits, activity buckets, best-time buckets,
  and monitor series.
- Build rule-based tips.
- Paginate posts.
- Compute the AI aggregate payload and data hash.
- Never call Meta.

`metaInsightsService.ts`:

- Fetch Facebook and Instagram metrics with the owning Page token.
- Run metric fallback ladders.
- Parse Graph API response shapes.
- Classify permission and token errors.
- Return normalized metric objects and status.
- Never persist or expose tokens.

`analyticsSyncService.ts`:

- Select stale targets.
- Group by connection.
- Decrypt tokens.
- Fetch with concurrency limits.
- Upsert snapshots.
- Update connection token status on token errors.
- Return sync counts and permission errors.

`analyticsAiService.ts`:

- Build the aggregate AI input.
- Compute the data hash.
- Read/write the 6-hour cache.
- Call Gemini with a strict JSON response prompt.
- Validate and normalize tips.
- Never send tokens, Page IDs, external post IDs, or raw captions.

## Meta Integration

### OAuth scopes

Add these to the default Meta scopes:

```text
read_insights
instagram_manage_insights
```

Update:

- `backend/src/config/env.ts` default scope list.
- `backend/.env.example`.
- `docs/DEPLOYMENT.md`.
- Any setup documentation that lists required Meta permissions.

Existing connections will not have the new permissions. Analytics shows a
reconnect prompt until the user reconnects the Page. The OAuth flow already uses
`auth_type=rerequest`, so the consent screen is shown again.

If `META_SCOPES` is explicitly set, it must include the two insight scopes. The
Profile credentials screen should warn when the configured scopes are missing
them.

### Facebook metrics

Requests per target:

1. Post fields:
   `GET /{post-id}?fields=reactions.summary(total_count),comments.summary(total_count),shares`
2. Insights ladder:
   - `GET /{post-id}/insights?metric=post_media_view,post_total_media_view_unique,post_clicks&period=lifetime`
   - Retry without `post_clicks`.
   - Retry with `post_media_view` only.
   - If all insight metrics fail, keep the post-field metrics and mark the
     snapshot `partial` or `unavailable`.

Metric mapping:

| Meta metric | Stored metric |
| --- | --- |
| `post_media_view` | `views` |
| `post_total_media_view_unique` | `reach` |
| `post_clicks` | `clicks` |
| reactions summary total | `likes` |
| comments summary total | `comments` |
| shares count | `shares` |

Notes:

- `post_impressions` and `post_engaged_users` are deprecated and must not be
  requested.
- Facebook Page insights can be unavailable for Pages with fewer than 100 likes.
  This is a valid empty state, not an error.
- A photo post may lack a `post_id` in legacy data. If insights fail for the
  stored ID, still return reactions/comments/shares and leave reach/views
  unavailable.

### Instagram metrics

Requests per target:

1. Insights ladder:
   - `GET /{media-id}/insights?metric=reach,views,likes,comments,shares,saved`
   - Retry without `views`.
   - Retry with `reach,likes,comments`.
   - Retry with `reach`.
2. Media fields fallback:
   `GET /{media-id}?fields=like_count,comments_count`
3. Legacy media: if `views` is unavailable but `impressions` is available, use
   `impressions` as `views`.

Metric mapping:

| Meta metric | Stored metric |
| --- | --- |
| `reach` | `reach` |
| `views` | `views` |
| `impressions` (legacy) | `views` |
| `likes` / `like_count` | `likes` |
| `comments` / `comments_count` | `comments` |
| `shares` | `shares` |
| `saved` | `saves` |

Notes:

- Meta may return an empty data set instead of zero when insights are not
  available. Treat missing metrics as `null`, not `0`.
- Insights can be delayed up to 48 hours.
- Only single-image posts are in scope. Carousel/album insights are out of scope.

### Error classification

- Permission errors:
  - Meta code `200`, `10`, or `100` with a permission-related message.
  - Result: snapshot `permission_error`, Page listed in `permissionErrors`, no
    connection token-status change.
- Token errors:
  - Meta code `190` or `102`.
  - Result: mark the connection `needs_reauth` using the existing publishing
    pattern, and show a reconnect prompt.
- Rate-limit errors:
  - Meta code `4`, `17`, `32`, or `613`.
  - Result: snapshot `partial` or `unavailable`, keep the old metrics, and show a
    retry-later message.
- Network/timeout:
  - Result: snapshot `unavailable`, keep the old metrics, and allow a later
    retry.

Error messages stored in snapshots must be sanitized. Do not store access tokens,
request URLs containing tokens, or raw Meta payloads.

### Engagement rate

```text
interactions = likes + comments + shares + saves   (only available values)
rate = interactions / reach * 100
```

Fallback:

1. If reach is available and greater than zero, use reach.
2. Else if views is available and greater than zero, use views.
3. Else store `null`.

The UI shows `—` for a null rate.

## AI Analysis

### Inputs

The AI aggregate payload contains only:

- Range and timezone.
- Scope: all Pages or one Page name.
- Totals and platform split.
- Publishing activity buckets.
- Best-time buckets with sample sizes.
- Top five posts by reach and by engagement rate, with captions trimmed to 120
  characters.
- Publishing frequency and the longest gap.
- Missing-insight/reconnect state.
- Brand profile: niche, tone, audience, keywords.

It does not contain:

- Access tokens.
- Page IDs.
- External post IDs.
- Raw Meta responses.
- Full captions.
- User email or password data.

### Prompt requirements

The AI must:

- Return 3–5 tips as strict JSON.
- Use only the provided metrics.
- Mention when there is not enough data.
- Prefer specific numbers and IST timing.
- Keep each tip under 240 characters.
- Include an action label and safe internal path when useful.
- Avoid generic advice that is not supported by the data.

### Validation and fallback

- Strip Markdown fences before parsing.
- Reject non-JSON output.
- Reject tips with missing titles or bodies.
- Cap the result at five tips.
- Only allow internal action paths beginning with `/`.
- On any failure, return a `502` and keep the previous cache and rule-based tips.
- Never replace rule-based tips with AI output.

## Frontend

### Files

New:

- `frontend/src/app/analytics/page.tsx`
- `frontend/src/components/AnalyticsCharts.tsx`
- `frontend/src/components/AnalyticsPostCard.tsx`
- `frontend/src/components/AnalyticsMonitor.tsx`
- `frontend/src/components/PostTrackerCalendar.tsx`
- `frontend/src/components/AnalyticsTips.tsx`
- `frontend/src/components/AnalyticsAiTips.tsx`

Updated:

- `frontend/src/lib/types.ts` — analytics types, IST/elapsed helpers.
- `frontend/src/lib/apiClient.ts` — `analyticsApi`.
- `frontend/src/components/AppShell.tsx` — Analytics nav item and chart icon.
- `frontend/src/context/AuthContext.tsx` — `/analytics` private path.
- `frontend/src/app/queue/page.tsx` — IST publish time and elapsed time.

### Charts

No chart library is added. Use lightweight SVG/CSS components:

- `AnalyticsBarChart` for publishing activity and engagement by date.
- `AnalyticsLineChart` for the live monitor series.
- `AnalyticsHeatmap` for best posting times.
- `MetricCard` for summary values.

Requirements:

- Responsive width.
- Accessible labels and `aria-label` text.
- Tooltips via `title` attributes for simple values.
- Empty and single-point states.
- No animation that blocks interaction.
- Weekly aggregation for ranges longer than 60 days.

### Polling and visibility

- UI refresh interval: 30 seconds.
- Meta sync interval: 5 minutes.
- Both only run when:
  - The Live monitor sub-tab is active.
  - `Live` is on.
  - `document.visibilityState === 'visible'`.
- Clear timers on unmount, scope change, and when Live is turned off.
- Use a single in-flight sync guard so overlapping requests cannot occur.
- After a sync completes, reload the monitor and overview data.
- The elapsed-time labels update every minute independently of the monitor.

### Error handling

- Show page-level error banners for failed reads.
- Show inline errors for failed syncs, keeping the last cached data visible.
- Show permission errors separately from generic sync errors.
- Disable the AI button while a request is in flight.
- Show a Gemini-not-configured link when applicable.
- Never clear existing metrics when a refresh fails.

## Security

- All queries filter by `req.user.id`.
- All `connectionId` values are ownership-checked.
- All post IDs and target IDs used for sync are resolved from the user's posts,
  not trusted from the client.
- Page tokens are decrypted server-side only.
- Tokens are never logged, returned, or stored in snapshots.
- Meta error messages are sanitized before storage/display.
- Analytics read and sync routes are rate-limited per user.
- AI inputs exclude identifiers and secrets.
- AI action links are restricted to internal paths.
- No cross-user analytics for admins through this feature.

## Verification

### Backend tests

Add tests for:

- IST range conversion, inclusive end-of-day, and custom range validation.
- Zero-filled daily buckets and Monday-based weekly aggregation.
- Latest-snapshot selection per post/platform.
- Engagement-rate reach/views fallback and null handling.
- Best-time grouping by IST weekday and 3-hour block.
- Rule-based tips with insufficient data.
- Facebook primary/fallback insight parsing.
- Instagram primary/fallback insight parsing.
- Empty insights, permission errors, token errors, and rate-limit errors.
- Sync stale/live caps, newest-first ordering, and `remaining` counts.
- Snapshot deduplication within 1 minute.
- AI cache hit, cache expiry, data-hash change, and invalid AI JSON.
- Controller ownership checks and rejection of `userId` input.
- Pagination and `hasMore`.

### Frontend verification

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- Manual checks:
  1. Reconnect a Page and confirm the new scopes.
  2. Publish a post and open Analytics.
  3. Confirm the IST publish time and elapsed label.
  4. Confirm the snapshot exists in MongoDB.
  5. Turn on Live and confirm the 30-second UI refresh and 5-minute sync.
  6. Hide the browser tab and confirm polling pauses.
  7. Open the Post tracker and confirm the post appears on the correct IST date.
  8. Run AI analysis and confirm the 6-hour cache.
  9. Remove insight permission from a Page and confirm the reconnect banner.
  10. Confirm Queue shows the published time in IST.

## Implementation Notes

- Follow the existing service/controller/route pattern used by storage and posts.
- Follow the existing Tailwind slate/indigo visual language.
- Do not add a chart dependency.
- Do not change the existing publishing flow.
- Do not change `formatDate`; add new helpers for IST and elapsed time.
- Do not create a background analytics job in this version.
- Keep the Analytics feature read-only with respect to posts.

## Open Questions

None. The design is approved and ready for implementation planning.
