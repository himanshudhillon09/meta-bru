import type {
    AiModels,
    AnalyticsMonitor,
    AnalyticsOverview,
    AnalyticsPostsResponse,
    AnalyticsTipsResponse,
    BrandLogoDetails,
    DeleteMediaResult,
    GeminiLimits,
    GeminiModelList,
    MediaAsset,
    MetaLoginResult,
    Platform,
    Post,
    StorageOverview,
    StoryAnalyticsResponse,
    TextArea,
    UsageReport,
    VideoMedia,
    VideoUploadSignature,
} from './types';

const BASE_URL = (
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api'
).replace(/\/+$/, '');

/** The backend health check, which uptime monitors should ping to keep it awake. */
export const HEALTH_URL = `${BASE_URL}/health`;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
    method?: HttpMethod;
    headers?: Record<string, string>;
    body?: any;
    params?: Record<string, string>;
}

/**
 * A general-purpose API request handler that can be easily swapped 
 * with Axios or another library in the future.
 */
async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', headers: customHeaders = {}, body, params } = options;

    // Construct URL with query params
    let url = `${BASE_URL}${endpoint}`;
    if (params) {
        const queryString = new URLSearchParams(params).toString();
        url += `?${queryString}`;
    }

    // Default headers
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...customHeaders,
    };

    // Add Auth token
    let authToken: string | null = null;
    if (typeof window !== 'undefined') {
        authToken = localStorage.getItem('token');
        if (authToken) {
            headers.Authorization = `Bearer ${authToken}`;
        }
    }

    const config: RequestInit = {
        method,
        headers,
    };

    if (body) {
        config.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, config);

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        if (!response.ok) {
            // Only a rejected token (401) or a deactivated account ends the
            // session. Server errors, timeouts, and restarts must not sign the
            // user out.
            const sessionEnded =
                response.status === 401 ||
                (response.status === 403 && data?.code === 'ACCOUNT_INACTIVE');
            if (
                sessionEnded &&
                typeof window !== 'undefined' &&
                authToken &&
                localStorage.getItem('token') === authToken
            ) {
                // The token was invalidated by a password change or reset.
                // Let AuthContext clear the stale session and route to login.
                window.dispatchEvent(new Event('meta-bru:unauthorized'));
            }

            // Error extraction
            const errorMessage = data?.message || data || response.statusText;
            throw new Error(errorMessage);
        }

        return data as T;
    } catch (error: any) {
        // Normalize error for UI consumption. Expected HTTP errors are rendered
        // by the page; only log actual network failures (a TypeError from fetch).
        const message = error.message || 'An unexpected network error occurred';
        if (error instanceof TypeError) {
            console.error(`Network error [${method} ${endpoint}]:`, message);
        }
        throw message;
    }
}

async function uploadRequest<T>(endpoint: string, formData: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        if (token) headers.Authorization = `Bearer ${token}`;
    }

    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'POST',
            headers,
            body: formData,
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.message || 'Upload failed');
        }
        return data as T;
    } catch (error: any) {
        const message = error.message || 'Upload failed';
        if (error instanceof TypeError) {
            console.error(`Network error [POST ${endpoint}]:`, message);
        }
        throw message;
    }
}

export interface VideoUploadHandle {
    promise: Promise<{ publicId: string }>;
    abort: () => void;
}

/**
 * Sends a reel straight from the browser to the user's own Cloudinary
 * account, using the signature from /media/video-signature, and reports
 * progress from 0 to 1. Rejects with a readable message string, like the
 * other API helpers.
 */
export function uploadVideoToCloudinary(
    file: File,
    upload: VideoUploadSignature,
    onProgress: (fraction: number) => void
): VideoUploadHandle {
    const xhr = new XMLHttpRequest();

    const promise = new Promise<{ publicId: string }>((resolve, reject) => {
        const form = new FormData();
        form.append('file', file);
        form.append('api_key', upload.apiKey);
        form.append('timestamp', String(upload.timestamp));
        form.append('signature', upload.signature);
        form.append('folder', upload.folder);
        form.append('eager', upload.eager);
        form.append('eager_async', upload.eagerAsync);
        form.append('allowed_formats', upload.allowedFormats);

        xhr.open(
            'POST',
            `https://api.cloudinary.com/v1_1/${encodeURIComponent(upload.cloudName)}/video/upload`
        );
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
        xhr.onload = () => {
            let data: { public_id?: unknown; error?: { message?: string } } | null = null;
            try {
                data = JSON.parse(xhr.responseText);
            } catch {
                data = null;
            }

            if (xhr.status >= 200 && xhr.status < 300 && typeof data?.public_id === 'string') {
                resolve({ publicId: data.public_id });
                return;
            }
            reject(data?.error?.message || `Cloudinary upload failed (${xhr.status})`);
        };
        xhr.onerror = () =>
            reject('Could not reach Cloudinary. Check your connection and try again.');
        xhr.onabort = () => reject('Upload cancelled.');
        xhr.send(form);
    });

    return { promise, abort: () => xhr.abort() };
}

