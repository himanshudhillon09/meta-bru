import { v2 as cloudinary } from 'cloudinary';
import { DateTime } from 'luxon';
import type { QueryFilter } from 'mongoose';
import { env } from '../config/env.js';
import {
    GeminiQuota,
    GeminiUsage,
    type GeminiFeature,
    type IGeminiQuota,
    type IGeminiUsage,
} from '../models/geminiUsageModel.js';
import {
    CLAUDE_FEATURES,
    ClaudeRateLimit,
    ClaudeUsage,
    type ClaudeFeature,
    type ClaudeLimitMeter,
    type IClaudeRateLimit,
    type IClaudeUsage,
} from '../models/claudeUsageModel.js';
import { AppError } from '../utils/errors.js';
import { resolveImageModel } from './aiService.js';
import { aiProviderOf, claudeModelOf } from './claudeService.js';
import { claudeDay, claudePrice } from './claudeUsageService.js';
import {
    cloudinaryErrorMessage,
    credentialsOptions,
} from './cloudinaryStorageService.js';
import {
    getAnthropicCredentials,
    getCloudinaryCredentials,
    getGeminiCredentials,
} from './credentialService.js';
import { QUOTA_TIMEZONE, quotaDay } from './geminiUsageService.js';

const HISTORY_DAYS = 30;

export interface GeminiTotals {
    requests: number;
    failures: number;
    rateLimited: number;
    inputTokens: number;
    outputTokens: number;
    images: number;
}

export interface GeminiModelUsage {
    model: string;
    features: GeminiFeature[];
    today: GeminiTotals;
    month: GeminiTotals;
    /** Daily request limit Google reported for this model, if it has. */
    dailyLimit: number | null;
    minuteLimit: number | null;
    freeTier: boolean;
    limitObservedAt: string | null;
}

export interface GeminiLimits {
    dailyRequests: number | null;
    monthlyRequests: number | null;
}

export interface GeminiUsageReport {
    configured: boolean;
    today: GeminiTotals;
    month: GeminiTotals;
    byModel: GeminiModelUsage[];
    byFeature: Array<{ feature: GeminiFeature; today: number; month: number }>;
    daily: Array<{ day: string; requests: number; tokens: number; images: number }>;
    limits: GeminiLimits;
    lastLimitHit: {
        model: string;
        period: IGeminiQuota['period'];
        limit: number | null;
        freeTier: boolean;
        observedAt: string;
        message: string;
    } | null;
    /** When Google's daily quotas next reset (midnight Pacific time). */
    resetsAt: string;
    models: { text: string; image: string };
}

function emptyTotals(): GeminiTotals {
    return { requests: 0, failures: 0, rateLimited: 0, inputTokens: 0, outputTokens: 0, images: 0 };
}

function add(totals: GeminiTotals, row: IGeminiUsage): void {
    totals.requests += row.requests;
    totals.failures += row.failures;
    totals.rateLimited += row.rateLimited;
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.images += row.images;
}

/**
 * Gemini calls Meta-Bru made with the user's key, by Google's quota day.
 * Google does not report remaining quota, so limits come from quota errors it
 * returned and from limits the user entered.
 */
