'use client';

import React, { useState } from 'react';
import { authApi } from '@/lib/apiClient';
import type { User } from '@/lib/types';
import { PasswordInput } from './PasswordInput';

interface PasswordChangeFormProps {
    onSuccess: (data: { token: string; user: User }) => void;
    currentPasswordLabel?: string;
    submitLabel?: string;
}

const fieldInputClass =
    'w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3.5 text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-60';

export function PasswordChangeForm({
    onSuccess,
    currentPasswordLabel = 'Current password',
    submitLabel = 'Change password',
}: PasswordChangeFormProps) {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');

        if (newPassword.length < 6 || newPassword.length > 128) {
            setError('New password must be between 6 and 128 characters.');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('New password and confirmation do not match.');
            return;
        }

        if (newPassword === currentPassword) {
            setError(
                'New password must be different from the current password.'
            );
            return;
        }

        setSaving(true);
        try {
            const data: any = await authApi.changePassword({
                currentPassword,
                newPassword,
            });

            if (!data?.success || !data.token || !data.user) {
                throw new Error('Password change did not return a new session.');
            }

            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            onSuccess({ token: data.token, user: data.user });
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : err?.message || 'Could not change password.'
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-5">
            <div>
                <label className="text-xs font-bold uppercase tracking-widest text-subtle">
                    {currentPasswordLabel}
                </label>
                <PasswordInput
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    autoComplete="current-password"
                    className={fieldInputClass}
                    wrapperClassName="mt-2"
                    required
                />
            </div>

            <div>
                <label className="text-xs font-bold uppercase tracking-widest text-subtle">
                    New password
                </label>
                <PasswordInput
                    value={newPassword}
                    onChange={setNewPassword}
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    className={fieldInputClass}
                    wrapperClassName="mt-2"
                    required
                />
            </div>

            <div>
                <label className="text-xs font-bold uppercase tracking-widest text-subtle">
                    Confirm new password
                </label>
                <PasswordInput
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                    placeholder="Enter the new password again"
                    className={fieldInputClass}
                    wrapperClassName="mt-2"
                    required
                />
            </div>

            <p className="text-xs text-subtle">
                Changing your password signs out every other session. This
                session stays signed in.
            </p>

            {error ? (
                <div className="animate-fade-up rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            ) : null}

            <button
                type="submit"
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-3 rounded-xl text-sm font-bold transition-all"
            >
                {saving ? 'Saving...' : submitLabel}
            </button>
        </form>
    );
}
