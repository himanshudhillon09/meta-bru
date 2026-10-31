import type { QueryFilter } from 'mongoose';
import {
    ClaudeRateLimit,
    ClaudeUsage,
    type ClaudeFeature,
    type ClaudeLimitMeter,
    type IClaudeRateLimit,
    type IClaudeUsage,
} from '../models/claudeUsageModel.js';

/** List prices in US dollars per million tokens. */
export interface ClaudePrice {
    input: number;
    output: number;
    cacheRead: number;
}

// Anthropic's published list prices. Cache writes cost 1.25x input for the
// 5-minute cache and 2x for the 1-hour cache on every model.
const PRICES: Array<[RegExp, ClaudePrice]> = [
    [/^claude-(fable|mythos)-5-1/, { input: 10, output: 50, cacheRead: 0.25 }],
    [/^claude-(fable|mythos)-5/, { input: 10, output: 50, cacheRead: 1 }],
    [/^claude-opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
    [/^claude-opus-(5|4-[5-9])/, { input: 5, output: 25, cacheRead: 0.5 }],
    [/^claude-opus-4/, { input: 15, output: 75, cacheRead: 1.5 }],
    [/^claude-sonnet-5/, { input: 2, output: 10, cacheRead: 0.2 }],
    [/^claude-sonnet-4/, { input: 3, output: 15, cacheRead: 0.3 }],
    [/^claude-haiku-5-5/, { input: 0.1, output: 0.5, cacheRead: 0.01 }],
    [/^claude-haiku-4-5/, { input: 1, output: 5, cacheRead: 0.1 }],
    [/^claude-3-5-haiku/, { input: 0.8, output: 4, cacheRead: 0.08 }],
];

// Claude Haiku 5.5 costs more once a prompt is over 100K tokens.
const HAIKU_LONG_PROMPT: ClaudePrice = { input: 0.5, output: 2.5, cacheRead: 0.05 };

/** The list price for a model, or null when Meta-Bru doesn't know it. */
export function claudePrice(model: string, promptTokens = 0): ClaudePrice | null {
    if (/^claude-haiku-5-5/.test(model) && promptTokens > 100_000) return HAIKU_LONG_PROMPT;
    return PRICES.find(([pattern]) => pattern.test(model))?.[1] ?? null;
}

/** Token counts for one model attempt within a call. */
export interface ClaudeAttempt {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWrite5mTokens: number;
    cacheWrite1hTokens: number;
}

/** Estimated cost of one attempt in millionths of a dollar; 0 for unknown models. */
export function attemptCostMicroUsd(attempt: ClaudeAttempt): number {
    const prompt =
        attempt.inputTokens +
        attempt.cacheReadTokens +
        attempt.cacheWrite5mTokens +
        attempt.cacheWrite1hTokens;
    const price = claudePrice(attempt.model, prompt);
    if (!price) return 0;
    // Price per token in micro-dollars equals the price per million tokens.
    return Math.round(
        attempt.inputTokens * price.input +
            attempt.outputTokens * price.output +
            attempt.cacheReadTokens * price.cacheRead +
            attempt.cacheWrite5mTokens * price.input * 1.25 +
            attempt.cacheWrite1hTokens * price.input * 2
    );
}

/** UTC day for a moment, YYYY-MM-DD, as the Claude Console shows usage. */
export function claudeDay(date = new Date()): string {
    return date.toISOString().slice(0, 10);
}

function headerNumber(headers: Headers, name: string): number | null {
    const raw = headers.get(name);
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

function headerDate(headers: Headers, name: string): Date | null {
    const raw = headers.get(name);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}

function meter(headers: Headers, bucket: string): ClaudeLimitMeter {
    return {
        limit: headerNumber(headers, `anthropic-ratelimit-${bucket}-limit`),
        remaining: headerNumber(headers, `anthropic-ratelimit-${bucket}-remaining`),
        resetsAt: headerDate(headers, `anthropic-ratelimit-${bucket}-reset`),
    };
}

/** The rate limits in a response's headers, or null when it carried none. */
export function parseRateLimitHeaders(headers: Headers): {
    requests: ClaudeLimitMeter;
    inputTokens: ClaudeLimitMeter;
    outputTokens: ClaudeLimitMeter;
    retryAfterSeconds: number | null;
} | null {
    const limits = {
        requests: meter(headers, 'requests'),
        inputTokens: meter(headers, 'input-tokens'),
        outputTokens: meter(headers, 'output-tokens'),
        retryAfterSeconds: headerNumber(headers, 'retry-after'),
    };
    const any = [limits.requests, limits.inputTokens, limits.outputTokens].some(
        (item) => item.limit !== null || item.remaining !== null
    );
    return any || limits.retryAfterSeconds !== null ? limits : null;
}

export interface ClaudeCallRecord {
    feature: ClaudeFeature;
    /** The model Meta-Bru asked for; rate limits are reported against it. */
    requestedModel: string;
    ok: boolean;
    /** HTTP status Anthropic answered with; 0 when the request never reached it. */
    httpStatus: number;
    refused: boolean;
    /** Every model attempt that ran, the served one last. Empty when none ran. */
    attempts: ClaudeAttempt[];
    headers?: Headers | undefined;
    message?: string;
}

/**
 * Counts one Claude call made with the user's key and keeps the newest rate
 * limits Anthropic reported. Usage tracking must never break the feature
 * itself, so failures here are only logged.
 */
export async function recordClaudeCall(userId: string, call: ClaudeCallRecord): Promise<void> {
    try {
        const day = claudeDay();
        const limited = call.httpStatus === 429;
        const served = call.attempts.at(-1)?.model || call.requestedModel;
        const rows = new Map<string, ClaudeAttempt[]>();
        for (const attempt of call.attempts) {
            rows.set(attempt.model, [...(rows.get(attempt.model) ?? []), attempt]);
        }
        if (!rows.has(served)) rows.set(served, []);

        for (const [model, attempts] of rows) {
            const isServed = model === served;
            const sum = (pick: (attempt: ClaudeAttempt) => number) =>
                attempts.reduce((total, attempt) => total + pick(attempt), 0);
            await ClaudeUsage.updateOne(
                { userId, day, model, feature: call.feature } as QueryFilter<IClaudeUsage>,
                {
                    $inc: {
                        requests: isServed ? 1 : 0,
                        failures: isServed && !call.ok ? 1 : 0,
                        rateLimited: isServed && limited ? 1 : 0,
                        refusals: isServed && call.refused ? 1 : 0,
                        inputTokens: sum((attempt) => attempt.inputTokens),
                        outputTokens: sum((attempt) => attempt.outputTokens),
                        cacheReadTokens: sum((attempt) => attempt.cacheReadTokens),
                        cacheWriteTokens: sum(
                            (attempt) => attempt.cacheWrite5mTokens + attempt.cacheWrite1hTokens
                        ),
                        costMicroUsd: sum(attemptCostMicroUsd),
                    },
                },
                { upsert: true }
            );
        }

        const limits = call.headers ? parseRateLimitHeaders(call.headers) : null;
        if (!limits) return;
        const now = new Date();
        await ClaudeRateLimit.updateOne(
            { userId, model: call.requestedModel } as QueryFilter<IClaudeRateLimit>,
            {
                $set: {
                    requests: limits.requests,
                    inputTokens: limits.inputTokens,
                    outputTokens: limits.outputTokens,
                    observedAt: now,
                    ...(limited
                        ? {
                              lastLimitedAt: now,
                              retryAfterSeconds: limits.retryAfterSeconds,
                              message: (call.message ?? '').slice(0, 500),
                          }
                        : {}),
                },
            },
            { upsert: true }
        );
    } catch (error) {
        console.error('[claude-usage] Could not record a Claude call:', error);
    }
}
