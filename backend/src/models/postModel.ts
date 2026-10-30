import mongoose from 'mongoose';

export type Platform = 'facebook' | 'instagram';
export type PostStatus =
    | 'draft'
    | 'queued'
    | 'publishing'
    | 'published'
    | 'partial'
    | 'failed';
export type TargetStatus = 'pending' | 'publishing' | 'published' | 'failed';
export type MediaType = 'image' | 'reel';

export interface IPostTarget {
    platform: Platform;
    status: TargetStatus;
    externalId: string;
    creationId: string;
    error: string;
    publishedAt: Date | null;
}

export interface IPost extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    connectionId: mongoose.Types.ObjectId;
    caption: string;
    mediaUrl: string;
    mediaJpegUrl: string;
    mediaPublicId: string;
    mediaType: MediaType;
    /** Reel length in seconds; 0 for images. */
    mediaDuration: number;
    /** Reel cover JPG used for thumbnails; empty for images. */
    mediaCoverUrl: string;
    /** The image carries the bold text line from the Composer. */
    hasTextOverlay: boolean;
    /** Publish with Meta's "AI info" label where the platform supports it. */
    aiGenerated: boolean;
    shareToStory: boolean;
    /** Story shares. They never change status, lastError, or publishedAt. */
    storyTargets: IPostTarget[];
    platforms: { facebook: boolean; instagram: boolean };
    status: PostStatus;
    targets: IPostTarget[];
    attempts: number;
    lastError: string;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const targetSchema = new mongoose.Schema<IPostTarget>(
    {
        platform: { type: String, enum: ['facebook', 'instagram'], required: true },
        status: {
            type: String,
            enum: ['pending', 'publishing', 'published', 'failed'],
            default: 'pending',
        },
        externalId: { type: String, default: '' },
        creationId: { type: String, default: '' },
        error: { type: String, default: '' },
        publishedAt: { type: Date, default: null },
    },
    { _id: false }
);

const postSchema = new mongoose.Schema<IPost>(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        connectionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'SocialConnection',
            required: true,
            index: true,
        },
        caption: { type: String, required: true, maxlength: 2200 },
        mediaUrl: { type: String, required: true },
        /** JPEG delivery URL for Meta. Empty for reels and legacy/external media. */
        mediaJpegUrl: { type: String, default: '' },
        mediaPublicId: { type: String, default: '' },
        mediaType: { type: String, enum: ['image', 'reel'], default: 'image' },
        mediaDuration: { type: Number, default: 0, min: 0 },
        mediaCoverUrl: { type: String, default: '' },
        hasTextOverlay: { type: Boolean, default: false },
        aiGenerated: { type: Boolean, default: false },
        shareToStory: { type: Boolean, default: false },
        storyTargets: { type: [targetSchema], default: [] },
        platforms: {
            facebook: { type: Boolean, default: true },
            instagram: { type: Boolean, default: false },
        },
        status: {
            type: String,
            enum: ['draft', 'queued', 'publishing', 'published', 'partial', 'failed'],
            default: 'queued',
            index: true,
        },
        targets: { type: [targetSchema], default: [] },
        attempts: { type: Number, default: 0 },
        lastError: { type: String, default: '' },
        publishedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

postSchema.index({ connectionId: 1, status: 1, createdAt: 1 });
postSchema.index({ userId: 1, createdAt: -1 });
postSchema.index({ userId: 1, mediaPublicId: 1 });

export const Post = mongoose.model<IPost>('Post', postSchema);
