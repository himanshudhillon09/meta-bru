'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { BrandLogoSection } from '@/components/BrandLogoSection';
import { Modal } from '@/components/Modal';
import { PasswordChangeForm } from '@/components/PasswordChangeForm';
import { PasswordInput } from '@/components/PasswordInput';
import { PasswordPromptModal } from '@/components/PasswordPromptModal';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/lib/apiClient';
import {
    getInitialTimezoneOptions,
    getTimezoneOptions,
} from '@/lib/timezones';
import type { CredentialStatus, RevealedCredentials } from '@/lib/types';

type CredentialKey = 'meta' | 'cloudinary' | 'gemini';
type RevealTarget =
    | 'meta'
    | 'cloudinaryKey'
    | 'cloudinarySecret'
    | 'gemini';

const REMOVE_MESSAGES: Record<CredentialKey, string> = {
    meta: 'Remove your Meta app credentials? Your Page connections will be marked for reconnect because their tokens were issued by the previous app.',
    cloudinary:
        'Remove your Cloudinary credentials? New image uploads and AI image generation will stop working until you add them again. Existing media URLs keep working.',
    gemini:
        'Remove your Gemini API key? Caption drafting and AI image generation will stop working until you add a key again.',
};

function StatusPill({ configured }: { configured: boolean }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider border ${
                configured
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
            }`}
        >
            <span
                className={`w-1.5 h-1.5 rounded-full ${
                    configured ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
            />
            {configured ? 'Configured' : 'Not configured'}
        </span>
    );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
    return (
        <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
            {children}
        </label>
    );
}

const inputClass =
    'mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50';

const fieldInputClass =
    'w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50';

function EyeIcon({ visible }: { visible: boolean }) {
    if (visible) {
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-5 w-5"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                />
            </svg>
        );
    }

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-5 w-5"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.036 12.322a1.012 1.012 0 0 1 0-.644C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
            />
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
        </svg>
    );
}

function SecretInput({
    value,
    onChange,
    show,
    onToggle,
    placeholder,
}: {
    value: string;
    onChange: (value: string) => void;
    show: boolean;
    onToggle: () => void;
    placeholder: string;
}) {
    return (
        <div className="relative mt-2">
            <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={placeholder}
                className={`${fieldInputClass} pr-12`}
            />
            <button
                type="button"
                onClick={onToggle}
                aria-label={show ? 'Hide saved credential' : 'Reveal saved credential'}
                title={show ? 'Hide' : 'Reveal'}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-300"
            >
                <EyeIcon visible={show} />
            </button>
        </div>
    );
}

const secondaryButtonClass =
    'bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white border border-white/10 px-4 py-2.5 rounded-xl text-xs font-bold transition-all';

