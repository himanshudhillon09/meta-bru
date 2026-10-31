import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { preparePostImage } from './brandLogoService.js';
import { editableSourceDataUrl } from './imageProcessingService.js';
import {
    jpegUrlFor,
    uploadImage,
    type PostImageMedia,
} from './cloudinaryService.js';
import {
    getCloudinaryCredentials,
    getGeminiCredentials,
} from './credentialService.js';
import { recordGeminiCall } from './geminiUsageService.js';
import { cleanOverlayText } from './textOverlayService.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_IMAGE_MODEL = 'gemini-2.5-flash-image';
const MAX_CAPTION_IMAGE_BYTES = 10 * 1024 * 1024;

export interface BrandProfile {
    niche?: string;
    tone?: string;
    audience?: string;
    keywords?: string;
}

export interface CaptionInput {
    topic?: string;
    platform: 'facebook' | 'instagram' | 'both';
    brandProfile?: BrandProfile;
    mediaPublicId?: string;
    /** The user's caption model; empty uses the deployment default. */
    model?: string;
}

export interface InlineImage {
    mimeType: string;
    data: string;
}

interface GeminiPart {
    text?: string;
    inlineData?: {
        mimeType?: string;
        data?: string;
    };
}

interface GeminiResponse {
    candidates?: Array<{
        content?: { parts?: GeminiPart[] };
        finishReason?: string;
    }>;
    error?: GeminiErrorBody;
}

interface GeminiErrorBody {
    code?: number;
    status?: string;
    message?: string;
    details?: Array<{
        '@type'?: string;
        retryDelay?: string;
        violations?: Array<{ quotaMetric?: string; quotaId?: string }>;
    }>;
}

export type GeminiTask = 'image' | 'caption' | 'image text' | 'model list' | 'analytics';

const GEMINI_FAILURE_CODES: Record<GeminiTask, string> = {
    image: 'AI_IMAGE_FAILED',
    caption: 'AI_CAPTION_FAILED',
    'image text': 'AI_OVERLAY_FAILED',
    'model list': 'AI_MODELS_FAILED',
    analytics: 'AI_TIPS_FAILED',
};

const FREE_TIER = /free_tier|FreeTier/i;

/** True when the key is on the free tier and Google allows it none of this model. */
function isFreeTierBlocked(error: GeminiErrorBody): boolean {
    const message = error.message ?? '';
    const violations = (error.details ?? []).flatMap((detail) => detail.violations ?? []);
    const freeTier =
        FREE_TIER.test(message) ||
        violations.some((violation) =>
            FREE_TIER.test(`${violation.quotaMetric ?? ''} ${violation.quotaId ?? ''}`)
        );
    return freeTier && /limit:\s*0\b/.test(message);
}

function retrySeconds(error: GeminiErrorBody): number | null {
    const delay = (error.details ?? []).find((detail) => detail.retryDelay)?.retryDelay;
    const fromDetails = delay ? Number.parseFloat(delay) : Number.NaN;
    if (Number.isFinite(fromDetails)) return fromDetails;

    const match = /retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(error.message ?? '');
    if (!match || !(match[1] || match[2] || match[3])) return null;
    return (
        Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
    );
}

