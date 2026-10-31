import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please add a name']
    },
    email: {
        type: String,
        required: [true, 'Please add an email'],
        unique: true,
        trim: true,
        lowercase: true,
        match: [
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            'Please add a valid email'
        ]
    },
    password: {
        type: String,
        required: [true, 'Please add a password'],
        minlength: 6,
        select: false
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    isActive: {
        type: Boolean,
        default: false
    },
    tokenVersion: {
        type: Number,
        default: 0
    },
    mustChangePassword: {
        type: Boolean,
        default: false
    },
    timezone: {
        type: String,
        default: process.env.APP_DEFAULT_TIMEZONE || 'Asia/Kolkata'
    },
    brandProfile: {
        niche: { type: String, default: '' },
        tone: { type: String, default: 'friendly and engaging' },
        audience: { type: String, default: '' },
        keywords: { type: String, default: '' }
    },
    /**
     * Which AI writes captions, image text, image art direction, and Analytics
     * tips. Images are always drawn by Gemini; Claude cannot make images.
     */
    aiProvider: {
        type: String,
        enum: ['gemini', 'claude'],
        default: 'gemini'
    },
    /** Model per AI feature; empty means the deployment default. */
    aiModels: {
        text: { type: String, default: '' },
        image: { type: String, default: '' },
        /** The Claude model used when aiProvider is claude. */
        claude: { type: String, default: '' }
    },
    /** The user's own Gemini request limits, for "left today/this month" on Usage. */
    geminiLimits: {
        dailyRequests: { type: Number, default: null, min: 0 },
        monthlyRequests: { type: Number, default: null, min: 0 }
    },
    /** The monthly spend limit the user set in the Claude Console, for Usage. */
    claudeLimits: {
        monthlyBudgetUsd: { type: Number, default: null, min: 0 }
    },
    /**
     * Legacy account-wide branding. Logos and brand profiles now live on each
     * Page; moveLegacyBranding copies these to the first Page once, then sets
     * brandMovedAt and removes the logo here.
     */
    brandMovedAt: { type: Date, default: null },
    brandLogo: {
        data: { type: Buffer, select: false },
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
        bytes: { type: Number, default: 0 },
        updatedAt: { type: Date, default: null }
    },
    /**
     * AES-256-GCM encrypted JSON blob containing the user's own Meta app
     * credentials, Cloudinary credentials, and Gemini and Anthropic API keys. Never select
     * this field unless the credential service explicitly needs it.
     */
    credentialsEnc: {
        type: String,
        default: '',
        select: false
    }
}, {
    timestamps: true
});

// Encrypt password using bcrypt
userSchema.pre('save', async function () {
    if (!this.isModified('password')) {
        return;
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword: string) {
    return await bcrypt.compare(enteredPassword, this.password);
};

export const User = mongoose.model('User', userSchema);
