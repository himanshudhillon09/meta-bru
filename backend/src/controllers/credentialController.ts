import type { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/userModel.js';
import {
    clearCloudinaryCredentials,
    clearGeminiCredentials,
    clearMetaCredentials,
    getCredentialStatus,
    getRevealedCredentials,
    updateCloudinaryCredentials,
    updateGeminiCredentials,
    updateMetaCredentials,
} from '../services/credentialService.js';
import { resolveMetaRedirectUri } from '../services/metaService.js';
import { AppError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';

const metaSchema = z.object({
    appId: z
        .string()
        .trim()
        .regex(/^\d{5,32}$/, 'Meta App ID must be numeric'),
    appSecret: z
        .string()
        .trim()
        .max(128)
        .refine(
            (value) => !value || value.length >= 16,
            'Meta App Secret looks too short'
        )
        .optional(),
});

const cloudinarySchema = z.object({
    cloudName: z
        .string()
        .trim()
        .regex(
            /^[a-zA-Z0-9_-]{1,64}$/,
            'Cloudinary cloud name may only contain letters, numbers, dashes and underscores'
        ),
    apiKey: z.string().trim().max(128).optional(),
    apiSecret: z.string().trim().max(128).optional(),
});

const geminiSchema = z.object({
    apiKey: z.string().trim().min(1).max(256),
});

async function statusResponse(req: Request, res: Response): Promise<void> {
    const credentials = await getCredentialStatus(
        req.user.id,
        resolveMetaRedirectUri(req)
    );
    res.json({ success: true, credentials });
}

const revealSchema = z.object({
    currentPassword: z.string().min(1).max(128),
});

export async function getCredentials(req: Request, res: Response): Promise<void> {
    await statusResponse(req, res);
}

export async function revealCredentials(
    req: Request,
    res: Response
): Promise<void> {
    const parsed = parseBody(revealSchema, req);
    const user = await User.findById(req.user.id).select('+password');

    if (
        !user ||
        !(await (user as any).matchPassword(parsed.currentPassword))
    ) {
        throw new AppError(
            400,
            'Current password is incorrect.',
            'INVALID_CURRENT_PASSWORD'
        );
    }

    const credentials = await getRevealedCredentials(req.user.id);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, credentials });
}

export async function saveMetaCredentials(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(metaSchema, req);

    await updateMetaCredentials(
        req.user.id,
        parsed.appSecret
            ? { appId: parsed.appId, appSecret: parsed.appSecret }
            : { appId: parsed.appId }
    );

    await statusResponse(req, res);
}

export async function removeMetaCredentials(req: Request, res: Response): Promise<void> {
    await clearMetaCredentials(req.user.id);
    await statusResponse(req, res);
}

export async function saveCloudinaryCredentials(
    req: Request,
    res: Response
): Promise<void> {
    const parsed = parseBody(cloudinarySchema, req);

    await updateCloudinaryCredentials(req.user.id, {
        cloudName: parsed.cloudName,
        ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
        ...(parsed.apiSecret ? { apiSecret: parsed.apiSecret } : {}),
    });

    await statusResponse(req, res);
}

export async function removeCloudinaryCredentials(
    req: Request,
    res: Response
): Promise<void> {
    await clearCloudinaryCredentials(req.user.id);
    await statusResponse(req, res);
}

export async function saveGeminiCredentials(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(geminiSchema, req);
    await updateGeminiCredentials(req.user.id, { apiKey: parsed.apiKey });
    await statusResponse(req, res);
}

export async function removeGeminiCredentials(
    req: Request,
    res: Response
): Promise<void> {
    await clearGeminiCredentials(req.user.id);
    await statusResponse(req, res);
}