export async function getGeminiUsage(
    userId: string,
    user: { aiModels?: { text?: string; image?: string }; geminiLimits?: Partial<GeminiLimits> },
    now = new Date()
): Promise<GeminiUsageReport> {
    let configured = true;
    try {
        await getGeminiCredentials(userId);
    } catch (error) {
        if (!(error instanceof AppError && error.code === 'AI_NOT_CONFIGURED')) throw error;
        configured = false;
    }

    const quotaNow = DateTime.fromJSDate(now).setZone(QUOTA_TIMEZONE);
    const today = quotaDay(now);
    const monthPrefix = today.slice(0, 7);
    const historyStart = quotaNow.minus({ days: HISTORY_DAYS - 1 }).toFormat('yyyy-LL-dd');
    const since = historyStart < `${monthPrefix}-01` ? historyStart : `${monthPrefix}-01`;

    const [rows, quotas] = await Promise.all([
        GeminiUsage.find({ userId, day: { $gte: since } } as QueryFilter<IGeminiUsage>).lean<IGeminiUsage[]>(),
        GeminiQuota.find({ userId } as QueryFilter<IGeminiQuota>).sort({ observedAt: -1 }).lean<IGeminiQuota[]>(),
    ]);

    const todayTotals = emptyTotals();
    const monthTotals = emptyTotals();
    const models = new Map<string, GeminiModelUsage>();
    const features = new Map<GeminiFeature, { today: number; month: number }>();
    const byDay = new Map<string, { requests: number; tokens: number; images: number }>();

    for (const row of rows) {
        const isToday = row.day === today;
        const inMonth = row.day.startsWith(monthPrefix);

        const model = models.get(row.model) ?? {
            model: row.model,
            features: [],
            today: emptyTotals(),
            month: emptyTotals(),
            dailyLimit: null,
            minuteLimit: null,
            freeTier: false,
            limitObservedAt: null,
        };
        if (!model.features.includes(row.feature)) model.features.push(row.feature);
        const feature = features.get(row.feature) ?? { today: 0, month: 0 };

        if (isToday) {
            add(todayTotals, row);
            add(model.today, row);
            feature.today += row.requests;
        }
        if (inMonth) {
            add(monthTotals, row);
            add(model.month, row);
            feature.month += row.requests;
        }
        models.set(row.model, model);
        features.set(row.feature, feature);

        const day = byDay.get(row.day) ?? { requests: 0, tokens: 0, images: 0 };
        day.requests += row.requests;
        day.tokens += row.inputTokens + row.outputTokens;
        day.images += row.images;
        byDay.set(row.day, day);
    }

    // Limits Google reported, newest first, for each model's request quotas.
    for (const quota of quotas) {
        if (quota.kind !== 'requests' || quota.limit === null) continue;
        const model = models.get(quota.model);
        if (!model) continue;
        if (quota.period === 'day' && model.dailyLimit === null) {
            model.dailyLimit = quota.limit;
            model.freeTier = quota.freeTier;
            model.limitObservedAt = quota.observedAt.toISOString();
        }
        if (quota.period === 'minute' && model.minuteLimit === null) {
            model.minuteLimit = quota.limit;
        }
    }

    const daily = Array.from({ length: HISTORY_DAYS }, (_, index) => {
        const day = quotaNow.minus({ days: HISTORY_DAYS - 1 - index }).toFormat('yyyy-LL-dd');
        return { day, ...(byDay.get(day) ?? { requests: 0, tokens: 0, images: 0 }) };
    });

    const latest = quotas[0];
    return {
        configured,
        today: todayTotals,
        month: monthTotals,
        byModel: [...models.values()].sort((a, b) => b.month.requests - a.month.requests),
        byFeature: [...features.entries()].map(([feature, value]) => ({ feature, ...value })),
        daily,
        limits: {
            dailyRequests: user.geminiLimits?.dailyRequests ?? null,
            monthlyRequests: user.geminiLimits?.monthlyRequests ?? null,
        },
        lastLimitHit: latest
            ? {
                  model: latest.model,
                  period: latest.period,
                  limit: latest.limit,
                  freeTier: latest.freeTier,
                  observedAt: latest.observedAt.toISOString(),
                  message: latest.message,
              }
            : null,
        resetsAt: quotaNow.plus({ days: 1 }).startOf('day').toUTC().toISO() ?? '',
        models: {
            text: user.aiModels?.text || env.gemini.textModel,
            image: resolveImageModel(user.aiModels?.image || env.gemini.imageModel),
        },
    };
}

export interface ClaudeTotals {
    requests: number;
    failures: number;
    rateLimited: number;
    refusals: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** Estimated from list prices; the Claude Console has the billed amount. */
    costUsd: number;
}

interface ClaudeMeterReport {
    limit: number | null;
    remaining: number | null;
    resetsAt: string | null;
}

export interface ClaudeUsageReport {
    configured: boolean;
    /** True when the Profile toggle sends AI features to Claude. */
    active: boolean;
    /** The model AI features use. */
    model: string;
    today: ClaudeTotals;
    month: ClaudeTotals;
    byModel: Array<{ model: string; priced: boolean; today: ClaudeTotals; month: ClaudeTotals }>;
    byFeature: Array<{ feature: ClaudeFeature; today: ClaudeTotals; month: ClaudeTotals }>;
    /** The last 30 UTC days, oldest first, split by feature. */
    daily: Array<{
        day: string;
        requests: number;
        tokens: number;
        costUsd: number;
        features: Array<{ feature: ClaudeFeature; requests: number; tokens: number; costUsd: number }>;
    }>;
    /** The newest limits Anthropic reported for each model. */
    rateLimits: Array<{
        model: string;
        requests: ClaudeMeterReport;
        inputTokens: ClaudeMeterReport;
        outputTokens: ClaudeMeterReport;
        observedAt: string;
        lastLimitedAt: string | null;
        retryAfterSeconds: number | null;
        message: string;
    }>;
    limits: { monthlyBudgetUsd: number | null };
}

