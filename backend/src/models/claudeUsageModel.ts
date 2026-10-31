import mongoose from 'mongoose';

export type ClaudeFeature = 'caption' | 'image text' | 'image prompt' | 'analytics';

export const CLAUDE_FEATURES: ClaudeFeature[] = ['caption', 'image text', 'image prompt', 'analytics'];

// `Document` declares a `model()` method that collides with the Claude model
// name field (see geminiUsageModel). Read `doc.model` as a string only.

/** One user's Claude calls for one UTC day, model, and feature. */
export interface IClaudeUsage extends Omit<mongoose.Document, 'model'> {
    userId: mongoose.Types.ObjectId;
    /** UTC day, YYYY-MM-DD, the same days the Claude Console reports. */
    day: string;
    /** The model that answered, which differs from the one asked after a fallback. */
    model: string;
    feature: ClaudeFeature;
    requests: number;
    failures: number;
    /** Calls Anthropic refused with a rate limit error (HTTP 429). */
    rateLimited: number;
    /** Calls Claude declined for safety reasons. */
    refusals: number;
    inputTokens: number;
    /** Includes thinking tokens, which bill as output. */
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** Estimated cost in millionths of a US dollar, from list prices. */
    costMicroUsd: number;
    createdAt: Date;
    updatedAt: Date;
}

const usageSchema = new mongoose.Schema<IClaudeUsage>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        day: { type: String, required: true },
        model: { type: String, required: true },
        feature: { type: String, enum: CLAUDE_FEATURES, required: true },
        requests: { type: Number, default: 0 },
        failures: { type: Number, default: 0 },
        rateLimited: { type: Number, default: 0 },
        refusals: { type: Number, default: 0 },
        inputTokens: { type: Number, default: 0 },
        outputTokens: { type: Number, default: 0 },
        cacheReadTokens: { type: Number, default: 0 },
        cacheWriteTokens: { type: Number, default: 0 },
        costMicroUsd: { type: Number, default: 0 },
    },
    { timestamps: true }
);

usageSchema.index({ userId: 1, day: 1, model: 1, feature: 1 }, { unique: true });

export const ClaudeUsage = mongoose.model<IClaudeUsage>('ClaudeUsage', usageSchema);

export interface ClaudeLimitMeter {
    limit: number | null;
    remaining: number | null;
    /** When the bucket is full again, as Anthropic reported it. */
    resetsAt: Date | null;
}

/**
 * The rate limits Anthropic sent on the latest response for one model. The
 * API reports them in `anthropic-ratelimit-*` headers on every reply.
 */
export interface IClaudeRateLimit extends Omit<mongoose.Document, 'model'> {
    userId: mongoose.Types.ObjectId;
    model: string;
    requests: ClaudeLimitMeter;
    inputTokens: ClaudeLimitMeter;
    outputTokens: ClaudeLimitMeter;
    observedAt: Date;
    /** The last time Anthropic refused a call for this model with a 429. */
    lastLimitedAt: Date | null;
    retryAfterSeconds: number | null;
    message: string;
    createdAt: Date;
    updatedAt: Date;
}

const meterSchema = new mongoose.Schema<ClaudeLimitMeter>(
    {
        limit: { type: Number, default: null },
        remaining: { type: Number, default: null },
        resetsAt: { type: Date, default: null },
    },
    { _id: false }
);

const rateLimitSchema = new mongoose.Schema<IClaudeRateLimit>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        model: { type: String, required: true },
        requests: { type: meterSchema, default: () => ({}) },
        inputTokens: { type: meterSchema, default: () => ({}) },
        outputTokens: { type: meterSchema, default: () => ({}) },
        observedAt: { type: Date, required: true },
        lastLimitedAt: { type: Date, default: null },
        retryAfterSeconds: { type: Number, default: null },
        message: { type: String, default: '' },
    },
    { timestamps: true }
);

rateLimitSchema.index({ userId: 1, model: 1 }, { unique: true });

export const ClaudeRateLimit = mongoose.model<IClaudeRateLimit>('ClaudeRateLimit', rateLimitSchema);
