import mongoose from 'mongoose';
import type { Platform } from './postModel.js';
import type { SnapshotStatus } from './postMetricSnapshotModel.js';

export interface IStoryMetrics {
    reach: number | null;
    views: number | null;
    replies: number | null;
    shares: number | null;
    interactions: number | null;
    /** Instagram navigation: taps to the next Story, back, out, or a swipe to the next account. */
    tapsForward: number | null;
    tapsBack: number | null;
    exits: number | null;
    swipesForward: number | null;
}

/**
 * The latest numbers for one Story. Meta only reports Story insights while the
 * Story is live (24 hours), so this keeps the last values it returned.
 */
export interface IStoryMetricSnapshot extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    connectionId: mongoose.Types.ObjectId;
    postId: mongoose.Types.ObjectId;
    platform: Platform;
    externalId: string;
    publishedAt: Date;
    /** Last time Meta was asked, successful or not. */
    capturedAt: Date;
    /** When `metrics` were reported; null until Meta returns any. */
    metricsCapturedAt: Date | null;
    metrics: IStoryMetrics;
    status: SnapshotStatus;
    error: string;
    createdAt: Date;
    updatedAt: Date;
}

export const emptyStoryMetrics = (): IStoryMetrics => ({
    reach: null,
    views: null,
    replies: null,
    shares: null,
    interactions: null,
    tapsForward: null,
    tapsBack: null,
    exits: null,
    swipesForward: null,
});

const metricsSchema = new mongoose.Schema<IStoryMetrics>(
    {
        reach: { type: Number, default: null },
        views: { type: Number, default: null },
        replies: { type: Number, default: null },
        shares: { type: Number, default: null },
        interactions: { type: Number, default: null },
        tapsForward: { type: Number, default: null },
        tapsBack: { type: Number, default: null },
        exits: { type: Number, default: null },
        swipesForward: { type: Number, default: null },
    },
    { _id: false }
);

const snapshotSchema = new mongoose.Schema<IStoryMetricSnapshot>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        connectionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'SocialConnection',
            required: true,
        },
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
        platform: { type: String, enum: ['facebook', 'instagram'], required: true },
        externalId: { type: String, default: '' },
        publishedAt: { type: Date, required: true },
        capturedAt: { type: Date, required: true },
        metricsCapturedAt: { type: Date, default: null },
        metrics: { type: metricsSchema, required: true, default: emptyStoryMetrics },
        status: {
            type: String,
            enum: ['ok', 'partial', 'unavailable', 'permission_error'],
            required: true,
            default: 'unavailable',
        },
        error: { type: String, default: '' },
    },
    { timestamps: true }
);

snapshotSchema.index({ postId: 1, platform: 1 }, { unique: true });
snapshotSchema.index({ userId: 1, publishedAt: -1 });

export const StoryMetricSnapshot = mongoose.model<IStoryMetricSnapshot>(
    'StoryMetricSnapshot',
    snapshotSchema
);
