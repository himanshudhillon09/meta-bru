# Cloudinary Storage Manager — Design

**Date:** 2026-10-24
**Status:** Approved
**Branch:** `feat/composer-ai-fixes`

## Goal

Give each Meta-Bru user a Storage tab that lists the images Meta-Bru uploaded to
their own Cloudinary account, shows how much storage is used, identifies exact
duplicate uploads, and lets the user safely delete unwanted images.

Only the authenticated account holder can list or delete their assets. No other
Meta-Bru user, admin, or API caller can read or delete another user's Cloudinary
assets.

## Scope

In scope:

- A new `Storage` navigation tab.
- Listing images in the authenticated user's `meta-bru/<userId>/` folder.
- Account-wide Cloudinary storage usage and Meta-Bru folder usage.
- Exact duplicate detection by Cloudinary `etag`.
- Fallback "possible duplicate" grouping by size, dimensions, and format.
- Per-image details: public ID, format, dimensions, bytes, upload date, post usage.
- Bulk selection and deletion.
- Blocking deletion of images used by draft, queued, publishing, failed, or
  partial posts.
- Warning before deleting images used by published posts.
- Tests and build verification.

Out of scope:

- Managing assets outside the Meta-Bru folder.
- Managing video or raw assets.
- Restoring deleted Cloudinary assets.
- Editing posts from the Storage tab.
- Storing or displaying another user's Cloudinary credentials.

## Access Control

All storage endpoints require `protect`.

The backend must use `req.user.id` for every operation. It must never accept a
`userId` from the request body, query string, or headers.

```text
authenticated user
  └── encrypted per-user Cloudinary credentials
        └── Cloudinary account
              └── meta-bru/<authenticated user id>/  (only visible folder)
```

Ownership checks:

1. The list is scoped to `meta-bru/<req.user.id>/`.
2. Every delete request validates that each asset ID belongs to that folder.
3. An asset ID from another user, another folder, or another Cloudinary account
   is skipped with a clear reason.
4. A user cannot choose which credentials are used; the backend always loads the
   credentials stored on the authenticated user record.

## User Experience

### Navigation

Add a `Storage` item to the sidebar and mobile navigation with a cloud icon.

### Summary cards

- **Cloudinary account**: storage used, limit, percentage, plan, account asset
  count, and last-updated date. This is account-wide and may include assets
  outside Meta-Bru.
- **Meta-Bru uploads**: total bytes and asset count for the user's folder.
- **Duplicate extras**: number of extra copies and recoverable bytes.
- **Unused images**: count and bytes.
- **Protected images**: count and bytes locked by unfinished posts.

### Toolbar

- Search by public ID or folder.
- Filters: All, Duplicates, Unused, Used.
- Sort: Newest, Oldest, Largest, Smallest.
- Refresh.
- Select extra copies.
- Select unused.
- Clear selection.
- Delete selected.

### Asset grid

Each card shows:

- Thumbnail (Cloudinary transformation URL).
- Public ID.
- Format, dimensions, and file size.
- Upload date.
- Usage badge:
  - `Unused`
  - `Published`
  - `In use` (blocked)
- Duplicate badge:
  - `Exact duplicate · N copies`
  - `Possible duplicate · N copies`
  - `Keep this copy` / `Extra copy`
- Post status chips for posts that use the image.
- Selection checkbox.

Images with a protected post are not selectable. Published-only images are
selectable after the confirmation warning.

### Delete flow

The confirmation shows:

- Number of images and total bytes.
- A warning that deletion is permanent.
- A warning when selected images are used by published posts.
- A note that deleting an image can break an unsaved Composer draft that still
  references it.

After deletion, the page refreshes and reports:

- Deleted count and freed bytes.
- Blocked count.
- Skipped count.

