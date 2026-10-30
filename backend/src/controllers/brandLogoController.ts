import type { Request, Response } from 'express';
import {
    getBrandLogoDetails,
    removeBrandLogo,
    saveBrandLogo,
} from '../services/brandLogoService.js';
import { AppError } from '../utils/errors.js';

// Every handler acts on one of the signed-in user's Pages (`:id`).

export async function getBrandLogo(req: Request, res: Response): Promise<void> {
    const details = await getBrandLogoDetails(req.user.id, String(req.params.id));
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, ...details });
}

export async function uploadBrandLogo(
    req: Request,
    res: Response
): Promise<void> {
    if (!req.file) {
        throw new AppError(400, 'No logo file was uploaded', 'NO_FILE');
    }

    const details = await saveBrandLogo(req.user.id, String(req.params.id), req.file.buffer);
    res.status(201).json({ success: true, ...details });
}

export async function deleteBrandLogo(
    req: Request,
    res: Response
): Promise<void> {
    await removeBrandLogo(req.user.id, String(req.params.id));
    res.json({ success: true, logo: null, previews: [] });
}
