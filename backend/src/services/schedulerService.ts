import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { Post } from '../models/postModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import { STALE_LOCK_MS } from './connectionLifecycleService.js';
import { publishPost } from './publishService.js';
import { nextSlotOrFallback } from './scheduleService.js';
import { STORY_SYNC_INTERVAL_MS, syncStoryInsights } from './storySyncService.js';

let running = false;
/** When the scheduler last refreshed live Story insights. */
let lastStorySyncAt = 0;
let timer: NodeJS.Timeout | null = null;
/** Heartbeat for /api/health and the Queue: when it started and last checked. */
let startedAt: Date | null = null;
let lastTickAt: Date | null = null;

export function schedulerStatus(): {
    enabled: boolean;
    startedAt: string | null;
    lastTickAt: string | null;
    intervalSeconds: number;
} {
    return {
        enabled: env.scheduler.enabled,
        startedAt: startedAt?.toISOString() ?? null,
        lastTickAt: lastTickAt?.toISOString() ?? null,
        intervalSeconds: env.scheduler.intervalMs / 1000,
    };
}

async function ensureSchedules(): Promise<void> {
    const missing = await SocialConnection.find({
        isActive: true,
        tokenStatus: 'active',
        nextRunAt: null,
    });

    for (const connection of missing) {
        try {
            const slot = nextSlotOrFallback(
                connection.dailyTimes,
                connection.timezone
            );
            connection.nextRunAt = slot.nextRunAt;
            if (slot.error) connection.lastError = slot.error;
            await connection.save();
        } catch (error) {
            console.error(
                `[scheduler] Could not initialize schedule for ${connection._id}:`,
                error
            );
        }
    }
}

/**
 * Moves the connection to its first slot after `now`. Missed slots collapse
 * into this one move. Returns an error message when the stored schedule was
 * unusable and a fallback slot was used.
 */
function advance(
    connection: { dailyTimes: string[]; timezone: string; nextRunAt: Date | null },
    now: Date
): string {
    const slot = nextSlotOrFallback(connection.dailyTimes, connection.timezone, now);
    connection.nextRunAt = slot.nextRunAt;
    return slot.error;
}

async function processConnection(connectionId: string, now: Date): Promise<void> {
    const staleLock = new Date(now.getTime() - STALE_LOCK_MS);

    const connection = await SocialConnection.findOneAndUpdate(
        {
            _id: connectionId,
            isActive: true,
            tokenStatus: 'active',
            nextRunAt: { $ne: null, $lte: now },
            $or: [{ lockedAt: null }, { lockedAt: { $lt: staleLock } }],
        },
        { $set: { lockedAt: now } },
        { new: true }
    ).select('+pageAccessTokenEnc');

    if (!connection) return;
    let scheduleError = '';

    try {
        const dueAt = connection.nextRunAt;
        if (!dueAt) return;

        const graceStart = new Date(
            now.getTime() - env.scheduler.graceMinutes * 60_000
        );

        // If the server was down for too long, skip this slot instead of
        // publishing a stale post hours late.
        if (dueAt.getTime() < graceStart.getTime()) {
            console.warn(
                `[scheduler] Skipping stale slot for connection ${connection._id} (due ${dueAt.toISOString()})`
            );
            // Say why nothing posted, so a sleeping server is visible in the app.
            const missed = DateTime.fromJSDate(dueAt).setZone(connection.timezone);
            connection.lastError = `Missed the ${
                missed.isValid ? missed.toFormat('d LLL, HH:mm') : dueAt.toISOString()
            } slot because the server was not running then. The next queued post goes at the next slot.`;
            scheduleError = advance(connection, now);
            return;
        }

        const owner = await User.findById(connection.userId).select('isActive');
        if (!owner?.isActive) {
            console.warn(
                `[scheduler] Skipping connection ${connection._id}: the owning account is inactive`
            );
            connection.lastError = 'The owning account is inactive';
            scheduleError = advance(connection, now);
            return;
        }

        connection.lastError = '';

        // Claim the daily slot before publishing. If the process crashes after
        // Meta accepts a post but before the post/connection saves, this prevents
        // the next tick from publishing a second post on the same day.
        scheduleError = advance(connection, now);
        await connection.save();

        // Claim the oldest queued post atomically so a manual "Post now"
        // cannot publish the same post at the same time.
        const post = await Post.findOneAndUpdate(
            {
                connectionId: connection._id,
                status: 'queued',
            },
            { $set: { status: 'publishing' } },
            { new: true, sort: { createdAt: 1 } }
        );

        if (!post) {
            return;
        }

        console.log(
            `[scheduler] Publishing post ${post._id} to connection ${connection._id}`
        );
        await publishPost(post, connection);

        connection.lastRunAt = now;
        connection.lastError = post.lastError;
    } catch (error) {
        connection.lastError =
            error instanceof Error ? error.message : 'Scheduler error';
        console.error(`[scheduler] Connection ${connection._id} failed:`, error);
        // The slot is advanced before publishing; only calculate a fallback
        // when the failure happened before that point.
        if (connection.nextRunAt && connection.nextRunAt <= now) {
            try {
                scheduleError = advance(connection, now);
            } catch {
                connection.nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            }
        }
    } finally {
        try {
            await SocialConnection.updateOne(
                {
                    _id: connection._id,
                    lockedAt: now,
                    tokenStatus: { $ne: 'disconnected' },
                },
                {
                    $set: {
                        lockedAt: null,
                        nextRunAt: connection.nextRunAt,
                        lastRunAt: connection.lastRunAt,
                        // A publish error is more useful than a schedule error.
                        lastError: connection.lastError || scheduleError,
                    },
                }
            );
        } catch (error) {
            console.error(
                `[scheduler] Could not release lock for ${connection._id}:`,
                error
            );
        }
    }
}

