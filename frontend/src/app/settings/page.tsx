'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AiModelsSection } from '@/components/AiModelsSection';
import { PagesBrandSummary } from '@/components/PagesBrandSummary';
import { Modal } from '@/components/Modal';
import { PasswordChangeForm } from '@/components/PasswordChangeForm';
import { PasswordInput } from '@/components/PasswordInput';
import { PasswordPromptModal } from '@/components/PasswordPromptModal';
import { Tabs } from '@/components/Tabs';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/lib/apiClient';
import {
    getInitialTimezoneOptions,
    getTimezoneOptions,
} from '@/lib/timezones';
import type { CredentialStatus, RevealedCredentials } from '@/lib/types';

type CredentialKey = 'meta' | 'cloudinary' | 'gemini' | 'anthropic';
type RevealTarget =
    | 'meta'
    | 'cloudinaryKey'
    | 'cloudinarySecret'
    | 'gemini'
    | 'anthropic';

const REMOVE_MESSAGES: Record<CredentialKey, string> = {
    meta: 'Remove your Meta app credentials? Your Page connections will be marked for reconnect because their tokens were issued by the previous app.',
    cloudinary:
        'Remove your Cloudinary credentials? New image uploads and AI image generation will stop working until you add them again. Existing media URLs keep working.',
    gemini:
        'Remove your Gemini API key? Caption drafting and AI image generation will stop working until you add a key again.',
    anthropic:
        'Remove your Anthropic API key? While Claude is your AI provider, captions, image text, and Analytics tips will stop working until you add a key again or switch to Gemini.',
};

function StatusPill({ configured }: { configured: boolean }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider border ${
                configured
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
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
        <label className="text-xs font-bold uppercase tracking-widest text-subtle">
            {children}
        </label>
    );
}

const inputClass =
    'mt-2 w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3.5 text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50';

const fieldInputClass =
    'w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3.5 text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50';

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
                className="absolute right-4 top-1/2 -translate-y-1/2 text-subtle transition-colors hover:text-fg-2"
            >
                <EyeIcon visible={show} />
            </button>
        </div>
    );
}

const secondaryButtonClass =
    'bg-hover hover:bg-hover-strong disabled:opacity-60 text-fg border border-line-strong px-4 py-2.5 rounded-xl text-xs font-bold transition-all';

const primaryButtonClass =
    'bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all';

const removeButtonClass =
    'bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-60 text-rose-700 dark:text-rose-300 border border-rose-500/20 px-5 py-2.5 rounded-xl text-sm font-bold transition-all';