/**
 * Generic API client methods
 */
export const api = {
    get: <T>(endpoint: string, params?: Record<string, string>, headers?: Record<string, string>) =>
        apiRequest<T>(endpoint, { method: 'GET', params, headers }),

    post: <T>(endpoint: string, body?: any, headers?: Record<string, string>) =>
        apiRequest<T>(endpoint, { method: 'POST', body, headers }),

    put: <T>(endpoint: string, body?: any, headers?: Record<string, string>) =>
        apiRequest<T>(endpoint, { method: 'PUT', body, headers }),

    patch: <T>(endpoint: string, body?: any, headers?: Record<string, string>) =>
        apiRequest<T>(endpoint, { method: 'PATCH', body, headers }),

    delete: <T>(endpoint: string, headers?: Record<string, string>) =>
        apiRequest<T>(endpoint, { method: 'DELETE', headers }),
};

/**
 * Domain-specific API wrappers
 */
export const authApi = {
    login: (credentials: any) => api.post('/auth/login', credentials),
    register: (userData: any) => api.post('/auth/register', userData),
    getMe: () => api.get('/auth/me'),
    logout: () => api.get('/auth/logout'),
    getUsers: () => api.get('/auth/users'),
    toggleUserStatus: (userId: string, isActive?: boolean) =>
        api.patch(`/auth/users/${userId}/status`, { isActive }),
    updateProfile: (data: {
        name?: string;
        email?: string;
        currentPassword?: string;
        timezone?: string;
        brandProfile?: {
            niche?: string;
            tone?: string;
            audience?: string;
            keywords?: string;
        };
        aiModels?: Partial<AiModels>;
    }) => api.patch('/auth/profile', data),
    changePassword: (data: {
        currentPassword: string;
        newPassword: string;
    }) => api.patch('/auth/password', data),
    resetUserPassword: (userId: string) =>
        api.patch(`/auth/users/${userId}/password`),
    revealCredentials: (currentPassword: string) =>
        api.post('/auth/credentials/reveal', { currentPassword }),
    getCredentials: () => api.get('/auth/credentials'),
    saveMetaCredentials: (data: { appId: string; appSecret?: string }) =>
        api.put('/auth/credentials/meta', data),
    removeMetaCredentials: () => api.delete('/auth/credentials/meta'),
    saveCloudinaryCredentials: (data: {
        cloudName: string;
        apiKey?: string;
        apiSecret?: string;
    }) => api.put('/auth/credentials/cloudinary', data),
    removeCloudinaryCredentials: () => api.delete('/auth/credentials/cloudinary'),
    saveGeminiCredentials: (data: { apiKey: string }) =>
        api.put('/auth/credentials/gemini', data),
    removeGeminiCredentials: () => api.delete('/auth/credentials/gemini'),
};

export interface SchedulerStatus {
    enabled: boolean;
    startedAt: string | null;
    lastTickAt: string | null;
    intervalSeconds: number;
}

export const systemApi = {
    health: () => api.get<{ status: string; scheduler?: SchedulerStatus }>('/health'),
};

export const connectionsApi = {
    list: () => api.get('/connections'),
    start: () => api.get('/connections/meta/start'),
    complete: (data: { code: string; state: string }) =>
        api.post<{ success: boolean } & MetaLoginResult>(
            '/connections/meta/complete',
            data
        ),
    update: (connectionId: string, data: any) =>
        api.patch(`/connections/${connectionId}`, data),
    /** Each Page's logo for the post frame. */
    getBrandLogo: (connectionId: string) =>
        api.get<{ success: boolean } & BrandLogoDetails>(`/connections/${connectionId}/brand-logo`),
    uploadBrandLogo: (connectionId: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return uploadRequest<{ success: boolean; thumb: string } & BrandLogoDetails>(
            `/connections/${connectionId}/brand-logo`,
            formData
        );
    },
    removeBrandLogo: (connectionId: string) =>
        api.delete<{ success: boolean } & BrandLogoDetails>(`/connections/${connectionId}/brand-logo`),
    disconnect: (connectionId: string) =>
        api.delete(`/connections/${connectionId}`),
};

