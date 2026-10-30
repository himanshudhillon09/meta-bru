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
    /** Gemini model per AI feature; empty means the deployment default. */
    aiModels?: AiModels;
    mustChangePassword?: boolean;
}

export interface AiModels {
    /** Captions and the text on images. */
    text: string;
    /** AI image generation. */
    image: string;
}

export interface GeminiModelOption {
    id: string;
    name: string;
}

export interface GeminiModelList {
    defaults: AiModels;
    text: GeminiModelOption[];
    image: GeminiModelOption[];
}

export interface BrandLogo {
    dataUrl: string;
    width: number;
    height: number;
    bytes: number;
    updatedAt: string;
}

export interface BrandFramePreview {
    label: string;
    dataUrl: string;
    width: number;
    height: number;
}

export interface BrandLogoDetails {
    logo: BrandLogo | null;
    previews: BrandFramePreview[];
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
    /** Sorted daily posting times (HH:mm) in `timezone`. */
    dailyTimes: string[];
    timezone: string;
    publishToFacebook: boolean;
    publishToInstagram: boolean;
    isActive: boolean;
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastError: string;
    queuedCount?: number;
    /** When the queued posts publish, one per slot, oldest first; empty when paused. */
    upcomingSlots?: string[];
    tokenUpdatedAt?: string | null;
    grantedScopes?: string[];
    /** The Page's brand voice for AI captions, image text, and analysis. */
    brandProfile?: BrandProfile;
    /** The Page frames its post images with its own logo. */
    hasBrandLogo?: boolean;
    /** Small data URL of the logo, for avatars. */
    logoThumb?: string;
    createdAt: string;
    updatedAt: string;
}