function readableWait(seconds: number): string {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.round(minutes / 60);
    return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Turns a Gemini error response into a short message the user can act on.
 * Google's quota errors are long and point at the wrong fix: a free-tier key
 * is told to "retry in 20h" for an image model whose free limit is 0.
 */
export function describeGeminiError(
    httpStatus: number,
    payload: unknown,
    task: GeminiTask
): AppError {
    const error = (payload as { error?: GeminiErrorBody } | null)?.error ?? {};
    const message = error.message ?? '';

    if (httpStatus === 429 || error.status === 'RESOURCE_EXHAUSTED') {
        if (isFreeTierBlocked(error)) {
            return task === 'image'
                ? new AppError(
                      402,
                      "Your Gemini API key is on Google's free tier, which can't generate images. Turn on billing for the key's project in Google AI Studio (images cost about $0.03–0.04 each), then try again.",
                      'AI_IMAGE_NEEDS_BILLING'
                  )
                : new AppError(
                      402,
                      "Your Gemini API key is on Google's free tier, which doesn't include this model. Turn on billing for the key's project in Google AI Studio, then try again.",
                      'AI_NEEDS_BILLING'
                  );
        }

        const seconds = retrySeconds(error);
        return new AppError(
            429,
            `Your Gemini API key has hit its usage limit. Try again in ${
                seconds === null ? 'a few minutes' : readableWait(seconds)
            }, or raise the limit in Google AI Studio.`,
            'AI_RATE_LIMITED'
        );
    }

    if (/API key not valid|API_KEY_INVALID/i.test(message)) {
        return new AppError(
            400,
            'Gemini rejected your API key. Check the Gemini key under Profile.',
            'AI_KEY_INVALID'
        );
    }

    return new AppError(
        502,
        message || `Gemini ${task} generation failed`,
        GEMINI_FAILURE_CODES[task]
    );
}

let warnedAboutRetiredImageModel = false;

export function resolveImageModel(configuredModel: string): string {
    const configured = configuredModel.trim();

    if (!configured) return FALLBACK_IMAGE_MODEL;

    if (configured.startsWith('imagen')) {
        if (!warnedAboutRetiredImageModel) {
            warnedAboutRetiredImageModel = true;
            console.warn(
                `[ai] GEMINI_IMAGE_MODEL=${configured} is retired. Using ${FALLBACK_IMAGE_MODEL}. Update GEMINI_IMAGE_MODEL.`
            );
        }
        return FALLBACK_IMAGE_MODEL;
    }

    return configured;
}

export function buildImageGenerationBody(prompt: string): Record<string, unknown> {
    return {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
                aspectRatio: '1:1',
            },
        },
    };
}

export function extractInlineImage(
    data: unknown
): { mimeType: string; data: string } | null {
    const response = data as GeminiResponse;
    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part) => part.inlineData?.data);

    if (!imagePart?.inlineData?.data) return null;

    return {
        mimeType: imagePart.inlineData.mimeType || 'image/png',
        data: imagePart.inlineData.data,
    };
}

export function hashtagRange(platform: CaptionInput['platform']): {
    min: number;
    max: number;
} {
    if (platform === 'instagram') return { min: 8, max: 12 };
    if (platform === 'facebook') return { min: 3, max: 5 };
    return { min: 6, max: 8 };
}

