import type { Request, Response } from 'express';
import { z } from 'zod';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { getCloudinaryCredentials } from '../services/credentialService.js';
import { decryptSecret } from '../services/cryptoService.js';
import { MetaApiError, searchInstagramAudio } from '../services/metaService.js';
import {
    deleteTrack as removeTrack,
    listTracks as loadTracks,
    registerTrack,
    signTrackUpload,
} from '../services/musicLibraryService.js';
import { AppError } from '../utils/errors.js';
import { parseBody, parseQuery } from '../utils/validation.js';

const registerTrackSchema = z.object({
    publicId: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1, 'Give the track a title').max(120),
    artist: z.string().trim().max(120).default(''),
});

const instagramSearchSchema = z.object({
    connectionId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid connection ID'),
    q: z.string().trim().max(100).default(''),
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

/**
 * Searches Instagram's music library for a Page's Instagram account. Meta's
 * own error is passed on, since it explains why the library is unavailable.
 */
export async function searchInstagramMusic(req: Request, res: Response): Promise<void> {
    const { connectionId, q } = parseQuery(instagramSearchSchema, req);
    const connection = await SocialConnection.findOne({
        _id: connectionId,
        userId: req.user.id,
    }).select('+pageAccessTokenEnc');

    if (!connection) throw new AppError(404, 'Connection not found', 'CONNECTION_NOT_FOUND');
    if (!connection.instagram?.id) {
        throw new AppError(400, 'This Page has no linked Instagram account.', 'INSTAGRAM_NOT_LINKED');
    }

    let token: string;
    try {
        token = decryptSecret(connection.pageAccessTokenEnc);
    } catch {
        throw new AppError(409, 'Stored Page token could not be decrypted. Reconnect this Page.', 'RECONNECT_REQUIRED');
    }

    try {
        const songs = await searchInstagramAudio(connection.instagram.id, token, q);
        res.json({ success: true, songs });
    } catch (error) {
        if (error instanceof MetaApiError) {
            throw new AppError(502, `Instagram's music library: ${error.message}`, 'INSTAGRAM_AUDIO_FAILED');
        }
        throw error;
    }
}
