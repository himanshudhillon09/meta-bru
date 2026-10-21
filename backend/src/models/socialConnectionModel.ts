import mongoose from 'mongoose';

export interface IInstagramAccount {
    id: string;
    username: string;
    profilePictureUrl: string;
}

export type ConnectionTokenStatus = 'active' | 'needs_reauth';

export interface ISocialConnection extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    pageId: string;
    pageName: string;
    pageAccessTokenEnc: string;
    tokenStatus: ConnectionTokenStatus;
    instagram: IInstagramAccount | null;
    dailyTime: string;
    timezone: string;
    publishToFacebook: boolean;
    publishToInstagram: boolean;
    isActive: boolean;
    nextRunAt: Date | null;
    lastRunAt: Date | null;
    lastError: string;
    lockedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const instagramSchema = new mongoose.Schema<IInstagramAccount>(
    {
        id: { type: String, required: true },
        username: { type: String, default: '' },
        profilePictureUrl: { type: String, default: '' },
    },
    { _id: false }
);

const socialConnectionSchema = new mongoose.Schema<ISocialConnection>(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        pageId: { type: String, required: true },
        pageName: { type: String, required: true },
        pageAccessTokenEnc: { type: String, required: true, select: false },
        tokenStatus: {
            type: String,
            enum: ['active', 'needs_reauth'],
            default: 'active',
        },
        instagram: { type: instagramSchema, default: null },
        dailyTime: {
            type: String,
            default: '09:00',
            match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'dailyTime must be HH:mm'],
        },
        timezone: { type: String, default: 'Asia/Kolkata' },
        publishToFacebook: { type: Boolean, default: true },
        publishToInstagram: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        nextRunAt: { type: Date, default: null },
        lastRunAt: { type: Date, default: null },
        lastError: { type: String, default: '' },
        lockedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

socialConnectionSchema.index({ userId: 1, pageId: 1 }, { unique: true });
socialConnectionSchema.index({ isActive: 1, nextRunAt: 1 });

export const SocialConnection = mongoose.model<ISocialConnection>(
    'SocialConnection',
    socialConnectionSchema
);
