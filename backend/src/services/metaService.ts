import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const GRAPH_BASE = `https://graph.facebook.com/${env.meta.graphVersion}`;

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

interface GraphRequestOptions {
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

async function graphRequest<T>(
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

export function getOAuthUrl(state: string): string {
    if (!env.meta.appId || !env.meta.redirectUri) {
        throw new AppError(503, 'Meta app is not configured', 'META_NOT_CONFIGURED');
    }

    const params = new URLSearchParams({
        client_id: env.meta.appId,
        redirect_uri: env.meta.redirectUri,
        state,
        response_type: 'code',
        scope: env.meta.scopes,
    });

    return `https://www.facebook.com/${env.meta.graphVersion}/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
    const data = await graphRequest<{ access_token?: string }>('oauth/access_token', {
        params: {
            client_id: env.meta.appId,
            client_secret: env.meta.appSecret,
            redirect_uri: env.meta.redirectUri,
            code,
        },
    });

    if (!data.access_token) {
        throw new MetaApiError('Meta did not return an access token', 502);
    }
    return data.access_token;
}

export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
    const data = await graphRequest<{ access_token?: string }>('oauth/access_token', {
        params: {
            grant_type: 'fb_exchange_token',
            client_id: env.meta.appId,
            client_secret: env.meta.appSecret,
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
