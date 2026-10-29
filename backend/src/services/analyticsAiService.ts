import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import {
    ANALYTICS_TIP_CATEGORIES,
    AnalyticsAiInsight,
    type AnalyticsTipCategory,
    type IAnalyticsTip,
    type IAnalyticsTipIdea,
} from '../models/analyticsAiInsightModel.js';
import { AppError } from '../utils/errors.js';
import { describeGeminiError } from './aiService.js';
import { recordGeminiCall } from './geminiUsageService.js';
import { getGeminiCredentials } from './credentialService.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Saved analyses stay viewable for a week; a new one runs at most daily. */
const KEEP_DAYS = 7;
const TIMEZONE = 'Asia/Kolkata';
const MAX_TIPS = 6;
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 280;
const MAX_IDEA_LENGTH = 200;
const MAX_ACTION_LABEL_LENGTH = 40;
const GEMINI_TIMEOUT_MS = 30_000;

export interface AnalyticsAiDependencies {
    getCredentials?: typeof getGeminiCredentials;
    fetch?: typeof fetch;
    now?: () => Date;
}

interface GeminiResponse {
    candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
    }>;
    error?: { message?: string };
}

export function buildAnalyticsAiPrompt(payload: Record<string, unknown>): string {
    return [
        'You are the social media strategist for a Facebook Page and Instagram account that posts images and reels through Meta-Bru.',
        'Study the data below and tell the owner exactly what to do next to grow reach and engagement.',
        'Use only the data below. Do not invent metrics, posts, or results that are not present. If there is not enough data for a point, skip it.',
        'The data has totals, a split by format (image posts vs reels), reel watch time (avgWatchTimeMs, watchedPercent = share of each reel people watched), Story totals (stories shared, reach, views, replies, taps forward/back, exits, exitRate), posting times in IST, and a sample of best and weakest posts with their format, length, caption length, hashtag count, text on image, Story sharing, day and hour.',
        'Compare what the best posts have in common against the weakest ones, and compare reels with image posts.',
        'Return strict JSON with this exact shape: {"tips":[{"title":"","body":"","severity":"info|success|warning","category":"timing|format|content|consistency|growth","actionLabel":"","actionHref":"","idea":{"format":"post|reel","topic":""}}]}.',
        'Return 4 to 6 tips, most impactful first. Each title is a short instruction (for example "Post reels on Fridays at 7 PM IST"). Each body explains why with specific numbers from the data, under 280 characters.',
        'Use severity "success" for something working to keep doing, "warning" for something hurting results, and "info" otherwise.',
        'When a tip suggests making content, set idea to one concrete post or reel the owner can make next: format is "post" or "reel", topic is one sentence they can paste into the caption generator, in the same language as their best captions, under 200 characters. Otherwise set idea to null.',
        'For reels with low watchedPercent, suggest a stronger hook in the first 2 seconds or a shorter length, citing the numbers.',
        'Action links must be one of /composer, /reels, /queue, /connections, or /analytics. Never link to an external site.',
        'Do not include access tokens, Page IDs, post IDs, or any other identifiers in your response.',
        'Do not use markdown or code fences. Return only the JSON object.',
        '',
        JSON.stringify(payload),
    ].join('\n');
}

function normalizeCategory(value: unknown): AnalyticsTipCategory {
    return ANALYTICS_TIP_CATEGORIES.includes(value as AnalyticsTipCategory)
        ? (value as AnalyticsTipCategory)
        : 'growth';
}

function normalizeIdea(value: unknown): IAnalyticsTipIdea | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const idea = value as { format?: unknown; topic?: unknown };
    if (typeof idea.topic !== 'string') return null;
    const topic = idea.topic.trim().slice(0, MAX_IDEA_LENGTH);
    if (!topic) return null;
    return { format: idea.format === 'reel' ? 'reel' : 'post', topic };
}

