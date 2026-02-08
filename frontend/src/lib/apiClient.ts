const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';

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
    if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        if (token) {
            headers.Authorization = `Bearer ${token}`;
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
            // Error extraction
            const errorMessage = data?.message || data || response.statusText;
            throw new Error(errorMessage);
        }

        return data as T;
    } catch (error: any) {
        // Normalize error for UI consumption
        const message = error.message || 'An unexpected network error occurred';
        console.error(`API Request Error [${method} ${endpoint}]:`, message);
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
 * Domain-specific API wrappers (e.g., Auth)
 */
export const authApi = {
    login: (credentials: any) => api.post('/auth/login', credentials),
    register: (userData: any) => api.post('/auth/register', userData),
    getMe: () => api.get('/auth/me'),
    logout: () => api.get('/auth/logout'),
    getUsers: () => api.get('/auth/users'),
    toggleUserStatus: (userId: string, isActive?: boolean) => api.patch(`/auth/users/${userId}/status`, { isActive }),
};

export default api;
