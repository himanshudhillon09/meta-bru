import type { Request, Response } from 'express';
import { z } from 'zod';
import {
    generateCaption,
    generateImage,
    generateOverlayText,
} from '../services/aiService.js';
import { AppError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';

const captionSchema = z.object({
    topic: z.string().trim().max(500).optional(),
    platform: z.enum(['facebook', 'instagram', 'both']).default('both'),
    connectionId: z.string().optional(),
    mediaPublicId: z.string().trim().min(1).max(500).optional(),
});

const overlayTextSchema = z.object({
    topic: z.string().trim().max(500).optional(),
    caption: z.string().trim().max(2200).optional(),
    prompt: z.string().trim().max(1_000).optional(),
});

const imageSchema = z.object({
    prompt: z.string().trim().min(3, 'Describe the image you want').max(1_000),
});

export async function draftCaption(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(captionSchema, req);

    const caption = await generateCaption(req.user.id, {
        ...(parsed.topic ? { topic: parsed.topic } : {}),
        platform: parsed.platform,
        brandProfile: req.user.brandProfile || {},
        ...(parsed.mediaPublicId ? { mediaPublicId: parsed.mediaPublicId } : {}),
    });

    res.json({ success: true, caption });
}

export async function createAiImage(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(imageSchema, req);
    const media = await generateImage(req.user.id, parsed.prompt);

    res.status(201).json({ success: true, media });
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
        brandProfile: req.user.brandProfile || {},
    });

    res.json({ success: true, text });
}
