# Queue Survives Page Disconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Facebook Page disconnect reversible so queued posts and published history survive, and the same Page's queue resumes automatically when reconnected.

**Architecture:** Keep `SocialConnection` as the durable Page identity. Disconnect clears credentials and marks the record `disconnected`; reconnect upserts the same `(userId, pageId)` record, preserving `_id` so existing `Post.connectionId` references rebind automatically. No `Post` migration is needed.

**Tech Stack:** Express 5 / TypeScript / Mongoose 9 / MongoDB Atlas, Next.js 16 / React 19 / Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-10-23-queue-survives-disconnect-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `backend/src/services/connectionLifecycleService.ts` | Pure connection-state decisions: busy check, publishability, reconnect schedule |
| `backend/src/services/connectionLifecycleService.test.ts` | Unit tests for those decisions |
| `backend/src/models/socialConnectionModel.ts` | Add `disconnected`; make token optional |
| `backend/src/services/schedulerService.ts` | Only schedule active connections; share stale-lock constant |
| `backend/src/services/credentialService.ts` | Do not mark disconnected Pages as `needs_reauth` |
| `backend/src/controllers/connectionController.ts` | Soft disconnect, reconnect schedule, queue counts, safe responses |
| `backend/src/routes/connectionRoutes.ts` | Wire the renamed disconnect handler |
| `backend/src/controllers/postController.ts` | Publish guards and populated connection status |
| `frontend/src/lib/types.ts` | Status/count types |
| `frontend/src/lib/apiClient.ts` | `connectionsApi.disconnect` |
| `frontend/src/components/ConnectionCard.tsx` | Disconnected card, count, reconnect action |
| `frontend/src/app/connections/page.tsx` | Keep the card after disconnect |
| `frontend/src/app/queue/page.tsx` | Disconnected badge and blocked publish actions |
| `frontend/src/app/composer/page.tsx` | Only allow active destinations |
| `frontend/src/components/Dashboards.tsx` | Admin “Disconnected” badge |

---

### Task 1: Backend Connection Lifecycle Decisions

**Files:**
- Create: `backend/src/services/connectionLifecycleService.ts`
- Create: `backend/src/services/connectionLifecycleService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/connectionLifecycleService.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    STALE_LOCK_MS,
    canPublishWithStatus,
    isConnectionBusy,
    shouldRecomputeScheduleOnReconnect,
} from './connectionLifecycleService.js';

const NOW = new Date('2026-10-23T10:00:00.000Z');

test('a fresh scheduler lock blocks disconnect', () => {
    assert.equal(
        isConnectionBusy(new Date(NOW.getTime() - 1_000), null, NOW),
        true
    );
});

test('a fresh publishing post blocks disconnect', () => {
    assert.equal(
        isConnectionBusy(null, new Date(NOW.getTime() - 1_000), NOW),
        true
    );
});

test('no lock or publishing post does not block disconnect', () => {
    assert.equal(isConnectionBusy(null, null, NOW), false);
});

test('stale locks and publishing posts do not block disconnect', () => {
    const stale = new Date(NOW.getTime() - STALE_LOCK_MS - 1);
    assert.equal(isConnectionBusy(stale, stale, NOW), false);
});

test('only active connections can publish', () => {
    assert.equal(canPublishWithStatus('active'), true);
    assert.equal(canPublishWithStatus('needs_reauth'), false);
    assert.equal(canPublishWithStatus('disconnected'), false);
});

test('reconnect recomputes an active schedule after a gap', () => {
    assert.equal(
        shouldRecomputeScheduleOnReconnect('disconnected', true),
        true
    );
    assert.equal(
        shouldRecomputeScheduleOnReconnect('needs_reauth', true),
        true
    );
});

test('reconnect preserves an active or paused schedule', () => {
    assert.equal(
        shouldRecomputeScheduleOnReconnect('active', true),
        false
    );
    assert.equal(
        shouldRecomputeScheduleOnReconnect('disconnected', false),
        false
    );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd backend
node --import tsx --test src/services/connectionLifecycleService.test.ts
```

Expected: FAIL with a module-not-found error for `connectionLifecycleService.js`.

- [ ] **Step 3: Implement the lifecycle service**

Create `backend/src/services/connectionLifecycleService.ts`:

```ts
import type { ConnectionTokenStatus } from '../models/socialConnectionModel.js';

/** A scheduler lock or publishing post older than this is treated as stale. */
export const STALE_LOCK_MS = 15 * 60 * 1000;

export function isConnectionBusy(
    lockedAt: Date | null,
    publishingUpdatedAt: Date | null,
    now: Date = new Date()
): boolean {
    const cutoff = now.getTime() - STALE_LOCK_MS;
    const freshLock = lockedAt !== null && lockedAt.getTime() >= cutoff;
    const freshPublishing =
        publishingUpdatedAt !== null &&
        publishingUpdatedAt.getTime() >= cutoff;
    return freshLock || freshPublishing;
}

export function canPublishWithStatus(
    status: ConnectionTokenStatus
): boolean {
    return status === 'active';
}

export function shouldRecomputeScheduleOnReconnect(
    previousStatus: ConnectionTokenStatus,
    isActive: boolean
): boolean {
    return isActive && previousStatus !== 'active';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd backend
node --import tsx --test src/services/connectionLifecycleService.test.ts
```

Expected: 7 tests pass, 0 fail.

- [ ] **Step 5: Run the full backend test suite**

Run:

```bash
cd backend
npm test
```

Expected: `# pass 24`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/connectionLifecycleService.ts backend/src/services/connectionLifecycleService.test.ts
git commit -m "feat: add connection lifecycle decisions"
```

---

### Task 2: Connection Status and Scheduler Guards

**Files:**
- Modify: `backend/src/models/socialConnectionModel.ts`
- Modify: `backend/src/services/schedulerService.ts`
- Modify: `backend/src/services/credentialService.ts`

- [ ] **Step 1: Add the disconnected status and optional token**

In `backend/src/models/socialConnectionModel.ts`, replace:

```ts
export type ConnectionTokenStatus = 'active' | 'needs_reauth';
```

with:

```ts
export type ConnectionTokenStatus = 'active' | 'needs_reauth' | 'disconnected';
```

Replace:

```ts
        pageAccessTokenEnc: { type: String, required: true, select: false },
        tokenStatus: {
            type: String,
            enum: ['active', 'needs_reauth'],
            default: 'active',
        },
```

with:

```ts
        pageAccessTokenEnc: { type: String, default: '', select: false },
        tokenStatus: {
            type: String,
            enum: ['active', 'needs_reauth', 'disconnected'],
            default: 'active',
        },
```

Do not add a schema-level “required when active” validator. The field is `select: false`, and several update paths save the document without loading it.

- [ ] **Step 2: Make the scheduler use the shared stale-lock constant and skip disconnected Pages**

In `backend/src/services/schedulerService.ts`, replace:

```ts
import { env } from '../config/env.js';
import { Post } from '../models/postModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import { publishPost } from './publishService.js';
import { computeNextRunAt } from './timeService.js';

const STALE_LOCK_MS = 15 * 60 * 1000;
```

with:

```ts
import { env } from '../config/env.js';
import { Post } from '../models/postModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import { STALE_LOCK_MS } from './connectionLifecycleService.js';
import { publishPost } from './publishService.js';
import { computeNextRunAt } from './timeService.js';
```

Replace:

```ts
    const missing = await SocialConnection.find({
        isActive: true,
        nextRunAt: null,
    });
```

with:

```ts
    const missing = await SocialConnection.find({
        isActive: true,
        tokenStatus: 'active',
        nextRunAt: null,
    });