const TABS = [
    { key: 'account', label: 'Account' },
    { key: 'ai', label: 'AI' },
    { key: 'integrations', label: 'Integrations' },
    { key: 'security', label: 'Security' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const ICONS: Record<'meta' | 'cloud' | 'spark' | 'chat' | 'lock' | 'user', React.ReactNode> = {
    meta: <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />,
    cloud: <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.75 4.75 0 0 1-.75 9.5H7Z" />,
    spark: <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.5 2.5m6.4 6.4 2.5 2.5m0-11.4-2.5 2.5m-6.4 6.4-2.5 2.5" />,
    chat: <path d="M5 18.5V6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4 2.5Z" />,
    lock: (
        <>
            <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
            <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </>
    ),
    user: (
        <>
            <circle cx="12" cy="8.5" r="3.5" />
            <path d="M5 20a7 7 0 0 1 14 0" />
        </>
    ),
};

function CardIcon({ name }: { name: keyof typeof ICONS }) {
    return (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                {ICONS[name]}
            </svg>
        </span>
    );
}

/** One integration: what it is for, whether it is saved, its fields, and its buttons. */
function CredentialCard({
    icon,
    title,
    description,
    configured,
    onSubmit,
    children,
    actions,
    className = '',
}: {
    icon: keyof typeof ICONS;
    title: string;
    description: React.ReactNode;
    configured: boolean;
    onSubmit: (event: React.FormEvent) => void;
    children: React.ReactNode;
    actions: React.ReactNode;
    className?: string;
}) {
    return (
        <form onSubmit={onSubmit} className={`flex flex-col rounded-2xl border border-line bg-surface p-6 shadow-card ${className}`}>
            <div className="flex items-start gap-3">
                <CardIcon name={icon} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-base font-bold text-fg">{title}</h3>
                        <StatusPill configured={configured} />
                    </div>
                    <p className="mt-1 text-sm text-muted">{description}</p>
                </div>
            </div>
            <div className="mt-5 flex-1">{children}</div>
            <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-4">{actions}</div>
        </form>
    );
}

interface SetupStep {
    key: string;
    label: string;
    done: boolean;
    detail: string;
    tab?: TabKey;
    href?: string;
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || 'U';
}

export default function SettingsPage() {
    const { user, updateUser, updateSession } = useAuth();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [timezone, setTimezone] = useState('Asia/Kolkata');
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
    const [anthropicKey, setAnthropicKey] = useState('');

    const [revealed, setRevealed] = useState<RevealedCredentials | null>(null);
    const [revealOpen, setRevealOpen] = useState(false);
    const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(
        null
    );
    const [showMetaSecret, setShowMetaSecret] = useState(false);
    const [showCloudApiKey, setShowCloudApiKey] = useState(false);
    const [showCloudApiSecret, setShowCloudApiSecret] = useState(false);
    const [showGeminiKey, setShowGeminiKey] = useState(false);
    const [showAnthropicKey, setShowAnthropicKey] = useState(false);
    const [tab, setTab] = useState<TabKey>('account');

    // Other pages link straight to a tab, e.g. /settings#integrations.
    useEffect(() => {
        const fromHash = () => {
            const match = TABS.find((item) => item.key === window.location.hash.slice(1));
            if (match) setTab(match.key);
        };
        fromHash();
        window.addEventListener('hashchange', fromHash);
        return () => window.removeEventListener('hashchange', fromHash);
    }, []);

    const changeTab = (key: TabKey) => {
        setTab(key);
        window.history.replaceState(null, '', `#${key}`);
    };

    useEffect(() => {
        if (!user) return;
        setName(user.name || '');
        setEmail(user.email || '');
        setTimezone(user.timezone || 'Asia/Kolkata');
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
        if (target === 'anthropic') setShowAnthropicKey((value) => !value);
    };

    const openSecretEye = (target: RevealTarget, typedValue: string) => {
        const configured =
            target === 'meta'
                ? Boolean(credentialStatus?.meta.appSecretConfigured)
                : target === 'cloudinaryKey'
                  ? Boolean(credentialStatus?.cloudinary.apiKeyConfigured)
                  : target === 'cloudinarySecret'
                    ? Boolean(credentialStatus?.cloudinary.apiSecretConfigured)
                    : target === 'anthropic'
                      ? Boolean(credentialStatus?.anthropic?.configured)
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
        if (revealTarget === 'anthropic') setShowAnthropicKey(true);
    };

    const lockSecrets = () => {
        setRevealed(null);
        setRevealOpen(false);
        setRevealTarget(null);
        setShowMetaSecret(false);
        setShowCloudApiKey(false);
        setShowCloudApiSecret(false);
        setShowGeminiKey(false);
        setShowAnthropicKey(false);
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
            });
            if (data.success) {
                updateUser(data.user);
                setCurrentPassword('');
                const rescheduled = Number(data.rescheduledPages) || 0;
                setNotice(
                    (emailChanged
                        ? 'Profile saved. Use your new email next time you sign in.'
                        : 'Profile saved.') +
                        (rescheduled > 0
                            ? ` Rescheduled ${rescheduled} Page${rescheduled === 1 ? '' : 's'}.`
                            : '')
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
                    'Meta app credentials saved. If you changed the app, reconnect your Pages under Pages & Schedule.'
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

    const saveAnthropic = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setNotice('');

        if (!anthropicKey.trim()) {
            setError('Enter your Anthropic API key.');
            return;
        }

        setSavingCredential('anthropic');
        try {
            const data: any = await authApi.saveAnthropicCredentials({
                apiKey: anthropicKey.trim(),
            });
            if (data.success) {
                setCredentialStatus(data.credentials);
                setAnthropicKey('');
                setNotice(
                    user?.aiProvider === 'claude'
                        ? 'Anthropic API key saved.'
                        : 'Anthropic API key saved. Pick Claude under AI provider to use it.'
                );
                lockSecrets();
            }
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not save Anthropic API key'
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
                      : target === 'anthropic'
                        ? await authApi.removeAnthropicCredentials()
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
                } else if (target === 'anthropic') {
                    setAnthropicKey('');
                } else {
                    setGeminiKey('');
                }
                setNotice(
                    target === 'meta'
                        ? 'Meta app credentials removed. Reconnect your Pages after adding a new app.'
                        : target === 'cloudinary'
                          ? 'Cloudinary credentials removed.'
                          : target === 'anthropic'
                            ? 'Anthropic API key removed.'
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

    const provider = user.aiProvider === 'claude' ? 'claude' : 'gemini';
    const aiKeySaved =
        provider === 'claude'
            ? Boolean(credentialStatus?.anthropic?.configured)
            : Boolean(credentialStatus?.gemini.configured);
    const pagesCount = credentialStatus?.meta.connectionsCount ?? 0;
    const steps: SetupStep[] = [
        {
            key: 'meta',
            label: 'Meta app',
            done: Boolean(credentialStatus?.meta.configured),
            detail: credentialStatus?.meta.configured ? 'Saved' : 'Needed to connect Pages',
            tab: 'integrations',
        },
        {
            key: 'pages',
            label: 'Facebook Pages',
            done: pagesCount > 0,
            detail:
                pagesCount > 0
                    ? `${pagesCount} Page${pagesCount === 1 ? '' : 's'}${
                          credentialStatus?.meta.needsReauthCount
                              ? `, ${credentialStatus.meta.needsReauthCount} to reconnect`
                              : ''
                      }`
                    : 'Connect in Pages & Schedule',
            href: '/connections',
        },
        {
            key: 'cloudinary',
            label: 'Media storage',
            done: Boolean(credentialStatus?.cloudinary.configured),
            detail: credentialStatus?.cloudinary.configured ? 'Cloudinary saved' : 'Needed for uploads',
            tab: 'integrations',
        },
        {
            key: 'ai',
            label: `${provider === 'claude' ? 'Claude' : 'Gemini'} key`,
            done: aiKeySaved,
            detail: aiKeySaved ? 'AI writer ready' : 'Needed for AI captions',
            tab: 'ai',
        },
    ];
    const doneCount = steps.filter((step) => step.done).length;
    const tabNeeds = (key: TabKey) =>
        !credentialsLoading && steps.some((step) => step.tab === key && !step.done);

    const geminiCard = (
        <CredentialCard
            key="gemini"
            icon="spark"
            title="Gemini"
            description={
                provider === 'claude'
                    ? 'Draws AI images from Claude’s art direction.'
                    : 'Writes captions, image text, and Analytics tips, and draws AI images.'
            }
            configured={Boolean(credentialStatus?.gemini.configured)}
            onSubmit={saveGemini}
            actions={
                <>
                    <button type="submit" disabled={savingCredential === 'gemini'} className={primaryButtonClass}>
                        {savingCredential === 'gemini' ? 'Saving...' : 'Save Gemini key'}
                    </button>
                    {credentialStatus?.gemini.configured ? (
                        <button
                            type="button"
                            onClick={() => setRemoveTarget('gemini')}
                            disabled={savingCredential === 'gemini'}
                            className={removeButtonClass}
                        >
                            Remove
                        </button>
                    ) : null}
                </>
            }
        >
            <FieldLabel>API key</FieldLabel>
            <SecretInput
                value={showGeminiKey ? geminiKey || revealed?.gemini?.apiKey || '' : geminiKey}
                onChange={setGeminiKey}
                show={showGeminiKey}
                onToggle={() => openSecretEye('gemini', geminiKey)}
                placeholder={
                    credentialStatus?.gemini.configured
                        ? 'Saved — enter a new key to replace it'
                        : 'Paste your Gemini API key'
                }
            />
            <p className="text-xs text-subtle mt-2">
                Create a key in{' '}
                <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-700 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                >
                    Google AI Studio
                </a>
                . It is used only for your account.
            </p>
        </CredentialCard>
    );

    const claudeCard = (
        <CredentialCard
            key="claude"
            icon="chat"
            title="Claude (Anthropic)"
            description="Writes captions, image text, image prompts, and Analytics tips when Claude is your AI provider."
            configured={Boolean(credentialStatus?.anthropic?.configured)}
            onSubmit={saveAnthropic}
            actions={
                <>
                    <button type="submit" disabled={savingCredential === 'anthropic'} className={primaryButtonClass}>
                        {savingCredential === 'anthropic' ? 'Saving...' : 'Save Claude key'}
                    </button>
                    {credentialStatus?.anthropic?.configured ? (
                        <button
                            type="button"
                            onClick={() => setRemoveTarget('anthropic')}
                            disabled={savingCredential === 'anthropic'}
                            className={removeButtonClass}
                        >
                            Remove
                        </button>
                    ) : null}
                </>
            }
        >
            <FieldLabel>API key</FieldLabel>
            <SecretInput
                value={showAnthropicKey ? anthropicKey || revealed?.anthropic?.apiKey || '' : anthropicKey}
                onChange={setAnthropicKey}
                show={showAnthropicKey}
                onToggle={() => openSecretEye('anthropic', anthropicKey)}
                placeholder={
                    credentialStatus?.anthropic?.configured
                        ? 'Saved — enter a new key to replace it'
                        : 'Paste your Anthropic API key (sk-ant-…)'
                }
            />
            <p className="text-xs text-subtle mt-2">
                Create a key in the{' '}
                <a
                    href="https://platform.claude.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-700 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                >
                    Claude Console
                </a>
                . It is used only for your account, and its usage shows on the Usage page.
            </p>
        </CredentialCard>
    );

    return (
        <AppShell title="Profile" subtitle="Your account, your AI, and the services Meta-Bru runs on.">
            <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center">
                    <div className="flex items-center gap-4">
                        <span
                            aria-hidden="true"
                            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-xl font-bold text-white shadow-card"
                        >
                            {initials(user.name || user.email)}
                        </span>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="truncate text-lg font-bold text-fg">{user.name || 'Your account'}</h2>
                                <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
                                    {user.role}
                                </span>
                                <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                                        user.isActive === false
                                            ? 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                            : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    }`}
                                >
                                    {user.isActive === false ? 'Inactive' : 'Active'}
                                </span>
                            </div>
                            <p className="mt-0.5 truncate text-sm text-muted">{user.email}</p>
                            <p className="mt-0.5 text-xs text-subtle">
                                {user.timezone || 'Asia/Kolkata'} · AI by {provider === 'claude' ? 'Claude' : 'Gemini'}
                            </p>
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-bold text-fg">
                                Setup {credentialsLoading ? '…' : `${doneCount} of ${steps.length} done`}
                            </span>
                            {!credentialsLoading && doneCount === steps.length ? (
                                <span className="font-semibold text-emerald-700 dark:text-emerald-300">Ready to post</span>
                            ) : null}
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                            <div
                                className="h-full rounded-full bg-indigo-500 transition-[width] duration-500"
                                style={{ width: credentialsLoading ? '0%' : `${(doneCount / steps.length) * 100}%` }}
                            />
                        </div>
                        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {steps.map((step) => {
                                const body = (
                                    <>
                                        <span
                                            aria-hidden="true"
                                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                                credentialsLoading
                                                    ? 'bg-sunken text-subtle'
                                                    : step.done
                                                      ? 'bg-emerald-500 text-white'
                                                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                            }`}
                                        >
                                            {credentialsLoading ? '' : step.done ? '✓' : '!'}
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block truncate text-xs font-semibold text-fg">{step.label}</span>
                                            <span className="block truncate text-[11px] text-subtle">
                                                {credentialsLoading ? 'Checking…' : step.detail}
                                            </span>
                                        </span>
                                        <span className="sr-only">{step.done ? 'done' : 'to do'}</span>
                                    </>
                                );
                                const className =
                                    'flex w-full items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-left transition-colors hover:bg-hover';
                                return (
                                    <li key={step.key}>
                                        {step.href ? (
                                            <Link href={step.href} className={className}>
                                                {body}
                                            </Link>
                                        ) : (
                                            <button type="button" onClick={() => step.tab && changeTab(step.tab)} className={className}>
                                                {body}
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            </section>

            <div className="sticky top-0 z-10 -mx-1 mt-6 bg-canvas/90 px-1 py-2 backdrop-blur">
                <Tabs
                    label="Profile sections"
                    items={TABS.map((item) => ({
                        key: item.key,
                        label: tabNeeds(item.key) ? (
                            <span className="inline-flex items-center gap-1.5">
                                {item.label}
                                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                <span className="sr-only">(needs setup)</span>
                            </span>
                        ) : (
                            item.label
                        ),
                    }))}
                    value={tab}
                    onChange={changeTab}
                />
            </div>

            {notice ? (
                <div
                    role="status"
                    className="animate-fade-up mt-4 flex items-start justify-between gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"
                >
                    <span>{notice}</span>
                    <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="text-xs font-bold opacity-70 hover:opacity-100">
                        ✕
                    </button>
                </div>
            ) : null}
            {error ? (
                <div
                    role="alert"
                    className="animate-fade-up mt-4 flex items-start justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300"
                >
                    <span>{error}</span>
                    <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="text-xs font-bold opacity-70 hover:opacity-100">
                        ✕
                    </button>
                </div>
            ) : null}

            <div className="mt-4">
                {tab === 'account' ? (
                    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
                        <form onSubmit={save} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
                            <div className="flex items-start gap-3">
                                <CardIcon name="user" />
                                <div>
                                    <h3 className="text-base font-bold text-fg">Account details</h3>
                                    <p className="mt-0.5 text-sm text-muted">How you sign in, and the timezone your Pages post in.</p>
                                </div>
                            </div>

                            <div className="mt-5 space-y-5">
                                <div>
                                    <FieldLabel>Full name</FieldLabel>
                                    <input
                                        value={name}
                                        onChange={(event) => setName(event.target.value)}
                                        autoComplete="name"
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
                                        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                                            <FieldLabel>Current password to change email</FieldLabel>
                                            <PasswordInput
                                                value={currentPassword}
                                                onChange={setCurrentPassword}
                                                autoComplete="current-password"
                                                placeholder="Confirm your password"
                                                className={fieldInputClass}
                                                wrapperClassName="mt-2"
                                                required
                                            />
                                            <p className="text-xs text-subtle mt-2">
                                                Required so a stolen session cannot change your sign-in email.
                                            </p>
                                        </div>
                                    ) : null}
                                </div>

                                <div>
                                    <FieldLabel>Timezone</FieldLabel>
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
                                    <p className="text-xs text-subtle mt-2">
                                        Every Page posts at its scheduled times in this timezone. Changing it
                                        reschedules all Pages.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                                <button type="submit" disabled={saving} className={primaryButtonClass}>
                                    {saving ? 'Saving...' : 'Save account'}
                                </button>
                                {name !== (user.name || '') || emailChanged || timezone !== (user.timezone || 'Asia/Kolkata') ? (
                                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Unsaved changes</span>
                                ) : null}
                            </div>
                        </form>

                        <PagesBrandSummary />
                    </div>
                ) : null}

                {tab === 'ai' ? (
                    <div className="space-y-6">
                        <AiModelsSection
                            onNotice={setNotice}
                            onError={setError}
                            keys={
                                credentialStatus
                                    ? {
                                          gemini: credentialStatus.gemini.configured,
                                          anthropic: Boolean(credentialStatus.anthropic?.configured),
                                      }
                                    : null
                            }
                        />
                        {credentialsLoading ? (
                            <div className="skeleton h-48 rounded-2xl" />
                        ) : (
                            <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
                                {provider === 'claude' ? [claudeCard, geminiCard] : [geminiCard, claudeCard]}
                            </div>
                        )}
                    </div>
                ) : null}

                {tab === 'integrations' ? (
                    credentialsLoading ? (
                        <div className="skeleton h-64 rounded-2xl" />
                    ) : (
                        <div className="space-y-6">
                            <CredentialCard
                                icon="meta"
                                title="Meta app"
                                description={
                                    <>
                                        Used for Facebook Login and Page connections. Create an app at{' '}
                                        <a
                                            href="https://developers.facebook.com/apps"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-indigo-700 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                                        >
                                            developers.facebook.com
                                        </a>
                                        .
                                    </>
                                }
                                configured={Boolean(credentialStatus?.meta.configured)}
                                onSubmit={saveMeta}
                                actions={
                                    <>
                                        <button type="submit" disabled={savingCredential === 'meta'} className={primaryButtonClass}>
                                            {savingCredential === 'meta' ? 'Saving...' : 'Save Meta app'}
                                        </button>
                                        {credentialStatus?.meta.configured ? (
                                            <button
                                                type="button"
                                                onClick={() => setRemoveTarget('meta')}
                                                disabled={savingCredential === 'meta'}
                                                className={removeButtonClass}
                                            >
                                                Remove
                                            </button>
                                        ) : null}
                                        <Link href="/connections" className={`${secondaryButtonClass} ml-auto self-center`}>
                                            Manage Page connections →
                                        </Link>
                                    </>
                                }
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                    <div>
                                        <FieldLabel>Meta App ID</FieldLabel>
                                        <input
                                            value={metaAppId}
                                            onChange={(event) => setMetaAppId(event.target.value)}
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
                                                    ? metaAppSecret || revealed?.meta?.appSecret || ''
                                                    : metaAppSecret
                                            }
                                            onChange={setMetaAppSecret}
                                            show={showMetaSecret}
                                            onToggle={() => openSecretEye('meta', metaAppSecret)}
                                            placeholder={
                                                !credentialStatus?.meta.configured
                                                    ? 'Paste your app secret'
                                                    : credentialStatus.meta.appId === metaAppId.trim()
                                                      ? 'Saved — leave blank to keep it'
                                                      : 'Enter the new app secret'
                                            }
                                        />
                                    </div>
                                </div>

                                <div className="mt-5">
                                    <FieldLabel>OAuth callback URL</FieldLabel>
                                    <div className="mt-2 flex flex-col sm:flex-row gap-2">
                                        <div className="flex-1 bg-surface-2 border border-line rounded-xl px-4 py-3 text-xs text-fg-2 break-all font-mono">
                                            {credentialStatus?.meta.redirectUri || 'Set META_REDIRECT_URI on the backend'}
                                        </div>
                                        <button type="button" onClick={copyCallbackUrl} className={secondaryButtonClass}>
                                            Copy
                                        </button>
                                    </div>
                                    <p className="text-xs text-subtle mt-2">
                                        Add this exact URL under Facebook Login → Settings → Valid OAuth Redirect URIs in
                                        your Meta app.
                                    </p>
                                </div>

                                <details className="group mt-5 rounded-xl border border-line bg-surface-2 px-4 py-3">
                                    <summary className="cursor-pointer list-none text-xs font-bold text-fg-2">
                                        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden="true">
                                            ›
                                        </span>{' '}
                                        Permissions your Meta app needs ({credentialStatus?.meta.scopes.length ?? 0})
                                    </summary>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {(credentialStatus?.meta.scopes || []).map((scope) => (
                                            <span
                                                key={scope}
                                                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] font-mono text-muted"
                                            >
                                                {scope}
                                            </span>
                                        ))}
                                    </div>
                                </details>

                                {credentialStatus?.meta.configured &&
                                (!credentialStatus.meta.scopes.includes('read_insights') ||
                                    !credentialStatus.meta.scopes.includes('instagram_manage_insights')) ? (
                                    <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                                        Add <code>read_insights</code> and <code>instagram_manage_insights</code> to your
                                        Meta app and reconnect your Pages to enable analytics.
                                    </div>
                                ) : null}

                                {credentialStatus?.meta.needsReauthCount ? (
                                    <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                                        {credentialStatus.meta.needsReauthCount} Page
                                        {credentialStatus.meta.needsReauthCount === 1 ? ' needs' : 's need'} reconnecting
                                        because the Meta app credentials changed.
                                    </div>
                                ) : null}
                            </CredentialCard>

                            <CredentialCard
                                icon="cloud"
                                title="Cloudinary"
                                description="Stores the images and reels you upload and the images AI creates."
                                configured={Boolean(credentialStatus?.cloudinary.configured)}
                                onSubmit={saveCloudinary}
                                actions={
                                    <>
                                        <button type="submit" disabled={savingCredential === 'cloudinary'} className={primaryButtonClass}>
                                            {savingCredential === 'cloudinary' ? 'Saving...' : 'Save Cloudinary'}
                                        </button>
                                        {credentialStatus?.cloudinary.configured ? (
                                            <button
                                                type="button"
                                                onClick={() => setRemoveTarget('cloudinary')}
                                                disabled={savingCredential === 'cloudinary'}
                                                className={removeButtonClass}
                                            >
                                                Remove
                                            </button>
                                        ) : null}
                                        <Link href="/storage" className={`${secondaryButtonClass} ml-auto self-center`}>
                                            Open Storage →
                                        </Link>
                                    </>
                                }
                            >
                                <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                                    <div>
                                        <FieldLabel>Cloud name</FieldLabel>
                                        <input
                                            value={cloudName}
                                            onChange={(event) => setCloudName(event.target.value)}
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
                                                    ? cloudApiKey || revealed?.cloudinary?.apiKey || ''
                                                    : cloudApiKey
                                            }
                                            onChange={setCloudApiKey}
                                            show={showCloudApiKey}
                                            onToggle={() => openSecretEye('cloudinaryKey', cloudApiKey)}
                                            placeholder={
                                                !credentialStatus?.cloudinary.configured
                                                    ? 'Cloudinary API key'
                                                    : credentialStatus.cloudinary.cloudName === cloudName.trim()
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
                                                    ? cloudApiSecret || revealed?.cloudinary?.apiSecret || ''
                                                    : cloudApiSecret
                                            }
                                            onChange={setCloudApiSecret}
                                            show={showCloudApiSecret}
                                            onToggle={() => openSecretEye('cloudinarySecret', cloudApiSecret)}
                                            placeholder={
                                                !credentialStatus?.cloudinary.configured
                                                    ? 'Cloudinary API secret'
                                                    : credentialStatus.cloudinary.cloudName === cloudName.trim()
                                                      ? 'Saved — leave blank to keep it'
                                                      : 'Enter the new cloud API secret'
                                            }
                                        />
                                    </div>
                                </div>
                            </CredentialCard>
                        </div>
                    )
                ) : null}

                {tab === 'security' ? (
                    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                        <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
                            <div className="flex items-start gap-3">
                                <CardIcon name="lock" />
                                <div>
                                    <h3 className="text-base font-bold text-fg">Password</h3>
                                    <p className="mt-0.5 text-sm text-muted">
                                        Every other signed-in session is logged out when you change it; this one stays
                                        active.
                                    </p>
                                </div>
                            </div>
                            <div className="mt-5">
                                <PasswordChangeForm
                                    onSuccess={(data) => {
                                        updateSession(data.token, data.user);
                                        lockSecrets();
                                        setError('');
                                        setNotice('Password updated. Other sessions were signed out.');
                                    }}
                                />
                            </div>
                        </section>

                        <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
                            <h3 className="text-base font-bold text-fg">Saved secrets</h3>
                            <p className="mt-0.5 text-sm text-muted">
                                Your Meta app secret, Cloudinary keys, and AI keys are encrypted at rest and used only for
                                your account. To see one, press its eye icon and confirm your password.
                            </p>
                            <div
                                className={`mt-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
                                    revealed
                                        ? 'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                                        : 'border-line bg-surface-2 text-fg-2'
                                }`}
                            >
                                <span className="font-semibold">
                                    {revealed ? 'Secrets are unlocked on this page.' : 'Secrets are locked.'}
                                </span>
                                {revealed ? (
                                    <button type="button" onClick={lockSecrets} className={secondaryButtonClass}>
                                        Lock now
                                    </button>
                                ) : null}
                            </div>
                            <dl className="mt-4 divide-y divide-line text-xs">
                                {[
                                    { label: 'Meta app secret', saved: Boolean(credentialStatus?.meta.appSecretConfigured) },
                                    {
                                        label: 'Cloudinary keys',
                                        saved: Boolean(
                                            credentialStatus?.cloudinary.apiKeyConfigured &&
                                                credentialStatus.cloudinary.apiSecretConfigured
                                        ),
                                    },
                                    { label: 'Gemini key', saved: Boolean(credentialStatus?.gemini.configured) },
                                    { label: 'Anthropic key', saved: Boolean(credentialStatus?.anthropic?.configured) },
                                ].map((item) => (
                                    <div key={item.label} className="flex items-center justify-between py-2.5">
                                        <dt className="text-fg-2">{item.label}</dt>
                                        <dd
                                            className={
                                                item.saved
                                                    ? 'font-semibold text-emerald-700 dark:text-emerald-300'
                                                    : 'text-subtle'
                                            }
                                        >
                                            {credentialsLoading ? '…' : item.saved ? 'Saved' : 'Not saved'}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    </div>
                ) : null}
            </div>

            <PasswordPromptModal
                isOpen={revealOpen}
                title="Reveal saved credentials"
                description="Enter your current password to unlock your saved Meta, Cloudinary, Gemini, and Anthropic secrets for this page."
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
                message={removeTarget ? REMOVE_MESSAGES[removeTarget] : 'Remove these credentials?'}
                confirmText="Remove"
                type="danger"
            />
        </AppShell>
    );
}
