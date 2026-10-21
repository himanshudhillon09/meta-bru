import {
    env,
    isCloudinaryConfigured,
    isGeminiConfigured,
} from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { uploadImage, type UploadedMedia } from './cloudinaryService.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface BrandProfile {
    niche?: string;
    tone?: string;
    audience?: string;
    keywords?: string;
}

interface CaptionInput {
    topic?: string;
    platform: 'facebook' | 'instagram' | 'both';
    brandProfile?: BrandProfile;
}

function assertConfigured(): void {
    if (!isGeminiConfigured) {
        throw new AppError(
            503,
            'AI assist is not configured. Add GEMINI_API_KEY to the backend environment.',
            'AI_NOT_CONFIGURED'
        );
    }
}

function buildCaptionPrompt(input: CaptionInput): string {
    const profile = input.brandProfile || {};
    const parts = [
        'You are a senior social media copywriter.',
        'Write exactly one ready-to-publish caption. Do not include markdown, quotes, or commentary.',
        `Platform: ${input.platform === 'both' ? 'Facebook and Instagram' : input.platform}.`,
    ];

    if (profile.niche) parts.push(`Brand niche: ${profile.niche}.`);
    if (profile.tone) parts.push(`Brand tone: ${profile.tone}.`);
    if (profile.audience) parts.push(`Target audience: ${profile.audience}.`);
    if (profile.keywords) parts.push(`Keywords to naturally include: ${profile.keywords}.`);
    if (input.topic) parts.push(`Post topic: ${input.topic}.`);

    parts.push(
        'Keep it engaging and specific. Use short paragraphs. Add 3-5 relevant hashtags at the end.',
        'Stay under 2,000 characters. Never invent prices, dates, or claims that were not provided.'
    );

    return parts.join('\n');
}

export async function generateCaption(input: CaptionInput): Promise<string> {
    assertConfigured();

    let response: Response;
    try {
        response = await fetch(
            `${GEMINI_BASE}/models/${encodeURIComponent(env.gemini.textModel)}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': env.gemini.apiKey,
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: buildCaptionPrompt(input) }] }],
                    generationConfig: {
                        temperature: 0.8,
                        maxOutputTokens: 800,
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

    const data = (await response.json().catch(() => ({}))) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
    };

    if (!response.ok || data.error) {
        throw new AppError(
            502,
            data.error?.message || 'Gemini caption generation failed',
            'AI_CAPTION_FAILED'
        );
    }

    const caption = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('\n')
        .trim();

    if (!caption) {
        throw new AppError(502, 'Gemini returned an empty caption', 'AI_EMPTY_RESPONSE');
    }

    return caption.slice(0, 2200);
}

export async function generateImage(prompt: string): Promise<UploadedMedia> {
    assertConfigured();

    if (!isCloudinaryConfigured) {
        throw new AppError(
            503,
            'AI image generation needs media storage. Add Cloudinary credentials to the backend environment.',
            'MEDIA_NOT_CONFIGURED'
        );
    }

    let response: Response;
    try {
        response = await fetch(
            `${GEMINI_BASE}/models/${encodeURIComponent(env.gemini.imageModel)}:predict`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': env.gemini.apiKey,
                },
                body: JSON.stringify({
                    instances: [{ prompt }],
                    parameters: {
                        sampleCount: 1,
                        aspectRatio: '1:1',
                    },
                }),
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

    const data = (await response.json().catch(() => ({}))) as {
        predictions?: Array<{ bytesBase64Encoded?: string }>;
        error?: { message?: string };
    };

    if (!response.ok || data.error) {
        throw new AppError(
            502,
            data.error?.message || 'Gemini image generation failed',
            'AI_IMAGE_FAILED'
        );
    }

    const base64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!base64) {
        throw new AppError(502, 'Gemini returned no image data', 'AI_EMPTY_RESPONSE');
    }

    return uploadImage(Buffer.from(base64, 'base64'));
}
