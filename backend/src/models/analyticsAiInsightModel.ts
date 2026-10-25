import mongoose from 'mongoose';

export type AnalyticsTipSeverity = 'info' | 'success' | 'warning';

export interface IAnalyticsTip {
    title: string;
    body: string;
    severity: AnalyticsTipSeverity;
    actionLabel: string;
    actionHref: string;
}

/**
 * `Document` declares a `model()` method, which collides with the cached
 * Gemini model name field. Omitting it keeps the field typed as `string`.
 *
 * Note: hydrated documents still type `model` as `Document['model'] & string`
 * because that intersection comes from the `HydratedDocument`/`Document`
 * declarations. At runtime `Document.prototype.model` is undefined, so calling
 * `doc.model()` throws. Callers must read `doc.model` as a string and never
 * call it.
 */
export interface IAnalyticsAiInsight extends Omit<mongoose.Document, 'model'> {
    userId: mongoose.Types.ObjectId;
    scopeKey: string;
    connectionId: mongoose.Types.ObjectId | null;
    rangeKey: string;
    dataHash: string;
    tips: IAnalyticsTip[];
    model: string;
    generatedAt: Date;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const tipSchema = new mongoose.Schema<IAnalyticsTip>(
    {
        title: { type: String, required: true },
        body: { type: String, required: true },
        severity: { type: String, enum: ['info', 'success', 'warning'], default: 'info' },
        actionLabel: { type: String, default: '' },
        actionHref: { type: String, default: '' },
    },
    { _id: false }
);

const insightSchema = new mongoose.Schema<IAnalyticsAiInsight>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        scopeKey: { type: String, required: true },
        connectionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'SocialConnection',
            default: null,
        },
        rangeKey: { type: String, required: true },
        dataHash: { type: String, required: true },
        tips: { type: [tipSchema], required: true, default: [] },
        model: { type: String, default: '' },
        generatedAt: { type: Date, required: true },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: true }
);

insightSchema.index({ userId: 1, scopeKey: 1, rangeKey: 1, generatedAt: -1 });
insightSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AnalyticsAiInsight = mongoose.model<IAnalyticsAiInsight>(
    'AnalyticsAiInsight',
    insightSchema
);
