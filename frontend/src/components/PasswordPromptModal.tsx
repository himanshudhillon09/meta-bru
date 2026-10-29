'use client';

import React, { useEffect, useState } from 'react';
import { PasswordInput } from './PasswordInput';

interface PasswordPromptModalProps {
    isOpen: boolean;
    title: string;
    description: string;
    submitLabel: string;
    onClose: () => void;
    onSubmit: (password: string) => Promise<void>;
}

const fieldInputClass =
    'w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3.5 text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50';

export function PasswordPromptModal({
    isOpen,
    title,
    description,
    submitLabel,
    onClose,
    onSubmit,
}: PasswordPromptModalProps) {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setPassword('');
            setError('');
            setLoading(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setLoading(true);
        setError('');

        try {
            await onSubmit(password);
            setPassword('');
            onClose();
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : err?.message || 'Could not verify your password.'
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-sm"
                onClick={loading ? undefined : onClose}
            />
            <form
                onSubmit={submit}
                className="relative w-full max-w-md animate-pop-in rounded-3xl border border-line-strong bg-surface p-7 shadow-2xl"
            >
                <h3 className="text-xl font-bold text-fg">{title}</h3>
                <p className="mt-2 text-sm text-muted">{description}</p>

                <div className="mt-5">
                    <PasswordInput
                        value={password}
                        onChange={setPassword}
                        autoComplete="current-password"
                        placeholder="Current password"
                        className={fieldInputClass}
                        required
                    />
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
                        disabled={loading}
                        className="flex-1 rounded-xl border border-line-strong bg-hover py-3 text-sm font-bold text-fg transition-all hover:bg-hover-strong disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white transition-all hover:bg-indigo-500 disabled:opacity-60"
                    >
                        {loading ? 'Checking...' : submitLabel}
                    </button>
                </div>
            </form>
        </div>
    );
}
