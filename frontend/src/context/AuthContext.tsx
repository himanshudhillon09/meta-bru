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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PRIVATE_PATHS = [
    '/dashboard',
    '/connections',
    '/composer',
    '/queue',
    '/activity',
    '/settings',
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

    // Protection logic
    useEffect(() => {
        if (!loading) {
            const isPublicPath = pathname === '/login' || pathname === '/register';

            if (user && isPublicPath) {
                router.push('/dashboard');
            } else if (!user && isPrivatePath(pathname)) {
                router.push('/login');
            }
        }
    }, [user, loading, pathname, router]);

    const login = (token: string, userData: User) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(userData));
        setUser(userData);
        router.push('/dashboard');
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
        <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
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
