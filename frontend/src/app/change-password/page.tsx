'use client';

import React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { PasswordChangeForm } from '@/components/PasswordChangeForm';
import { useAuth } from '@/context/AuthContext';

export default function ChangePasswordPage() {
    const { user, updateSession, logout } = useAuth();
    const router = useRouter();

    if (!user) return null;

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-[24px] border border-white/10 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <Image
                        src="/icon.png"
                        alt="Meta-Bru"
                        width={40}
                        height={40}
                        className="rounded-xl shadow-lg shadow-indigo-500/20"
                    />
                    <div>
                        <div className="text-lg font-black tracking-tight text-white">
                            Meta-Bru
                        </div>
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                            Account security
                        </div>
                    </div>
                </div>

                <h1 className="mt-8 text-2xl font-extrabold text-white">
                    Set a new password
                </h1>
                <p className="mt-2 text-sm text-slate-400">
                    Your password was reset by an administrator. Enter the
                    temporary password and choose a new one before continuing.
                </p>

                <div className="mt-6">
                    <PasswordChangeForm
                        currentPasswordLabel="Temporary password"
                        submitLabel="Update password and continue"
                        onSuccess={(data) => {
                            updateSession(data.token, data.user);
                            router.push('/dashboard');
                        }}
                    />
                </div>

                <button
                    type="button"
                    onClick={() => void logout()}
                    className="mt-6 text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors"
                >
                    Sign out instead
                </button>
            </div>
        </div>
    );
}
