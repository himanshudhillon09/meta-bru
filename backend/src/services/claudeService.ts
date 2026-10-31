import Anthropic, { type APIError } from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { env } from '../config/env.js';
import { ANALYTICS_TIP_CATEGORIES } from '../models/analyticsAiInsightModel.js';
import type { ClaudeFeature } from '../models/claudeUsageModel.js';
import { AppError } from '../utils/errors.js';
import {
    finishCaption,
    hashtagRange,
    loadCaptionImage,
    parseOverlayResponse,
    type BrandProfile,
    type CaptionInput,
    type OverlayTextInput,
} from './aiService.js';
import { recordClaudeCall, type ClaudeAttempt } from './claudeUsageService.js';
import { getAnthropicCredentials } from './credentialService.js';

/** Which AI writes text for a user: their Profile toggle. */
export type AiProvider = 'gemini' | 'claude';

export function aiProviderOf(user: { aiProvider?: unknown } | null | undefined): AiProvider {
    return user?.aiProvider === 'claude' ? 'claude' : 'gemini';
}

/** The user's Claude model, or the deployment default. */
export function claudeModelOf(user: { aiModels?: { claude?: unknown } } | null | undefined): string {
    const model = user?.aiModels?.claude;
    return typeof model === 'string' && model ? model : env.claude.model;
}

// Models that can re-run a declined request on Anthropic's recommended
// fallback model ("fallbacks": "default"). Haiku has no server-side fallback.
const SERVER_FALLBACK = /^claude-(opus-5|sonnet-5-5|fable-5-1)/;
// Models that accept output_config.effort at low, medium, and high.
const EFFORT = /^claude-(opus-(4-[5-9]|[5-9])|sonnet-(4-6|[5-9])|haiku-[5-9]|fable|mythos)/;
// Claude reads images up to 5 MB each.
const MAX_CLAUDE_IMAGE_BASE64 = Math.floor((5 * 1024 * 1024 * 4) / 3);

type Effort = 'low' | 'medium' | 'high';

interface ClaudeRequest<Schema extends z.ZodType> {
    userId: string;
    model: string;
    feature: ClaudeFeature;
    /** What is being written, for error messages. */
    label: string;
    system: string;
    content: Anthropic.Beta.BetaContentBlockParam[];
    schema: Schema;
    effort: Effort;
    timeoutMs: number;
}

function attemptsOf(message: Anthropic.Beta.BetaMessage): ClaudeAttempt[] {
    const toAttempt = (
        model: string,
        usage: {
            input_tokens: number;
            output_tokens: number;
            cache_read_input_tokens: number | null;
            cache_creation_input_tokens: number | null;
            cache_creation: Anthropic.Beta.BetaCacheCreation | null;
        }
    ): ClaudeAttempt => ({
        model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWrite5mTokens:
            usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0,
        cacheWrite1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    });

    // After a fallback, each model that ran is listed with its own tokens.
    const iterations = (message.usage.iterations ?? []).filter(
        (entry) => entry.type === 'message' || entry.type === 'fallback_message'
    );
    if (iterations.length === 0) return [toAttempt(message.model, message.usage)];
    return iterations.map((entry) => toAttempt(entry.model ?? message.model, entry));
}

function apiMessage(error: APIError): string {
    const body = error.error as { error?: { message?: unknown } } | undefined;
    return typeof body?.error?.message === 'string' ? body.error.message : error.message;
}

