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
    mediaPublicId: string;
    mediaType: 'image';
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
        mediaPublicId: { type: String, default: '' },
        mediaType: { type: String, enum: ['image'], default: 'image' },
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

export const Post = mongoose.model<IPost>('Post', postSchema);
