import type { Request, Response } from 'express';
import { uploadImage as uploadToCloudinary } from '../services/cloudinaryService.js';
import { AppError } from '../utils/errors.js';

export async function uploadMedia(req: Request, res: Response): Promise<void> {
    if (!req.file) {
        throw new AppError(400, 'No image file was uploaded', 'NO_FILE');
    }

    const media = await uploadToCloudinary(req.user.id, req.file.buffer);

    res.status(201).json({ success: true, media });
}
