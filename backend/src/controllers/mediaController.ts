import type { Request, Response } from 'express';
import { z } from 'zod';
import { preparePostImage } from '../services/brandLogoService.js';
import { uploadImage as uploadToCloudinary } from '../services/cloudinaryService.js';
import {
    deleteUserAssets,
    emptyStorageSummary,
    getStorageOverviewForUser,
    MAX_DELETE_IDS,
} from '../services/cloudinaryStorageService.js';
import { getCloudinaryCredentials } from '../services/credentialService.js';
import {
    loadReelVideo,
    signVideoUpload,
} from '../services/videoUploadService.js';
import { AppError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';

const deleteMediaSchema = z.object({
    assetIds: z
        .array(z.string().trim().min(1))
        .min(1)
        .max(MAX_DELETE_IDS),
});

const registerVideoSchema = z.object({
    publicId: z.string().trim().min(1).max(300),
});

export async function uploadMedia(req: Request, res: Response): Promise<void> {
    if (!req.file) {
        throw new AppError(400, 'No image file was uploaded', 'NO_FILE');
    }

    // Resize to feed limits (and frame with the user's logo) before upload, so
    // Cloudinary only ever stores the exact image that will be published.
    const image = await preparePostImage(req.user.id, req.file.buffer);
    const media = {
        ...(await uploadToCloudinary(req.user.id, image.buffer)),
        textArea: image.textArea,
    };

    res.status(201).json({ success: true, media });
}

/**
 * Lists only the authenticated user's own Meta-Bru uploads. There is no
 * userId parameter: the credential owner and folder are always derived from
 * req.user.id, so another user cannot read this account through the API.
 */
export async function getStorageOverview(
    req: Request,
    res: Response
): Promise<void> {
    try {
        const overview = await getStorageOverviewForUser(req.user.id);
        res.json({ success: true, ...overview });
    } catch (error) {
        if (
            error instanceof AppError &&
            error.code === 'MEDIA_NOT_CONFIGURED'
        ) {
            res.json({
                success: true,
                configured: false,
                assets: [],
                summary: emptyStorageSummary(),
            });
            return;
        }

        throw error;
    }
}

/**
 * Deletes only assets that belong to the authenticated user's own folder.
 * Asset IDs from another folder or Cloudinary account are skipped by the
 * storage service, even if a caller guesses them.
 */
export async function deleteMedia(
    req: Request,
    res: Response
): Promise<void> {
    const { assetIds } = parseBody(deleteMediaSchema, req);
    const result = await deleteUserAssets(req.user.id, assetIds);

    res.json({ success: true, ...result });
}

/**
 * Signs a direct browser upload of a reel to the user's own Cloudinary
 * account. Large videos never pass through this server.
 */
export async function createVideoSignature(
    req: Request,
    res: Response
): Promise<void> {
    const credentials = await getCloudinaryCredentials(req.user.id);
    res.json({ success: true, upload: signVideoUpload(credentials, req.user.id) });
}

/**
 * Checks a reel the browser just uploaded and returns its media details. A
 * video that breaks the reel limits is deleted from Cloudinary.
 */
export async function registerVideo(req: Request, res: Response): Promise<void> {
    const { publicId } = parseBody(registerVideoSchema, req);
    const credentials = await getCloudinaryCredentials(req.user.id);
    const media = await loadReelVideo(req.user.id, publicId, credentials, {
        deleteIfRejected: true,
    });

    res.status(201).json({ success: true, media });
}
