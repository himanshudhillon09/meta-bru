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

export interface AnalyticsMetrics {
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    reach: number | null;
    views: number | null;
    clicks: number | null;
    interactions: number | null;
    engagementRate: number | null;
}

export interface AnalyticsSummary {
    posts: number;
    facebookPosts: number;
    instagramPosts: number;
    reach: number;
    views: number;
    interactions: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    clicks: number;
    engagementRate: number | null;
}

export interface AnalyticsActivityBucket {
    date: string;
    label: string;
    posts: number;
    facebook: number;
    instagram: number;
    reach: number;
    interactions: number;
}

export interface AnalyticsBestTime {
    day: number;
    dayLabel: string;
    block: number;
    label: string;
    posts: number;
    avgEngagementRate: number | null;
}

export interface AnalyticsPermissionError {
    connectionId: string;
    pageName: string;
    platform: Platform;
}

export interface AnalyticsSyncState {
    lastSyncedAt: string | null;
    staleTargets: number;
    remainingTargets?: number;
    nextSyncAt?: string;
    permissionErrors: AnalyticsPermissionError[];
}

export interface AnalyticsOverview {
    range: { from: string; to: string; preset: string; timezone: string };
    totals: AnalyticsSummary;
    byPlatform: { facebook: AnalyticsSummary; instagram: AnalyticsSummary };
    activity: AnalyticsActivityBucket[];
    bestTimes: AnalyticsBestTime[];
    sync: AnalyticsSyncState;
}

export interface AnalyticsMonitorPoint {
    capturedAt: string;
    reach: number;
    views: number;
    interactions: number;
    engagementRate: number | null;
}

export interface AnalyticsMonitor {
    scope: { connectionId: string | null; pageName: string };
    summary: AnalyticsSummary;
    series: {
        all: AnalyticsMonitorPoint[];
        facebook: AnalyticsMonitorPoint[];
        instagram: AnalyticsMonitorPoint[];
    };
    seriesTruncated: boolean;
    recentPosts: Array<{
        postId: string;
        caption: string;
        mediaUrl: string;
        pageName: string;
        platform: Platform;
        publishedAt: string;
        metrics: AnalyticsMetrics | null;
    }>;
    sync: AnalyticsSyncState;
}

export interface AnalyticsPostTarget {
    platform: Platform;
    externalId: string;
    publishedAt: string;
    metrics: AnalyticsMetrics | null;
    availableMetrics: string[];
    snapshotAt: string | null;
    status: 'ok' | 'partial' | 'unavailable' | 'permission_error';
    error: string;
}

export interface AnalyticsPost {
    postId: string;
    caption: string;
    mediaUrl: string;
    status: PostStatus;
    connection: {
        id: string;
        pageId: string;
        pageName: string;
        instagramUsername: string;
    };
    targets: AnalyticsPostTarget[];
}

export interface AnalyticsPostsResponse {
    posts: AnalyticsPost[];
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
}

export interface AnalyticsRuleTip {
    id: string;
    title: string;
    body: string;
    severity: 'info' | 'success' | 'warning';
    actionLabel: string;
    actionHref: string;
}

export interface AnalyticsAiTip {
    title: string;
    body: string;
    severity: 'info' | 'success' | 'warning';
    actionLabel: string;
    actionHref: string;
}

export interface AnalyticsAiInsight {
    cached: boolean;
    generatedAt: string;
    expiresAt: string;
    model: string;
    tips: AnalyticsAiTip[];
}

export interface AnalyticsTipsResponse {
    ruleBased: AnalyticsRuleTip[];
    ai: AnalyticsAiInsight | null;
}

export function formatIstDateTime(value: string | null | undefined): string {
    if (!value) return 'Not published';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not published';
    const formatted = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(date);
    return `${formatted} IST`;
}

export function formatElapsed(
    value: string | null | undefined,
    now = Date.now()
): string {
    if (!value || now <= 0) return '';
    const then = new Date(value).getTime();
    if (Number.isNaN(then)) return '';
    const seconds = Math.max(0, Math.floor((now - then) / 1000));
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ${hours % 24}h ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

export function latestPublishedAt(post: Post): string | null {
    const times = post.targets
        .filter((target) => target.status === 'published' && target.publishedAt)
        .map((target) => new Date(target.publishedAt as string).getTime())
        .filter((time) => Number.isFinite(time));
    if (times.length > 0) return new Date(Math.max(...times)).toISOString();
    return post.publishedAt;
}
