import mongoose from 'mongoose';
import type { Platform } from './postModel.js';

export type SnapshotStatus = 'ok' | 'partial' | 'unavailable' | 'permission_error';

export interface IAnalyticsMetrics {
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    reach: number | null;
    views: number | null;
    clicks: number | null;
    interactions: number | null;
    engagementRate: number | null;
}

export interface IPostMetricSnapshot extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    connectionId: mongoose.Types.ObjectId;
    pageId: string;
    pageName: string;
    postId: mongoose.Types.ObjectId;
    platform: Platform;
    externalId: string;
    publishedAt: Date;
    capturedAt: Date;
    metrics: IAnalyticsMetrics;
    availableMetrics: string[];
    status: SnapshotStatus;
    error: string;
    createdAt: Date;
    updatedAt: Date;
}

export const emptyAnalyticsMetrics = (): IAnalyticsMetrics => ({
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    reach: null,
    views: null,
    clicks: null,
    interactions: null,
    engagementRate: null,
});

const metricsSchema = new mongoose.Schema<IAnalyticsMetrics>(
    {
        likes: { type: Number, default: null },
        comments: { type: Number, default: null },
        shares: { type: Number, default: null },
        saves: { type: Number, default: null },
        reach: { type: Number, default: null },
        views: { type: Number, default: null },
        clicks: { type: Number, default: null },
        interactions: { type: Number, default: null },
        engagementRate: { type: Number, default: null },
    },
    { _id: false }
);

const snapshotSchema = new mongoose.Schema<IPostMetricSnapshot>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        connectionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'SocialConnection',
            required: true,
        },
        pageId: { type: String, required: true },
        pageName: { type: String, default: '' },
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
        platform: { type: String, enum: ['facebook', 'instagram'], required: true },
        externalId: { type: String, default: '' },
        publishedAt: { type: Date, required: true },
        capturedAt: { type: Date, required: true },
        metrics: { type: metricsSchema, default: emptyAnalyticsMetrics },
        availableMetrics: { type: [String], default: [] },
        status: {
            type: String,
            enum: ['ok', 'partial', 'unavailable', 'permission_error'],
            default: 'unavailable',
        },
        error: { type: String, default: '' },
    },
    { timestamps: true }
);

snapshotSchema.index({ userId: 1, publishedAt: -1 });
snapshotSchema.index({ userId: 1, connectionId: 1, publishedAt: -1 });
snapshotSchema.index({ postId: 1, platform: 1, capturedAt: -1 });
snapshotSchema.index({ userId: 1, platform: 1, publishedAt: -1 });

export const PostMetricSnapshot = mongoose.model<IPostMetricSnapshot>(
    'PostMetricSnapshot',
    snapshotSchema
);
