'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { AuthFrame } from '@/components/AuthFrame';
import { PasswordChangeForm } from '@/components/PasswordChangeForm';
import { useAuth } from '@/context/AuthContext';

export default function ChangePasswordPage() {
    const { user, updateSession, logout } = useAuth();
    const router = useRouter();

    if (!user) return null;

    return (
        <AuthFrame
            title="Set a new password"
            subtitle="Your password was reset by an administrator. Enter the temporary password and choose a new one before continuing."
            width="wide"
        >
                <div>
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
                    className="mt-6 text-xs font-semibold text-subtle hover:text-fg-2 transition-colors"
                >
                    Sign out instead
                </button>
        </AuthFrame>
    );
}