function readableWait(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds)) return 'a minute';
    if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} seconds`;
    const minutes = Math.round(seconds / 60);
    return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Turns an Anthropic error into a short message the user can act on. A bad
 * key answers 400, not 401: the frontend signs the user out on any 401.
 */
export function describeClaudeError(error: unknown, model: string, label: string): AppError {
    if (error instanceof AppError) return error;

    if (error instanceof Anthropic.APIConnectionTimeoutError) {
        return new AppError(504, `Claude took too long to write the ${label}. Try again.`, 'AI_TIMEOUT');
    }
    if (error instanceof Anthropic.APIConnectionError) {
        return new AppError(502, `Could not reach Claude: ${error.message}`, 'AI_UNREACHABLE');
    }
    if (!(error instanceof Anthropic.APIError)) {
        return new AppError(
            502,
            error instanceof Error ? error.message : `Claude ${label} failed`,
            'AI_FAILED'
        );
    }

    const message = apiMessage(error);
    if (error instanceof Anthropic.AuthenticationError) {
        return new AppError(400, 'Anthropic rejected your API key. Check the Claude key under Profile.', 'AI_KEY_INVALID');
    }
    if (error.type === 'billing_error' || /credit balance/i.test(message)) {
        return new AppError(
            402,
            'Your Anthropic account is out of credits. Add credits in the Claude Console under Billing, then try again.',
            'AI_NEEDS_BILLING'
        );
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
        return new AppError(400, `Your Anthropic API key can't use ${model}: ${message}`, 'AI_KEY_FORBIDDEN');
    }
    if (error instanceof Anthropic.NotFoundError) {
        return new AppError(400, `Claude model ${model} was not found. Pick another model under Profile.`, 'AI_MODEL_NOT_FOUND');
    }
    if (error instanceof Anthropic.RateLimitError) {
        const retry = Number(error.headers?.get('retry-after'));
        return new AppError(
            429,
            `Your Anthropic API key has hit its rate limit for ${model}. Try again in ${readableWait(
                Number.isFinite(retry) ? retry : null
            )}, or raise your limits in the Claude Console.`,
            'AI_RATE_LIMITED'
        );
    }
    if (error.type === 'overloaded_error' || error.status === 529) {
        return new AppError(503, 'Claude is overloaded right now. Try again in a minute.', 'AI_OVERLOADED');
    }
    return new AppError(502, message || `Claude ${label} failed`, 'AI_FAILED');
}

/**
 * Sends one structured-output request to Claude with the user's own key,
 * records its tokens, cost, and rate limits for the Usage page, and returns
 * the parsed answer.
 */
async function requestClaude<Schema extends z.ZodType>(
    request: ClaudeRequest<Schema>
): Promise<z.infer<Schema>> {
    const { apiKey } = await getAnthropicCredentials(request.userId);
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: request.timeoutMs });
    const { model } = request;
    const format = betaZodOutputFormat(request.schema);
    const fallback = SERVER_FALLBACK.test(model);

    // create() rather than parse(): parse() loses the response headers, which
    // carry the rate limits, so the reply is parsed below with the same format.
    let message: Anthropic.Beta.BetaMessage;
    let headers: Headers;
    try {
        const result = await client.beta.messages
            .create({
                model,
                max_tokens: 16_000,
                system: request.system,
                messages: [{ role: 'user', content: request.content }],
                output_config: {
                    format,
                    ...(EFFORT.test(model) ? { effort: request.effort } : {}),
                },
                betas: [
                    'structured-outputs-2025-12-15',
                    ...(fallback ? ['server-side-fallback-2026-07-01'] : []),
                ],
                // A declined request is re-run on the model Anthropic recommends.
                ...(fallback ? { fallbacks: 'default' as const } : {}),
            })
            .withResponse();
        message = result.data;
        headers = result.response.headers;
    } catch (error) {
        const status = error instanceof Anthropic.APIError ? (error.status ?? 0) : 0;
        void recordClaudeCall(request.userId, {
            feature: request.feature,
            requestedModel: model,
            ok: false,
            httpStatus: status,
            refused: false,
            attempts: [],
            headers: error instanceof Anthropic.APIError ? error.headers : undefined,
            message: error instanceof Anthropic.APIError ? apiMessage(error) : '',
        });
        throw describeClaudeError(error, model, request.label);
    }

    const refused = message.stop_reason === 'refusal';
    const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();
    let output: z.infer<Schema> | null = null;
    if (!refused && message.stop_reason !== 'max_tokens' && text) {
        try {
            output = format.parse(text);
        } catch {
            output = null;
        }
    }
    void recordClaudeCall(request.userId, {
        feature: request.feature,
        requestedModel: model,
        ok: !refused && message.stop_reason !== 'max_tokens' && output !== null,
        httpStatus: 200,
        refused,
        attempts: attemptsOf(message),
        headers,
    });

    if (refused) {
        throw new AppError(
            422,
            `Claude declined to write this ${request.label}. Reword the topic or description and try again.`,
            'AI_REFUSED'
        );
    }
    if (message.stop_reason === 'max_tokens') {
        throw new AppError(502, `Claude stopped before finishing the ${request.label}. Please try again.`, 'AI_TRUNCATED');
    }
    if (output === null) {
        throw new AppError(
            502,
            text
                ? `Claude's ${request.label} came back in a form Meta-Bru could not read. Please try again.`
                : `Claude returned an empty ${request.label}`,
            text ? 'AI_INVALID_RESPONSE' : 'AI_EMPTY_RESPONSE'
        );
    }
    return output;
}

