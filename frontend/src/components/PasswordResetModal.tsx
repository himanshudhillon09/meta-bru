'use client';

import React, { useState } from 'react';
import { authApi } from '@/lib/apiClient';
import { PasswordInput } from './PasswordInput';

interface PasswordResetModalProps {
    target: { _id: string; name: string; email: string };
    onClose: () => void;
    onResetComplete: () => Promise<void> | void;
}

const fieldInputClass =
    'w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3.5 text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50';

export function PasswordResetModal({
    target,
    onClose,
    onResetComplete,
}: PasswordResetModalProps) {
    const [temporaryPassword, setTemporaryPassword] = useState('');
    const [resetting, setResetting] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);

    const reset = async () => {
        setResetting(true);
        setError('');

        try {
            const data: any = await authApi.resetUserPassword(target._id);
            if (!data?.success || !data.temporaryPassword) {
                throw new Error('Password reset did not return a temporary password.');
            }

            setTemporaryPassword(data.temporaryPassword);
            void onResetComplete();
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : err?.message || 'Could not reset this password.'
            );
        } finally {
            setResetting(false);
        }
    };

    const copy = async () => {
        if (!temporaryPassword) return;
        setCopied(false);
        setError('');

        if (!navigator.clipboard) {
            setError('Copy is not available in this browser. Reveal and copy it manually.');
            return;
        }

        try {
            await navigator.clipboard.writeText(temporaryPassword);
            setCopied(true);
        } catch {
            setError('Could not copy the temporary password.');
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-sm"
                onClick={
                    temporaryPassword || resetting ? undefined : onClose
                }
            />
            <div className="relative w-full max-w-lg animate-pop-in rounded-3xl border border-line-strong bg-surface p-7 shadow-2xl">
                {temporaryPassword ? (
                    <>
                        <h3 className="text-xl font-bold text-fg">
                            Temporary password ready
                        </h3>
                        <p className="mt-2 text-sm text-muted">
                            Give this password to {target.name} ({target.email})
                            through a secure channel. It will not be shown again.
                        </p>

                        <div className="mt-5">
                            <label className="text-xs font-bold uppercase tracking-widest text-subtle">
                                Temporary password
                            </label>
                            <PasswordInput
                                value={temporaryPassword}
                                onChange={() => undefined}
                                readOnly
                                autoComplete="off"
                                className={`${fieldInputClass} font-mono text-base tracking-wider`}
                                wrapperClassName="mt-2"
                            />
                        </div>

                        <div className="mt-3 flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => void copy()}
                                className="rounded-xl border border-line-strong bg-hover px-4 py-2.5 text-xs font-bold text-fg transition-all hover:bg-hover-strong"
                            >
                                {copied ? 'Copied' : 'Copy password'}
                            </button>
                        </div>

                        <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                            All of this user&apos;s sessions have been signed
                            out. They must change this password before they can
                            use the app again.
                        </div>

                        {error ? (
                            <div className="animate-fade-up mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                                {error}
                            </div>
                        ) : null}

                        <button
                            type="button"
                            onClick={onClose}
                            className="mt-6 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white transition-all hover:bg-indigo-500"
                        >
                            Done
                        </button>
                    </>
                ) : (
                    <>
                        <h3 className="text-xl font-bold text-fg">
                            Reset password?
                        </h3>
                        <p className="mt-2 text-sm text-muted">
                            Reset the password for{' '}
                            <span className="font-semibold text-fg">
                                {target.name}
                            </span>{' '}
                            ({target.email}).
                        </p>

                        <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
                            This signs out all of their active sessions. A
                            temporary password will be shown to you once, and
                            they will be required to change it at next login.
                        </div>

                        {error ? (
                            <div className="animate-fade-up mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                                {error}
                            </div>
                        ) : null}

                        <div className="mt-6 flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={resetting}
                                className="flex-1 rounded-xl border border-line-strong bg-hover py-3 text-sm font-bold text-fg transition-all hover:bg-hover-strong disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void reset()}
                                disabled={resetting}
                                className="flex-1 rounded-xl bg-rose-600 py-3 text-sm font-bold text-white transition-all hover:bg-rose-500 disabled:opacity-60"
                            >
                                {resetting ? 'Resetting...' : 'Reset password'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
