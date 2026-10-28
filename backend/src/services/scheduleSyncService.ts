import { SocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import { STALE_LOCK_MS } from './connectionLifecycleService.js';
import {
    DEFAULT_DAILY_TIME,
    DEFAULT_TIMEZONE,
    nextSlotOrFallback,
} from './scheduleService.js';

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

/**
 * One-time upgrade from a single `dailyTime` to `dailyTimes`, plus aligning
 * every Page with its owner's Profile timezone. Safe to run on every start.
 */
export async function migrateConnectionSchedules(
    now: Date = new Date()
): Promise<{ copied: number; rescheduled: number }> {
    // Uses the native collection because `dailyTime` is no longer in the schema.
    const copied = await SocialConnection.collection.updateMany(
        {
            $or: [
                { dailyTimes: { $exists: false } },
                { dailyTimes: { $size: 0 } },
            ],
        },
        [
            {
                $set: {
                    dailyTimes: [{ $ifNull: ['$dailyTime', DEFAULT_DAILY_TIME] }],
                },
            },
            { $unset: 'dailyTime' },
        ]
    );
    await SocialConnection.collection.updateMany(
        { dailyTime: { $exists: true } },
        { $unset: { dailyTime: '' } }
    );

    let rescheduled = 0;
    const users = await User.find({}).select('timezone');
    for (const user of users) {
        rescheduled += await syncConnectionTimezones(
            String(user._id),
            user.timezone || DEFAULT_TIMEZONE,
            now
        );
    }

    return { copied: copied.modifiedCount, rescheduled };
}
