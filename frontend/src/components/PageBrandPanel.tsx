'use client';

import React, { useState } from 'react';
import { BrandLogoSection } from '@/components/BrandLogoSection';
import { connectionsApi } from '@/lib/apiClient';
import type { BrandProfile, SocialConnection } from '@/lib/types';

const FIELDS: Array<{
    key: keyof BrandProfile;
    label: string;
    placeholder: string;
    hint: string;
}> = [
    { key: 'niche', label: 'Niche', placeholder: 'e.g. Science & Tech, Street food', hint: 'What the Page is about.' },
    { key: 'tone', label: 'Tone', placeholder: 'e.g. friendly and witty', hint: 'How captions should sound.' },
    { key: 'audience', label: 'Audience', placeholder: 'e.g. students and young professionals', hint: 'Who the posts are for.' },
    { key: 'keywords', label: 'Keywords', placeholder: 'e.g. gadgets, AI, reviews', hint: 'Comma separated; also used for hashtags.' },
];

/**
 * One Page's branding: its logo frame and the brand voice every AI feature
 * uses for its posts.
 */
export function PageBrandPanel({
    connection,
    onChange,
}: {
    connection: SocialConnection;
    /** The updated Page, so the card and list show the new logo and voice. */
    onChange: (connection: SocialConnection) => void;
}) {
    const [profile, setProfile] = useState<BrandProfile>({
        niche: connection.brandProfile?.niche ?? '',
        tone: connection.brandProfile?.tone ?? '',
        audience: connection.brandProfile?.audience ?? '',
        keywords: connection.brandProfile?.keywords ?? '',
    });
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    // Shown beside the Save button, which sits below the logo section.
    const [voiceStatus, setVoiceStatus] = useState<{ ok: boolean; text: string } | null>(null);

    const saveProfile = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setVoiceStatus(null);
        try {
            const data = (await connectionsApi.update(connection._id, { brandProfile: profile })) as {
                success: boolean;
                connection: SocialConnection;
            };
            if (data.success) {
                onChange(data.connection);
                setVoiceStatus({ ok: true, text: `Saved. AI for ${connection.pageName} now uses this voice.` });
            }
        } catch (err) {
            setVoiceStatus({ ok: false, text: typeof err === 'string' ? err : 'Could not save the brand voice' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {notice ? (
                <div className="animate-fade-up rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300">
                    {notice}
                </div>
            ) : null}
            {error ? (
                <div className="animate-fade-up rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            ) : null}

            <BrandLogoSection
                connectionId={connection._id}
                pageName={connection.pageName}
                onNotice={setNotice}
                onError={setError}
                onLogoChange={(hasLogo, thumb) =>
                    onChange({ ...connection, hasBrandLogo: hasLogo, logoThumb: thumb })
                }
            />

            <form onSubmit={saveProfile} className="border-t border-line pt-6">
                <h4 className="text-sm font-bold text-fg">Brand voice</h4>
                <p className="mt-1 text-xs text-muted">
                    AI captions, text on images, and AI analysis for {connection.pageName} follow this.
                </p>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {FIELDS.map((field) => (
                        <label key={field.key} className="block">
                            <span className="text-[11px] font-bold uppercase tracking-widest text-subtle">
                                {field.label}
                            </span>
                            <input
                                value={profile[field.key] ?? ''}
                                onChange={(event) =>
                                    setProfile((current) => ({ ...current, [field.key]: event.target.value }))
                                }
                                placeholder={field.placeholder}
                                maxLength={field.key === 'keywords' ? 500 : 200}
                                className="mt-1.5 w-full rounded-xl border border-line-strong bg-surface-2 px-4 py-2.5 text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            />
                            <span className="mt-1 block text-[11px] text-subtle">{field.hint}</span>
                        </label>
                    ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                    {voiceStatus ? (
                        <span
                            role="status"
                            className={`animate-fade-up text-xs font-semibold ${
                                voiceStatus.ok
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : 'text-rose-700 dark:text-rose-300'
                            }`}
                        >
                            {voiceStatus.text}
                        </span>
                    ) : null}
                    <button
                        type="submit"
                        disabled={saving}
                        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white transition-all hover:bg-indigo-500 disabled:opacity-60"
                    >
                        {saving ? 'Saving...' : 'Save brand voice'}
                    </button>
                </div>
            </form>
        </div>
    );
}

/** The Page's logo as its avatar, or its initial when it has none. */
export function PageAvatar({
    connection,
    size = 'md',
}: {
    connection: Pick<SocialConnection, 'pageName' | 'logoThumb'>;
    size?: 'sm' | 'md';
}) {
    const box = size === 'sm' ? 'h-7 w-7 rounded-lg text-xs' : 'h-12 w-12 rounded-2xl text-lg';
    return connection.logoThumb ? (
        <span className={`flex shrink-0 items-center justify-center overflow-hidden border border-line bg-white ${box}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={connection.logoThumb} alt="" className="h-full w-full object-contain p-0.5" />
        </span>
    ) : (
        <span
            className={`flex shrink-0 items-center justify-center border border-indigo-500/20 bg-indigo-500/15 font-bold text-indigo-700 dark:text-indigo-300 ${box}`}
        >
            {connection.pageName[0]?.toUpperCase() || 'P'}
        </span>
    );
}