export interface MetaLoginResult {
    connected: number;
    added?: string[];
    reconnected?: string[];
    /** Connected Pages that Meta left out of this login. */
    notIncluded?: string[];
    /** Requested permissions that were not granted in this login. */
    notGranted?: string[];
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
export type MediaType = 'image' | 'reel';

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
    mediaType?: MediaType;
    /** Reel length in seconds. */
    mediaDuration?: number;
    /** Reel cover JPG; empty for images. */
    mediaCoverUrl?: string;
    /** The image already carries the bold text line from the Composer. */
    hasTextOverlay?: boolean;
    shareToStory?: boolean;
    /** Published with Meta's "AI info" label (Instagram). */
    aiGenerated?: boolean;
    storyTargets?: PostTarget[];
    platforms: { facebook: boolean; instagram: boolean };
    status: PostStatus;
    targets: PostTarget[];
    attempts: number;
    lastError: string;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

/** Where the photo sits in a post image; overlay text goes inside it. */
export interface TextArea {
    left: number;
    top: number;
    width: number;
    height: number;
    radius: number;
}

export interface MediaAsset {
    url: string;
    jpegUrl: string;
    publicId: string;
    width: number;
    height: number;
    format: string;
    bytes: number;
    textArea?: TextArea;
    /** The Page whose logo framed this image; empty when unframed. */
    brandConnectionId?: string;
}

export interface VideoMedia {
    publicId: string;
    /** Meta-ready MP4 derivative. */
    url: string;
    coverUrl: string;
    /** The uploaded file, used while the derivative is still processing. */
    originalUrl: string;
    width: number;
    height: number;
    duration: number;
    format: string;
    bytes: number;
}

export interface VideoUploadSignature {
    cloudName: string;
    apiKey: string;
    timestamp: number;
    signature: string;
    folder: string;
    eager: string;
    eagerAsync: string;
    allowedFormats: string;
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
    resourceType: 'image' | 'video';
    /** Video length in seconds; 0 for images. */
    duration: number;
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

export function isReel(post: Pick<Post, 'mediaType'>): boolean {
    return post.mediaType === 'reel';
}

/** The image to show for a post: a reel's mediaUrl is an MP4, so use its cover. */
export function postThumbnailUrl(
    post: Pick<Post, 'mediaType' | 'mediaUrl' | 'mediaCoverUrl'>
): string {
    return isReel(post) ? post.mediaCoverUrl || '' : post.mediaUrl;
}

type TargetState = Pick<PostTarget, 'platform' | 'status'>;
type StoryState = Pick<PostTarget, 'platform' | 'status' | 'error'>;

/** What sharing to Story needs from a post; analytics rows have the same shape. */
export interface StoryShareSubject {
    _id: string;
    mediaType?: MediaType;
    targets: TargetState[];
    storyTargets?: StoryState[];
}

export function publishedPlatforms(post: { targets: TargetState[] }): Platform[] {
    return post.targets
        .filter((target) => target.status === 'published')
        .map((target) => target.platform);
}

export function storyTarget<T extends StoryState>(
    post: { storyTargets?: T[] },
    platform: Platform
): T | undefined {
    return (post.storyTargets ?? []).find((target) => target.platform === platform);
}

/** Published platforms whose Story has not published yet. */
export function unsharedStoryPlatforms(post: {
    targets: TargetState[];
    storyTargets?: StoryState[];
}): Platform[] {
    return publishedPlatforms(post).filter(
        (platform) => storyTarget(post, platform)?.status !== 'published'
    );
}

export function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, '0')}`;
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
    /** Reels only: average and total watch time in milliseconds. */
    avgWatchTimeMs?: number | null;
    totalWatchTimeMs?: number | null;
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
    /** Distinct reels among `posts`. */
    reels?: number;
    avgWatchTimeMs?: number | null;
    /** How much of each reel people watched on average, 0-100. */
    watchedPercent?: number | null;
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
    platforms?: Platform[];
    /** Meta's own error message. */
    error?: string;
    missingScopes?: string[];
    /** False when Meta still refuses after a full reconnect. */
    reconnectRequired?: boolean;
}

export interface AnalyticsSyncState {
    lastSyncedAt: string | null;
    staleTargets: number;
    remainingTargets?: number;
    /** Posts to read again because their Page was reconnected. */
    reconnectPending?: number;
    nextSyncAt?: string;
    permissionErrors: AnalyticsPermissionError[];
}

export interface AnalyticsOverview {
    range: { from: string; to: string; preset: string; timezone: string };
    totals: AnalyticsSummary;
    byPlatform: { facebook: AnalyticsSummary; instagram: AnalyticsSummary };
    byContentType?: { image: AnalyticsSummary; reel: AnalyticsSummary };
    stories?: StorySummary;
    activity: AnalyticsActivityBucket[];
    bestTimes: AnalyticsBestTime[];
    sync: AnalyticsSyncState;
}

export interface StoryMetrics {
    reach: number | null;
    views: number | null;
    replies: number | null;
    shares: number | null;
    interactions: number | null;
    tapsForward: number | null;
    tapsBack: number | null;
    exits: number | null;
    swipesForward: number | null;
}

export interface StorySummary {
    stories: number;
    /** Stories still inside Meta's 24-hour window. */
    live: number;
    reach: number;
    views: number;
    replies: number;
    shares: number;
    interactions: number;
    tapsForward: number;
    tapsBack: number;
    exits: number;
    swipesForward: number;
    /** Exits as a share of views, 0-100. Lower is better. */
    exitRate: number | null;
}

export interface StoryRow {
    postId: string;
    caption: string;
    mediaUrl: string;
    mediaType: MediaType;
    platform: Platform;
    pageName: string;
    publishedAt: string;
    expiresAt: string;
    live: boolean;
    metrics: StoryMetrics | null;
    metricsAt: string | null;
    status: 'ok' | 'partial' | 'unavailable' | 'permission_error' | 'waiting';
    error: string;
}

export interface StoryAnalyticsResponse {
    summary: StorySummary;
    stories: StoryRow[];
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
        mediaType?: MediaType;
        mediaDuration?: number | null;
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
    /** When Meta reported these metrics; older than snapshotAt if kept. */
    metricsAt?: string | null;
    status: 'ok' | 'partial' | 'unavailable' | 'permission_error';
    error: string;
    reconnectRequired?: boolean;
}

export interface AnalyticsPost {
    postId: string;
    caption: string;
    mediaUrl: string;
    mediaType?: MediaType;
    /** Reel length in seconds. */
    mediaDuration?: number | null;
    /** Story shares of this post. */
    storyTargets?: Array<{ platform: Platform; status: TargetStatus; error: string }>;
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

export type AnalyticsTipCategory = 'timing' | 'format' | 'content' | 'consistency' | 'growth';

/** A ready-to-make post or reel that acts on a tip. */
export interface AnalyticsTipIdea {
    format: 'post' | 'reel';
    topic: string;
}

export interface AnalyticsRuleTip {
    id: string;
    title: string;
    body: string;
    severity: 'info' | 'success' | 'warning';
    category?: AnalyticsTipCategory;
    actionLabel: string;
    actionHref: string;
    idea?: AnalyticsTipIdea | null;
}

export interface AnalyticsAiTip {
    title: string;
    body: string;
    severity: 'info' | 'success' | 'warning';
    category?: AnalyticsTipCategory;
    actionLabel: string;
    actionHref: string;
    idea?: AnalyticsTipIdea | null;
}

/** Composer or Reels link with the idea's topic filled in. */
export function ideaHref(idea: AnalyticsTipIdea): string {
    return `${idea.format === 'reel' ? '/reels' : '/composer'}?topic=${encodeURIComponent(idea.topic)}`;
}

/** Milliseconds as a short duration, e.g. "4.2s" or "1m 05s". */
export function formatWatchTime(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) return `${Math.round(totalSeconds * 10) / 10}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const secondsLeft = Math.round(totalSeconds % 60);
    return `${minutes}m ${String(secondsLeft).padStart(2, '0')}s`;
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
    /** No AI analysis has run today for this view yet. */
    aiDueToday?: boolean;
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