export default function SettingsPage() {
    const { user, updateUser, updateSession } = useAuth();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [timezone, setTimezone] = useState('Asia/Kolkata');
    const [niche, setNiche] = useState('');
    const [tone, setTone] = useState('');
    const [audience, setAudience] = useState('');
    const [keywords, setKeywords] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [timezones, setTimezones] = useState(() =>
        getInitialTimezoneOptions('Asia/Kolkata')
    );

    const [credentialStatus, setCredentialStatus] =
        useState<CredentialStatus | null>(null);
    const [credentialsLoading, setCredentialsLoading] = useState(true);
    const [savingCredential, setSavingCredential] = useState<CredentialKey | ''>(
        ''
    );
    const [removeTarget, setRemoveTarget] = useState<CredentialKey | null>(null);

    const [metaAppId, setMetaAppId] = useState('');
    const [metaAppSecret, setMetaAppSecret] = useState('');
    const [cloudName, setCloudName] = useState('');
    const [cloudApiKey, setCloudApiKey] = useState('');
    const [cloudApiSecret, setCloudApiSecret] = useState('');
    const [geminiKey, setGeminiKey] = useState('');

    const [revealed, setRevealed] = useState<RevealedCredentials | null>(null);
    const [revealOpen, setRevealOpen] = useState(false);
    const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(
        null
    );
    const [showMetaSecret, setShowMetaSecret] = useState(false);
    const [showCloudApiKey, setShowCloudApiKey] = useState(false);
    const [showCloudApiSecret, setShowCloudApiSecret] = useState(false);
    const [showGeminiKey, setShowGeminiKey] = useState(false);

    useEffect(() => {
        if (!user) return;
        setName(user.name || '');
        setEmail(user.email || '');
        setTimezone(user.timezone || 'Asia/Kolkata');
        setNiche(user.brandProfile?.niche || '');
        setTone(user.brandProfile?.tone || '');
        setAudience(user.brandProfile?.audience || '');
        setKeywords(user.brandProfile?.keywords || '');
    }, [user]);

    useEffect(() => {
        setTimezones(getTimezoneOptions(timezone));
    }, [timezone]);

    const loadCredentials = async () => {
        setCredentialsLoading(true);
        try {
            const data: any = await authApi.getCredentials();
            if (data.success) {
                setCredentialStatus(data.credentials);
                setMetaAppId(data.credentials.meta?.appId || '');
                setCloudName(data.credentials.cloudinary?.cloudName || '');
                if (data.credentials.storageError) {
                    setError(data.credentials.storageError);
                }
            }
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not load your integration credentials'
            );
        } finally {
            setCredentialsLoading(false);
        }
    };

    useEffect(() => {
        void loadCredentials();
    }, []);

    const emailChanged =
        email.trim().toLowerCase() !== (user?.email || '').trim().toLowerCase();

    const toggleSecret = (target: RevealTarget) => {
        if (target === 'meta') setShowMetaSecret((value) => !value);
        if (target === 'cloudinaryKey') setShowCloudApiKey((value) => !value);
        if (target === 'cloudinarySecret') {
            setShowCloudApiSecret((value) => !value);
        }
        if (target === 'gemini') setShowGeminiKey((value) => !value);
    };

    const openSecretEye = (target: RevealTarget, typedValue: string) => {
        const configured =
            target === 'meta'
                ? Boolean(credentialStatus?.meta.appSecretConfigured)
                : target === 'cloudinaryKey'
                  ? Boolean(credentialStatus?.cloudinary.apiKeyConfigured)
                  : target === 'cloudinarySecret'
                    ? Boolean(credentialStatus?.cloudinary.apiSecretConfigured)
                    : Boolean(credentialStatus?.gemini.configured);

        if (revealed || !configured || typedValue.trim()) {
            toggleSecret(target);
            return;
        }

        setRevealTarget(target);
        setRevealOpen(true);
    };

    const revealSecrets = async (password: string) => {
        const data: any = await authApi.revealCredentials(password);
        if (!data?.success) {
            throw new Error('Could not reveal saved credentials.');
        }

        setRevealed(data.credentials);
        if (revealTarget === 'meta') setShowMetaSecret(true);
        if (revealTarget === 'cloudinaryKey') setShowCloudApiKey(true);
        if (revealTarget === 'cloudinarySecret') setShowCloudApiSecret(true);
        if (revealTarget === 'gemini') setShowGeminiKey(true);
    };

    const lockSecrets = () => {
        setRevealed(null);
        setRevealOpen(false);
        setRevealTarget(null);
        setShowMetaSecret(false);
        setShowCloudApiKey(false);
        setShowCloudApiSecret(false);
        setShowGeminiKey(false);
    };

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setNotice('');

        if (emailChanged && !currentPassword) {
            setError('Enter your current password to change your email.');
            return;
        }

        setSaving(true);
        try {
            const data: any = await authApi.updateProfile({
                name,
                email,
                ...(emailChanged ? { currentPassword } : {}),
                timezone,
                brandProfile: { niche, tone, audience, keywords },
            });
            if (data.success) {
                updateUser(data.user);
                setCurrentPassword('');
                setNotice(
                    emailChanged
                        ? 'Profile saved. Use your new email next time you sign in.'
                        : 'Profile saved.'
                );
            }
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not save profile');
        } finally {
            setSaving(false);
        }
    };

    const saveMeta = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setNotice('');

        if (!metaAppId.trim()) {
            setError('Enter your Meta App ID.');
            return;
        }
        if (!credentialStatus?.meta.configured && !metaAppSecret.trim()) {
            setError('Enter your Meta App Secret.');
            return;
        }
        if (
            credentialStatus?.meta.configured &&
            credentialStatus.meta.appId !== metaAppId.trim() &&
            !metaAppSecret.trim()
        ) {
            setError(
                'Enter the App Secret for the new Meta app. A secret from a different app cannot be reused.'
            );
            return;
        }

        setSavingCredential('meta');
        try {
            const data: any = await authApi.saveMetaCredentials({
                appId: metaAppId.trim(),
                ...(metaAppSecret.trim()
                    ? { appSecret: metaAppSecret.trim() }
                    : {}),
            });
            if (data.success) {
                setCredentialStatus(data.credentials);
                setMetaAppId(data.credentials.meta?.appId || metaAppId.trim());
                setMetaAppSecret('');
                setNotice(
                    'Meta app credentials saved. If you changed the app, reconnect your Pages under Connections.'
                );
                lockSecrets();
            }
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not save Meta app credentials'
            );
        } finally {
            setSavingCredential('');
        }
    };

    const saveCloudinary = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setNotice('');

        if (!cloudName.trim()) {
            setError('Enter your Cloudinary cloud name.');
            return;
        }
        if (
            !credentialStatus?.cloudinary.configured &&
            (!cloudApiKey.trim() || !cloudApiSecret.trim())
        ) {
            setError('Enter your Cloudinary API key and API secret.');
            return;
        }
        if (
            credentialStatus?.cloudinary.configured &&
            credentialStatus.cloudinary.cloudName !== cloudName.trim() &&
            (!cloudApiKey.trim() || !cloudApiSecret.trim())
        ) {
            setError(
                'Enter the API key and API secret for the new Cloudinary cloud. Credentials from a different cloud cannot be reused.'
            );
            return;
        }

        setSavingCredential('cloudinary');
        try {
            const data: any = await authApi.saveCloudinaryCredentials({
                cloudName: cloudName.trim(),
                ...(cloudApiKey.trim() ? { apiKey: cloudApiKey.trim() } : {}),
                ...(cloudApiSecret.trim()
                    ? { apiSecret: cloudApiSecret.trim() }
                    : {}),
            });
            if (data.success) {
                setCredentialStatus(data.credentials);
                setCloudName(
                    data.credentials.cloudinary?.cloudName || cloudName.trim()
                );
                setCloudApiKey('');
                setCloudApiSecret('');
                setNotice('Cloudinary credentials saved.');
                lockSecrets();
            }
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not save Cloudinary credentials'
            );
        } finally {
            setSavingCredential('');
        }
    };

    const saveGemini = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setNotice('');

        if (!geminiKey.trim()) {
            setError('Enter your Gemini API key.');
            return;
        }

        setSavingCredential('gemini');
        try {
            const data: any = await authApi.saveGeminiCredentials({
                apiKey: geminiKey.trim(),
            });
            if (data.success) {
                setCredentialStatus(data.credentials);
                setGeminiKey('');
                setNotice('Gemini API key saved.');
                lockSecrets();
            }
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not save Gemini API key'
            );
        } finally {
            setSavingCredential('');
        }
    };

    const removeCredential = async () => {
        const target = removeTarget;
        if (!target) return;

        setSavingCredential(target);
        setError('');
        setNotice('');

        try {
            const data: any =
                target === 'meta'
                    ? await authApi.removeMetaCredentials()
                    : target === 'cloudinary'
                      ? await authApi.removeCloudinaryCredentials()
                      : await authApi.removeGeminiCredentials();

            if (data.success) {
                setCredentialStatus(data.credentials);
                if (target === 'meta') {
                    setMetaAppId('');
                    setMetaAppSecret('');
                } else if (target === 'cloudinary') {
                    setCloudName('');
                    setCloudApiKey('');
                    setCloudApiSecret('');
                } else {
                    setGeminiKey('');
                }
                setNotice(
                    target === 'meta'
                        ? 'Meta app credentials removed. Reconnect your Pages after adding a new app.'
                        : target === 'cloudinary'
                          ? 'Cloudinary credentials removed.'
                          : 'Gemini API key removed.'
                );
                lockSecrets();
            }
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not remove credentials'
            );
        } finally {
            setSavingCredential('');
            setRemoveTarget(null);
        }
    };

    const copyCallbackUrl = () => {
        const value = credentialStatus?.meta.redirectUri;
        if (!value) return;
        if (!navigator.clipboard) {
            setError('Copy is not available in this browser. Select the URL manually.');
            return;
        }
        void navigator.clipboard
            .writeText(value)
            .then(() => setNotice('OAuth callback URL copied.'))
            .catch(() => setError('Could not copy the callback URL.'));
    };

    if (!user) return null;

    return (
        <AppShell
            title="Profile & credentials"
            subtitle="Your account, brand context, and the integrations that belong only to you."
        >
            {notice ? (
                <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    {notice}
                </div>
            ) : null}
            {error ? (
                <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                    {error}
                </div>
            ) : null}

            <form
                onSubmit={save}
                className="grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-6 items-start"
            >
                <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
                    <h2 className="text-lg font-bold text-white mb-6">Account</h2>

                    <div className="space-y-5">
                        <div>
                            <FieldLabel>Full name</FieldLabel>
                            <input
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <FieldLabel>Email</FieldLabel>
                            <input
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                autoComplete="email"
                                required
                                className={inputClass}
                            />
                            {emailChanged ? (
                                <div className="mt-3">
                                    <FieldLabel>
                                        Current password to change email
                                    </FieldLabel>
                                    <PasswordInput
                                        value={currentPassword}
                                        onChange={setCurrentPassword}
                                        autoComplete="current-password"
                                        placeholder="Confirm your password"
                                        className={fieldInputClass}
                                        wrapperClassName="mt-2"
                                        required
                                    />
                                    <p className="text-xs text-slate-500 mt-2">
                                        Required so a stolen session cannot
                                        change your sign-in email.
                                    </p>
                                </div>
                            ) : null}
                        </div>

                        <div>
                            <FieldLabel>Default timezone</FieldLabel>
                            <select
                                value={timezone}
                                onChange={(event) => setTimezone(event.target.value)}
                                className={inputClass}
                            >
                                {timezones.map((zone) => (
                                    <option key={zone} value={zone}>
                                        {zone}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-slate-500 mt-2">
                                Used for new Pages. Each connection can override
                                its own timezone.
                            </p>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={saving}
                        className="mt-7 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-6 py-3 rounded-xl text-sm font-bold transition-all"
                    >
                        {saving ? 'Saving...' : 'Save account'}
                    </button>

                    <div className="mt-8 pt-6 border-t border-white/5 text-xs text-slate-500">
                        Role:{' '}
                        <span className="capitalize text-slate-300">{user.role}</span>
                        <br />
                        Status:{' '}
                        <span
                            className={
                                user.isActive === false
                                    ? 'text-rose-400'
                                    : 'text-emerald-400'
                            }
                        >
                            {user.isActive === false ? 'Inactive' : 'Active'}
                        </span>
                    </div>
                </section>

                <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
                    <h2 className="text-lg font-bold text-white">Brand profile</h2>
                    <p className="text-sm text-slate-400 mt-1 mb-6">
                        Gemini uses this to write captions that sound like your
                        brand.
                    </p>

                    <div className="space-y-5">
                        <div>
                            <FieldLabel>Niche</FieldLabel>
                            <input
                                value={niche}
                                onChange={(event) => setNiche(event.target.value)}
                                placeholder="e.g. sustainable fashion, local bakery, fitness coaching"
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <FieldLabel>Tone</FieldLabel>
                            <input
                                value={tone}
                                onChange={(event) => setTone(event.target.value)}
                                placeholder="e.g. warm, bold, playful, professional"
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <FieldLabel>Audience</FieldLabel>
                            <input
                                value={audience}
                                onChange={(event) => setAudience(event.target.value)}
                                placeholder="Who are you talking to?"
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <FieldLabel>Keywords</FieldLabel>
                            <input
                                value={keywords}
                                onChange={(event) => setKeywords(event.target.value)}
                                placeholder="Words or phrases to include naturally"
                                className={inputClass}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={saving}
                        className="mt-7 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-6 py-3 rounded-xl text-sm font-bold transition-all"
                    >
                        {saving ? 'Saving...' : 'Save brand profile'}
                    </button>
                </section>
            </form>

            <BrandLogoSection onNotice={setNotice} onError={setError} />

            <section className="mt-6 rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
                <h2 className="text-lg font-bold text-white">Password</h2>
                <p className="mt-1 mb-6 text-sm text-slate-400">
                    Change your password. Every other signed-in session will be
                    logged out; this session stays active.
                </p>
                <div className="max-w-xl">
                    <PasswordChangeForm
                        onSuccess={(data) => {
                            updateSession(data.token, data.user);
                            lockSecrets();
                            setError('');
                            setNotice(
                                'Password updated. Other sessions were signed out.'
                            );
                        }}
                    />
                </div>
            </section>

            <section className="mt-10">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div>
                        <h2 className="text-xl font-bold text-white">
                            Integration credentials
                        </h2>
                        <p className="text-sm text-slate-400 mt-1 max-w-2xl">
                            Each user brings their own Meta app, Cloudinary
                            account, and Gemini API key. Secrets are encrypted
                            at rest. Use the eye icons to reveal saved secrets
                            after confirming your password.
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        {revealed ? (
                            <button
                                type="button"
                                onClick={lockSecrets}
                                className="text-xs font-bold text-amber-300 hover:text-amber-200"
                            >
                                Lock revealed secrets
                            </button>
                        ) : null}
                        <Link
                            href="/connections"
                            className="text-sm font-bold text-indigo-400 hover:text-indigo-300"
                        >
                            Manage Page connections →
                        </Link>
                    </div>
                </div>

                {credentialsLoading ? (
                    <div className="flex justify-center py-16">
                        <div className="animate-spin rounded-full h-9 w-9 border-t-2 border-indigo-500" />
                    </div>
                ) : (
                    <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                        <form
                            onSubmit={saveMeta}
                            className="lg:col-span-2 rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-bold text-white">
                                        Meta app
                                    </h3>
                                    <p className="text-sm text-slate-400 mt-1">
                                        Used for Facebook Login and Page
                                        connections. Create an app at{' '}
                                        <a
                                            href="https://developers.facebook.com/apps"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-indigo-400 hover:text-indigo-300"
                                        >
                                            developers.facebook.com
                                        </a>
                                        .
                                    </p>
                                </div>
                                <StatusPill
                                    configured={Boolean(
                                        credentialStatus?.meta.configured
                                    )}
                                />
                            </div>

                            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
                                <div>
                                    <FieldLabel>Meta App ID</FieldLabel>
                                    <input
                                        value={metaAppId}
                                        onChange={(event) =>
                                            setMetaAppId(event.target.value)
                                        }
                                        autoComplete="off"
                                        spellCheck={false}
                                        placeholder="e.g. 123456789012345"
                                        className={inputClass}
                                    />
                                </div>
                                <div>
                                    <FieldLabel>Meta App Secret</FieldLabel>
                                    <SecretInput
                                        value={
                                            showMetaSecret
                                                ? metaAppSecret ||
                                                  revealed?.meta?.appSecret ||
                                                  ''
                                                : metaAppSecret
                                        }
                                        onChange={setMetaAppSecret}
                                        show={showMetaSecret}
                                        onToggle={() =>
                                            openSecretEye('meta', metaAppSecret)
                                        }
                                        placeholder={
                                            !credentialStatus?.meta.configured
                                                ? 'Paste your app secret'
                                                : credentialStatus.meta.appId ===
                                                    metaAppId.trim()
                                                  ? 'Saved — leave blank to keep it'
                                                  : 'Enter the new app secret'
                                        }
                                    />
                                </div>
                            </div>

                            <div className="mt-5">
                                <FieldLabel>OAuth callback URL</FieldLabel>
                                <div className="mt-2 flex flex-col sm:flex-row gap-2">
                                    <div className="flex-1 bg-slate-950/40 border border-white/5 rounded-xl px-4 py-3.5 text-xs text-slate-300 break-all font-mono">
                                        {credentialStatus?.meta.redirectUri ||
                                            'Set META_REDIRECT_URI on the backend'}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={copyCallbackUrl}
                                        className={secondaryButtonClass}
                                    >
                                        Copy
                                    </button>
                                </div>
                                <p className="text-xs text-slate-500 mt-2">
                                    Add this exact URL under Facebook Login →
                                    Settings → Valid OAuth Redirect URIs in your
                                    Meta app.
                                </p>
                            </div>

                            <div className="mt-5">
                                <FieldLabel>Required permissions</FieldLabel>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {(credentialStatus?.meta.scopes || []).map(
                                        (scope) => (
                                            <span
                                                key={scope}
                                                className="rounded-lg border border-white/5 bg-slate-950/40 px-2.5 py-1.5 text-[11px] font-mono text-slate-400"
                                            >
                                                {scope}
                                            </span>
                                        )
                                    )}
                                </div>
                            </div>

                            {credentialStatus?.meta.needsReauthCount ? (
                                <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                                    {credentialStatus.meta.needsReauthCount} Page
                                    {credentialStatus.meta.needsReauthCount === 1
                                        ? ''
                                        : 's'}{' '}
                                    need reconnecting because the Meta app
                                    credentials changed.
                                </div>
                            ) : null}

                            <div className="mt-6 flex flex-wrap gap-3">
                                <button
                                    type="submit"
                                    disabled={savingCredential === 'meta'}
                                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-3 rounded-xl text-sm font-bold transition-all"
                                >
                                    {savingCredential === 'meta'
                                        ? 'Saving...'
                                        : 'Save Meta app'}
                                </button>
                                {credentialStatus?.meta.configured ? (
                                    <button
                                        type="button"
                                        onClick={() => setRemoveTarget('meta')}
                                        disabled={savingCredential === 'meta'}
                                        className="bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-60 text-rose-300 border border-rose-500/20 px-5 py-3 rounded-xl text-sm font-bold transition-all"
                                    >
                                        Remove
                                    </button>
                                ) : null}
                            </div>
                        </form>

                        <form
                            onSubmit={saveCloudinary}
                            className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-bold text-white">
                                        Cloudinary
                                    </h3>
                                    <p className="text-sm text-slate-400 mt-1">
                                        Stores the images you upload and the
                                        images Gemini creates.
                                    </p>
                                </div>
                                <StatusPill
                                    configured={Boolean(
                                        credentialStatus?.cloudinary.configured
                                    )}
                                />
                            </div>

                            <div className="mt-6 space-y-5">
                                <div>
                                    <FieldLabel>Cloud name</FieldLabel>
                                    <input
                                        value={cloudName}
                                        onChange={(event) =>
                                            setCloudName(event.target.value)
                                        }
                                        autoComplete="off"
                                        spellCheck={false}
                                        placeholder="Your Cloudinary cloud name"
                                        className={inputClass}
                                    />
                                </div>
                                <div>
                                    <FieldLabel>API key</FieldLabel>
                                    <SecretInput
                                        value={
                                            showCloudApiKey
                                                ? cloudApiKey ||
                                                  revealed?.cloudinary?.apiKey ||
                                                  ''
                                                : cloudApiKey
                                        }
                                        onChange={setCloudApiKey}
                                        show={showCloudApiKey}
                                        onToggle={() =>
                                            openSecretEye(
                                                'cloudinaryKey',
                                                cloudApiKey
                                            )
                                        }
                                        placeholder={
                                            !credentialStatus?.cloudinary
                                                .configured
                                                ? 'Cloudinary API key'
                                                : credentialStatus.cloudinary
                                                        .cloudName ===
                                                    cloudName.trim()
                                                  ? 'Saved — leave blank to keep it'
                                                  : 'Enter the new cloud API key'
                                        }
                                    />
                                </div>
                                <div>
                                    <FieldLabel>API secret</FieldLabel>
                                    <SecretInput
                                        value={
                                            showCloudApiSecret
                                                ? cloudApiSecret ||
                                                  revealed?.cloudinary
                                                      ?.apiSecret ||
                                                  ''
                                                : cloudApiSecret
                                        }
                                        onChange={setCloudApiSecret}
                                        show={showCloudApiSecret}
                                        onToggle={() =>
                                            openSecretEye(
                                                'cloudinarySecret',
                                                cloudApiSecret
                                            )
                                        }
                                        placeholder={
                                            !credentialStatus?.cloudinary
                                                .configured
                                                ? 'Cloudinary API secret'
                                                : credentialStatus.cloudinary
                                                        .cloudName ===
                                                    cloudName.trim()
                                                  ? 'Saved — leave blank to keep it'
                                                  : 'Enter the new cloud API secret'
                                        }
                                    />
                                </div>
                            </div>

                            <div className="mt-6 flex flex-wrap gap-3">
                                <button
                                    type="submit"
                                    disabled={savingCredential === 'cloudinary'}
                                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-3 rounded-xl text-sm font-bold transition-all"
                                >
                                    {savingCredential === 'cloudinary'
                                        ? 'Saving...'
                                        : 'Save Cloudinary'}
                                </button>
                                {credentialStatus?.cloudinary.configured ? (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setRemoveTarget('cloudinary')
                                        }
                                        disabled={savingCredential === 'cloudinary'}
                                        className="bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-60 text-rose-300 border border-rose-500/20 px-5 py-3 rounded-xl text-sm font-bold transition-all"
                                    >
                                        Remove
                                    </button>
                                ) : null}
                            </div>
                        </form>

                        <form
                            onSubmit={saveGemini}
                            className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-bold text-white">
                                        Gemini
                                    </h3>
                                    <p className="text-sm text-slate-400 mt-1">
                                        Writes captions and generates images for
                                        your posts.
                                    </p>
                                </div>
                                <StatusPill
                                    configured={Boolean(
                                        credentialStatus?.gemini.configured
                                    )}
                                />
                            </div>

                            <div className="mt-6">
                                <FieldLabel>API key</FieldLabel>
                                <SecretInput
                                    value={
                                        showGeminiKey
                                            ? geminiKey ||
                                              revealed?.gemini?.apiKey ||
                                              ''
                                            : geminiKey
                                    }
                                    onChange={setGeminiKey}
                                    show={showGeminiKey}
                                    onToggle={() =>
                                        openSecretEye('gemini', geminiKey)
                                    }
                                    placeholder={
                                        credentialStatus?.gemini.configured
                                            ? 'Saved — enter a new key to replace it'
                                            : 'Paste your Gemini API key'
                                    }
                                />
                                <p className="text-xs text-slate-500 mt-2">
                                    Create a key in Google AI Studio. It is used
                                    only for your account.
                                </p>
                            </div>

                            <div className="mt-6 flex flex-wrap gap-3">
                                <button
                                    type="submit"
                                    disabled={savingCredential === 'gemini'}
                                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-3 rounded-xl text-sm font-bold transition-all"
                                >
                                    {savingCredential === 'gemini'
                                        ? 'Saving...'
                                        : 'Save Gemini key'}
                                </button>
                                {credentialStatus?.gemini.configured ? (
                                    <button
                                        type="button"
                                        onClick={() => setRemoveTarget('gemini')}
                                        disabled={savingCredential === 'gemini'}
                                        className="bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-60 text-rose-300 border border-rose-500/20 px-5 py-3 rounded-xl text-sm font-bold transition-all"
                                    >
                                        Remove
                                    </button>
                                ) : null}
                            </div>
                        </form>
                    </div>
                )}
            </section>

            <PasswordPromptModal
                isOpen={revealOpen}
                title="Reveal saved credentials"
                description="Enter your current password to unlock your saved Meta, Cloudinary, and Gemini secrets for this page."
                submitLabel="Reveal credentials"
                onClose={() => {
                    setRevealOpen(false);
                    setRevealTarget(null);
                }}
                onSubmit={revealSecrets}
            />

            <Modal
                isOpen={removeTarget !== null}
                onClose={() => setRemoveTarget(null)}
                onConfirm={removeCredential}
                title="Remove credentials?"
                message={
                    removeTarget
                        ? REMOVE_MESSAGES[removeTarget]
                        : 'Remove these credentials?'
                }
                confirmText="Remove"
                type="danger"
            />
        </AppShell>
    );
}
