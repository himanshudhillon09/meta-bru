import mongoose from 'mongoose';
import type { Platform } from './postModel.js';

export type ImportedKind = 'post' | 'reel' | 'story';

/**
 * A post, reel, or Story published on a connected Page or Instagram account
 * outside Meta-Bru. Kept apart from Post so the Queue, Activity, Storage, and
 * scheduler never see it; only Analytics reads it. One document per platform
 * copy.
 */
export interface IImportedPost extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    connectionId: mongoose.Types.ObjectId;
    platform: Platform;
    kind: ImportedKind;
    /** Facebook post id (Page_Post), Instagram media id, or Story id. */
    externalId: string;
    /** Facebook reels: the video id their insights are read from. */
    videoId: string;
    caption: string;
    /** Thumbnail from Meta's CDN; it can expire, so each import refreshes it. */
    mediaUrl: string;
    permalink: string;
    publishedAt: Date;
    /** The last import that still found it on Meta. */
    lastSeenAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const importedPostSchema = new mongoose.Schema<IImportedPost>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialConnection', required: true },
        platform: { type: String, enum: ['facebook', 'instagram'], required: true },
        kind: { type: String, enum: ['post', 'reel', 'story'], required: true },
        externalId: { type: String, required: true },
        videoId: { type: String, default: '' },
        caption: { type: String, default: '' },
        mediaUrl: { type: String, default: '' },
        permalink: { type: String, default: '' },
        publishedAt: { type: Date, required: true },
        lastSeenAt: { type: Date, required: true },
    },
    { timestamps: true }
);

importedPostSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
importedPostSchema.index({ userId: 1, kind: 1, publishedAt: -1 });

export const ImportedPost = mongoose.model<IImportedPost>('ImportedPost', importedPostSchema);
