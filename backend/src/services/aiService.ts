import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import {
    jpegUrlFor,
    uploadImage,
    type UploadedMedia,
} from './cloudinaryService.js';
import {
    getCloudinaryCredentials,
    getGeminiCredentials,
} from './credentialService.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_IMAGE_MODEL = 'gemini-2.5-flash-image';
const MAX_CAPTION_IMAGE_BYTES = 10 * 1024 * 1024;

interface BrandProfile {
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
}

interface InlineImage {
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
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    error?: { message?: string };
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

function hashtagRange(platform: CaptionInput['platform']): {
    min: number;
    max: number;
} {
    if (platform === 'instagram') return { min: 8, max: 12 };
    if (platform === 'facebook') return { min: 3, max: 5 };
    return { min: 6, max: 8 };
}

function buildCaptionResponseSchema(
    platform: CaptionInput['platform']
): Record<string, unknown> {
    const { min, max } = hashtagRange(platform);

    return {
        type: 'OBJECT',
        properties: {
            caption: { type: 'STRING' },
            hashtags: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                minItems: String(min),
                maxItems: String(max),
            },
        },
        required: ['caption', 'hashtags'],
    };
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

export function buildCaptionPrompt(input: CaptionInput): string {
    const profile = input.brandProfile || {};
    const parts = [
        'You are a senior social media copywriter.',
        'Write exactly one ready-to-publish caption for the caption field. Do not include markdown or commentary inside the caption.',
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
        `Keep it engaging and specific. Use short paragraphs. Add ${min}-${max} currently popular or trending hashtags to the hashtags field.`,
        'Choose hashtags from the image subject, setting, mood, post topic, and brand niche. Mix broad and specific tags.',
        'Do not use unrelated generic hashtags. Every hashtag must genuinely fit the image or topic.',
        'Stay under 2,000 characters. Never invent prices, dates, or claims that were not provided.',
        'Return the caption and hashtag list in the requested JSON format.'
    );

    return parts.join('\n');
}

async function loadCaptionImage(
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

    let response: Response;
    try {
        response = await fetch(
            `${GEMINI_BASE}/models/${encodeURIComponent(env.gemini.textModel)}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': credentials.apiKey,
                },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        temperature: 0.8,
                        maxOutputTokens: 1200,
                        responseMimeType: 'application/json',
                        responseSchema: buildCaptionResponseSchema(input.platform),
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
            'AI_CAPTION_FAILED'
        );
    }

    const data = (await response.json().catch(() => ({}))) as GeminiResponse;

    if (!response.ok || data.error) {
        throw new AppError(
            502,
            data.error?.message || 'Gemini caption generation failed',
            'AI_CAPTION_FAILED'
        );
    }

    const rawText = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('')
        .trim();

    if (!rawText) {
        throw new AppError(502, 'Gemini returned an empty caption', 'AI_EMPTY_RESPONSE');
    }

    const jsonText = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    let parsed: { caption?: unknown; hashtags?: unknown } | null = null;
    try {
        const candidate = JSON.parse(jsonText) as unknown;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            parsed = candidate as { caption?: unknown; hashtags?: unknown };
        }
    } catch {
        // Fall back to the raw text if the model did not return valid JSON.
    }

    const caption =
        typeof parsed?.caption === 'string' ? parsed.caption.trim() : rawText;

    if (!caption) {
        throw new AppError(502, 'Gemini returned an empty caption', 'AI_EMPTY_RESPONSE');
    }

    const { max } = hashtagRange(input.platform);
    const structuredHashtags = Array.isArray(parsed?.hashtags)
        ? parsed.hashtags
        : typeof parsed?.hashtags === 'string'
          ? parsed.hashtags.split(/\s+/)
          : [];
    const rawHashtags = [
        ...structuredHashtags,
        ...(caption.match(/#[\p{L}\p{N}_]+/gu) || []),
    ];
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

export async function generateImage(
    userId: string,
    prompt: string
): Promise<UploadedMedia> {
    const credentials = await getGeminiCredentials(userId);
    const model = resolveImageModel(env.gemini.imageModel);

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

    if (!response.ok || data.error) {
        throw new AppError(
            502,
            data.error?.message || 'Gemini image generation failed',
            'AI_IMAGE_FAILED'
        );
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

    return uploadImage(userId, Buffer.from(image.data, 'base64'));
}
