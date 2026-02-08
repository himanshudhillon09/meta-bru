'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/lib/apiClient';
import { Modal } from '@/components/Modal';

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
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Modal State
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        type: 'danger' | 'info' | 'success';
    }>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
        type: 'info'
    });

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const data: any = await authApi.getUsers();
            if (data.success) {
                setUsers(data.users);
            }
        } catch (err: any) {
            setError(err || 'Failed to fetch users');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleStatusRequest = (targetUser: any) => {
        const action = targetUser.isActive ? 'deactivate' : 'approve';
        setModalConfig({
            isOpen: true,
            title: action === 'approve' ? 'Approve Account?' : 'Deactivate Account?',
            message: action === 'approve'
                ? `This will grant ${targetUser.name} full access to the platform.`
                : `This will immediately block ${targetUser.name} from all platform features.`,
            type: action === 'approve' ? 'success' : 'danger',
            onConfirm: () => performToggleStatus(targetUser._id, targetUser.isActive)
        });
    };

    const performToggleStatus = async (userId: string, currentStatus: boolean) => {
        try {
            const data: any = await authApi.toggleUserStatus(userId, !currentStatus);
            if (data.success) {
                setUsers(users.map(u => u._id === userId ? { ...u, isActive: !currentStatus } : u));
            }
        } catch (err: any) {
            alert(err || 'Failed to update user status');
        }
    };

    if (!user) return null;

    const pendingUsers = users.filter(u => !u.isActive);

    return (
        <div className="min-h-screen p-8 max-w-7xl mx-auto">
            <Modal
                {...modalConfig}
                onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
                confirmText={modalConfig.title.split(' ')[0]}
            />

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

            <main className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
                <div className="bg-indigo-500/10 p-8 rounded-[32px] border border-indigo-500/20 shadow-2xl transition-all hover:bg-indigo-500/15 group">
                    <h3 className="text-indigo-400 text-sm font-medium mb-2">Total Users</h3>
                    <p className="text-4xl font-black text-white">{users.length}</p>
                </div>

                <div className="bg-amber-500/10 p-8 rounded-[32px] border border-amber-500/20 shadow-2xl transition-all hover:bg-amber-500/15 group">
                    <h3 className="text-amber-400 text-sm font-medium mb-2">Pending Approval</h3>
                    <p className="text-4xl font-black text-white">{pendingUsers.length}</p>
                </div>

                <div className="bg-emerald-500/10 p-8 rounded-[32px] border border-emerald-500/20 shadow-2xl transition-all hover:bg-emerald-500/15 group">
                    <h3 className="text-emerald-400 text-sm font-medium mb-2">Active Users</h3>
                    <p className="text-4xl font-black text-white">{users.filter(u => u.isActive).length}</p>
                </div>

                <div className="bg-rose-500/10 p-8 rounded-[32px] border border-rose-500/20 shadow-2xl transition-all hover:bg-rose-500/15 group">
                    <h3 className="text-rose-400 text-sm font-medium mb-2">System Health</h3>
                    <p className="text-4xl font-black text-white">100%</p>
                </div>
            </main>

            <section className="grid grid-cols-1 gap-12">
                <div className="bg-slate-900/40 p-10 rounded-[40px] border border-white/5 shadow-2xl">
                    <h2 className="text-2xl font-bold mb-8 text-white flex items-center gap-3">
                        <span className="w-2 h-8 bg-indigo-500 rounded-full"></span>
                        User Management
                    </h2>

                    {loading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-indigo-500"></div>
                        </div>
                    ) : error ? (
                        <div className="text-rose-400 text-center py-8">{error}</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="text-slate-500 text-xs font-bold uppercase tracking-wider border-b border-white/5">
                                        <th className="pb-4 pl-4">User</th>
                                        <th className="pb-4">Role</th>
                                        <th className="pb-4">Status</th>
                                        <th className="pb-4 text-right pr-4">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {users.map((u) => (
                                        <tr key={u._id} className="group hover:bg-white/5 transition-colors">
                                            <td className="py-5 pl-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-indigo-400 border border-white/5">
                                                        {u.name[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="text-white font-semibold">{u.name}</div>
                                                        <div className="text-slate-500 text-xs">{u.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-5 capitalize text-slate-400 text-sm">
                                                {u.role}
                                            </td>
                                            <td className="py-5">
                                                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${u.isActive
                                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                                    }`}>
                                                    {u.isActive ? 'Active' : 'Pending'}
                                                </span>
                                            </td>
                                            <td className="py-5 text-right pr-4">
                                                <button
                                                    onClick={() => handleToggleStatusRequest(u)}
                                                    disabled={u._id === user.id}
                                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${u._id === user.id
                                                        ? 'opacity-30 cursor-not-allowed bg-slate-800 text-slate-500 border border-white/5'
                                                        : u.isActive
                                                            ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/10'
                                                            : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20'
                                                        }`}
                                                >
                                                    {u._id === user.id ? 'You' : (u.isActive ? 'Deactivate' : 'Approve Access')}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