function cleanFences(rawText: string): string {
    return rawText
        .trim()
        .replace(/^```[\w-]*\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function normalizeSeverity(value: unknown): IAnalyticsTip['severity'] {
    return value === 'success' || value === 'warning' ? value : 'info';
}

function safeActionHref(value: unknown): string {
    if (typeof value !== 'string') return '';
    const href = value.trim();
    if (!href.startsWith('/')) return '';
    if (href.startsWith('//')) return '';
    if (href.includes('\\')) return '';
    return href;
}

export function parseAnalyticsAiTips(rawText: string): IAnalyticsTip[] {
    const cleaned = cleanFences(rawText);

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        throw new AppError(502, 'AI returned invalid JSON', 'AI_TIPS_INVALID');
    }

    const tips =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as { tips?: unknown }).tips
            : undefined;
    if (!Array.isArray(tips)) {
        throw new AppError(502, 'AI returned no tips', 'AI_TIPS_INVALID');
    }

    const normalized: IAnalyticsTip[] = [];
    for (const tip of tips) {
        if (!tip || typeof tip !== 'object' || Array.isArray(tip)) continue;

        const value = tip as Record<string, unknown>;
        if (typeof value.title !== 'string' || typeof value.body !== 'string') {
            continue;
        }

        const title = value.title.trim();
        const body = value.body.trim();
        if (!title || !body) continue;

        normalized.push({
            title: title.slice(0, MAX_TITLE_LENGTH),
            body: body.slice(0, MAX_BODY_LENGTH),
            severity: normalizeSeverity(value.severity),
            category: normalizeCategory(value.category),
            idea: normalizeIdea(value.idea),
            actionLabel:
                typeof value.actionLabel === 'string'
                    ? value.actionLabel
                          .trim()
                          .slice(0, MAX_ACTION_LABEL_LENGTH)
                    : '',
            actionHref: safeActionHref(value.actionHref),
        });

        if (normalized.length >= MAX_TIPS) break;
    }

    if (normalized.length === 0) {
        throw new AppError(502, 'AI returned no usable tips', 'AI_TIPS_INVALID');
    }

    return normalized;
}

export function hashAnalyticsAiPayload(payload: unknown): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
}

/** The newest saved analysis for this scope and range, whatever data it saw. */
export async function getLatestAnalyticsAiInsight(
    userId: string,
    scopeKey: string,
    rangeKey: string,
    now: Date = new Date()
) {
    return AnalyticsAiInsight.findOne({
        userId,
        scopeKey,
        rangeKey,
        expiresAt: { $gt: now },
    }).sort({ generatedAt: -1 });
}

/** True when the analysis ran on the same IST calendar day as `now`. */
export function generatedToday(generatedAt: Date, now: Date = new Date()): boolean {
    const day = (value: Date) => DateTime.fromJSDate(value).setZone(TIMEZONE).toISODate();
    return day(generatedAt) === day(now);
}

function extractText(data: GeminiResponse): string {
    return (
        data.candidates?.[0]?.content?.parts
            ?.map((part) => part.text || '')
            .join('')
            .trim() || ''
    );
}

export async function generateAnalyticsAiInsight(
    userId: string,
    scopeKey: string,
    rangeKey: string,
    payload: Record<string, unknown>,
    connectionId: string | null,
    /** The user's Gemini text model from Profile; empty uses the default. */
    textModel = '',
    /**
     * True for the Run/Refresh button: always ask Gemini. False for the daily
     * automatic run, which reuses an analysis already made today.
     */
    force = true,
    deps: AnalyticsAiDependencies = {}
) {
    const model = textModel || env.gemini.textModel;
    const now = deps.now?.() ?? new Date();
    const dataHash = hashAnalyticsAiPayload(payload);

    if (!force) {
        const latest = await getLatestAnalyticsAiInsight(userId, scopeKey, rangeKey, now);
        if (latest && generatedToday(latest.generatedAt, now)) {
            return { insight: latest, cached: true as const };
        }
    }

    const getCredentials = deps.getCredentials ?? getGeminiCredentials;
    let credentials: Awaited<ReturnType<typeof getGeminiCredentials>>;
    try {
        credentials = await getCredentials(userId);
    } catch (error) {
        if (error instanceof AppError && error.code === 'AI_NOT_CONFIGURED') {
            throw new AppError(400, error.message, 'GEMINI_NOT_CONFIGURED');
        }
        throw error;
    }

    const fetchImpl = deps.fetch ?? fetch;
    const prompt = buildAnalyticsAiPrompt(payload);

    let response: Response;
    try {
        response = await fetchImpl(
            `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': credentials.apiKey,
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.4,
                        responseMimeType: 'application/json',
                        maxOutputTokens: 4096,
                        ...(model.includes('flash')
                            ? { thinkingConfig: { thinkingBudget: 0 } }
                            : {}),
                    },
                }),
                signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
            }
        );
    } catch (error) {
        throw new AppError(
            502,
            error instanceof Error
                ? `Could not reach Gemini: ${error.message}`
                : 'Could not reach Gemini',
            'AI_TIPS_FAILED'
        );
    }

    const parsedBody: unknown = await response.json().catch(() => ({}));
    const data: GeminiResponse =
        parsedBody && typeof parsedBody === 'object'
            ? (parsedBody as GeminiResponse)
            : {};
    void recordGeminiCall(userId, {
        model,
        feature: 'analytics',
        httpStatus: response.status,
        ok: response.ok && !data.error,
        body: data,
    });

    if (!response.ok || data.error) {
        throw describeGeminiError(response.status, data, 'analytics');
    }

    const rawText = extractText(data);
    if (!rawText) {
        throw new AppError(
            502,
            'Gemini returned an empty analysis',
            'AI_TIPS_EMPTY'
        );
    }

    const tips = parseAnalyticsAiTips(rawText);
    const generatedAt = now;
    const insight = await AnalyticsAiInsight.create({
        userId,
        scopeKey,
        connectionId,
        rangeKey,
        dataHash,
        tips,
        model,
        generatedAt,
        expiresAt: new Date(
            generatedAt.getTime() + KEEP_DAYS * 24 * 60 * 60_000
        ),
    });

    return { insight, cached: false as const };
}
