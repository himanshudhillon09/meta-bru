'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';

export default function DashboardPage() {
    const { user, logout } = useAuth();

    if (!user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-8 max-w-7xl mx-auto">
            <header className="flex justify-between items-center mb-12 bg-slate-900/50 backdrop-blur-md p-6 rounded-3xl border border-white/5 shadow-xl">
                <div>
                    <h1 className="text-3xl font-extrabold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                        Dashboard
                    </h1>
                    <p className="text-slate-400 mt-1">Welcome back, {user.name}</p>
                </div>

                <button
                    onClick={logout}
                    className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 px-6 py-2.5 rounded-xl font-semibold transition-all hover:scale-105 active:scale-95"
                >
                    Log Out
                </button>
            </header>

            <main className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Stats Card */}
                <div className="bg-slate-900/40 p-8 rounded-[32px] border border-white/5 shadow-2xl transition-all hover:border-indigo-500/30 group">
                    <h3 className="text-slate-400 text-sm font-medium mb-2">User Role</h3>
                    <p className="text-3xl font-bold text-white capitalize">{user.role}</p>
                    <div className="mt-4 h-1 w-12 bg-indigo-500 rounded-full group-hover:w-full transition-all duration-500"></div>
                </div>

                {/* Profile Card */}
                <div className="bg-slate-900/40 p-8 rounded-[32px] border border-white/5 shadow-2xl transition-all hover:border-indigo-500/30 group">
                    <h3 className="text-slate-400 text-sm font-medium mb-2">Email Address</h3>
                    <p className="text-xl font-semibold text-white break-all">{user.email}</p>
                    <div className="mt-4 h-1 w-12 bg-emerald-500 rounded-full group-hover:w-full transition-all duration-500"></div>
                </div>

                {/* Info Card */}
                <div className="bg-slate-900/40 p-8 rounded-[32px] border border-white/5 shadow-2xl transition-all hover:border-indigo-500/30 group">
                    <h3 className="text-slate-400 text-sm font-medium mb-2">Account Status</h3>
                    <p className="text-3xl font-bold text-emerald-400">Active</p>
                    <div className="mt-4 h-1 w-12 bg-indigo-500 rounded-full group-hover:w-full transition-all duration-500"></div>
                </div>
            </main>

            <section className="mt-12 bg-slate-900/40 p-12 rounded-[40px] border border-white/5 shadow-2xl">
                <div className="max-w-2xl">
                    <h2 className="text-2xl font-bold mb-4 text-white">Getting Started</h2>
                    <p className="text-slate-400 leading-relaxed mb-8">
                        This is your personal workspace. From here you can manage your settings, view your progress, and explore all features of Meta-Bru.
                    </p>
                    <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3.5 rounded-2xl font-bold transition-all hover:-translate-y-1 shadow-lg shadow-indigo-500/25">
                        Explore Features
                    </button>
                </div>
            </section>
        </div>
    );
}
