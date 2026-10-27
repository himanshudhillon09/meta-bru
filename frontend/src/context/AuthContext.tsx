'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { authApi } from '@/lib/apiClient';
import type { User } from '@/lib/types';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (token: string, userData: User) => void;
    logout: () => Promise<void>;
    updateUser: (userData: User) => void;
    updateSession: (token: string, userData: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PRIVATE_PATHS = [
    '/dashboard',
    '/connections',
    '/composer',
    '/queue',
    '/analytics',
    '/activity',
    '/storage',
    '/settings',
    '/change-password',
];

function isPrivatePath(pathname: string): boolean {
    return PRIVATE_PATHS.some(
        (path) => pathname === path || pathname.startsWith(`${path}/`)
    );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        const initAuth = async () => {
            const token = localStorage.getItem('token');
            const storedUser = localStorage.getItem('user');

            if (token && storedUser) {
                try {
                    // Pre-load from localStorage for instant UI feedback
                    setUser(JSON.parse(storedUser));

                    // Verify token with backend to ensure it's still valid and user is active
                    const data: any = await authApi.getMe();
                    if (data.success) {
                        setUser(data.user);
                        localStorage.setItem('user', JSON.stringify(data.user));
                    } else {
                        throw new Error('User verification failed');
                    }
                } catch (error) {
                    console.warn('Session verification failed:', error);
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    setUser(null);
                }
            }
            setLoading(false);
        };

        initAuth();
    }, []);

    // A password change on another device, or an admin reset, invalidates the
    // token used by this tab. Clear the stale session as soon as an API call
    // reports it instead of leaving the user on a broken screen.
    useEffect(() => {
        const handleUnauthorized = () => {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setUser(null);
            router.replace('/login');
        };

        window.addEventListener('meta-bru:unauthorized', handleUnauthorized);
        return () => {
            window.removeEventListener(
                'meta-bru:unauthorized',
                handleUnauthorized
            );
        };
    }, [router]);

    // Protection logic
    useEffect(() => {
        if (loading) return;

        const isPublicPath = pathname === '/login' || pathname === '/register';

        if (user && isPublicPath) {
            router.replace(
                user.mustChangePassword ? '/change-password' : '/dashboard'
            );
            return;
        }

        if (!user && isPrivatePath(pathname)) {
            router.replace('/login');
            return;
        }

        if (user?.mustChangePassword && pathname !== '/change-password') {
            router.replace('/change-password');
            return;
        }

        if (user && !user.mustChangePassword && pathname === '/change-password') {
            router.replace('/dashboard');
        }
    }, [user, loading, pathname, router]);

    const updateSession = (token: string, userData: User) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(userData));
        setUser(userData);
    };

    const login = (token: string, userData: User) => {
        updateSession(token, userData);
        router.push(
            userData.mustChangePassword ? '/change-password' : '/dashboard'
        );
    };

    const logout = async () => {
        try {
            await authApi.logout();
        } catch (error) {
            console.warn('Logout API call failed', error);
        } finally {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setUser(null);
            router.push('/login');
        }
    };

    const updateUser = (userData: User) => {
        setUser(userData);
        localStorage.setItem('user', JSON.stringify(userData));
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                login,
                logout,
                updateUser,
                updateSession,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