async function imageBlock(
    userId: string,
    publicId: string
): Promise<Anthropic.Beta.BetaImageBlockParam> {
    const image = await loadCaptionImage(userId, publicId);
    if (image.data.length > MAX_CLAUDE_IMAGE_BASE64) {
        throw new AppError(502, 'The image is too large for Claude to read (max 5 MB)', 'AI_IMAGE_FETCH_FAILED');
    }
    const mediaType = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const).find(
        (type) => type === image.mimeType
    );
    return {
        type: 'image',
        source: { type: 'base64', media_type: mediaType ?? 'image/jpeg', data: image.data },
    };
}

function brandLines(profile: BrandProfile | undefined): string[] {
    const lines: string[] = [];
    if (profile?.niche) lines.push(`Brand niche: ${profile.niche}`);
    if (profile?.tone) lines.push(`Brand voice: ${profile.tone}`);
    if (profile?.audience) lines.push(`Audience: ${profile.audience}`);
    if (profile?.keywords) lines.push(`Keywords to work in naturally: ${profile.keywords}`);
    return lines;
}

const LANGUAGE_RULE =
    'Write in the language of the topic and brand details. For Hindi or Hinglish, write Hinglish in Roman (English) letters, never Devanagari.';

const CAPTION_SYSTEM = [
    "You are the lead social media copywriter for a brand's Facebook Page and Instagram account. You write captions that stop the scroll and earn real engagement: saves, shares, comments, and profile visits.",
    '',
    'What makes a caption work:',
    '- The first line is the hook. Instagram shows only about the first 125 characters before "more", and Facebook folds long posts too, so the first line has to earn the tap on its own: a bold claim, a surprising detail, a relatable moment, or a question the reader wants answered. Never open with the brand name, a greeting, or "Introducing".',
    '- Then deliver on the hook with specific, concrete, sensory detail. Use short lines and short paragraphs separated by line breaks, never a wall of text.',
    '- Sound like a person in the brand voice, not like an ad.',
    `- ${LANGUAGE_RULE}`,
    '- End with one natural call to action that fits the post: a question people can answer in a few words, "save this for later", or "send this to someone who...". Meta demotes engagement bait, so never ask for likes or reactions, never say "comment YES", "tag 3 friends", or "share if you agree".',
    '- Use 0 to 3 emojis, only where they add meaning.',
    '- Instagram rewards saves and shares and uses hashtags for discovery. Facebook rewards conversation, so a genuine question lands well there and hashtags matter less.',
    '',
    'Hashtags go only in the hashtags field, never in the caption. Pick tags people actually search and follow for this exact subject: one or two broad tags, several mid-size niche tags, and one or two specific ones (place, product, or community). Every tag must fit the image or topic. No spam tags such as #followforfollow or #like4like.',
    '',
    'Never invent prices, dates, offers, statistics, names, places, or claims that are not in the topic, the brand details, or clearly visible in the image. Keep the caption under 1,800 characters.',
].join('\n');

const captionSchema = z.object({
    caption: z.string().describe('The ready-to-publish caption, without hashtags.'),
    hashtags: z.array(z.string()).describe('Hashtags, each starting with #.'),
});

