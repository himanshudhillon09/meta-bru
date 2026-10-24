export interface BrandProfile {
    niche?: string;
    tone?: string;
    audience?: string;
    keywords?: string;
}

export interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive?: boolean;
    timezone?: string;
    brandProfile?: BrandProfile;
    mustChangePassword?: boolean;
}

export interface RevealedCredentials {
    meta: { appSecret: string } | null;
    cloudinary: { apiKey: string; apiSecret: string } | null;
    gemini: { apiKey: string } | null;
}

export interface CredentialStatus {
    storageError: string;
    meta: {
        configured: boolean;
        appId: string;
        appSecretConfigured: boolean;
        redirectUri: string;
        scopes: string[];
        connectionsCount: number;
        needsReauthCount: number;
    };
    cloudinary: {
        configured: boolean;
        cloudName: string;
        apiKeyConfigured: boolean;
        apiSecretConfigured: boolean;
    };
    gemini: {
        configured: boolean;
    };
}

export interface InstagramAccount {
    id: string;
    username: string;
    profilePictureUrl: string;
}

export type TokenStatus = 'active' | 'needs_reauth' | 'disconnected';

export interface SocialConnection {
    _id: string;
    pageId: string;
    pageName: string;
    tokenStatus: TokenStatus;
    instagram: InstagramAccount | null;
    dailyTime: string;
    timezone: string;
    publishToFacebook: boolean;
    publishToInstagram: boolean;
    isActive: boolean;
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastError: string;
    queuedCount?: number;
    createdAt: string;
    updatedAt: string;
}

export type Platform = 'facebook' | 'instagram';
export type PostStatus =
    | 'draft'
    | 'queued'
    | 'publishing'
    | 'published'
    | 'partial'
    | 'failed';
export type TargetStatus = 'pending' | 'publishing' | 'published' | 'failed';

export interface PostTarget {
    platform: Platform;
    status: TargetStatus;
    externalId: string;
    creationId: string;
    error: string;
    publishedAt: string | null;
}

export interface PostConnection {
    _id: string;
    pageName: string;
    pageId: string;
    instagram?: InstagramAccount | null;
    tokenStatus: TokenStatus;
}

export interface Post {
    _id: string;
    connectionId: string | PostConnection;
    caption: string;
    mediaUrl: string;
    mediaJpegUrl?: string;
    mediaPublicId: string;
    platforms: { facebook: boolean; instagram: boolean };
    status: PostStatus;
    targets: PostTarget[];
    attempts: number;
    lastError: string;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface MediaAsset {
    url: string;
    jpegUrl: string;
    publicId: string;
    width: number;
    height: number;
    format: string;
    bytes: number;
}

export type StorageDuplicateMatch = 'exact' | 'likely' | '';

export interface StoragePostUsage {
    id: string;
    status: PostStatus;
    caption: string;
    publishedAt: string | null;
    platforms: { facebook: boolean; instagram: boolean };
}

export interface StorageAsset {
    assetId: string;
    publicId: string;
    assetFolder: string;
    url: string;
    secureUrl: string;
    thumbnailUrl: string;
    format: string;
    width: number;
    height: number;
    bytes: number;
    createdAt: string;
    etag: string;
    duplicateGroup: string;
    duplicateCount: number;
    duplicateMatch: StorageDuplicateMatch;
    recommendedKeep: boolean;
    posts: StoragePostUsage[];
    canDelete: boolean;
    deleteBlockedReason: string;
}

export interface CloudinaryAccountUsage {
    plan: string;
    storageUsed: number;
    storageLimit: number;
    storagePercent: number;
    bandwidthUsed: number;
    bandwidthLimit: number;
    resources: number;
    lastUpdated: string;
    error: string;
}

export interface StorageSummary {
    account: CloudinaryAccountUsage;
    folder: {
        assetCount: number;
        bytes: number;
        truncated: boolean;
    };
    duplicates: {
        groups: number;
        extraAssets: number;
        extraBytes: number;
        exactGroups: number;
        likelyGroups: number;
    };
    unused: {
        assets: number;
        bytes: number;
    };
    protected: {
        assets: number;
        bytes: number;
    };
}

export interface StorageOverview {
    configured: boolean;
    assets: StorageAsset[];
    summary: StorageSummary;
}

export interface DeleteMediaResult {
    deleted: Array<{ assetId: string; publicId: string; bytes: number }>;
    blocked: Array<{
        assetId: string;
        publicId: string;
        reason: string;
    }>;
    skipped: Array<{ assetId: string; reason: string }>;
    freedBytes: number;
}

export interface AdminOverview {
    stats: {
        users: number;
        connections: number;
        queued: number;
        publishedThisWeek: number;
        needsReauth: number;
    };
    recentPosts: Post[];
}

export function connectionName(post: Post): string {
    if (typeof post.connectionId === 'string') return 'Connected page';
    return post.connectionId?.pageName || 'Connected page';
}

export function formatDate(value: string | null | undefined): string {
    if (!value) return 'Not scheduled';
    return new Date(value).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
    );
    const value = bytes / 1024 ** exponent;
    const formatted =
        exponent === 0 || value >= 10
            ? Math.round(value).toString()
            : value.toFixed(1);

    return `${formatted} ${units[exponent]}`;
}
