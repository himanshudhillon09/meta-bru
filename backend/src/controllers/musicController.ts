import type { Request, Response } from 'express';
import { z } from 'zod';
import { getCloudinaryCredentials } from '../services/credentialService.js';
import {
    deleteTrack as removeTrack,
    listTracks as loadTracks,
    registerTrack,
    signTrackUpload,
} from '../services/musicLibraryService.js';
import { AppError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';

const registerTrackSchema = z.object({
    publicId: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1, 'Give the track a title').max(120),
    artist: z.string().trim().max(120).default(''),
});

/** Signs a direct browser upload of a track to the user's Cloudinary. */
export async function createTrackSignature(req: Request, res: Response): Promise<void> {
    const credentials = await getCloudinaryCredentials(req.user.id);
    res.json({ success: true, upload: signTrackUpload(credentials, req.user.id) });
}

export async function addTrack(req: Request, res: Response): Promise<void> {
    const input = parseBody(registerTrackSchema, req);
    const track = await registerTrack(req.user.id, input);
    res.status(201).json({ success: true, track });
}

export async function listTracks(req: Request, res: Response): Promise<void> {
    try {
        res.json({ success: true, configured: true, tracks: await loadTracks(req.user.id) });
    } catch (error) {
        if (error instanceof AppError && error.code === 'MEDIA_NOT_CONFIGURED') {
            res.json({ success: true, configured: false, tracks: [] });
            return;
        }
        throw error;
    }
}

export async function deleteTrack(req: Request, res: Response): Promise<void> {
    await removeTrack(req.user.id, String(req.params.id));
    res.json({ success: true });
}