function emptyClaudeTotals(): ClaudeTotals {
    return {
        requests: 0,
        failures: 0,
        rateLimited: 0,
        refusals: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
    };
}

function addClaude(totals: ClaudeTotals, row: IClaudeUsage): void {
    totals.requests += row.requests;
    totals.failures += row.failures;
    totals.rateLimited += row.rateLimited;
    totals.refusals += row.refusals;
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.cacheReadTokens += row.cacheReadTokens;
    totals.cacheWriteTokens += row.cacheWriteTokens;
    totals.costUsd += row.costMicroUsd / 1_000_000;
}

function claudeTokens(row: IClaudeUsage): number {
    return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens;
}

function meterReport(meter: ClaudeLimitMeter | undefined): ClaudeMeterReport {
    return {
        limit: meter?.limit ?? null,
        remaining: meter?.remaining ?? null,
        resetsAt: meter?.resetsAt ? new Date(meter.resetsAt).toISOString() : null,
    };
}

/**
 * Claude calls Meta-Bru made with the user's key, by UTC day like the Claude
 * Console. Anthropic has no usage endpoint for ordinary API keys, so tokens
 * and cost are counted from each response, and rate limits come from the
 * headers on the latest response for each model.
 */
export async function getClaudeUsage(
    userId: string,
    user: {
        aiProvider?: unknown;
        aiModels?: { claude?: unknown };
        claudeLimits?: { monthlyBudgetUsd?: number | null };
    },
    now = new Date()
): Promise<ClaudeUsageReport> {
    let configured = true;
    try {
        await getAnthropicCredentials(userId);
    } catch (error) {
        if (!(error instanceof AppError && error.code === 'CLAUDE_NOT_CONFIGURED')) throw error;
        configured = false;
    }

    const today = claudeDay(now);
    const monthPrefix = today.slice(0, 7);
    const days = Array.from({ length: HISTORY_DAYS }, (_, index) =>
        claudeDay(new Date(now.getTime() - (HISTORY_DAYS - 1 - index) * 86_400_000))
    );
    const historyStart = days[0] ?? today;
    const since = historyStart < `${monthPrefix}-01` ? historyStart : `${monthPrefix}-01`;

    const [rows, limits] = await Promise.all([
        ClaudeUsage.find({ userId, day: { $gte: since } } as QueryFilter<IClaudeUsage>).lean<IClaudeUsage[]>(),
        ClaudeRateLimit.find({ userId } as QueryFilter<IClaudeRateLimit>)
            .sort({ observedAt: -1 })
            .lean<IClaudeRateLimit[]>(),
    ]);

    const todayTotals = emptyClaudeTotals();
    const monthTotals = emptyClaudeTotals();
    const models = new Map<string, { today: ClaudeTotals; month: ClaudeTotals }>();
    const features = new Map<ClaudeFeature, { today: ClaudeTotals; month: ClaudeTotals }>(
        CLAUDE_FEATURES.map((feature) => [feature, { today: emptyClaudeTotals(), month: emptyClaudeTotals() }])
    );
    const byDay = new Map<string, Map<ClaudeFeature, { requests: number; tokens: number; costUsd: number }>>();

    for (const row of rows) {
        const model = models.get(row.model) ?? { today: emptyClaudeTotals(), month: emptyClaudeTotals() };
        const feature = features.get(row.feature) ?? { today: emptyClaudeTotals(), month: emptyClaudeTotals() };
        if (row.day === today) {
            addClaude(todayTotals, row);
            addClaude(model.today, row);
            addClaude(feature.today, row);
        }
        if (row.day.startsWith(monthPrefix)) {
            addClaude(monthTotals, row);
            addClaude(model.month, row);
            addClaude(feature.month, row);
        }
        models.set(row.model, model);
        features.set(row.feature, feature);

        const day = byDay.get(row.day) ?? new Map();
        const cell = day.get(row.feature) ?? { requests: 0, tokens: 0, costUsd: 0 };
        cell.requests += row.requests;
        cell.tokens += claudeTokens(row);
        cell.costUsd += row.costMicroUsd / 1_000_000;
        day.set(row.feature, cell);
        byDay.set(row.day, day);
    }

    const daily = days.map((day) => {
        const cells = byDay.get(day) ?? new Map();
        const split = CLAUDE_FEATURES.map((feature) => ({
            feature,
            ...(cells.get(feature) ?? { requests: 0, tokens: 0, costUsd: 0 }),
        }));
        return {
            day,
            requests: split.reduce((total, cell) => total + cell.requests, 0),
            tokens: split.reduce((total, cell) => total + cell.tokens, 0),
            costUsd: split.reduce((total, cell) => total + cell.costUsd, 0),
            features: split,
        };
    });

    return {
        configured,
        active: aiProviderOf(user) === 'claude',
        model: claudeModelOf(user),
        today: todayTotals,
        month: monthTotals,
        byModel: [...models.entries()]
            .map(([model, totals]) => ({ model, priced: claudePrice(model) !== null, ...totals }))
            .sort((a, b) => b.month.costUsd - a.month.costUsd),
        byFeature: [...features.entries()].map(([feature, totals]) => ({ feature, ...totals })),
        daily,
        rateLimits: limits.map((limit) => ({
            model: limit.model,
            requests: meterReport(limit.requests),
            inputTokens: meterReport(limit.inputTokens),
            outputTokens: meterReport(limit.outputTokens),
            observedAt: new Date(limit.observedAt).toISOString(),
            lastLimitedAt: limit.lastLimitedAt ? new Date(limit.lastLimitedAt).toISOString() : null,
            retryAfterSeconds: limit.retryAfterSeconds ?? null,
            message: limit.message ?? '',
        })),
        limits: { monthlyBudgetUsd: user.claudeLimits?.monthlyBudgetUsd ?? null },
    };
}

