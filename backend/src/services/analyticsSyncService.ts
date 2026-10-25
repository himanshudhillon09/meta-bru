import type { QueryFilter } from 'mongoose';
import {
    SocialConnection,
    type ISocialConnection,
} from '../models/socialConnectionModel.js';
import { PostMetricSnapshot } from '../models/postMetricSnapshotModel.js';
import type { IPostMetricSnapshot } from '../models/postMetricSnapshotModel.js';
import { decryptSecret } from './cryptoService.js';
import {
    latestSnapshotsByTarget,
    loadLatestSnapshots,
    loadPublishedTargets,
    targetKey,
    type AnalyticsFilters,
    type PublishedTarget,
} from './analyticsService.js';
import type { AnalyticsRange } from './analyticsDateService.js';
import {
    fetchFacebookMetrics,
    fetchInstagramMetrics,
    type NormalizedInsightMetrics,
} from './metaInsightsService.js';
import { MetaApiError } from './metaService.js';

export type SyncMode = 'stale' | 'live';

export interface SyncResult {
    synced: number;
    failed: number;
    skipped: number;
    remaining: number;
    permissionErrors: Array<{
        connectionId: string;
        pageName: string;
        platform: string;
    }>;
    lastSyncedAt: string | null;
}

/**
 * Test-only seams. Routes and the controller always call `syncAnalytics` with
 * the four public arguments, so production behavior is unchanged.
 */
export interface SyncDependencies {
    fetchFacebook?: typeof fetchFacebookMetrics;
    fetchInstagram?: typeof fetchInstagramMetrics;
    now?: () => Date;
}

const DEDUPE_WINDOW_MS = 60_000;
const FETCH_CONCURRENCY = 3;
const DECRYPT_ERROR =
    'Stored Page token could not be decrypted. Reconnect this Page.';
const TOKEN_ERROR =
    'Meta access token is invalid or was revoked. Reconnect this Page.';

export function syncCapForMode(mode: SyncMode): number {
    return mode === 'live' ? 10 : 20;
}

