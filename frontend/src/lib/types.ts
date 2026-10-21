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
}

export interface InstagramAccount {
    id: string;
    username: string;
    profilePictureUrl: string;
}

export type TokenStatus = 'active' | 'needs_reauth';

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
}

export interface Post {
    _id: string;
    connectionId: string | PostConnection;
    caption: string;
    mediaUrl: string;
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
    publicId: string;
    width: number;
    height: number;
    format: string;
    bytes: number;
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
