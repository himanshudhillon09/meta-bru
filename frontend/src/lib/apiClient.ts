import type {
    BrandLogoDetails,
    DeleteMediaResult,
    StorageOverview,
} from './types';

const BASE_URL = (
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api'
).replace(/\/+$/, '');

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
            if (
                response.status === 401 &&
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
    getBrandLogo: () =>
        api.get<{ success: boolean } & BrandLogoDetails>('/auth/brand-logo'),
    uploadBrandLogo: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return uploadRequest<{ success: boolean } & BrandLogoDetails>(
            '/auth/brand-logo',
            formData
        );
    },
    removeBrandLogo: () =>
        api.delete<{ success: boolean } & BrandLogoDetails>('/auth/brand-logo'),
};

export const connectionsApi = {
    list: () => api.get('/connections'),
    start: (timezone?: string) =>
        api.get(`/connections/meta/start${timezone ? `?timezone=${encodeURIComponent(timezone)}` : ''}`),
    complete: (data: { code: string; state: string }) =>
        api.post('/connections/meta/complete', data),
    update: (connectionId: string, data: any) =>
        api.patch(`/connections/${connectionId}`, data),
    disconnect: (connectionId: string) =>
        api.delete(`/connections/${connectionId}`),
};

export const postsApi = {
    list: (params?: Record<string, string>) => api.get('/posts', params),
    create: (data: any) => api.post('/posts', data),
    update: (postId: string, data: any) => api.patch(`/posts/${postId}`, data),
    remove: (postId: string) => api.delete(`/posts/${postId}`),
    publishNow: (postId: string) => api.post(`/posts/${postId}/publish-now`),
    retry: (postId: string) => api.post(`/posts/${postId}/retry`),
};

export const mediaApi = {
    upload: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return uploadRequest('/media/upload', formData);
    },
    storage: () =>
        api.get<{ success: boolean } & StorageOverview>('/media/storage'),
    deleteAssets: (assetIds: string[]) =>
        api.post<{ success: boolean } & DeleteMediaResult>('/media/delete', {
            assetIds,
        }),
};

export const aiApi = {
    caption: (data: { topic?: string; platform?: string; mediaPublicId?: string }) =>
        api.post('/ai/caption', data),
    image: (data: { prompt: string }) => api.post('/ai/image', data),
};

export const adminApi = {
    overview: () => api.get('/admin/overview'),
    connections: () => api.get('/admin/connections'),
    posts: () => api.get('/admin/posts'),
};

export default api;