## Backend

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/media/storage` | List the authenticated user's assets and summary |
| `POST` | `/api/media/delete` | Delete selected assets owned by the authenticated user |

Both routes use `protect` and a dedicated storage rate limiter.

### `GET /api/media/storage`

Response:

```json
{
  "success": true,
  "configured": true,
  "assets": [],
  "summary": {
    "account": {
      "plan": "Basic",
      "storageUsed": 0,
      "storageLimit": 0,
      "storagePercent": 0,
      "bandwidthUsed": 0,
      "bandwidthLimit": 0,
      "resources": 0,
      "lastUpdated": "",
      "error": ""
    },
    "folder": { "assetCount": 0, "bytes": 0, "truncated": false },
    "duplicates": {
      "groups": 0,
      "extraAssets": 0,
      "extraBytes": 0,
      "exactGroups": 0,
      "likelyGroups": 0
    },
    "unused": { "assets": 0, "bytes": 0 },
    "protected": { "assets": 0, "bytes": 0 }
  }
}
```

If Cloudinary credentials are not configured, return `200` with
`configured: false`, empty assets, and a zeroed summary. The UI then shows a
link to Profile.

If the account usage call fails but the asset list succeeds, return the assets
and `summary.account: null` with an error string. The page still works.

### `POST /api/media/delete`

Request:

```json
{ "assetIds": ["asset-id-1", "asset-id-2"] }
```

Validation:

- `assetIds` must be a non-empty array of strings.
- Maximum 500 IDs per request.
- Duplicate IDs are removed.

Response:

```json
{
  "success": true,
  "deleted": [{ "assetId": "", "publicId": "", "bytes": 0 }],
  "blocked": [{ "assetId": "", "publicId": "", "reason": "" }],
  "skipped": [{ "assetId": "", "reason": "" }],
  "freedBytes": 0
}
```

### Cloudinary service

File: `backend/src/services/cloudinaryStorageService.ts`

Responsibilities:

- Load the authenticated user's Cloudinary credentials.
- List images in `meta-bru/<userId>/`.
- Fetch account usage.
- Cross-reference posts.
- Group duplicates.
- Plan and execute deletion.

Listing strategy:

1. Use the Cloudinary Search API with an expression matching
   `public_id:meta-bru/<userId>/*` or `asset_folder:meta-bru/<userId>/*`.
2. If the Search API fails, use `resources_by_asset_folder`.
3. If that fails, use `resources` with the folder prefix.
4. Cap the total at 2,000 assets and set `folder.truncated` when more remain.

All Cloudinary calls pass `cloud_name`, `api_key`, and `api_secret` per call.
Never mutate global Cloudinary configuration.

Asset normalization:

```ts
{
  assetId, publicId, assetFolder, url, secureUrl, thumbnailUrl,
  format, width, height, bytes, createdAt, etag
}
```

Post usage:

- Query `Post` for the user where `mediaPublicId` is in the listed public IDs.
- Store `{ id, status, caption, publishedAt, platforms }` per asset.
- Protected statuses: `draft`, `queued`, `publishing`, `failed`, `partial`.
- `canDelete` is false when any protected post uses the asset.
- `deleteBlockedReason` explains the block.

Duplicate grouping:

- Exact key: `etag:<etag>`.
- Fallback key: `shape:<bytes>:<width>:<height>:<format>`.
- Groups with more than one asset are duplicates.
- Recommended keep:
  1. An asset used by any post.
  2. The oldest asset.
- Exact duplicates can be auto-selected. Possible duplicates require manual
  selection.

Deletion:

- Re-list the user's assets and map requested IDs to owned assets.
- Skip IDs that are not in the user's folder.
- Block assets used by protected posts.
- Delete allowed assets in chunks of 100 using
  `delete_resources_by_asset_ids`.
- Count freed bytes only for confirmed deletions.
- Return blocked and skipped reasons instead of failing the whole request when
  Cloudinary rejects part of a batch.

## Frontend

### Files

- `frontend/src/app/storage/page.tsx` — page, filters, selection, delete flow.
- `frontend/src/components/StorageAssetCard.tsx` — asset card.
- `frontend/src/components/AppShell.tsx` — Storage nav item and cloud icon.
- `frontend/src/lib/apiClient.ts` — storage API wrappers.
- `frontend/src/lib/types.ts` — storage types and `formatBytes`.

### State

- Overview data, loading, refreshing, error, notice.
- Filter, search, sort.
- Selected asset IDs.
- Visible count for client-side "Load more".
- Delete confirmation open/closed and deleting state.

Selection is limited to assets with `canDelete: true`.

After a successful delete, clear selection and refresh the overview.

## Error Handling

- Missing Cloudinary credentials: setup card linking to Profile.
- Invalid credentials: clear message with a Profile link.
- Cloudinary usage failure: show account usage unavailable, keep the asset list.
- Partial delete failure: report deleted, blocked, and skipped counts.
- Malformed stored draft or malformed Cloudinary response: ignore invalid fields
  and keep the page usable.

## Testing

Backend unit tests:

- Folder prefix and ownership validation.
- Exact and likely duplicate grouping.
- Recommended-keep selection.
- Storage summary totals.
- Protected-post deletion blocking.
- Deletion planning and result normalization.
- Usage response normalization.

Controller tests:

- Rejects missing or empty `assetIds`.
- Uses only the authenticated user's ID.
- Returns blocked assets without deleting them.

Frontend verification:

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`

Manual verification:

- Configure Cloudinary credentials.
- Upload the same image twice from the Composer.
- Confirm both appear in Storage, grouped as an exact duplicate.
- Confirm an image used by a queued post cannot be selected.
- Delete a duplicate and confirm the freed bytes and list update.
- Confirm a second user cannot see or delete the first user's assets.
