import type { Request } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const GRAPH_BASE = `https://graph.facebook.com/${env.meta.graphVersion}`;

export interface MetaAppCredentials {
    appId: string;
    appSecret: string;
}

export interface MetaOAuthCredentials extends MetaAppCredentials {
    redirectUri: string;
}

export interface MetaPermissionStatus {
    granted: string[];
    declined: string[];
}

export interface MetaAuthenticatedUser {
    id: string;
    name?: string;
}

/**
 * The OAuth callback is deployment-level: every user's own Meta app must
 * whitelist the same backend URL. If META_REDIRECT_URI is not set, derive it
 * from the incoming request so local development works without extra config.
 */
export function resolveMetaRedirectUri(req: Request): string {
    if (env.meta.redirectUri) return env.meta.redirectUri;

    const host = req.get('host');
    if (!host) {
        throw new AppError(
            500,
            'Could not determine the Meta OAuth callback URL. Set META_REDIRECT_URI.',
            'META_REDIRECT_URI_MISSING'
        );
    }

    return `${req.protocol}://${host}/api/connections/meta/callback`;
}

export class MetaApiError extends Error {
    readonly status: number;
    readonly code: number;
    readonly subcode: number;
    readonly isTokenError: boolean;

    constructor(
        message: string,
        status: number,
        code = 0,
        subcode = 0,
        isTokenError = false
    ) {
        super(message);
        this.name = 'MetaApiError';
        this.status = status;
        this.code = code;
        this.subcode = subcode;
        this.isTokenError = isTokenError;
    }
}

interface MetaErrorPayload {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
}

export interface GraphRequestOptions {
    method?: 'GET' | 'POST';
    accessToken?: string;
    params?: Record<string, string | number | undefined>;
    timeoutMs?: number;
}

export interface MetaPageAccount {
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: {
        id: string;
        username?: string;
        profile_picture_url?: string;
    };
}

export async function graphRequest<T>(
    path: string,
    options: GraphRequestOptions = {}
): Promise<T> {
    const { method = 'GET', accessToken, params = {}, timeoutMs = 20_000 } = options;
    const url = new URL(`${GRAPH_BASE}/${path.replace(/^\/+/, '')}`);

    let body: string | undefined;
    let contentType: string | undefined;
    if (method === 'GET') {
        if (accessToken) url.searchParams.set('access_token', accessToken);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
    } else {
        // Graph API write endpoints expect form-encoded parameters (the same
        // shape the Graph API Explorer and official SDKs send).
        const form = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) form.set(key, String(value));
        }
        if (accessToken) form.set('access_token', accessToken);
        body = form.toString();
        contentType = 'application/x-www-form-urlencoded';
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method,
            ...(body ? { body } : {}),
            ...(contentType ? { headers: { 'Content-Type': contentType } } : {}),
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        throw new MetaApiError(
            error instanceof Error ? error.message : 'Could not reach Meta Graph API',
            0
        );
    }

    const raw = await response.text();
    let data: unknown = {};
    if (raw) {
        try {
            data = JSON.parse(raw);
        } catch {
            data = { error: { message: raw } };
        }
    }

    const errorPayload = (data as { error?: MetaErrorPayload })?.error;
    if (!response.ok || errorPayload) {
        const code = Number(errorPayload?.code || 0);
        const subcode = Number(errorPayload?.error_subcode || 0);
        const message =
            errorPayload?.error_user_msg ||
            errorPayload?.message ||
            `Meta request failed with status ${response.status}`;

        throw new MetaApiError(
            message,
            response.status,
            code,
            subcode,
            code === 190 || code === 102
        );
    }

    return data as T;
}