/**
 * Runs one scheduler pass. Exported for tests and manual triggers.
 */
export async function runSchedulerTick(now: Date = new Date()): Promise<void> {
    if (running) return;
    running = true;
    lastTickAt = new Date();

    try {
        const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);

        // A crash mid-publish leaves posts in "publishing". Do not retry them
        // automatically: a Facebook request may have succeeded before the crash.
        await Post.updateMany(
            { status: 'publishing', updatedAt: { $lt: staleBefore } },
            {
                $set: {
                    status: 'failed',
                    lastError:
                        'Publishing was interrupted. Check the page before retrying to avoid a duplicate.',
                    'targets.$[target].status': 'failed',
                    'targets.$[target].error':
                        'Publishing was interrupted before this platform finished.',
                },
            },
            {
                arrayFilters: [
                    { 'target.status': { $in: ['pending', 'publishing'] } },
                ],
            }
        );

        const due = await SocialConnection.find({
            isActive: true,
            tokenStatus: 'active',
            nextRunAt: { $ne: null, $lte: now },
        })
            .select('_id')
            .limit(20);

        for (const connection of due) {
            await processConnection(connection._id.toString(), now);
        }

        // Meta drops Story insights after 24 hours, so save them while live.
        if (now.getTime() - lastStorySyncAt >= STORY_SYNC_INTERVAL_MS) {
            lastStorySyncAt = now.getTime();
            try {
                await syncStoryInsights({ now });
            } catch (error) {
                console.error('[scheduler] Story insights sync failed:', error);
            }
        }
    } finally {
        running = false;
    }
}


export function startScheduler(): void {
    if (!env.scheduler.enabled || timer) return;
    startedAt = new Date();

    void ensureSchedules().catch((error) =>
        console.error('[scheduler] Could not initialize schedules:', error)
    );
    void runSchedulerTick().catch((error) =>
        console.error('[scheduler] Initial tick failed:', error)
    );

    timer = setInterval(() => {
        void runSchedulerTick().catch((error) =>
            console.error('[scheduler] Tick failed:', error)
        );
    }, env.scheduler.intervalMs);
    timer.unref();

    console.log(
        `[scheduler] Started (every ${env.scheduler.intervalMs / 1000}s, grace ${env.scheduler.graceMinutes}m)`
    );
}

export function stopScheduler(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