export function selectStaleTargets(
    targets: PublishedTarget[],
    latest: Map<string, { capturedAt: Date }>,
    mode: SyncMode,
    now: Date
): PublishedTarget[] {
    const staleMinutes = mode === 'live' ? 5 : 15;
    const before = now.getTime() - staleMinutes * 60_000;
    return targets
        .filter((target) => {
            const snapshot = latest.get(targetKey(target.postId, target.platform));
            return !snapshot || snapshot.capturedAt.getTime() < before;
        })
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

async function mapWithConcurrency<T, R>(
    values: T[],
    limit: number,
    worker: (value: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = [];
    let index = 0;
    async function run(): Promise<void> {
        while (index < values.length) {
            const current = index;
            index += 1;
            const value = values[current];
            if (value !== undefined) results[current] = await worker(value);
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(limit, values.length) }, run)
    );
    return results;
}

async function upsertSnapshot(
    userId: string,
    target: PublishedTarget,
    result: NormalizedInsightMetrics,
    now: Date
): Promise<void> {
    // The dedupe lookup is scoped to the owner so a snapshot can never be
    // updated across users, even if a post id is reused or guessed.
    const existing = await PostMetricSnapshot.findOne({
        userId,
        postId: target.postId,
        platform: target.platform,
        capturedAt: { $gte: new Date(now.getTime() - DEDUPE_WINDOW_MS) },
    } as QueryFilter<IPostMetricSnapshot>);

    const data = {
        userId,
        connectionId: target.connectionId,
        pageId: target.pageId,
        pageName: target.pageName,
        postId: target.postId,
        platform: target.platform,
        externalId: target.externalId,
        publishedAt: target.publishedAt,
        capturedAt: now,
        metrics: result.metrics,
        availableMetrics: result.availableMetrics,
        status: result.status,
        error: result.error,
    };

    if (existing) {
        await PostMetricSnapshot.updateOne(
            { _id: existing._id, userId } as QueryFilter<IPostMetricSnapshot>,
            { $set: data }
        );
    } else {
        await PostMetricSnapshot.create(data);
    }
}

async function markNeedsReauth(
    connection: ISocialConnection,
    message: string,
    marked: Set<string>
): Promise<void> {
    const connectionId = String(connection._id);
    if (marked.has(connectionId)) return;
    marked.add(connectionId);

    await SocialConnection.updateOne(
        {
            _id: connection._id,
            userId: connection.userId,
            tokenStatus: { $ne: 'disconnected' },
        } as QueryFilter<ISocialConnection>,
        { $set: { tokenStatus: 'needs_reauth', lastError: message } }
    );
}

export async function syncAnalytics(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters,
    mode: SyncMode,
    deps: SyncDependencies = {}
): Promise<SyncResult> {
    const clock = deps.now ?? (() => new Date());
    const fetchFacebook = deps.fetchFacebook ?? fetchFacebookMetrics;
    const fetchInstagram = deps.fetchInstagram ?? fetchInstagramMetrics;

    const targets = await loadPublishedTargets(userId, range, filters);
    const snapshots = await loadLatestSnapshots(userId, targets, range);
    const latest = latestSnapshotsByTarget(snapshots);
    const stale = selectStaleTargets(targets, latest, mode, clock());
    const selected = stale.slice(0, syncCapForMode(mode));

    const connectionIds = [...new Set(selected.map((target) => target.connectionId))];
    const connections =
        connectionIds.length === 0
            ? []
            : await SocialConnection.find({
                  _id: { $in: connectionIds },
                  userId,
              } as QueryFilter<ISocialConnection>).select('+pageAccessTokenEnc');
    const connectionMap = new Map<string, ISocialConnection>(
        connections.map((connection) => [String(connection._id), connection])
    );

    // Decrypt one Page token per selected connection for the whole request.
    const tokens = new Map<string, string>();
    const decryptFailures = new Set<string>();
    for (const connection of connections) {
        const connectionId = String(connection._id);
        try {
            tokens.set(connectionId, decryptSecret(connection.pageAccessTokenEnc));
        } catch {
            decryptFailures.add(connectionId);
        }
    }

    let synced = 0;
    let failed = 0;
    let skipped = 0;
    const permissionErrors: SyncResult['permissionErrors'] = [];
    const permissionConnectionIds = new Set<string>();
    const reauthMarked = new Set<string>();

    await mapWithConcurrency(selected, FETCH_CONCURRENCY, async (target) => {
        if (!target.externalId) {
            skipped += 1;
            return;
        }

        const connection = connectionMap.get(target.connectionId);
        if (!connection) {
            skipped += 1;
            return;
        }

        if (decryptFailures.has(target.connectionId)) {
            failed += 1;
            await markNeedsReauth(connection, DECRYPT_ERROR, reauthMarked);
            return;
        }

        const token = tokens.get(target.connectionId);
        if (!token) {
            failed += 1;
            await markNeedsReauth(connection, DECRYPT_ERROR, reauthMarked);
            return;
        }

        try {
            const result =
                target.platform === 'facebook'
                    ? await fetchFacebook(target.externalId, token)
                    : await fetchInstagram(target.externalId, token);
            await upsertSnapshot(userId, target, result, clock());
            synced += 1;

            if (result.status === 'permission_error') {
                // A Page shares one connection across Facebook and Instagram.
                // Surface one reconnect action per Page, not one per target.
                if (!permissionConnectionIds.has(target.connectionId)) {
                    permissionConnectionIds.add(target.connectionId);
                    permissionErrors.push({
                        connectionId: target.connectionId,
                        pageName: target.pageName,
                        platform: target.platform,
                    });
                }
            }
        } catch (error) {
            failed += 1;
            if (error instanceof MetaApiError && error.isTokenError) {
                await markNeedsReauth(connection, TOKEN_ERROR, reauthMarked);
            }
        }
    });

    return {
        synced,
        failed,
        skipped,
        remaining: Math.max(0, stale.length - selected.length),
        permissionErrors,
        lastSyncedAt: clock().toISOString(),
    };
}
