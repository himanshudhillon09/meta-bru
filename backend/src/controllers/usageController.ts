import type { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/userModel.js';
import { AppError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import { getCloudinaryPlanUsage, getGeminiUsage } from '../services/usageService.js';

const limitSchema = z.number().int().min(1).max(10_000_000).nullable();

const geminiLimitsSchema = z
    .object({
        dailyRequests: limitSchema,
        monthlyRequests: limitSchema,
    })
    .strict();

/** Gemini and Cloudinary usage for the signed-in user's own keys. */
export async function getUsage(req: Request, res: Response): Promise<void> {
    const [gemini, cloudinary] = await Promise.all([
        getGeminiUsage(req.user.id, req.user),
        getCloudinaryPlanUsage(req.user.id),
    ]);
    res.json({ success: true, gemini, cloudinary });
}

/** Saves the request limits the user sees in Google AI Studio. */
export async function updateGeminiLimits(req: Request, res: Response): Promise<void> {
    const limits = parseBody(geminiLimitsSchema, req);
    const user = await User.findById(req.user.id);
    if (!user) throw new AppError(404, 'User not found', 'NOT_FOUND');

    user.set('geminiLimits', limits);
    await user.save();
    res.json({ success: true, limits });
}
