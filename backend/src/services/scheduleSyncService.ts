import { SocialConnection } from '../models/socialConnectionModel.js';
import { STALE_LOCK_MS } from './connectionLifecycleService.js';
import { nextSlotOrFallback } from './scheduleService.js';

/**
 * Moves every Page the user owns onto their Profile timezone and returns how
 * many Pages got a new next slot. Only Pages on a different timezone are
 * touched, so calling this again is a no-op and never pushes a due slot back.
 * Paused, disconnected, and scheduler-locked Pages keep their `nextRunAt`.
 */
export async function syncConnectionTimezones(
    userId: string,
    timezone: string,
    now: Date = new Date()
): Promise<number> {
    const staleLock = now.getTime() - STALE_LOCK_MS;
    const drifted = await SocialConnection.find({
        userId,
        timezone: { $ne: timezone },
    });

    let rescheduled = 0;
    for (const connection of drifted) {
        const schedulable =
            connection.isActive &&
            connection.tokenStatus === 'active' &&
            (!connection.lockedAt || connection.lockedAt.getTime() < staleLock);
        const update: Record<string, unknown> = { timezone };
        if (schedulable) {
            const slot = nextSlotOrFallback(connection.dailyTimes, timezone, now);
            update.nextRunAt = slot.nextRunAt;
            if (slot.error) update.lastError = slot.error;
            rescheduled += 1;
        }
        await SocialConnection.updateOne(
            { _id: connection._id, userId },
            { $set: update }
        );
    }
    return rescheduled;
}
