'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';

export function UserDashboard() {
    const { user, logout } = useAuth();

    if (!user) return null;

    return (
        <div className="min-h-screen p-8 max-w-7xl mx-auto">
            <header className="flex justify-between items-center mb-12 bg-slate-900/50 backdrop-blur-md p-6 rounded-3xl border border-white/5 shadow-xl">
                <div>
                    <h1 className="text-3xl font-extrabold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                        User Dashboard
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
                <div className="bg-slate-900/40 p-8 rounded-[32px] border border-white/5 shadow-2xl transition-all hover:border-indigo-500/30 group">
                    <h3 className="text-slate-400 text-sm font-medium mb-2">Role</h3>
                    <p className="text-3xl font-bold text-white capitalize">{user.role}</p>
                    <div className="mt-4 h-1 w-12 bg-indigo-500 rounded-full group-hover:w-full transition-all duration-500"></div>
                </div>

                <div className="bg-slate-900/40 p-8 rounded-[32px] border border-white/5 shadow-2xl transition-all hover:border-indigo-500/30 group">
                    <h3 className="text-slate-400 text-sm font-medium mb-2">Email</h3>
                    <p className="text-xl font-semibold text-white break-all">{user.email}</p>
                    <div className="mt-4 h-1 w-12 bg-emerald-500 rounded-full group-hover:w-full transition-all duration-500"></div>
                </div>

                <div className="bg-slate-900/40 p-8 rounded-[32px] border border-white/5 shadow-2xl transition-all hover:border-indigo-500/30 group">
                    <h3 className="text-slate-400 text-sm font-medium mb-2">Status</h3>
                    <p className="text-3xl font-bold text-emerald-400">Active</p>
                    <div className="mt-4 h-1 w-12 bg-indigo-500 rounded-full group-hover:w-full transition-all duration-500"></div>
                </div>
            </main>

            <section className="mt-12 bg-slate-900/40 p-12 rounded-[40px] border border-white/5 shadow-2xl">
                <div className="max-w-2xl">
                    <h2 className="text-2xl font-bold mb-4 text-white">Getting Started</h2>
                    <p className="text-slate-400 leading-relaxed mb-8">
                        Explore all the features of Meta-Bru and start amplifying your social impact today.
                    </p>
                    <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3.5 rounded-2xl font-bold transition-all hover:-translate-y-1 shadow-lg shadow-indigo-500/25">
                        Start Exploring
                    </button>
                </div>
            </section>
        </div>
    );
}

export function AdminDashboard() {
    const { user, logout } = useAuth();

    if (!user) return null;

    return (
        <div className="min-h-screen p-8 max-w-7xl mx-auto">
            <header className="flex justify-between items-center mb-12 bg-slate-900/50 backdrop-blur-md p-6 rounded-3xl border border-white/5 shadow-xl">
                <div>
                    <h1 className="text-3xl font-extrabold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                        Admin Command Center
                    </h1>
                    <p className="text-slate-400 mt-1">Administrator: {user.name}</p>
                </div>

                <button
                    onClick={logout}
                    className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 px-6 py-2.5 rounded-xl font-semibold transition-all hover:scale-105 active:scale-95"
                >
                    Log Out
                </button>
            </header>

            <main className="grid grid-cols-1 md:grid-cols-4 gap-8">
                <div className="bg-indigo-500/10 p-8 rounded-[32px] border border-indigo-500/20 shadow-2xl transition-all hover:bg-indigo-500/15 group">
                    <h3 className="text-indigo-400 text-sm font-medium mb-2">Total Users</h3>
                    <p className="text-4xl font-black text-white">1,284</p>
                    <div className="mt-4 text-xs text-indigo-400 font-bold">+12% from last week</div>
                </div>

                <div className="bg-purple-500/10 p-8 rounded-[32px] border border-purple-500/20 shadow-2xl transition-all hover:bg-purple-500/15 group">
                    <h3 className="text-purple-400 text-sm font-medium mb-2">Active Sessions</h3>
                    <p className="text-4xl font-black text-white">422</p>
                    <div className="mt-4 text-xs text-purple-400 font-bold">58 new today</div>
                </div>

                <div className="bg-emerald-500/10 p-8 rounded-[32px] border border-emerald-500/20 shadow-2xl transition-all hover:bg-emerald-500/15 group">
                    <h3 className="text-emerald-400 text-sm font-medium mb-2">System Health</h3>
                    <p className="text-4xl font-black text-white">99.9%</p>
                    <div className="mt-4 text-xs text-emerald-400 font-bold">All systems nominal</div>
                </div>

                <div className="bg-rose-500/10 p-8 rounded-[32px] border border-rose-500/20 shadow-2xl transition-all hover:bg-rose-500/15 group">
                    <h3 className="text-rose-400 text-sm font-medium mb-2">Critical Alerts</h3>
                    <p className="text-4xl font-black text-white">0</p>
                    <div className="mt-4 text-xs text-rose-400 font-bold">Secure and stable</div>
                </div>
            </main>

            <section className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-slate-900/40 p-10 rounded-[40px] border border-white/5 shadow-2xl">
                    <h2 className="text-2xl font-bold mb-6 text-white flex items-center gap-3">
                        <span className="w-2 h-8 bg-indigo-500 rounded-full"></span>
                        User Management
                    </h2>
                    <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-indigo-400">U{i}</div>
                                    <div>
                                        <div className="text-white font-semibold text-sm">User {i}</div>
                                        <div className="text-slate-500 text-xs">user{i}@example.com</div>
                                    </div>
                                </div>
                                <button className="text-xs font-bold text-indigo-400 hover:text-indigo-300">Manage</button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-slate-900/40 p-10 rounded-[40px] border border-white/5 shadow-2xl">
                    <h2 className="text-2xl font-bold mb-6 text-white flex items-center gap-3">
                        <span className="w-2 h-8 bg-purple-500 rounded-full"></span>
                        System Logs
                    </h2>
                    <div className="font-mono text-[11px] space-y-2 text-slate-500">
                        <div className="p-3 rounded-xl bg-black/30 border border-white/5">
                            <span className="text-emerald-500 mr-2">[INFO]</span> 14:02:11 - Database connection established
                        </div>
                        <div className="p-3 rounded-xl bg-black/30 border border-white/5">
                            <span className="text-indigo-500 mr-2">[AUTH]</span> 14:03:45 - Admin user logged in from 192.168.1.1
                        </div>
                        <div className="p-3 rounded-xl bg-black/30 border border-white/5">
                            <span className="text-emerald-500 mr-2">[INFO]</span> 14:05:22 - Scheduled cleanup task completed
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