export interface CloudinaryMeter {
    used: number;
    limit: number;
    /** Credits this meter used this cycle, when the plan is credit based. */
    credits: number | null;
}

export interface CloudinaryPlanUsage {
    configured: boolean;
    plan: string;
    lastUpdated: string;
    credits: { used: number; limit: number; percent: number } | null;
    storage: CloudinaryMeter;
    bandwidth: CloudinaryMeter;
    transformations: CloudinaryMeter;
    resources: number;
    derivedResources: number;
    requests: number;
    error: string;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function meter(value: unknown): CloudinaryMeter {
    const item = record(value);
    return {
        used: num(item.usage),
        limit: num(item.limit),
        credits: typeof item.credits_usage === 'number' ? item.credits_usage : null,
    };
}

export function normalizePlanUsage(raw: unknown): Omit<CloudinaryPlanUsage, 'configured' | 'error'> {
    const usage = record(raw);
    const credits = record(usage.credits);
    const creditLimit = num(credits.limit);
    const creditUsed = num(credits.usage);
    return {
        plan: typeof usage.plan === 'string' ? usage.plan : '',
        lastUpdated: typeof usage.last_updated === 'string' ? usage.last_updated : '',
        credits:
            creditLimit > 0
                ? {
                      used: creditUsed,
                      limit: creditLimit,
                      percent: Math.min(100, num(credits.used_percent) || (creditUsed / creditLimit) * 100),
                  }
                : null,
        storage: meter(usage.storage),
        bandwidth: meter(usage.bandwidth),
        transformations: meter(usage.transformations),
        resources: num(usage.resources),
        derivedResources: num(usage.derived_resources),
        requests: num(usage.requests),
    };
}

/** The user's whole Cloudinary plan usage, as Cloudinary reports it. */
export async function getCloudinaryPlanUsage(userId: string): Promise<CloudinaryPlanUsage> {
    const empty = normalizePlanUsage({});
    let credentials;
    try {
        credentials = await getCloudinaryCredentials(userId);
    } catch (error) {
        if (error instanceof AppError && error.code === 'MEDIA_NOT_CONFIGURED') {
            return { ...empty, configured: false, error: '' };
        }
        throw error;
    }

    try {
        const raw = await cloudinary.api.usage(credentialsOptions(credentials));
        return { ...normalizePlanUsage(raw), configured: true, error: '' };
    } catch (error) {
        return { ...empty, configured: true, error: cloudinaryErrorMessage(error) };
    }
}
