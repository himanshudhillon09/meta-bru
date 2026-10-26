import crypto from 'node:crypto';
import { env } from '../config/env.js';
import {
    AnalyticsAiInsight,
    type IAnalyticsTip,
} from '../models/analyticsAiInsightModel.js';
import { AppError } from '../utils/errors.js';
import { getGeminiCredentials } from './credentialService.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const CACHE_HOURS = 6;
const MAX_TIPS = 5;
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 240;
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
        'You are a social media analyst for Meta-Bru.',
        'Use only the data below. Do not invent metrics, posts, or results that are not present.',
        'If there is not enough data, say so instead of guessing.',
        'Return strict JSON with this exact shape: {"tips":[{"title":"","body":"","severity":"info|success|warning","actionLabel":"","actionHref":""}]}.',
        'Return 3 to 5 tips. Keep each body under 240 characters.',
        'Prefer specific numbers from the data. Use IST timing when recommending a posting time.',
        'Do not give generic advice that the data does not support.',
        'Action links must be internal paths beginning with / (for example /composer or /analytics). Never link to an external site.',
        'Do not include access tokens, Page IDs, post IDs, or any other identifiers in your response.',
        'Do not use markdown or code fences. Return only the JSON object.',
        '',
        JSON.stringify(payload),
    ].join('\n');
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

function hashPayload(payload: unknown): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
}

export async function getCachedAnalyticsAiInsight(
    userId: string,
    scopeKey: string,
    rangeKey: string,
    dataHash: string,
    now: Date = new Date()
) {
    return AnalyticsAiInsight.findOne({
        userId,
        scopeKey,
        rangeKey,
        dataHash,
        expiresAt: { $gt: now },
    }).sort({ generatedAt: -1 });
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
    deps: AnalyticsAiDependencies = {}
) {
    const now = deps.now?.() ?? new Date();
    const dataHash = hashPayload(payload);

    const cached = await getCachedAnalyticsAiInsight(
        userId,
        scopeKey,
        rangeKey,
        dataHash,
        now
    );
    if (cached) return { insight: cached, cached: true as const };

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
            `${GEMINI_BASE}/models/${encodeURIComponent(env.gemini.textModel)}:generateContent`,
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
                        maxOutputTokens: 2048,
                        ...(env.gemini.textModel.includes('flash')
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

    if (!response.ok || data.error) {
        throw new AppError(
            502,
            data.error?.message || 'Gemini analytics analysis failed',
            'AI_TIPS_FAILED'
        );
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
        model: env.gemini.textModel,
        generatedAt,
        expiresAt: new Date(
            generatedAt.getTime() + CACHE_HOURS * 60 * 60_000
        ),
    });

    return { insight, cached: false as const };
}
