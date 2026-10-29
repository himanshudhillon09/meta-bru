import mongoose from 'mongoose';

export type GeminiFeature = 'caption' | 'image text' | 'image' | 'analytics';

// `Document` declares a `model()` method that collides with the Gemini model
// name field (see analyticsAiInsightModel). Read `doc.model` as a string only.

/** One user's Gemini calls for one quota day (Pacific time), model, and feature. */
export interface IGeminiUsage extends Omit<mongoose.Document, 'model'> {
    userId: mongoose.Types.ObjectId;
    /** Google's quota day in Pacific time, YYYY-MM-DD. */
    day: string;
    model: string;
    feature: GeminiFeature;
    requests: number;
    failures: number;
    /** Calls Google refused with a quota error (HTTP 429). */
    rateLimited: number;
    inputTokens: number;
    outputTokens: number;
    images: number;
    createdAt: Date;
    updatedAt: Date;
}

const usageSchema = new mongoose.Schema<IGeminiUsage>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        day: { type: String, required: true },
        model: { type: String, required: true },
        feature: {
            type: String,
            enum: ['caption', 'image text', 'image', 'analytics'],
            required: true,
        },
        requests: { type: Number, default: 0 },
        failures: { type: Number, default: 0 },
        rateLimited: { type: Number, default: 0 },
        inputTokens: { type: Number, default: 0 },
        outputTokens: { type: Number, default: 0 },
        images: { type: Number, default: 0 },
    },
    { timestamps: true }
);

usageSchema.index({ userId: 1, day: 1, model: 1, feature: 1 }, { unique: true });

export const GeminiUsage = mongoose.model<IGeminiUsage>('GeminiUsage', usageSchema);

/**
 * A limit Google reported in a quota error, such as 250 requests per day for
 * one model. Google does not expose remaining quota any other way.
 */
export interface IGeminiQuota extends Omit<mongoose.Document, 'model'> {
    userId: mongoose.Types.ObjectId;
    model: string;
    /** Google's quota id, e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier. */
    quotaId: string;
    period: 'day' | 'minute' | 'other';
    kind: 'requests' | 'tokens';
    limit: number | null;
    freeTier: boolean;
    message: string;
    observedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const quotaSchema = new mongoose.Schema<IGeminiQuota>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        model: { type: String, required: true },
        quotaId: { type: String, required: true },
        period: { type: String, enum: ['day', 'minute', 'other'], default: 'other' },
        kind: { type: String, enum: ['requests', 'tokens'], default: 'requests' },
        limit: { type: Number, default: null },
        freeTier: { type: Boolean, default: false },
        message: { type: String, default: '' },
        observedAt: { type: Date, required: true },
    },
    { timestamps: true }
);

quotaSchema.index({ userId: 1, model: 1, quotaId: 1 }, { unique: true });

export const GeminiQuota = mongoose.model<IGeminiQuota>('GeminiQuota', quotaSchema);