export const postsApi = {
    list: (params?: Record<string, string>) => api.get('/posts', params),
    get: (postId: string) => api.get<{ success: boolean; post: Post }>(`/posts/${postId}`),
    create: (data: any) => api.post('/posts', data),
    update: (postId: string, data: any) => api.patch(`/posts/${postId}`, data),
    remove: (postId: string) =>
        api.delete<{
            success: boolean;
            message: string;
            mediaDeleted?: boolean;
            mediaError?: string;
        }>(`/posts/${postId}`),
    /** Deletes every post the Activity filter shows, with its history. */
    clearActivity: (filter: 'all' | 'published' | 'failed', connectionId = '') =>
        api.post<{
            success: boolean;
            deleted: number;
            mediaDeleted: number;
            mediaErrors: number;
        }>('/posts/activity/clear', { filter, ...(connectionId ? { connectionId } : {}) }),
    shareStory: (postId: string, platforms: Platform[]) =>
        api.post<{ success: boolean; post: Post }>(`/posts/${postId}/story`, {
            platforms,
        }),
    publishNow: (postId: string) => api.post(`/posts/${postId}/publish-now`),
    retry: (postId: string) => api.post(`/posts/${postId}/retry`),
};

export const mediaApi = {
    /** `connectionId` is the Page whose logo frames the image. */
    upload: (file: Blob, connectionId = '', fileName = 'image.jpg') => {
        const formData = new FormData();
        formData.append('file', file, file instanceof File ? file.name : fileName);
        if (connectionId) formData.append('connectionId', connectionId);
        return uploadRequest<{ success: boolean; media: MediaAsset }>('/media/upload', formData);
    },
    /** Deletes a replaced Composer image unless a post uses it. */
    discard: (publicId: string) =>
        api.post<{ success: boolean; deleted: boolean }>('/media/discard', { publicId }),
    storage: () =>
        api.get<{ success: boolean } & StorageOverview>('/media/storage'),
    deleteAssets: (assetIds: string[]) =>
        api.post<{ success: boolean } & DeleteMediaResult>('/media/delete', {
            assetIds,
        }),
    videoSignature: () =>
        api.post<{ success: boolean; upload: VideoUploadSignature }>(
            '/media/video-signature'
        ),
    registerVideo: (publicId: string) =>
        api.post<{ success: boolean; media: VideoMedia }>('/media/videos', {
            publicId,
        }),
    textPreview: (publicId: string, text: string, textArea?: TextArea, connectionId = '') =>
        api.post<{ success: boolean; dataUrl: string }>('/media/text-preview', {
            publicId,
            text,
            ...(textArea ? { textArea } : {}),
            ...(connectionId ? { connectionId } : {}),
        }),
};

export const aiApi = {
    caption: (data: { topic?: string; platform?: string; mediaPublicId?: string; connectionId?: string }) =>
        api.post('/ai/caption', data),
    /** `source` is the unframed image as a data URL, for re-cropping. */
    image: (data: { prompt: string; connectionId?: string }) =>
        api.post<{ success: boolean; media: MediaAsset; source: string }>('/ai/image', data),
    models: () =>
        api.get<{ success: boolean } & GeminiModelList>('/ai/models'),
    overlayText: (data: { topic?: string; caption?: string; prompt?: string; connectionId?: string }) =>
        api.post<{ success: boolean; text: string }>('/ai/overlay-text', data),
};

export const usageApi = {
    get: () => api.get<{ success: boolean } & UsageReport>('/usage'),
    saveGeminiLimits: (limits: GeminiLimits) =>
        api.put<{ success: boolean; limits: GeminiLimits }>('/usage/gemini-limits', limits),
};

export const adminApi = {
    overview: () => api.get('/admin/overview'),
    connections: () => api.get('/admin/connections'),
    posts: () => api.get('/admin/posts'),
};

export const analyticsApi = {
    overview: (params: Record<string, string>) =>
        api.get<{ success: boolean } & AnalyticsOverview>(
            '/analytics/overview',
            params
        ),
    monitor: (params: Record<string, string>) =>
        api.get<{ success: boolean } & AnalyticsMonitor>(
            '/analytics/monitor',
            params
        ),
    stories: (params: Record<string, string>) =>
        api.get<{ success: boolean } & StoryAnalyticsResponse>('/analytics/stories', params),
    posts: (params: Record<string, string>) =>
        api.get<{ success: boolean } & AnalyticsPostsResponse>(
            '/analytics/posts',
            params
        ),
    sync: (data: {
        from: string;
        to: string;
        mode: 'stale' | 'live';
        connectionId?: string;
        platform?: string;
    }) => api.post('/analytics/sync', data),
    tips: (params: Record<string, string>) =>
        api.get<{ success: boolean } & AnalyticsTipsResponse>(
            '/analytics/tips',
            params
        ),
    generateTips: (data: {
        from: string;
        to: string;
        connectionId?: string;
        platform?: string;
        mediaType?: string;
        /** False for the daily automatic run, which reuses today's analysis. */
        force?: boolean;
    }) => api.post('/analytics/tips', data),
};

export default api;
