import type { Request, Response } from 'express';
import { z } from 'zod';
import {
    buildActivity,
    buildAnalyticsAiPayload,
    buildBestTimes,
    buildRuleBasedTips,
    getAnalyticsMonitor,
    getAnalyticsOverview,
    getAnalyticsPosts,
    latestSnapshotsByTarget,
    loadLatestSnapshots,
    loadPublishedTargets,
    resolvePageName,
    summarizeByContentType,
    summarizeTargets,
    targetKey,
    uniquePermissionErrors,
    type AnalyticsFilters,
} from '../services/analyticsService.js';
import {
    parseAnalyticsRange,
    type AnalyticsRange,
} from '../services/analyticsDateService.js';
import { syncAnalytics } from '../services/analyticsSyncService.js';
import { getStoryAnalytics } from '../services/storyAnalyticsService.js';
import { syncStoryInsights } from '../services/storySyncService.js';
import {
    generateAnalyticsAiInsight,
    getCachedAnalyticsAiInsight,
    hashAnalyticsAiPayload,
} from '../services/analyticsAiService.js';
import { parseBody, parseQuery } from '../utils/validation.js';

const rangeQuerySchema = z
    .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        connectionId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
        platform: z.enum(['facebook', 'instagram']).optional(),
        mediaType: z.enum(['image', 'reel']).optional(),
        userId: z.never().optional(),
    })
    .strict();

const postsQuerySchema = rangeQuerySchema.extend({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
});

const syncBodySchema = rangeQuerySchema.extend({
    mode: z.enum(['stale', 'live']).default('stale'),
});

const tipsBodySchema = rangeQuerySchema;

function rangeAndFilters(input: z.infer<typeof rangeQuerySchema>) {
    return {
        range: parseAnalyticsRange(input.from, input.to),
        filters: {
            ...(input.connectionId ? { connectionId: input.connectionId } : {}),
            ...(input.platform ? { platform: input.platform } : {}),
            ...(input.mediaType ? { mediaType: input.mediaType } : {}),
        } satisfies AnalyticsFilters,
    };
}

interface TipsContext {
    ruleBased: ReturnType<typeof buildRuleBasedTips>;
    payload: ReturnType<typeof buildAnalyticsAiPayload>;
    scopeKey: string;
    rangeKey: string;
}

async function buildTipsContext(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters,
    brandProfile: Record<string, string | undefined>
): Promise<TipsContext> {
    const targets = await loadPublishedTargets(userId, range, filters);
    const snapshots = await loadLatestSnapshots(userId, targets, range);
    const latest = latestSnapshotsByTarget(snapshots);
    const summary = summarizeTargets(targets, latest);
    const byPlatform = {
        facebook: summarizeTargets(
            targets.filter((target) => target.platform === 'facebook'),
            latest
        ),
        instagram: summarizeTargets(
            targets.filter((target) => target.platform === 'instagram'),
            latest
        ),
    };
    const byContentType = summarizeByContentType(targets, latest);
    const activity = buildActivity(targets, latest, range);
    const bestTimes = buildBestTimes(targets, latest);
    const permissionErrors = uniquePermissionErrors(targets, latest);
    const stories = (await getStoryAnalytics(userId, range, filters)).summary;
    const posts = targets.map((target) => ({
        caption: target.caption,
        mediaType: target.mediaType,
        engagementRate:
            latest.get(targetKey(target.postId, target.platform))?.metrics
                .engagementRate ?? null,
    }));
    const ruleBased = buildRuleBasedTips({
        summary,
        byPlatform,
        byContentType,
        bestTimes,
        activity,
        permissionErrors,
        posts,
        stories,
        granularity: range.granularity,
    });
    const scopeName = filters.connectionId
        ? await resolvePageName(userId, filters.connectionId, targets)
        : 'All Pages';
    const payload = buildAnalyticsAiPayload({
        range,
        scopeName,
        summary,
        byPlatform,
        byContentType,
        stories,
        activity,
        bestTimes,
        permissionErrors,
        posts: targets.map((target) => ({
            postId: target.postId,
            caption: target.caption,
            mediaType: target.mediaType,
            mediaDuration: target.mediaDuration,
            publishedAt: target.publishedAt,
            sharedToStory: target.sharedToStory,
            hasTextOverlay: target.hasTextOverlay,
            metrics: latest.get(targetKey(target.postId, target.platform))?.metrics ?? null,
        })),
        brandProfile,
    });

    return {
        ruleBased,
        payload,
        scopeKey: filters.connectionId || 'all',
        rangeKey: `${range.fromKey}:${range.toKey}:${filters.platform || 'all'}:${filters.mediaType || 'all'}`,
    };
}

export async function overview(req: Request, res: Response): Promise<void> {
    const input = parseQuery(rangeQuerySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const [data, stories] = await Promise.all([
        getAnalyticsOverview(req.user!.id, range, filters),
        getStoryAnalytics(req.user!.id, range, filters),
    ]);
    res.json({ success: true, ...data, stories: stories.summary });
}

export async function monitor(req: Request, res: Response): Promise<void> {
    const input = parseQuery(rangeQuerySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const data = await getAnalyticsMonitor(req.user!.id, range, filters);
    res.json({ success: true, ...data });
}

export async function listPosts(req: Request, res: Response): Promise<void> {
    const input = parseQuery(postsQuerySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const data = await getAnalyticsPosts(
        req.user!.id,
        range,
        filters,
        input.page,
        input.limit
    );
    res.json({ success: true, ...data });
}

export async function sync(req: Request, res: Response): Promise<void> {
    const input = parseBody(syncBodySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const [data, stories] = await Promise.all([
        syncAnalytics(req.user!.id, range, filters, input.mode),
        // Live Stories are refreshed too, inside Meta's 24-hour window.
        syncStoryInsights({ userId: req.user!.id }),
    ]);
    res.json({ success: true, ...data, stories });
}

export async function stories(req: Request, res: Response): Promise<void> {
    const input = parseQuery(rangeQuerySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const data = await getStoryAnalytics(req.user!.id, range, filters);
    res.json({ success: true, ...data });
}

export async function tips(req: Request, res: Response): Promise<void> {
    const input = parseQuery(rangeQuerySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const context = await buildTipsContext(
        req.user!.id,
        range,
        filters,
        req.user!.brandProfile || {}
    );
    const cached = await getCachedAnalyticsAiInsight(
        req.user!.id,
        context.scopeKey,
        context.rangeKey,
        hashAnalyticsAiPayload(context.payload)
    );

    res.json({
        success: true,
        ruleBased: context.ruleBased,
        ai: cached
            ? {
                  cached: true,
                  generatedAt: cached.generatedAt.toISOString(),
                  expiresAt: cached.expiresAt.toISOString(),
                  model: cached.model,
                  tips: cached.tips,
              }
            : null,
    });
}

export async function generateTips(
    req: Request,
    res: Response
): Promise<void> {
    const input = parseBody(tipsBodySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const context = await buildTipsContext(
        req.user!.id,
        range,
        filters,
        req.user!.brandProfile || {}
    );
    const result = await generateAnalyticsAiInsight(
        req.user!.id,
        context.scopeKey,
        context.rangeKey,
        context.payload,
        filters.connectionId || null,
        typeof req.user!.aiModels?.text === 'string' ? req.user!.aiModels.text : ''
    );

    res.json({
        success: true,
        cached: result.cached,
        insight: {
            generatedAt: result.insight.generatedAt.toISOString(),
            expiresAt: result.insight.expiresAt.toISOString(),
            model: result.insight.model,
            tips: result.insight.tips,
        },
    });
}
