'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { AdminDashboard, UserDashboard } from '@/components/Dashboards';

export default function DashboardPage() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950">
                <div className="relative w-20 h-20">
                    <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-t-indigo-500 rounded-full animate-spin"></div>
                </div>
            </div>
        );
    }

    if (!user) {
        return null; // AuthContext handles redirect
    }

    return user.role === 'admin' ? <AdminDashboard /> : <UserDashboard />;
}