```

- [ ] **Step 3: Stop converting intentional disconnects into reconnect-needed**

In `backend/src/services/credentialService.ts`, replace:

```ts
    await SocialConnection.updateMany(
        { userId },
        {
            $set: {
                tokenStatus: 'needs_reauth',
```

with:

```ts
    await SocialConnection.updateMany(
        { userId, tokenStatus: { $ne: 'disconnected' } },
        {
            $set: {
                tokenStatus: 'needs_reauth',
```

- [ ] **Step 4: Build and test**

Run:

```bash
cd backend
npm run build
npm test
```

Expected: build succeeds with no output; 24 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/socialConnectionModel.ts backend/src/services/schedulerService.ts backend/src/services/credentialService.ts
git commit -m "feat: add disconnected connection status"
```

---

### Task 3: Soft Disconnect, Reconnect, and Queue Counts

**Files:**
- Modify: `backend/src/controllers/connectionController.ts`
- Modify: `backend/src/routes/connectionRoutes.ts`

- [ ] **Step 1: Add imports and connection response helpers**

In `backend/src/controllers/connectionController.ts`, replace the current model and service imports:

```ts
import { Post } from '../models/postModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import { getMetaCredentials } from '../services/credentialService.js';
```

with:

```ts
import { Post } from '../models/postModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import type { ISocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import {
    isConnectionBusy,
    shouldRecomputeScheduleOnReconnect,
} from '../services/connectionLifecycleService.js';
import { getMetaCredentials } from '../services/credentialService.js';
```

After `findOwnedConnection`, add:

```ts
async function queuedCountFor(connectionId: string): Promise<number> {
    return Post.countDocuments({ connectionId, status: 'queued' });
}

function connectionResponse(
    connection: ISocialConnection,
    queuedCount: number
): Record<string, unknown> {
    const safe = connection.toObject() as Record<string, unknown>;
    delete safe.pageAccessTokenEnc;
    return { ...safe, queuedCount };
}
```

- [ ] **Step 2: Include queue counts in the connection list**

Replace the current `listConnections` body:

```ts
export async function listConnections(req: Request, res: Response): Promise<void> {
    const connections = await SocialConnection.find({ userId: req.user.id })
        .select('-pageAccessTokenEnc')
        .sort({ createdAt: -1 });

    res.json({ success: true, connections });
}
```

with:

```ts
export async function listConnections(req: Request, res: Response): Promise<void> {
    const connections = await SocialConnection.find({ userId: req.user.id })
        .select('-pageAccessTokenEnc')
        .sort({ createdAt: -1 });

    const counts = await Promise.all(
        connections.map((connection) =>
            queuedCountFor(connection._id.toString())
        )
    );

    res.json({
        success: true,
        connections: connections.map((connection, index) =>
            connectionResponse(connection, counts[index] ?? 0)
        ),
    });
}
```

- [ ] **Step 3: Recompute schedules correctly on reconnect**

In `upsertPagesForUser()`, replace the existing `if (existing) { ... }` block with:

```ts
        if (existing) {
            const hadInstagram = Boolean(existing.instagram?.id);
            const previousStatus = existing.tokenStatus;

            existing.pageName = page.name;
            existing.pageAccessTokenEnc = encryptSecret(page.access_token);
            existing.tokenStatus = 'active';
            existing.instagram = instagram;
            existing.lastError = '';
            existing.lockedAt = null;

            if (instagram && !hadInstagram) {
                existing.publishToInstagram = true;
            }
            if (!instagram) {
                existing.publishToInstagram = false;
            }

            if (!existing.isActive) {
                existing.nextRunAt = null;
            } else if (
                shouldRecomputeScheduleOnReconnect(
                    previousStatus,
                    existing.isActive
                )
            ) {
                existing.nextRunAt = computeNextRunAt(
                    existing.dailyTime,
                    existing.timezone
                );
            } else if (!existing.nextRunAt) {
                existing.nextRunAt = computeNextRunAt(
                    existing.dailyTime,
                    existing.timezone
                );
            }

            await existing.save();
        } else {
```

Leave the existing `else` creation block unchanged.

- [ ] **Step 4: Keep disconnected and paused schedules empty**

In `updateConnection`, replace:

```ts
    if (
        parsed.dailyTime !== undefined ||
        parsed.timezone !== undefined ||
        parsed.isActive === true ||
        !connection.nextRunAt
    ) {
        connection.nextRunAt = computeNextRunAt(
            connection.dailyTime,
            connection.timezone
        );
    }

    await connection.save();

    res.json({ success: true, connection: connection.toObject() });
```

with:

```ts
    if (!connection.isActive || connection.tokenStatus !== 'active') {
        connection.nextRunAt = null;
    } else if (
        parsed.dailyTime !== undefined ||
        parsed.timezone !== undefined ||
        parsed.isActive === true ||
        !connection.nextRunAt
    ) {
        connection.nextRunAt = computeNextRunAt(
            connection.dailyTime,
            connection.timezone
        );
    }

    await connection.save();

    const queuedCount = await queuedCountFor(connection._id.toString());
    res.json({
        success: true,
        connection: connectionResponse(connection, queuedCount),
    });
```

- [ ] **Step 5: Replace hard delete with soft disconnect**

Replace the entire `deleteConnection` function:

```ts
export async function deleteConnection(req: Request, res: Response): Promise<void> {
    const connection = await findOwnedConnection(String(req.params.id), req.user.id);

    await Post.deleteMany({ connectionId: connection._id });
    await connection.deleteOne();

    res.json({ success: true, message: 'Connection removed' });
}
```

with:

```ts
export async function disconnectConnection(req: Request, res: Response): Promise<void> {
    const connection = await findOwnedConnection(String(req.params.id), req.user.id);

    if (connection.tokenStatus === 'disconnected') {
        const queuedCount = await queuedCountFor(connection._id.toString());
        res.json({
            success: true,
            message: 'Page already disconnected. Queued posts are kept.',
            connection: connectionResponse(connection, queuedCount),
            queuedCount,
        });
        return;
    }

    const publishing = await Post.findOne({
        connectionId: connection._id,
        status: 'publishing',
    })
        .sort({ updatedAt: -1 })
        .select('updatedAt');

    if (
        isConnectionBusy(
            connection.lockedAt,
            publishing?.updatedAt ?? null
        )
    ) {
        throw new AppError(
            409,
            'Wait for the current post to finish before disconnecting this Page.',
            'POST_IN_PROGRESS'
        );
    }

    const updated = await SocialConnection.findOneAndUpdate(
        { _id: connection._id, userId: req.user.id },
        {
            $set: {
                pageAccessTokenEnc: '',
                tokenStatus: 'disconnected',
                nextRunAt: null,
                lockedAt: null,
                lastError: '',
            },
        },
        { new: true, runValidators: true }
    ).select('-pageAccessTokenEnc');

    if (!updated) {
        throw new AppError(404, 'Connection not found', 'CONNECTION_NOT_FOUND');
    }

    const queuedCount = await queuedCountFor(updated._id.toString());
    res.json({
        success: true,
        message: 'Page disconnected. Queued posts are kept.',
        connection: connectionResponse(updated, queuedCount),
        queuedCount,
    });
}
```

- [ ] **Step 6: Wire the renamed handler**

In `backend/src/routes/connectionRoutes.ts`, replace `deleteConnection` in the import and route:

```ts
import {
    completeMetaOAuth,
    deleteConnection,
    listConnections,
    metaOAuthCallback,
    startMetaOAuth,
    updateConnection,
} from '../controllers/connectionController.js';
```

with:

```ts
import {
    completeMetaOAuth,
    disconnectConnection,
    listConnections,
    metaOAuthCallback,
    startMetaOAuth,
    updateConnection,
} from '../controllers/connectionController.js';
```

Replace:

```ts
router.delete('/:id', protect, deleteConnection);
```

with:

```ts
router.delete('/:id', protect, disconnectConnection);
```

- [ ] **Step 7: Build and test**

Run:

```bash
cd backend
npm run build
npm test
```

Expected: build succeeds with no output; 24 tests pass, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/connectionController.ts backend/src/routes/connectionRoutes.ts
git commit -m "feat: soft disconnect pages and keep queued posts"
```

---

### Task 4: Block Publishing for Disconnected Pages

**Files:**
- Modify: `backend/src/controllers/postController.ts`

- [ ] **Step 1: Add the publishability helper**

In `backend/src/controllers/postController.ts`, add this import after the `SocialConnection` import:

```ts
import type { ConnectionTokenStatus } from '../models/socialConnectionModel.js';
import { canPublishWithStatus } from '../services/connectionLifecycleService.js';
```

After `ownedPost`, add:

```ts
function assertConnectionCanPublish(
    connection: { tokenStatus: ConnectionTokenStatus },
    action: 'publish' | 'retry' = 'publish'
): void {
    if (canPublishWithStatus(connection.tokenStatus)) return;

    if (connection.tokenStatus === 'disconnected') {
        throw new AppError(
            409,
            'This Page is disconnected. Reconnect it before publishing.',
            'PAGE_DISCONNECTED'
        );
    }

    throw new AppError(
        409,
        `This Page needs to be reconnected before ${
            action === 'retry' ? 'retrying' : 'publishing'
        }.`,
        'RECONNECT_REQUIRED'
    );
}
```

- [ ] **Step 2: Replace the old needs-reauth checks**

In `createPost`, replace:

```ts
    if (connection.tokenStatus === 'needs_reauth') {
        throw new AppError(
            409,
            'This Page needs to be reconnected before publishing',
            'RECONNECT_REQUIRED'
        );
    }
```

with:

```ts
    assertConnectionCanPublish(connection);
```

In `publishNow`, replace:

```ts
    if (connection.tokenStatus === 'needs_reauth') {
        throw new AppError(
            409,
            'This Page needs to be reconnected before publishing',
            'RECONNECT_REQUIRED'
        );
    }
```

with:

```ts
    assertConnectionCanPublish(connection);
```

In `retryPost`, replace:

```ts
    if (connection.tokenStatus === 'needs_reauth') {
        throw new AppError(
            409,
            'This Page needs to be reconnected before retrying',
            'RECONNECT_REQUIRED'
        );
    }
```

with:

```ts
    assertConnectionCanPublish(connection, 'retry');
```

- [ ] **Step 3: Populate the connection status for the Queue page**

In `listPosts`, replace:

```ts
        .populate('connectionId', 'pageName pageId instagram');
```

with:

```ts
        .populate('connectionId', 'pageName pageId instagram tokenStatus');
```

- [ ] **Step 4: Build and test**

Run:

```bash
cd backend
npm run build
npm test
```

Expected: build succeeds with no output; 24 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/postController.ts
git commit -m "feat: block publishing for disconnected pages"
```

---

### Task 5: Frontend Types and API Client

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/apiClient.ts`
- Modify: `frontend/src/components/ConnectionCard.tsx` (call-site compatibility only)

- [ ] **Step 1: Extend the frontend types**

In `frontend/src/lib/types.ts`, replace:

```ts
export type TokenStatus = 'active' | 'needs_reauth';
```

with:

```ts
export type TokenStatus = 'active' | 'needs_reauth' | 'disconnected';
```

In `SocialConnection`, add:

```ts
    queuedCount?: number;
```

after `lastError`.

In `PostConnection`, add:

```ts
    tokenStatus: TokenStatus;
```

after `instagram`.

The resulting interfaces should include:

```ts
export interface SocialConnection {
    _id: string;
    pageId: string;
    pageName: string;
    tokenStatus: TokenStatus;
    instagram: InstagramAccount | null;
    dailyTime: string;
    timezone: string;
    publishToFacebook: boolean;
    publishToInstagram: boolean;
    isActive: boolean;
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastError: string;
    queuedCount?: number;
    createdAt: string;
    updatedAt: string;
}

export interface PostConnection {
    _id: string;
    pageName: string;
    pageId: string;
    instagram?: InstagramAccount | null;
    tokenStatus: TokenStatus;
}
```

- [ ] **Step 2: Rename the API wrapper**

In `frontend/src/lib/apiClient.ts`, replace:

```ts
    remove: (connectionId: string) => api.delete(`/connections/${connectionId}`),
```

with:

```ts
    disconnect: (connectionId: string) =>
        api.delete(`/connections/${connectionId}`),
```

- [ ] **Step 3: Rename the one existing call site**

In `frontend/src/components/ConnectionCard.tsx`, replace:

```ts
            await connectionsApi.remove(connection._id);
```

with:

```ts
            await connectionsApi.disconnect(connection._id);
```

This keeps the tree compiling. The behavior still removes the card locally until Task 6 updates the callback.

- [ ] **Step 4: Typecheck**

Run:

```bash
cd frontend
npx tsc --noEmit
```

Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/apiClient.ts frontend/src/components/ConnectionCard.tsx
git commit -m "feat: add disconnected frontend types"
```

---

### Task 6: Disconnected Card and Connections Page

**Files:**
- Modify: `frontend/src/components/ConnectionCard.tsx`
- Modify: `frontend/src/app/connections/page.tsx`

- [ ] **Step 1: Update the card props and derived state**

In `frontend/src/components/ConnectionCard.tsx`, replace:

```ts
interface ConnectionCardProps {
    connection: SocialConnection;
    onUpdated: (connection: SocialConnection) => void;
    onRemoved: (connectionId: string) => void;
}

export function ConnectionCard({
    connection,
    onUpdated,
    onRemoved,
}: ConnectionCardProps) {
```

with:

```ts
interface ConnectionCardProps {
    connection: SocialConnection;
    onUpdated: (connection: SocialConnection) => void;
    onDisconnected: (connection: SocialConnection) => void;
}

export function ConnectionCard({
    connection,
    onUpdated,
    onDisconnected,
}: ConnectionCardProps) {
```

After the `confirmOpen` state, add:

```ts
    const isDisconnected = connection.tokenStatus === 'disconnected';
    const needsReauth = connection.tokenStatus === 'needs_reauth';
    const queuedCount = connection.queuedCount ?? 0;
    const queuedLabel = `${queuedCount} queued ${
        queuedCount === 1 ? 'post' : 'posts'
    }`;
```

- [ ] **Step 2: Replace the destructive disconnect call**

Replace:

```ts
    const disconnect = async () => {
        try {
            await connectionsApi.disconnect(connection._id);
            onRemoved(connection._id);
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not remove connection');
        }
    };
```

with:

```ts
    const disconnect = async () => {
        try {
            const data: any = await connectionsApi.disconnect(connection._id);
            if (data.connection) onDisconnected(data.connection);
            setConfirmOpen(false);
        } catch (err: any) {
            setError(
                typeof err === 'string' ? err : 'Could not disconnect Page'
            );
        }
    };
```

- [ ] **Step 3: Update the confirmation dialog**

Replace the `Modal` message:

```tsx
                message={`This removes ${connection.pageName} and deletes its queued posts from Meta-Bru. Published history will also be removed.`}
```

with:

```tsx
                message={`Disconnect ${connection.pageName}? Your ${queuedLabel} and published history will be kept. If the schedule is active, it will resume when you reconnect this same Page.`}
```

- [ ] **Step 4: Update status badges and the header action**

Replace the current badge block:

```tsx
                            {connection.tokenStatus === 'needs_reauth' ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                    Reconnect needed
                                </span>
                            ) : null}
                            {!connection.isActive ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                    Paused
                                </span>
                            ) : null}
```

with:

```tsx
                            {isDisconnected ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-300 border border-slate-500/20">
                                    Disconnected
                                </span>
                            ) : null}
                            {needsReauth ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                    Reconnect needed
                                </span>
                            ) : null}
                            {!connection.isActive && !isDisconnected ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                    Paused
                                </span>
                            ) : null}
                            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                {queuedCount} {queuedCount === 1 ? 'post' : 'posts'} waiting
                            </span>
```

Replace the header action button:

```tsx
                <button
                    onClick={() => setConfirmOpen(true)}
                    className="self-start text-xs font-bold text-rose-400 hover:text-rose-300 px-3 py-2 rounded-lg hover:bg-rose-500/10 transition-all"
                >
                    Disconnect
                </button>
```

with:

```tsx
                {isDisconnected ? (
                    <button
                        onClick={reconnect}
                        className="self-start text-xs font-bold text-indigo-300 hover:text-indigo-200 px-3 py-2 rounded-lg hover:bg-indigo-500/10 transition-all"
                    >
                        Reconnect
                    </button>
                ) : (
                    <button
                        onClick={() => setConfirmOpen(true)}
                        className="self-start text-xs font-bold text-rose-400 hover:text-rose-300 px-3 py-2 rounded-lg hover:bg-rose-500/10 transition-all"
                    >
                        Disconnect
                    </button>
                )}
```

- [ ] **Step 5: Replace the reconnect banner block**

Replace the current `needs_reauth` banner:

```tsx
            {connection.tokenStatus === 'needs_reauth' ? (
                <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span>
                        Meta rejected this Page token. Reconnect to resume
                        scheduled posting.
                    </span>
                    <button
                        onClick={reconnect}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-black"
                    >
                        Reconnect
                    </button>
                </div>
            ) : null}
```

with:

```tsx
            {isDisconnected ? (
                <div className="mt-5 rounded-2xl border border-slate-500/20 bg-slate-500/10 px-4 py-3 text-sm text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span>
                        This Page is disconnected.{' '}
                        {queuedCount > 0
                            ? `${queuedLabel} will wait for this Page.`
                            : 'There are no queued posts waiting.'}{' '}
                        Reconnect the Facebook account that manages it to
                        resume.
                    </span>
                    <button
                        onClick={reconnect}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-black"
                    >
                        Reconnect
                    </button>
                </div>
            ) : null}

            {needsReauth ? (
                <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span>
                        Meta rejected this Page token. Reconnect to resume
                        scheduled posting.
                    </span>
                    <button
                        onClick={reconnect}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-black"
                    >
                        Reconnect
                    </button>
                </div>
            ) : null}
```

- [ ] **Step 6: Update the Next slot display**

Replace:

```tsx
                        {connection.isActive
                            ? formatDate(connection.nextRunAt)
                            : 'Paused'}
```

with:

```tsx
                        {isDisconnected
                            ? 'Waiting for reconnect'
                            : connection.isActive
                              ? formatDate(connection.nextRunAt)
                              : 'Paused'}
```

- [ ] **Step 7: Keep the card after disconnect**

In `frontend/src/app/connections/page.tsx`, replace:

```ts
    const updateConnection = (updated: SocialConnection) => {
        setConnections((current) =>
            current.map((connection) =>
                connection._id === updated._id ? updated : connection
            )
        );
        setNotice('Connection settings saved.');
    };

    const removeConnection = (connectionId: string) => {
        setConnections((current) =>
            current.filter((connection) => connection._id !== connectionId)
        );
        setNotice('Connection removed.');
    };
```

with:

```ts
    const mergeConnection = (updated: SocialConnection) => {
        setConnections((current) =>
            current.map((connection) =>
                connection._id === updated._id
                    ? {
                          ...connection,
                          ...updated,
                          queuedCount:
                              updated.queuedCount ?? connection.queuedCount,
                      }
                    : connection
            )
        );
    };

    const updateConnection = (updated: SocialConnection) => {
        mergeConnection(updated);
        setNotice('Connection settings saved.');
    };

    const disconnectConnection = (updated: SocialConnection) => {
        mergeConnection(updated);
        setNotice(
            'Page disconnected. Queued posts will resume when you reconnect this Page.'
        );
    };
```

Replace the card props:

```tsx
                            onUpdated={updateConnection}
                            onRemoved={removeConnection}
```

with:

```tsx
                            onUpdated={updateConnection}
                            onDisconnected={disconnectConnection}
```

- [ ] **Step 8: Typecheck**

Run:

```bash
cd frontend
npx tsc --noEmit
```

Expected: no output, exit code 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/ConnectionCard.tsx frontend/src/app/connections/page.tsx
git commit -m "feat: show disconnected page cards"
```

---

### Task 7: Queue Shows Disconnected Destinations

**Files:**
- Modify: `frontend/src/app/queue/page.tsx`

- [ ] **Step 1: Add a destination-status helper**

After `matchesTab`, add:

```ts
function destinationStatus(post: Post) {
    return typeof post.connectionId === 'string'
        ? null
        : post.connectionId.tokenStatus;
}
```

- [ ] **Step 2: Convert the queue item map to a block body**

Change the opening of the visible-posts map:

```tsx
                    {visible.map((post) => (
                        <article
```

to:

```tsx
                    {visible.map((post) => {
                        const status = destinationStatus(post);
                        const publishBlocked =
                            status === 'disconnected' ||
                            status === 'needs_reauth';

                        return (
                            <article
```

At the end of the map, change:

```tsx
                        </article>
                    ))}
```

to:

```tsx
                            </article>
                        );
                    })}
```

Do not change the existing `<article>` contents in this step; only change the map wrapper from an implicit return to an explicit return.

- [ ] **Step 3: Add the disconnected badge next to the Page name**

Replace:

```tsx
                                        <span className="text-xs text-slate-500">
                                            {connectionName(post)}
                                        </span>
```

with:

```tsx
                                        <span className="text-xs text-slate-500">
                                            {connectionName(post)}
                                        </span>
                                        {status === 'disconnected' ||
                                        status === 'needs_reauth' ? (
                                            <Link
                                                href="/connections"
                                                className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${
                                                    status === 'disconnected'
                                                        ? 'bg-slate-500/10 text-slate-300 border-slate-500/20'
                                                        : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                                }`}
                                            >
                                                {status === 'disconnected'
                                                    ? 'Page disconnected'
                                                    : 'Reconnect needed'}
                                            </Link>
                                        ) : null}
```

- [ ] **Step 4: Disable publish actions for disconnected destinations**

Replace the Post now button:

```tsx
                                        <button
                                            onClick={() => publishNow(post)}
                                            disabled={busyId === post._id}
                                            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                        >
```

with:

```tsx
                                        <button
                                            onClick={() => publishNow(post)}
                                            disabled={
                                                busyId === post._id ||
                                                publishBlocked
                                            }
                                            title={
                                                publishBlocked
                                                    ? 'Reconnect this Page before publishing.'
                                                    : undefined
                                            }
                                            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                        >
```

Replace the Retry button:

```tsx
                                        <button
                                            onClick={() => retry(post)}
                                            disabled={busyId === post._id}
                                            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                        >
```

with:

```tsx
                                        <button
                                            onClick={() => retry(post)}
                                            disabled={
                                                busyId === post._id ||
                                                publishBlocked
                                            }
                                            title={
                                                publishBlocked
                                                    ? 'Reconnect this Page before retrying.'
                                                    : undefined
                                            }
                                            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                        >
```

- [ ] **Step 5: Typecheck**

Run:

```bash
cd frontend
npx tsc --noEmit
```

Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/queue/page.tsx
git commit -m "feat: mark disconnected pages in the queue"
```

---

### Task 8: Composer and Admin Status

**Files:**
- Modify: `frontend/src/app/composer/page.tsx`
- Modify: `frontend/src/components/Dashboards.tsx`

- [ ] **Step 1: Add the active-connection list**

In `frontend/src/app/composer/page.tsx`, after `selectedConnection`, add:

```ts
    const activeConnections = useMemo(
        () =>
            connections.filter(
                (connection) => connection.tokenStatus === 'active'
            ),
        [connections]
    );
```

- [ ] **Step 2: Block stale or inactive destinations**

Replace:

```ts
        if (selectedConnection?.tokenStatus === 'needs_reauth') {
            setError('Reconnect this Page before publishing.');
            return;
        }
```

with:

```ts
        if (selectedConnection?.tokenStatus !== 'active') {
            setError(
                selectedConnection?.tokenStatus === 'disconnected'
                    ? 'This Page is disconnected. Reconnect it under Connections.'
                    : 'Reconnect this Page before publishing.'
            );
            return;
        }
```

- [ ] **Step 3: Only show active destinations**

Replace the composer empty-state condition:

```tsx
            ) : connections.length === 0 ? (
```

with:

```tsx
            ) : activeConnections.length === 0 ? (
```

Replace the empty-state copy:

```tsx
                    <div className="text-xl font-bold text-white">
                        Connect a Page to start composing
                    </div>
                    <p className="text-sm text-slate-400 mt-2">
                        The composer needs at least one Facebook Page connection.
                    </p>
```

with:

```tsx
                    <div className="text-xl font-bold text-white">
                        No active Pages
                    </div>
                    <p className="text-sm text-slate-400 mt-2">
                        Reconnect a Page under Connections to create and publish
                        a new post.
                    </p>
```

Replace the dropdown map:

```tsx
                                {connections.map((connection) => (
```

with:

```tsx
                                {activeConnections.map((connection) => (
```

- [ ] **Step 4: Show disconnected status in the admin connection badge**

In `frontend/src/components/Dashboards.tsx`, replace the entire `ConnectionStatus` function:

```tsx
function ConnectionStatus({
    isActive,
    tokenStatus,
}: Pick<SocialConnection, 'isActive' | 'tokenStatus'>) {
    return (
        <span
            className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                !isActive
                    ? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    : tokenStatus === 'needs_reauth'
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}
        >
            {!isActive
                ? 'Paused'
                : tokenStatus === 'needs_reauth'
                  ? 'Reconnect'
                  : 'Active'}
        </span>
    );
}
```

with:

```tsx
function ConnectionStatus({
    isActive,
    tokenStatus,
}: Pick<SocialConnection, 'isActive' | 'tokenStatus'>) {
    const isDisconnected = tokenStatus === 'disconnected';
    const needsReauth = tokenStatus === 'needs_reauth';

    return (
        <span
            className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                isDisconnected
                    ? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    : needsReauth
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      : !isActive
                        ? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}
        >
            {isDisconnected
                ? 'Disconnected'
                : needsReauth
                  ? 'Reconnect'
                  : !isActive
                    ? 'Paused'
                    : 'Active'}
        </span>
    );
}
```

- [ ] **Step 5: Typecheck and lint**

Run:

```bash
cd frontend
npx tsc --noEmit
npm run lint
```

Expected: `tsc` exits 0 with no output. ESLint exits 0 with warnings only; there must be no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/composer/page.tsx frontend/src/components/Dashboards.tsx
git commit -m "feat: restrict composer to active pages"
```

---

### Task 9: End-to-End Verification

**Files:**
- No code changes expected. If verification finds a defect, fix it and commit with a focused message.

- [ ] **Step 1: Run all automated checks**

Run:

```bash
cd backend
npm test
npm run build
```

Expected: 24 tests pass, 0 fail; build exits 0.

Run:

```bash
cd frontend
npx tsc --noEmit
npm run lint
npm run build
```

Expected: typecheck exits 0; ESLint exits 0 with warnings only; production build succeeds.

- [ ] **Step 2: Start the app**

In one terminal:

```bash
cd backend
npm run dev
```

In another terminal:

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`.

- [ ] **Step 3: Verify queue survival and reconnect**

Use a test user with at least two connected Facebook Pages, each with its own linked Instagram account where possible.

1. Create a post for Page A and add it to the queue.
2. Open Connections and click Disconnect on Page A.
3. Confirm the dialog explains that queued posts and history are kept.
4. Verify Page A remains visible with a Disconnected badge and a queued count.
5. Open Queue and verify the post is still in the Queue tab with a Page disconnected badge.
6. Verify Post now and Retry failed are disabled for that post.
7. Try the API directly if needed; it must return `409 PAGE_DISCONNECTED`.
8. Verify the Published tab still shows Page A's older published posts.
9. Click Reconnect on Page A and complete Meta OAuth.
10. Verify Page A returns to Active and its queued count is unchanged.
11. Publish the queued post and verify it appears in Published.

- [ ] **Step 4: Verify isolation and paused schedules**

1. Disconnect Page A.
2. Connect Page B.
3. Verify Page A's queued post still shows Page A and was not moved to Page B.
4. Pause Page A's schedule, disconnect it, reconnect it, and verify it remains paused.
5. Activate Page A's schedule and verify a new future next-slot date appears.
6. Verify Page B's schedule and Instagram target are unaffected.

- [ ] **Step 5: Verify scheduler behavior**

1. Set Page A's daily time to a slot that is due within the next few minutes.
2. Disconnect Page A before the slot.
3. Wait for a scheduler tick.
4. Verify no post is published and the post remains queued.
5. Reconnect Page A.
6. Verify the scheduler computes a fresh future slot and does not publish a stale slot.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
```

Expected: no uncommitted changes, unless a verification fix was needed and committed.

If a fix was needed, commit it with a focused message and re-run the relevant checks.