export async function claudeCaption(userId: string, model: string, input: CaptionInput): Promise<string> {
    const { min, max } = hashtagRange(input.platform);
    const platform =
        input.platform === 'both' ? 'Facebook and Instagram (the same caption goes to both)' : input.platform;
    const details = [
        `Platform: ${platform}`,
        ...brandLines(input.brandProfile),
        input.topic ? `Post topic: ${input.topic}` : 'No topic was given; write from the image and brand details.',
        `Hashtags: ${min} to ${max}.`,
    ];
    if (input.mediaPublicId) {
        details.push(
            'The attached image is exactly what will be published with this caption. Build the caption on what is really in it: subject, setting, mood, and any visible product. Never say "this image" or describe it like alt text.'
        );
    }

    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.mediaPublicId) content.push(await imageBlock(userId, input.mediaPublicId));
    content.push({ type: 'text', text: details.join('\n') });

    const output = await requestClaude({
        userId,
        model,
        feature: 'caption',
        label: 'caption',
        system: CAPTION_SYSTEM,
        content,
        schema: captionSchema,
        effort: 'high',
        timeoutMs: 120_000,
    });

    const caption = finishCaption(output.caption.trim(), output.hashtags, input);
    if (!output.caption.trim() || !caption) {
        throw new AppError(502, 'Claude returned an empty caption', 'AI_EMPTY_RESPONSE');
    }
    return caption;
}

const OVERLAY_SYSTEM = [
    'You write the one short line printed in big bold letters across a social media image, the way viral reels and meme pages do. It is the first thing people read while scrolling, so it decides whether they stop.',
    '',
    'Rules:',
    '- One line of at most 12 words and 80 characters.',
    '- Make it a hook, not a label: a relatable thought, a bold claim, a twist, or a curiosity gap that the caption pays off. Never just describe what is in the picture.',
    `- Match the language and style of the post. ${LANGUAGE_RULE}`,
    '- Wrap the 1 to 3 most important words in *asterisks*; they are printed in the highlight colour. Example: Real life wali bandi *ko* pata chal gaya',
    '- No hashtags, no emojis, no quotation marks, and no full stop at the end.',
].join('\n');

const overlaySchema = z.object({
    line: z.string().describe('The single line of text for the image.'),
});

export async function claudeOverlayText(
    userId: string,
    model: string,
    input: OverlayTextInput & { mediaPublicId?: string }
): Promise<string> {
    const details = [...brandLines(input.brandProfile)];
    if (input.topic) details.push(`Post topic: ${input.topic}`);
    if (input.caption) details.push(`Post caption: ${input.caption}`);
    if (input.prompt) details.push(`Image description: ${input.prompt}`);

    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.mediaPublicId) {
        // The picture sharpens the line but isn't essential when there are words to go on.
        try {
            content.push(await imageBlock(userId, input.mediaPublicId));
            details.push('The attached image is the picture the line is printed on.');
        } catch (error) {
            if (!input.topic && !input.caption && !input.prompt) throw error;
        }
    }
    content.push({ type: 'text', text: details.join('\n') });

    const output = await requestClaude({
        userId,
        model,
        feature: 'image text',
        label: 'image text',
        system: OVERLAY_SYSTEM,
        content,
        schema: overlaySchema,
        effort: 'medium',
        timeoutMs: 90_000,
    });

    const text = parseOverlayResponse(output.line);
    if (!text) throw new AppError(502, 'Claude returned an empty image text', 'AI_EMPTY_RESPONSE');
    return text;
}

