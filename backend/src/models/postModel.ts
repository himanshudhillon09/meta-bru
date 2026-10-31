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

/** A song from Instagram's music library, attached by id. */
export interface IInstagramSong {
    audioId: string;
    title: string;
    artist: string;
    coverUrl: string;
    durationMs: number;
}

/** One of the user's own tracks, copied from their music library. */
export interface IMusicTrackRef {
    trackId: mongoose.Types.ObjectId;
    publicId: string;
    title: string;
    artist: string;
    duration: number;
}

export interface IPostMusic {
    /** Plays on Instagram reels only. */
    instagram: IInstagramSong | null;
    /** Mixed into the video, so it plays everywhere. */
    track: IMusicTrackRef | null;
    /** Where the track starts, in seconds. */
    trackStart: number;
    /** 1-100. */
    musicVolume: number;
    /** The video's own sound, 0-100; 0 mutes it. */
    videoVolume: number;
    /** The reel with the track mixed in; '' without a track. */
    mixUrl: string;
    /** The Story video with the track mixed in; '' without a track. */
    storyMixUrl: string;
}

/** The image a photo reel was made from. */
export interface IPostPhoto {
    publicId: string;
    url: string;
    jpegUrl: string;
    hasTextOverlay: boolean;
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
    music: IPostMusic | null;
    /** Set on a photo reel: an image post published as a video with music. */
    photo: IPostPhoto | null;
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

const instagramSongSchema = new mongoose.Schema<IInstagramSong>(
    {
        audioId: { type: String, required: true },
        title: { type: String, default: '' },
        artist: { type: String, default: '' },
        coverUrl: { type: String, default: '' },
        durationMs: { type: Number, default: 0 },
    },
    { _id: false }
);

const musicTrackRefSchema = new mongoose.Schema<IMusicTrackRef>(
    {
        trackId: { type: mongoose.Schema.Types.ObjectId, ref: 'MusicTrack', required: true },
        publicId: { type: String, required: true },
        title: { type: String, default: '' },
        artist: { type: String, default: '' },
        duration: { type: Number, default: 0 },
    },
    { _id: false }
);

const musicSchema = new mongoose.Schema<IPostMusic>(
    {
        instagram: { type: instagramSongSchema, default: null },
        track: { type: musicTrackRefSchema, default: null },
        trackStart: { type: Number, default: 0, min: 0 },
        musicVolume: { type: Number, default: 80, min: 1, max: 100 },
        videoVolume: { type: Number, default: 30, min: 0, max: 100 },
        mixUrl: { type: String, default: '' },
        storyMixUrl: { type: String, default: '' },
    },
    { _id: false }
);

const photoSchema = new mongoose.Schema<IPostPhoto>(
    {
        publicId: { type: String, required: true },
        url: { type: String, required: true },
        jpegUrl: { type: String, default: '' },
        hasTextOverlay: { type: Boolean, default: false },
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
        music: { type: musicSchema, default: null },
        photo: { type: photoSchema, default: null },
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
postSchema.index({ userId: 1, 'photo.publicId': 1 });
postSchema.index({ userId: 1, 'music.track.trackId': 1 });

export const Post = mongoose.model<IPost>('Post', postSchema);
