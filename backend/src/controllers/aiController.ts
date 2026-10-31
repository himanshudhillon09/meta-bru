import type { Request, Response } from 'express';
import { z } from 'zod';
import {
    generateCaption,
    generateImage,
    generateOverlayText,
    listGeminiModels,
} from '../services/aiService.js';
import {
    aiProviderOf,
    claudeCaption,
    claudeImagePrompt,
    claudeModelOf,
    claudeOverlayText,
    listClaudeModels,
} from '../services/claudeService.js';
import { getGeminiCredentials } from '../services/credentialService.js';
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
    /** The picture the text goes on; Claude reads it, Gemini doesn't. */
    mediaPublicId: z.string().trim().min(1).max(500).optional(),
});

const imageSchema = z.object({
    prompt: z.string().trim().min(3, 'Describe the image you want').max(1_000),
    /** The Page whose logo frames the image. */
    connectionId: z.string().optional(),
    /** The post's topic and caption, for Claude's art direction. */
    topic: z.string().trim().max(500).optional(),
    caption: z.string().trim().max(2200).optional(),
});

/** The user's chosen model for a feature, or nothing for the deployment default. */
function chosenModel(req: Request, feature: 'text' | 'image'): string {
    const model = req.user?.aiModels?.[feature];
    return typeof model === 'string' ? model : '';
}

export async function draftCaption(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(captionSchema, req);
    const input = {
        ...(parsed.topic ? { topic: parsed.topic } : {}),
        platform: parsed.platform,
        brandProfile: await getPageBrandProfile(req.user.id, parsed.connectionId),
        ...(parsed.mediaPublicId ? { mediaPublicId: parsed.mediaPublicId } : {}),
    };

    const caption =
        aiProviderOf(req.user) === 'claude'
            ? await claudeCaption(req.user.id, claudeModelOf(req.user), input)
            : await generateCaption(req.user.id, {
                  ...input,
                  ...(chosenModel(req, 'text') ? { model: chosenModel(req, 'text') } : {}),
              });

    res.json({ success: true, caption });
}

/**
 * Gemini always draws the picture. With Claude selected, Claude first turns
 * the user's description into detailed art direction, and the response
 * returns that prompt so the Composer can show and reuse it.
 */
export async function createAiImage(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(imageSchema, req);
    let prompt = parsed.prompt;
    let directedBy: 'claude' | null = null;

    if (aiProviderOf(req.user) === 'claude') {
        // Check the Gemini key first so no Claude tokens are spent on a
        // prompt that can't be drawn.
        try {
            await getGeminiCredentials(req.user.id);
        } catch (error) {
            if (error instanceof AppError && error.code === 'AI_NOT_CONFIGURED') {
                throw new AppError(
                    400,
                    'Claude writes the image direction, but Claude cannot draw images, so Gemini draws the picture. Add your Gemini API key under Profile.',
                    'AI_NOT_CONFIGURED'
                );
            }
            throw error;
        }
        prompt = await claudeImagePrompt(req.user.id, claudeModelOf(req.user), {
            description: parsed.prompt,
            ...(parsed.topic ? { topic: parsed.topic } : {}),
            ...(parsed.caption ? { caption: parsed.caption } : {}),
            brandProfile: await getPageBrandProfile(req.user.id, parsed.connectionId),
        });
        directedBy = 'claude';
    }

    const { media, source } = await generateImage(
        req.user.id,
        prompt,
        chosenModel(req, 'image'),
        parsed.connectionId || null
    );

    res.status(201).json({ success: true, media, source, prompt, directedBy });
}

export async function draftOverlayText(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(overlayTextSchema, req);
    const claude = aiProviderOf(req.user) === 'claude';
    // Claude can write from the picture alone; Gemini needs words.
    if (!parsed.topic && !parsed.caption && !parsed.prompt && !(claude && parsed.mediaPublicId)) {
        throw new AppError(
            400,
            'Write a topic, caption, or image description first.',
            'VALIDATION_ERROR'
        );
    }

    const input = {
        ...(parsed.topic ? { topic: parsed.topic } : {}),
        ...(parsed.caption ? { caption: parsed.caption } : {}),
        ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
        brandProfile: await getPageBrandProfile(req.user.id, parsed.connectionId),
    };

    const text = claude
        ? await claudeOverlayText(req.user.id, claudeModelOf(req.user), {
              ...input,
              ...(parsed.mediaPublicId ? { mediaPublicId: parsed.mediaPublicId } : {}),
          })
        : await generateOverlayText(req.user.id, {
              ...input,
              ...(chosenModel(req, 'text') ? { model: chosenModel(req, 'text') } : {}),
          });

    res.json({ success: true, text });
}

/** The Gemini models the user's key can use, for the Profile model pickers. */
export async function listModels(req: Request, res: Response): Promise<void> {
    res.json({ success: true, ...(await listGeminiModels(req.user.id)) });
}

/** The Claude models the user's key can use, for the Profile model picker. */
export async function listClaudeModelOptions(req: Request, res: Response): Promise<void> {
    res.json({ success: true, ...(await listClaudeModels(req.user.id)) });
}
