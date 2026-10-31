import mongoose from 'mongoose';

/** An audio file the user uploaded to their own Cloudinary music folder. */
export interface IMusicTrack extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    /** Cloudinary public id; Cloudinary stores audio as video resources. */
    publicId: string;
    title: string;
    artist: string;
    /** Length in seconds. */
    duration: number;
    bytes: number;
    createdAt: Date;
    updatedAt: Date;
}

const musicTrackSchema = new mongoose.Schema<IMusicTrack>(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        publicId: { type: String, required: true },
        title: { type: String, required: true, maxlength: 120 },
        artist: { type: String, default: '', maxlength: 120 },
        duration: { type: Number, default: 0, min: 0 },
        bytes: { type: Number, default: 0, min: 0 },
    },
    { timestamps: true }
);

musicTrackSchema.index({ userId: 1, publicId: 1 }, { unique: true });

export const MusicTrack = mongoose.model<IMusicTrack>('MusicTrack', musicTrackSchema);
