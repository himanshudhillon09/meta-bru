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