export function getOAuthUrl(
    credentials: MetaOAuthCredentials,
    state: string
): string {
    const params = new URLSearchParams({
        client_id: credentials.appId,
        redirect_uri: credentials.redirectUri,
        state,
        response_type: 'code',
        scope: env.meta.scopes.join(','),
        // Re-show the consent screen instead of silently reusing an earlier
        // grant that may have omitted Page/Instagram permissions.
        auth_type: 'rerequest',
    });

    return `https://www.facebook.com/${env.meta.graphVersion}/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForToken(
    code: string,
    credentials: MetaOAuthCredentials
): Promise<string> {
    const data = await graphRequest<{ access_token?: string }>('oauth/access_token', {
        params: {
            client_id: credentials.appId,
            client_secret: credentials.appSecret,
            redirect_uri: credentials.redirectUri,
            code,
        },
    });

    if (!data.access_token) {
        throw new MetaApiError('Meta did not return an access token', 502);
    }
    return data.access_token;
}

export async function exchangeForLongLivedToken(
    shortLivedToken: string,
    credentials: MetaAppCredentials
): Promise<string> {
    const data = await graphRequest<{ access_token?: string }>('oauth/access_token', {
        params: {
            grant_type: 'fb_exchange_token',
            client_id: credentials.appId,
            client_secret: credentials.appSecret,
            fb_exchange_token: shortLivedToken,
        },
    });

    if (!data.access_token) {
        throw new MetaApiError('Meta did not return a long-lived access token', 502);
    }
    return data.access_token;
}

export async function fetchPageAccounts(userToken: string): Promise<MetaPageAccount[]> {
    const data = await graphRequest<{ data?: MetaPageAccount[] }>('me/accounts', {
        accessToken: userToken,
        params: {
            fields:
                'id,name,access_token,instagram_business_account{id,username,profile_picture_url}',
            limit: 100,
        },
    });

    return data.data || [];
}

/**
 * Used only to explain an empty Page list. Meta can return `data: []` when the
 * user declined (or was never granted) `pages_show_list`, so the permission
 * status is much more actionable than the empty response alone.
 */
export async function fetchPermissionStatus(
    userToken: string
): Promise<MetaPermissionStatus> {
    const data = await graphRequest<{
        data?: Array<{ permission?: string; status?: string }>;
    }>('me/permissions', { accessToken: userToken });

    const granted: string[] = [];
    const declined: string[] = [];
    for (const entry of data.data || []) {
        if (!entry.permission) continue;
        if (entry.status === 'granted') granted.push(entry.permission);
        else if (entry.status === 'declined') declined.push(entry.permission);
    }

    return { granted, declined };
}

export async function fetchAuthenticatedUser(
    userToken: string
): Promise<MetaAuthenticatedUser | null> {
    try {
        const data = await graphRequest<{ id?: string; name?: string }>('me', {
            accessToken: userToken,
            params: { fields: 'id,name' },
        });
        if (!data.id) return null;
        return data.name ? { id: data.id, name: data.name } : { id: data.id };
    } catch {
        return null;
    }
}

export async function publishFacebookPhoto(params: {
    pageId: string;
    pageToken: string;
    imageUrl: string;
    caption: string;
}): Promise<{ id: string; post_id?: string }> {
    return graphRequest(`${params.pageId}/photos`, {
        method: 'POST',
        accessToken: params.pageToken,
        params: {
            url: params.imageUrl,
            caption: params.caption,
        },
    });
}

export async function getInstagramPublishingUsage(
    igUserId: string,
    accessToken: string
): Promise<{ quotaUsage: number; quotaTotal: number }> {
    const data = await graphRequest<{
        data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }>;
    }>(`${igUserId}/content_publishing_limit`, {
        accessToken,
        params: { fields: 'quota_usage,config' },
    });

    const entry = data.data?.[0];
    return {
        quotaUsage: Number(entry?.quota_usage || 0),
        quotaTotal: Number(entry?.config?.quota_total || 100),
    };
}

export async function createInstagramContainer(params: {
    igUserId: string;
    accessToken: string;
    imageUrl: string;
    caption: string;
}): Promise<string> {
    const data = await graphRequest<{ id?: string }>(`${params.igUserId}/media`, {
        method: 'POST',
        accessToken: params.accessToken,
        params: {
            image_url: params.imageUrl,
            caption: params.caption,
        },
    });

    if (!data.id) {
        throw new MetaApiError('Instagram did not return a media container ID', 502);
    }
    return data.id;
}

export async function publishInstagramContainer(params: {
    igUserId: string;
    accessToken: string;
    creationId: string;
}): Promise<string> {
    const data = await graphRequest<{ id?: string }>(
        `${params.igUserId}/media_publish`,
        {
            method: 'POST',
            accessToken: params.accessToken,
            params: { creation_id: params.creationId },
        }
    );

    if (!data.id) {
        throw new MetaApiError('Instagram did not return a published media ID', 502);
    }
    return data.id;
}

export async function getInstagramContainerStatus(
    containerId: string,
    accessToken: string
): Promise<string> {
    const data = await graphRequest<{ status_code?: string }>(containerId, {
        accessToken,
        params: { fields: 'status_code' },
    });
    return data.status_code || 'UNKNOWN';
}

export interface InstagramContainerState {
    /** IN_PROGRESS, FINISHED, PUBLISHED, ERROR, EXPIRED, or UNKNOWN. */
    statusCode: string;
    /** Meta's human-readable status, which explains an ERROR. */
    status: string;
}

export interface InstagramMediaApi {
    createContainer(
        igUserId: string,
        accessToken: string,
        params: Record<string, string | number>
    ): Promise<string>;
    containerState(
        containerId: string,
        accessToken: string
    ): Promise<InstagramContainerState>;
    publishContainer(
        igUserId: string,
        accessToken: string,
        creationId: string
    ): Promise<string>;
}

export async function createInstagramMediaContainer(
    igUserId: string,
    accessToken: string,
    params: Record<string, string | number>
): Promise<string> {
    const data = await graphRequest<{ id?: string }>(`${igUserId}/media`, {
        method: 'POST',
        accessToken,
        params,
    });

    if (!data.id) {
        throw new MetaApiError('Instagram did not return a media container ID', 502);
    }
    return data.id;
}

export async function getInstagramContainerState(
    containerId: string,
    accessToken: string
): Promise<InstagramContainerState> {
    const data = await graphRequest<{ status_code?: string; status?: string }>(
        containerId,
        { accessToken, params: { fields: 'status_code,status' } }
    );
    return {
        statusCode: data.status_code || 'UNKNOWN',
        status: data.status || '',
    };
}

export const instagramMediaApi: InstagramMediaApi = {
    createContainer: createInstagramMediaContainer,
    containerState: getInstagramContainerState,
    publishContainer: (igUserId, accessToken, creationId) =>
        publishInstagramContainer({ igUserId, accessToken, creationId }),
};

export type FacebookVideoEdge = 'video_reels' | 'video_stories';

export interface FacebookVideoStatus {
    videoStatus: string;
    uploading: string;
    processing: string;
    publishing: string;
    /** Why Meta rejected the video, or '' while it is fine. */
    error: string;
}

export interface FacebookVideoApi {
    start(
        pageId: string,
        pageToken: string,
        edge: FacebookVideoEdge
    ): Promise<{ videoId: string; uploadUrl: string }>;
    upload(uploadUrl: string, pageToken: string, fileUrl: string): Promise<void>;
    finish(
        pageId: string,
        pageToken: string,
        edge: FacebookVideoEdge,
        params: Record<string, string>
    ): Promise<{ postId: string }>;
    status(videoId: string, pageToken: string): Promise<FacebookVideoStatus>;
}

export interface FacebookPhotoStoryApi {
    uploadUnpublished(
        pageId: string,
        pageToken: string,
        imageUrl: string
    ): Promise<string>;
    publishStory(
        pageId: string,
        pageToken: string,
        photoId: string
    ): Promise<{ postId: string }>;
}

export async function startFacebookVideoUpload(
    pageId: string,
    pageToken: string,
    edge: FacebookVideoEdge
): Promise<{ videoId: string; uploadUrl: string }> {
    const data = await graphRequest<{ video_id?: string; upload_url?: string }>(
        `${pageId}/${edge}`,
        { method: 'POST', accessToken: pageToken, params: { upload_phase: 'start' } }
    );

    if (!data.video_id || !data.upload_url) {
        throw new MetaApiError('Facebook did not return a video upload session', 502);
    }
    return { videoId: data.video_id, uploadUrl: data.upload_url };
}

function isFacebookHost(url: string): boolean {
    try {
        const { protocol, hostname } = new URL(url);
        return (
            protocol === 'https:' &&
            (hostname === 'facebook.com' || hostname.endsWith('.facebook.com'))
        );
    } catch {
        return false;
    }
}

/**
 * Asks Meta to download a hosted video into an upload session. The Page token
 * is sent as a header, so it only ever goes to a Facebook host.
 */
export async function uploadFacebookVideoFromUrl(
    uploadUrl: string,
    pageToken: string,
    fileUrl: string
): Promise<void> {
    if (!isFacebookHost(uploadUrl)) {
        throw new MetaApiError('Meta returned an unexpected video upload address', 502);
    }

    let response: Response;
    try {
        response = await fetch(uploadUrl, {
            method: 'POST',
            headers: { Authorization: `OAuth ${pageToken}`, file_url: fileUrl },
            signal: AbortSignal.timeout(120_000),
        });
    } catch (error) {
        throw new MetaApiError(
            error instanceof Error ? error.message : 'Could not reach the Meta upload service',
            0
        );
    }

    const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        debug_info?: { message?: string };
    };
    if (!response.ok || data.success !== true) {
        throw new MetaApiError(
            data.debug_info?.message ||
                `Meta video upload failed with status ${response.status}`,
            response.status
        );
    }
}

export async function finishFacebookVideoUpload(
    pageId: string,
    pageToken: string,
    edge: FacebookVideoEdge,
    params: Record<string, string>
): Promise<{ postId: string }> {
    const data = await graphRequest<{ success?: boolean; post_id?: string }>(
        `${pageId}/${edge}`,
        {
            method: 'POST',
            accessToken: pageToken,
            params: { ...params, upload_phase: 'finish' },
        }
    );

    if (data.success === false) {
        throw new MetaApiError('Facebook did not accept the video', 502);
    }
    return { postId: data.post_id || '' };
}

interface RawVideoPhase {
    status?: string;
    errors?: Array<{ message?: string }>;
}

const FAILED_VIDEO_STATUSES: Record<string, string> = {
    error: 'Facebook could not process this video',
    upload_failed: 'Facebook video upload failed',
    expired: 'Facebook video upload expired',
};

export function parseFacebookVideoStatus(raw: unknown): FacebookVideoStatus {
    const status =
        (raw as {
            status?: {
                video_status?: string;
                uploading_phase?: RawVideoPhase;
                processing_phase?: RawVideoPhase;
                publishing_phase?: RawVideoPhase;
            };
        } | null)?.status ?? {};
    const phases = [
        status.uploading_phase,
        status.processing_phase,
        status.publishing_phase,
    ];
    const failedPhase = phases.find((phase) => phase?.status === 'error');
    const videoStatus = status.video_status ?? '';

    return {
        videoStatus,
        uploading: status.uploading_phase?.status ?? '',
        processing: status.processing_phase?.status ?? '',
        publishing: status.publishing_phase?.status ?? '',
        error: failedPhase
            ? failedPhase.errors?.[0]?.message || 'Facebook could not process this video'
            : FAILED_VIDEO_STATUSES[videoStatus] ?? '',
    };
}

export async function getFacebookVideoStatus(
    videoId: string,
    pageToken: string
): Promise<FacebookVideoStatus> {
    const data = await graphRequest<unknown>(videoId, {
        accessToken: pageToken,
        params: { fields: 'status' },
    });
    return parseFacebookVideoStatus(data);
}

export const facebookVideoApi: FacebookVideoApi = {
    start: startFacebookVideoUpload,
    upload: uploadFacebookVideoFromUrl,
    finish: finishFacebookVideoUpload,
    status: getFacebookVideoStatus,
};

/** Photo Stories need a fresh, unpublished photo; a feed photo cannot be reused. */
export async function uploadUnpublishedFacebookPhoto(
    pageId: string,
    pageToken: string,
    imageUrl: string
): Promise<string> {
    const data = await graphRequest<{ id?: string }>(`${pageId}/photos`, {
        method: 'POST',
        accessToken: pageToken,
        params: { url: imageUrl, published: 'false' },
    });

    if (!data.id) {
        throw new MetaApiError('Facebook did not return a photo ID', 502);
    }
    return data.id;
}

export async function publishFacebookPhotoStory(
    pageId: string,
    pageToken: string,
    photoId: string
): Promise<{ postId: string }> {
    const data = await graphRequest<{ success?: boolean; post_id?: string }>(
        `${pageId}/photo_stories`,
        { method: 'POST', accessToken: pageToken, params: { photo_id: photoId } }
    );

    if (data.success === false) {
        throw new MetaApiError('Facebook did not accept the Story', 502);
    }
    return { postId: data.post_id || '' };
}

export const facebookPhotoStoryApi: FacebookPhotoStoryApi = {
    uploadUnpublished: uploadUnpublishedFacebookPhoto,
    publishStory: publishFacebookPhotoStory,
};
