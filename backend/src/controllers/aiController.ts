import type { Request, Response } from 'express';
import { z } from 'zod';
import {
    generateCaption,
    generateImage,
    generateOverlayText,
    listGeminiModels,
} from '../services/aiService.js';
import { getPageBrandProfile } from '../services/pageBrandService.js';
import { AppError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';

const captionSchema = z.object({
    topic: z.string().trim().max(500).optional(),
    platform: z.enum(['facebook', 'instagram', 'both']).default('both'),
    connectionId: z.string().optional(),
    mediaPublicId: z.string().trim().min(1).max(500).optional(),
});

const overlayTextSchema = z.object({
    /** The Page whose brand voice the text should match. */
    connectionId: z.string().optional(),
    topic: z.string().trim().max(500).optional(),
    caption: z.string().trim().max(2200).optional(),
    prompt: z.string().trim().max(1_000).optional(),
});

const imageSchema = z.object({
    prompt: z.string().trim().min(3, 'Describe the image you want').max(1_000),
    /** The Page whose logo frames the image. */
    connectionId: z.string().optional(),
});

/** The user's chosen model for a feature, or nothing for the deployment default. */
function chosenModel(req: Request, feature: 'text' | 'image'): string {
    const model = req.user?.aiModels?.[feature];
    return typeof model === 'string' ? model : '';
}

export async function draftCaption(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(captionSchema, req);

    const caption = await generateCaption(req.user.id, {
        ...(parsed.topic ? { topic: parsed.topic } : {}),
        platform: parsed.platform,
        brandProfile: await getPageBrandProfile(req.user.id, parsed.connectionId),
        ...(parsed.mediaPublicId ? { mediaPublicId: parsed.mediaPublicId } : {}),
        ...(chosenModel(req, 'text') ? { model: chosenModel(req, 'text') } : {}),
    });

    res.json({ success: true, caption });
}

export async function createAiImage(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(imageSchema, req);
    const { media, source } = await generateImage(
        req.user.id,
        parsed.prompt,
        chosenModel(req, 'image'),
        parsed.connectionId || null
    );

    res.status(201).json({ success: true, media, source });
}

export async function draftOverlayText(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(overlayTextSchema, req);
    if (!parsed.topic && !parsed.caption && !parsed.prompt) {
        throw new AppError(
            400,
            'Write a topic, caption, or image description first.',
            'VALIDATION_ERROR'
        );
    }

    const text = await generateOverlayText(req.user.id, {
        ...(parsed.topic ? { topic: parsed.topic } : {}),
        ...(parsed.caption ? { caption: parsed.caption } : {}),
        ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
        brandProfile: await getPageBrandProfile(req.user.id, parsed.connectionId),
        ...(chosenModel(req, 'text') ? { model: chosenModel(req, 'text') } : {}),
    });

    res.json({ success: true, text });
}

/** The Gemini models the user's key can use, for the Profile model pickers. */
export async function listModels(req: Request, res: Response): Promise<void> {
    res.json({ success: true, ...(await listGeminiModels(req.user.id)) });
}