const IMAGE_PROMPT_SYSTEM = [
    'You are an art director. Turn a short brief into one detailed prompt for an image model that will draw a single square image for a Facebook and Instagram feed post. The image has to stop the scroll and look right for the brand.',
    '',
    'A strong feed image:',
    '- Has one clear subject that reads instantly on a small phone screen, with strong contrast, a clean background, and vivid but natural colour.',
    '- Shows a specific moment with real texture and light: setting, time of day, lighting, camera angle and lens, and mood. Never a generic stock scene.',
    "- Feels authentic for the brand's audience and place: people, food, products, and places look real and culturally right.",
    '- Keeps the subject in the upper and middle part of the frame and the bottom quarter simple, because a bold line of white text is printed across the bottom.',
    '- Contains no text, letters, captions, logos, watermarks, or borders. Meta-Bru adds the text and the logo frame itself.',
    '',
    'Keep everything the brief asks for and never change its subject. Keep any style the brief names (cartoon, 3D, flat illustration, minimal); otherwise make it photorealistic.',
    'Write the prompt as 3 to 6 plain sentences under 900 characters, with no lists, markdown, or quotation marks, and nothing but the prompt.',
].join('\n');

const imagePromptSchema = z.object({
    prompt: z.string().describe('The prompt for the image model.'),
});

export interface ImagePromptInput {
    /** What the user typed under "Describe an image". */
    description: string;
    topic?: string;
    caption?: string;
    brandProfile?: BrandProfile;
}

/** Claude's art direction for an image Gemini draws. */
export async function claudeImagePrompt(userId: string, model: string, input: ImagePromptInput): Promise<string> {
    const details = [`Brief: ${input.description}`, ...brandLines(input.brandProfile)];
    if (input.topic && input.topic !== input.description) details.push(`Post topic: ${input.topic}`);
    if (input.caption && input.caption !== input.description) details.push(`Post caption: ${input.caption}`);

    const output = await requestClaude({
        userId,
        model,
        feature: 'image prompt',
        label: 'image prompt',
        system: IMAGE_PROMPT_SYSTEM,
        content: [{ type: 'text', text: details.join('\n') }],
        schema: imagePromptSchema,
        effort: 'medium',
        timeoutMs: 90_000,
    });

    const prompt = output.prompt.replace(/\s+/g, ' ').trim().slice(0, 1_000);
    if (!prompt) throw new AppError(502, 'Claude returned an empty image prompt', 'AI_EMPTY_RESPONSE');
    return prompt;
}

// The SDK sends enums as descriptions rather than constraints, so these stay
// plain strings here and parseAnalyticsAiTips normalizes anything unexpected.
const tipsSchema = z.object({
    tips: z.array(
        z.object({
            title: z.string(),
            body: z.string(),
            severity: z.string().describe('One of: info, success, warning.'),
            category: z.string().describe(`One of: ${ANALYTICS_TIP_CATEGORIES.join(', ')}.`),
            actionLabel: z.string(),
            actionHref: z.string(),
            idea: z
                .object({
                    format: z.string().describe('One of: post, reel.'),
                    topic: z.string(),
                })
                .nullable(),
        })
    ),
});

/** Claude's Analytics tips as JSON text, for parseAnalyticsAiTips. */
export async function claudeAnalyticsTips(
    userId: string,
    model: string,
    instructions: string,
    payload: Record<string, unknown>
): Promise<string> {
    const output = await requestClaude({
        userId,
        model,
        feature: 'analytics',
        label: 'analysis',
        system: instructions,
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        schema: tipsSchema,
        effort: 'high',
        timeoutMs: 180_000,
    });
    return JSON.stringify(output);
}

export interface ClaudeModelOption {
    id: string;
    name: string;
}

/** The Claude models the user's key can use that read images and return JSON. */
export async function listClaudeModels(
    userId: string
): Promise<{ default: string; models: ClaudeModelOption[] }> {
    const { apiKey } = await getAnthropicCredentials(userId);
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
    const models: Array<ClaudeModelOption & { createdAt: string }> = [];
    try {
        for await (const model of client.models.list({ limit: 100 })) {
            const capabilities = model.capabilities;
            if (
                capabilities &&
                (!capabilities.structured_outputs.supported || !capabilities.image_input.supported)
            ) {
                continue;
            }
            models.push({ id: model.id, name: model.display_name || model.id, createdAt: model.created_at });
        }
    } catch (error) {
        throw describeClaudeError(error, 'the model list', 'model list');
    }

    return {
        default: env.claude.model,
        models: models
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(({ id, name }) => ({ id, name })),
    };
}
