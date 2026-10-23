import { env } from '../config/env.js';
import { Post } from '../models/postModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import { STALE_LOCK_MS } from './connectionLifecycleService.js';
import { publishPost } from './publishService.js';
import { computeNextRunAt } from './timeService.js';

let running = false;
let timer: NodeJS.Timeout | null = null;

async function ensureSchedules(): Promise<void> {
    const missing = await SocialConnection.find({
        isActive: true,
        tokenStatus: 'active',
        nextRunAt: null,
    });

    for (const connection of missing) {
        try {
            connection.nextRunAt = computeNextRunAt(
                connection.dailyTime,
                connection.timezone
            );
            await connection.save();
        } catch (error) {
            console.error(
                `[scheduler] Could not initialize schedule for ${connection._id}:`,
                error
            );
        }
    }
}

async function advance(connection: {
    dailyTime: string;
    timezone: string;
    nextRunAt: Date | null;
}, now: Date): Promise<void> {
    connection.nextRunAt = computeNextRunAt(connection.dailyTime, connection.timezone, now);
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
            await advance(connection, now);
            return;
        }

        const owner = await User.findById(connection.userId).select('isActive');
        if (!owner?.isActive) {
            console.warn(
                `[scheduler] Skipping connection ${connection._id}: the owning account is inactive`
            );
            connection.lastError = 'The owning account is inactive';
            await advance(connection, now);
            return;
        }

        connection.lastError = '';

        // Claim the daily slot before publishing. If the process crashes after
        // Meta accepts a post but before the post/connection saves, this prevents
        // the next tick from publishing a second post on the same day.
        await advance(connection, now);
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
                await advance(connection, now);
            } catch {
                connection.nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            }
        }
    } finally {
        connection.lockedAt = null;
        try {
            await connection.save();
        } catch (error) {
            console.error(`[scheduler] Could not release lock for ${connection._id}:`, error);
        }
    }
}

/**
 * Runs one scheduler pass. Exported for tests and manual triggers.
 */
export async function runSchedulerTick(now: Date = new Date()): Promise<void> {
    if (running) return;
    running = true;

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
    } finally {
        running = false;
    }
}

export function startScheduler(): void {
    if (!env.scheduler.enabled || timer) return;

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
