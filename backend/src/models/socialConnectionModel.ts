import mongoose from 'mongoose';
import {
    DAILY_TIME_PATTERN,
    DEFAULT_DAILY_TIME,
    MAX_DAILY_SLOTS,
} from '../services/scheduleService.js';

export interface IInstagramAccount {
    id: string;
    username: string;
    profilePictureUrl: string;
}

export type ConnectionTokenStatus = 'active' | 'needs_reauth' | 'disconnected';

/** The Page's brand voice, used by every AI feature for its posts. */
export interface IPageBrandProfile {
    niche: string;
    tone: string;
    audience: string;
    keywords: string;
}

/**
 * The Page's logo for the post frame, stored on the Page rather than in
 * Cloudinary so the storage manager never lists it. The bytes are only
 * selected when needed; `thumb` is a small data URL for avatars.
 */
export interface IPageBrandLogo {
    data?: Buffer;
    width: number;
    height: number;
    bytes: number;
    updatedAt: Date | null;
    thumb: string;
}

export interface ISocialConnection extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    pageId: string;
    pageName: string;
    pageAccessTokenEnc: string;
    tokenStatus: ConnectionTokenStatus;
    instagram: IInstagramAccount | null;
    /** Sorted daily posting times (HH:mm) in `timezone`. */
    dailyTimes: string[];
    timezone: string;
    publishToFacebook: boolean;
    publishToInstagram: boolean;
    isActive: boolean;
    nextRunAt: Date | null;
    lastRunAt: Date | null;
    lastError: string;
    lockedAt: Date | null;
    /** When a Meta login last stored this Page's token. */
    tokenUpdatedAt: Date | null;
    /** App permissions Meta reported as granted at that login. Empty when unknown. */
    grantedScopes: string[];
    brandProfile: IPageBrandProfile;
    brandLogo: IPageBrandLogo | null;
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
        pageAccessTokenEnc: { type: String, default: '', select: false },
        tokenStatus: {
            type: String,
            enum: ['active', 'needs_reauth', 'disconnected'],
            default: 'active',
        },
        instagram: { type: instagramSchema, default: null },
        dailyTimes: {
            type: [
                {
                    type: String,
                    match: [DAILY_TIME_PATTERN, 'Posting times must be HH:mm'],
                },
            ],
            default: () => [DEFAULT_DAILY_TIME],
            validate: {
                validator: (times: string[]) =>
                    times.length >= 1 && times.length <= MAX_DAILY_SLOTS,
                message: `A Page needs 1 to ${MAX_DAILY_SLOTS} posting times`,
            },
        },
        timezone: { type: String, default: 'Asia/Kolkata' },
        publishToFacebook: { type: Boolean, default: true },
        publishToInstagram: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        nextRunAt: { type: Date, default: null },
        lastRunAt: { type: Date, default: null },
        lastError: { type: String, default: '' },
        lockedAt: { type: Date, default: null },
        tokenUpdatedAt: { type: Date, default: null },
        grantedScopes: { type: [String], default: [] },
        brandProfile: {
            niche: { type: String, default: '' },
            tone: { type: String, default: '' },
            audience: { type: String, default: '' },
            keywords: { type: String, default: '' },
        },
        brandLogo: {
            data: { type: Buffer, select: false },
            width: { type: Number, default: 0 },
            height: { type: Number, default: 0 },
            bytes: { type: Number, default: 0 },
            updatedAt: { type: Date, default: null },
            thumb: { type: String, default: '' },
        },
    },
    { timestamps: true }
);

socialConnectionSchema.index({ userId: 1, pageId: 1 }, { unique: true });
socialConnectionSchema.index({ isActive: 1, nextRunAt: 1 });

export const SocialConnection = mongoose.model<ISocialConnection>(
    'SocialConnection',
    socialConnectionSchema
);