/** "in 16h 5m" until a future time; "now" once it has passed. */
export function formatTimeUntil(value: string, now = Date.now()): string {
    const minutes = Math.ceil((new Date(value).getTime() - now) / 60_000);
    if (Number.isNaN(minutes)) return '';
    if (minutes <= 0) return 'now';
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `in ${days}d ${hours % 24}h`;
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

export type GeminiFeature = 'caption' | 'image text' | 'image' | 'analytics';

export interface GeminiTotals {
    requests: number;
    failures: number;
    rateLimited: number;
    inputTokens: number;
    outputTokens: number;
    images: number;
}

export interface GeminiModelUsage {
    model: string;
    features: GeminiFeature[];
    today: GeminiTotals;
    month: GeminiTotals;
    /** Daily request limit Google reported for this model, if it has. */
    dailyLimit: number | null;
    minuteLimit: number | null;
    freeTier: boolean;
    limitObservedAt: string | null;
}

export interface GeminiLimits {
    dailyRequests: number | null;
    monthlyRequests: number | null;
}

export interface GeminiUsageReport {
    configured: boolean;
    today: GeminiTotals;
    month: GeminiTotals;
    byModel: GeminiModelUsage[];
    byFeature: Array<{ feature: GeminiFeature; today: number; month: number }>;
    daily: Array<{ day: string; requests: number; tokens: number; images: number }>;
    limits: GeminiLimits;
    lastLimitHit: {
        model: string;
        period: 'day' | 'minute' | 'other';
        limit: number | null;
        freeTier: boolean;
        observedAt: string;
        message: string;
    } | null;
    /** When Google's daily quotas next reset (midnight Pacific time). */
    resetsAt: string;
    models: { text: string; image: string };
}

export interface CloudinaryMeter {
    used: number;
    limit: number;
    credits: number | null;
}

export interface CloudinaryPlanUsage {
    configured: boolean;
    plan: string;
    lastUpdated: string;
    credits: { used: number; limit: number; percent: number } | null;
    storage: CloudinaryMeter;
    bandwidth: CloudinaryMeter;
    transformations: CloudinaryMeter;
    resources: number;
    derivedResources: number;
    requests: number;
    error: string;
}

export interface UsageReport {
    gemini: GeminiUsageReport;
    cloudinary: CloudinaryPlanUsage;
}
