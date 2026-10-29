import type { QueryFilter } from 'mongoose';
import { DateTime } from 'luxon';
import {
    GeminiQuota,
    GeminiUsage,
    type GeminiFeature,
    type IGeminiQuota,
    type IGeminiUsage,
} from '../models/geminiUsageModel.js';

/** Google resets Gemini daily quotas at midnight Pacific time. */
export const QUOTA_TIMEZONE = 'America/Los_Angeles';

export interface GeminiCallRecord {
    model: string;
    feature: GeminiFeature;
    /** HTTP status Google answered with; 0 when the request never reached it. */
    httpStatus: number;
    ok: boolean;
    /** The parsed response body, for usageMetadata and quota details. */
    body?: unknown;
}

interface UsageMetadata {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
}

interface QuotaViolation {
    quotaMetric?: string;
    quotaId?: string;
    quotaValue?: string | number;
}

/** Google's quota day for a moment, YYYY-MM-DD in Pacific time. */
export function quotaDay(date = new Date()): string {
    return DateTime.fromJSDate(date).setZone(QUOTA_TIMEZONE).toFormat('yyyy-LL-dd');
}

function count(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Quota violations Google lists on a 429, plus the limit named in its message. */
export function parseQuotaError(body: unknown): Array<{
    quotaId: string;
    period: IGeminiQuota['period'];
    kind: IGeminiQuota['kind'];
    limit: number | null;
    freeTier: boolean;
}> {
    const error = (body as { error?: { message?: string; details?: Array<{ violations?: QuotaViolation[] }> } } | null)
        ?.error;
    const message = error?.message ?? '';
    const violations = (error?.details ?? []).flatMap((detail) => detail.violations ?? []);
    const messageLimit = /limit:\s*(\d+)/i.exec(message)?.[1];

    const fromViolations = violations.map((violation) => {
        const quotaId = violation.quotaId || violation.quotaMetric || 'unknown';
        const label = `${quotaId} ${violation.quotaMetric ?? ''}`;
        const value = Number(violation.quotaValue ?? messageLimit);
        return {
            quotaId,
            period: /PerDay/i.test(label) ? 'day' : /PerMinute/i.test(label) ? 'minute' : 'other',
            kind: /token/i.test(label) ? 'tokens' : 'requests',
            limit: Number.isFinite(value) ? value : null,
            freeTier: /free/i.test(label),
        } as const;
    });

    if (fromViolations.length > 0) return fromViolations;
    if (!messageLimit) return [];
    return [
        {
            quotaId: 'reported',
            period: /per\s*day|daily/i.test(message) ? 'day' : /per\s*minute/i.test(message) ? 'minute' : 'other',
            kind: /token/i.test(message) ? 'tokens' : 'requests',
            limit: Number(messageLimit),
            freeTier: /free/i.test(message),
        },
    ];
}

/**
 * Counts one Gemini call made with the user's key. Usage tracking must never
 * break the feature itself, so failures here are only logged.
 */
export async function recordGeminiCall(userId: string, call: GeminiCallRecord): Promise<void> {
    try {
        const usage = ((call.body as { usageMetadata?: UsageMetadata } | null)?.usageMetadata ?? {}) as UsageMetadata;
        const limited =
            call.httpStatus === 429 ||
            (call.body as { error?: { status?: string } } | null)?.error?.status === 'RESOURCE_EXHAUSTED';

        await GeminiUsage.updateOne(
            { userId, day: quotaDay(), model: call.model, feature: call.feature } as QueryFilter<IGeminiUsage>,
            {
                $inc: {
                    requests: 1,
                    failures: call.ok ? 0 : 1,
                    rateLimited: limited ? 1 : 0,
                    inputTokens: count(usage.promptTokenCount),
                    outputTokens: count(usage.candidatesTokenCount) + count(usage.thoughtsTokenCount),
                    images: call.ok && call.feature === 'image' ? 1 : 0,
                },
            },
            { upsert: true }
        );

        if (!limited) return;
        const message = (call.body as { error?: { message?: string } } | null)?.error?.message ?? '';
        for (const quota of parseQuotaError(call.body)) {
            await GeminiQuota.updateOne(
                { userId, model: call.model, quotaId: quota.quotaId } as QueryFilter<IGeminiQuota>,
                {
                    $set: {
                        period: quota.period,
                        kind: quota.kind,
                        limit: quota.limit,
                        freeTier: quota.freeTier,
                        message: message.slice(0, 500),
                        observedAt: new Date(),
                    },
                },
                { upsert: true }
            );
        }
    } catch (error) {
        console.error('[gemini-usage] Could not record a Gemini call:', error);
    }
}