function normalizeHashtags(values: unknown[], max: number): string[] {
    const seen = new Set<string>();
    const tags: string[] = [];

    for (const value of values) {
        if (typeof value !== 'string') continue;

        const cleaned = value
            .trim()
            .replace(/^#+/, '')
            .replace(/[^\p{L}\p{N}_]/gu, '');

        if (!cleaned) continue;

        const tag = `#${cleaned}`;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        tags.push(tag);
        if (tags.length >= max) break;
    }

    return tags;
}

function composeCaption(caption: string, hashtags: string[]): string {
    const body = caption
        .replace(/#[\p{L}\p{N}_]+/gu, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

    const finalCaption = body || caption.trim();
    const withHashtags = hashtags.length
        ? `${finalCaption}\n\n${hashtags.join(' ')}`
        : finalCaption;

    return withHashtags.slice(0, 2200);
}

function unescapeJsonString(value: string): string {
    return value
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}

function parseJsonCaption(
    rawText: string
): { caption: string; hashtagsText: string } | null {
    const jsonText = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    try {
        const parsed = JSON.parse(jsonText) as {
            caption?: unknown;
            hashtags?: unknown;
        };

        if (typeof parsed.caption !== 'string') return null;

        const hashtagsText = Array.isArray(parsed.hashtags)
            ? parsed.hashtags
                  .filter((value): value is string => typeof value === 'string')
                  .join(' ')
            : typeof parsed.hashtags === 'string'
              ? parsed.hashtags
              : '';

        return { caption: parsed.caption, hashtagsText };
    } catch {
        return null;
    }
}

export function parseCaptionResponse(
    rawText: string,
    input: CaptionInput
): string {
    let caption = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/\*\*(CAPTION|HASHTAGS)\s*:\*\*/gi, '$1:')
        .trim();
    let hashtagsText = '';

    const labeled = caption.match(
        /CAPTION\s*:?\s*([\s\S]*)\s*HASHTAGS\s*:?\s*([\s\S]*)$/i
    );

    const parseJson = () => {
        const parsed = parseJsonCaption(caption);

        if (parsed) {
            caption = parsed.caption;
            hashtagsText = parsed.hashtagsText;
            return;
        }

        // Some models return JSON-like text with unescaped line breaks.
        const jsonCaption =
            caption.match(
                /"caption"\s*:\s*"([\s\S]*?)"\s*,\s*"hashtags"\s*:/
            ) || caption.match(/"caption"\s*:\s*"([\s\S]*)"\s*}/);

        if (jsonCaption?.[1]) {
            caption = unescapeJsonString(jsonCaption[1]);
            hashtagsText = rawText;
        }
    };

    if (labeled) {
        caption = labeled[1]?.trim() || '';
        hashtagsText = labeled[2]?.trim() || '';
    } else {
        caption = caption.replace(/^CAPTION\s*:?\s*/i, '').trim();

        if (caption.startsWith('{')) {
            parseJson();
        } else {
            const hashtagSplit = caption.split(/HASHTAGS\s*:?\s*/i);

            if (hashtagSplit.length > 1) {
                caption = hashtagSplit[0]?.trim() || '';
                hashtagsText = hashtagSplit.slice(1).join(' ').trim();
            }
        }
    }

    caption = caption
        .replace(/^CAPTION\s*:?\s*/i, '')
        .replace(/^HASHTAGS\s*:?\s*/i, '')
        .trim();

    if (!caption) return '';

    return finishCaption(
        caption,
        [
            ...(hashtagsText.match(/#[\p{L}\p{N}_]+/gu) || []),
            ...(caption.match(/#[\p{L}\p{N}_]+/gu) || []),
        ],
        input
    );
}

/**
 * Joins a caption and its hashtags into the text that is published, with the
 * Page's niche and keywords as hashtags when the AI gave none.
 */
export function finishCaption(
    caption: string,
    rawHashtags: unknown[],
    input: CaptionInput
): string {
    const { max } = hashtagRange(input.platform);
    let hashtags = normalizeHashtags(rawHashtags, max);

    if (hashtags.length === 0) {
        const profile = input.brandProfile || {};
        hashtags = normalizeHashtags(
            [
                profile.niche,
                ...(profile.keywords ? profile.keywords.split(',') : []),
                ...(input.topic && input.topic.length <= 30 ? [input.topic] : []),
            ],
            max
        );
    }

    return composeCaption(caption, hashtags);
}

export function buildCaptionPrompt(input: CaptionInput): string {
    const profile = input.brandProfile || {};
    const parts = [
        'You are a senior social media copywriter.',
        'Write exactly one ready-to-publish caption. Do not include markdown or commentary inside the caption.',
        `Platform: ${input.platform === 'both' ? 'Facebook and Instagram' : input.platform}.`,
    ];

    if (profile.niche) parts.push(`Brand niche: ${profile.niche}.`);
    if (profile.tone) parts.push(`Brand tone: ${profile.tone}.`);
    if (profile.audience) parts.push(`Target audience: ${profile.audience}.`);
    if (profile.keywords) parts.push(`Keywords to naturally include: ${profile.keywords}.`);
    if (input.topic) parts.push(`Post topic: ${input.topic}.`);

    if (input.mediaPublicId) {
        parts.push(
            'The attached image is the exact image that will be published with this caption.',
            'Use the image as the primary source: reference its subject, setting, and mood naturally.',
            'Before writing, identify the main subject, setting, mood, and any visible product or brand details in the image.',
            'Do not say "in this image" or refer to the image itself. Do not invent details that are not visible.'
        );
    }

    const { min, max } = hashtagRange(input.platform);

    parts.push(
        `Keep it engaging and specific. Use short paragraphs. Add ${min}-${max} currently popular or trending hashtags under HASHTAGS.`,
        'Choose hashtags from the image subject, setting, mood, post topic, and brand niche. Mix broad and specific tags.',
        'Do not use unrelated generic hashtags. Every hashtag must genuinely fit the image or topic.',
        'Stay under 2,000 characters. Never invent prices, dates, or claims that were not provided.',
        'Return the result in exactly this format:',
        'CAPTION:',
        '<caption text>',
        'HASHTAGS:',
        '<space-separated hashtags>',
        'Do not use JSON, markdown, or code fences.'
    );

    return parts.join('\n');
}

export async function loadCaptionImage(
    userId: string,
    publicId: string
): Promise<InlineImage> {
    const credentials = await getCloudinaryCredentials(userId);
    const url = jpegUrlFor(credentials.cloudName, publicId);

    let response: Response;
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
        throw new AppError(
            502,
            error instanceof Error
                ? `Could not load the uploaded image: ${error.message}`
                : 'Could not load the uploaded image',
            'AI_IMAGE_FETCH_FAILED'
        );
    }

    if (!response.ok) {
        throw new AppError(
            502,
            `Could not load the uploaded image (${response.status}). Try uploading it again.`,
            'AI_IMAGE_FETCH_FAILED'
        );
    }

    const contentType =
        (response.headers.get('content-type') || 'image/jpeg')
            .split(';')[0]
            ?.trim()
            .toLowerCase() || 'image/jpeg';

    if (!contentType.startsWith('image/')) {
        throw new AppError(
            502,
            'The uploaded file is not an image',
            'AI_IMAGE_FETCH_FAILED'
        );
    }

    let buffer: Buffer;
    try {
        buffer = Buffer.from(await response.arrayBuffer());
    } catch (error) {
        throw new AppError(
            502,
            error instanceof Error
                ? `Could not read the uploaded image: ${error.message}`
                : 'Could not read the uploaded image',
            'AI_IMAGE_FETCH_FAILED'
        );
    }

    if (buffer.length === 0) {
        throw new AppError(
            502,
            'The uploaded image is empty',
            'AI_IMAGE_FETCH_FAILED'
        );
    }

    if (buffer.length > MAX_CAPTION_IMAGE_BYTES) {
        throw new AppError(
            502,
            'The uploaded image is too large for captioning (max 10 MB)',
            'AI_IMAGE_FETCH_FAILED'
        );
    }

    return {
        mimeType: contentType,
        data: buffer.toString('base64'),
    };
}

interface GeminiTextRequest {
    /** Whose key is used, for the Usage page. */
    userId: string;
    /** Model id; empty uses the deployment default. */
    model?: string | undefined;
    parts: Array<{ text?: string; inlineData?: InlineImage }>;
    temperature: number;
    maxOutputTokens: number;
    /** What is being written, for error messages. */
    label: 'caption' | 'image text';
    errorCode: string;
    truncatedCode: string;
}

/** Sends a text generation request and returns the non-empty reply text. */
async function requestGeminiText(
    apiKey: string,
    request: GeminiTextRequest
): Promise<string> {
    const model = request.model || env.gemini.textModel;
    let response: Response;
    try {
        response = await fetch(
            `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify({
                    contents: [{ parts: request.parts }],
                    generationConfig: {
                        temperature: request.temperature,
                        maxOutputTokens: request.maxOutputTokens,
                        // Only 2.5 Flash models accept turning thinking off
                        // with a zero budget; other models reject it.
                        ...(/^gemini-2\.5-flash/.test(model)
                            ? { thinkingConfig: { thinkingBudget: 0 } }
                            : {}),
                    },
                }),
                signal: AbortSignal.timeout(30_000),
            }
        );
    } catch (error) {
        throw new AppError(
            502,
            error instanceof Error
                ? `Could not reach Gemini: ${error.message}`
                : 'Could not reach Gemini',
            request.errorCode
        );
    }

    const data = (await response.json().catch(() => ({}))) as GeminiResponse;
    void recordGeminiCall(request.userId, {
        model,
        feature: request.label,
        httpStatus: response.status,
        ok: response.ok && !data.error,
        body: data,
    });

    if (!response.ok || data.error) {
        throw describeGeminiError(response.status, data, request.label);
    }

    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
        throw new AppError(
            502,
            `Gemini stopped before finishing the ${request.label}. Please try again.`,
            request.truncatedCode
        );
    }

    const rawText = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('')
        .trim();

    if (!rawText) {
        throw new AppError(
            502,
            `Gemini returned an empty ${request.label}`,
            'AI_EMPTY_RESPONSE'
        );
    }

    return rawText;
}

export async function generateCaption(
    userId: string,
    input: CaptionInput
): Promise<string> {
    const credentials = await getGeminiCredentials(userId);

    const parts: Array<{ text?: string; inlineData?: InlineImage }> = [
        { text: buildCaptionPrompt(input) },
    ];

    if (input.mediaPublicId) {
        parts.push({
            inlineData: await loadCaptionImage(userId, input.mediaPublicId),
        });
    }

    const rawText = await requestGeminiText(credentials.apiKey, {
        userId,
        model: input.model,
        parts,
        temperature: 0.8,
        maxOutputTokens: 4096,
        label: 'caption',
        errorCode: 'AI_CAPTION_FAILED',
        truncatedCode: 'AI_CAPTION_TRUNCATED',
    });

    const caption = parseCaptionResponse(rawText, input);

    if (!caption) {
        throw new AppError(502, 'Gemini returned an empty caption', 'AI_EMPTY_RESPONSE');
    }

    return caption;
}

export interface GeneratedImage {
    /** The feed-ready (framed) image, already in Cloudinary. */
    media: PostImageMedia & { brandConnectionId: string };
    /** The unframed image as a JPEG data URL, so the Composer can re-crop it. */
    source: string;
}

export async function generateImage(
    userId: string,
    prompt: string,
    /** The user's image model; empty uses the deployment default. */
    imageModel = '',
    /** The Page whose logo frames the image; null leaves it unframed. */
    connectionId: string | null = null
): Promise<GeneratedImage> {
    const credentials = await getGeminiCredentials(userId);
    const model = resolveImageModel(imageModel || env.gemini.imageModel);

    let response: Response;
    try {
        response = await fetch(
            `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': credentials.apiKey,
                },
                body: JSON.stringify(buildImageGenerationBody(prompt)),
                signal: AbortSignal.timeout(60_000),
            }
        );
    } catch (error) {
        throw new AppError(
            502,
            error instanceof Error
                ? `Could not reach Gemini: ${error.message}`
                : 'Could not reach Gemini',
            'AI_IMAGE_FAILED'
        );
    }

    const data = (await response.json().catch(() => ({}))) as GeminiResponse;
    void recordGeminiCall(userId, {
        model,
        feature: 'image',
        httpStatus: response.status,
        ok: response.ok && !data.error && Boolean(extractInlineImage(data)),
        body: data,
    });

    if (!response.ok || data.error) {
        throw describeGeminiError(response.status, data, 'image');
    }

    const image = extractInlineImage(data);

    if (!image) {
        const parts = data.candidates?.[0]?.content?.parts || [];
        const text = parts
            .map((part) => part.text || '')
            .join(' ')
            .trim();

        throw new AppError(
            502,
            text || 'Gemini returned no image data',
            'AI_EMPTY_RESPONSE'
        );
    }

    const raw = Buffer.from(image.data, 'base64');
    const [prepared, source] = await Promise.all([
        preparePostImage(userId, connectionId, raw),
        editableSourceDataUrl(raw),
    ]);
    return {
        media: {
            ...(await uploadImage(userId, prepared.buffer)),
            textArea: prepared.textArea,
            brandConnectionId: prepared.framedFor,
        },
        source,
    };
}

export interface OverlayTextInput {
    topic?: string;
    caption?: string;
    /** The prompt the image was generated from. */
    prompt?: string;
    brandProfile?: BrandProfile;
    /** The user's caption model, also used for image text. */
    model?: string;
}

export function buildOverlayPrompt(input: OverlayTextInput): string {
    const profile = input.brandProfile || {};
    const parts = [
        'You write the short line printed in big bold letters on a social media image, like a reel or meme caption.',
        'Write exactly one line of at most 12 words and 80 characters.',
        'Use the same language and style as the post caption and topic. For Hindi or Hinglish, write Hinglish in Roman (English) letters, never Devanagari.',
        'Make it punchy, relatable, and specific to this post.',
        'Wrap the 1 to 3 most important words in *asterisks*, for example: Real life wali bandi *ko* pata chal gaya',
        'No hashtags, no emojis, no quotation marks, and no full stop at the end. Return only the line.',
    ];

    if (profile.niche) parts.push(`Brand niche: ${profile.niche}.`);
    if (profile.tone) parts.push(`Brand tone: ${profile.tone}.`);
    if (profile.audience) parts.push(`Target audience: ${profile.audience}.`);
    if (input.topic) parts.push(`Post topic: ${input.topic}`);
    if (input.caption) parts.push(`Post caption: ${input.caption}`);
    if (input.prompt) parts.push(`Image description: ${input.prompt}`);

    return parts.join('\n');
}

/**
 * Turns Gemini's reply into one clean overlay line: first line only, no label,
 * quotes, hashtags, emojis, or final full stop, and at least one highlighted
 * word.
 */
export function parseOverlayResponse(raw: string): string {
    const firstLine =
        raw
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? '';

    let text = firstLine
        .replace(/^(?:headline|line|overlay|text)\s*:\s*/i, '')
        .replace(/#[\p{L}\p{N}_]+/gu, '')
        .replace(/["“”„‟«»]/g, '')
        .replace(/^'+|'+$/g, '');

    text = cleanOverlayText(text).replace(/[.。]+$/u, '').trim();
    if (!text) return '';

    if (!text.includes('*')) {
        const lastSpace = text.lastIndexOf(' ');
        text =
            lastSpace === -1
                ? `*${text}*`
                : `${text.slice(0, lastSpace + 1)}*${text.slice(lastSpace + 1)}*`;
    }

    return text;
}

export async function generateOverlayText(
    userId: string,
    input: OverlayTextInput
): Promise<string> {
    const credentials = await getGeminiCredentials(userId);
    const rawText = await requestGeminiText(credentials.apiKey, {
        userId,
        model: input.model,
        parts: [{ text: buildOverlayPrompt(input) }],
        temperature: 0.9,
        maxOutputTokens: 256,
        label: 'image text',
        errorCode: 'AI_OVERLAY_FAILED',
        truncatedCode: 'AI_OVERLAY_TRUNCATED',
    });

    const text = parseOverlayResponse(rawText);
    if (!text) {
        throw new AppError(502, 'Gemini returned an empty image text', 'AI_EMPTY_RESPONSE');
    }
    return text;
}

export interface GeminiModelOption {
    id: string;
    name: string;
}

export interface GeminiModelList {
    /** What an empty choice falls back to on this deployment. */
    defaults: { text: string; image: string };
    text: GeminiModelOption[];
    image: GeminiModelOption[];
}

interface RawGeminiModel {
    name?: unknown;
    displayName?: unknown;
    supportedGenerationMethods?: unknown;
}

// Models that answer generateContent but cannot write a caption.
const NOT_FOR_CAPTIONS = /(tts|audio|live|embedding|aqa|veo|computer-use|robotics)/i;

/**
 * Splits the models a key can use into caption choices and image choices.
 * Only Gemini models that support generateContent are offered; image models
 * are the ones whose id names images.
 */
export function classifyGeminiModels(
    raw: unknown[]
): Pick<GeminiModelList, 'text' | 'image'> {
    const text = new Map<string, GeminiModelOption>();
    const image = new Map<string, GeminiModelOption>();

    for (const entry of raw) {
        const model = (entry ?? {}) as RawGeminiModel;
        const id = typeof model.name === 'string' ? model.name.replace(/^models\//, '') : '';
        const methods = Array.isArray(model.supportedGenerationMethods)
            ? model.supportedGenerationMethods
            : [];
        if (!id.startsWith('gemini') || !methods.includes('generateContent')) continue;

        const option = {
            id,
            name: typeof model.displayName === 'string' && model.displayName ? model.displayName : id,
        };
        if (/image/i.test(id)) image.set(id, option);
        else if (!NOT_FOR_CAPTIONS.test(id)) text.set(id, option);
    }

    const newestFirst = (a: GeminiModelOption, b: GeminiModelOption) => b.id.localeCompare(a.id);
    return {
        text: [...text.values()].sort(newestFirst),
        image: [...image.values()].sort(newestFirst),
    };
}

/** Lists the Gemini models the user's own key can use, for the Profile pickers. */
export async function listGeminiModels(userId: string): Promise<GeminiModelList> {
    const credentials = await getGeminiCredentials(userId);
    const models: unknown[] = [];
    let pageToken = '';

    for (let page = 0; page < 5; page += 1) {
        const url = new URL(`${GEMINI_BASE}/models`);
        url.searchParams.set('pageSize', '200');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        let response: Response;
        try {
            response = await fetch(url, {
                headers: { 'x-goog-api-key': credentials.apiKey },
                signal: AbortSignal.timeout(15_000),
            });
        } catch (error) {
            throw new AppError(
                502,
                error instanceof Error
                    ? `Could not reach Gemini: ${error.message}`
                    : 'Could not reach Gemini',
                'AI_MODELS_FAILED'
            );
        }

        const data = (await response.json().catch(() => ({}))) as {
            models?: unknown[];
            nextPageToken?: string;
            error?: GeminiErrorBody;
        };
        if (!response.ok || data.error) {
            throw describeGeminiError(response.status, data, 'model list');
        }

        models.push(...(Array.isArray(data.models) ? data.models : []));
        pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
        if (!pageToken) break;
    }

    return {
        defaults: {
            text: env.gemini.textModel,
            image: resolveImageModel(env.gemini.imageModel),
        },
        ...classifyGeminiModels(models),
    };
}
