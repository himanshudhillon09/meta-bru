'use client';

import React, { useState } from 'react';
import { BrandLogoSection } from '@/components/BrandLogoSection';
import { connectionsApi } from '@/lib/apiClient';
import type { BrandProfile, SocialConnection } from '@/lib/types';

type FieldKey = keyof BrandProfile;

const FIELDS: Array<{
    key: FieldKey;
    label: string;
    placeholder: string;
    hint: string;
}> = [
    {
        key: 'niche',
        label: 'What the Page is about',
        placeholder: 'e.g. Street food in Delhi',
        hint: 'Be specific. It shapes captions, image ideas, and hashtags.',
    },
    {
        key: 'tone',
        label: 'How it sounds',
        placeholder: 'e.g. warm and witty',
        hint: 'Pick a style below or write your own.',
    },
    {
        key: 'audience',
        label: 'Who it is for',
        placeholder: 'e.g. college students in Mumbai',
        hint: 'A specific audience gets sharper captions than "everyone".',
    },
    {
        key: 'keywords',
        label: 'Keywords',
        placeholder: 'e.g. momos, street food, Delhi eats',
        hint: 'Comma separated. AI works them in and uses them for hashtags.',
    },
];

const TONES = ['Friendly', 'Witty', 'Bold', 'Premium', 'Informative', 'Desi Hinglish'];

const VAGUE_AUDIENCE = /^(all|everyone|everybody|anyone|general|public|people)$/i;

function emptyProfile(connection: SocialConnection): Required<BrandProfile> {
    return {
        niche: connection.brandProfile?.niche ?? '',
        tone: connection.brandProfile?.tone ?? '',
        audience: connection.brandProfile?.audience ?? '',
        keywords: connection.brandProfile?.keywords ?? '',
    };
}

function keywordList(value: string): string[] {
    return value
        .split(',')
        .map((keyword) => keyword.trim())
        .filter(Boolean);
}

/**
 * One Page's branding: the brand voice every AI feature writes in, and the
 * logo frame on its post images.
 */
export function PageBrandPanel({
    connection,
    onChange,
}: {
    connection: SocialConnection;
    /** The updated Page, so the card and list show the new logo and voice. */
    onChange: (connection: SocialConnection) => void;
}) {
    const [profile, setProfile] = useState<Required<BrandProfile>>(() => emptyProfile(connection));
    const [saved, setSaved] = useState<Required<BrandProfile>>(() => emptyProfile(connection));
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [voiceStatus, setVoiceStatus] = useState<{ ok: boolean; text: string } | null>(null);

    const dirty = FIELDS.some((field) => profile[field.key].trim() !== saved[field.key].trim());
    const filled = FIELDS.filter((field) => profile[field.key].trim()).length;
    const keywords = keywordList(profile.keywords);
    const vagueAudience = VAGUE_AUDIENCE.test(profile.audience.trim());
    const summary =
        profile.niche.trim() || profile.tone.trim() || profile.audience.trim()
            ? `${profile.tone.trim() ? `A ${profile.tone.trim().toLowerCase()} ` : 'A '}${
                  profile.niche.trim() ? `${profile.niche.trim()} ` : ''
              }Page${profile.audience.trim() ? ` for ${profile.audience.trim()}` : ''}.`
            : '';

    const set = (key: FieldKey, value: string) => {
        setProfile((current) => ({ ...current, [key]: value }));
        setVoiceStatus(null);
    };

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
                setSaved(profile);
                setVoiceStatus({ ok: true, text: `Saved. AI for ${connection.pageName} now writes in this voice.` });
            }
        } catch (err) {
            setVoiceStatus({ ok: false, text: typeof err === 'string' ? err : 'Could not save the brand voice' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-5">
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

            <form onSubmit={saveProfile} className="rounded-2xl border border-line bg-surface-2 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h4 className="text-sm font-bold text-fg">Brand voice</h4>
                        <p className="mt-0.5 text-xs text-muted">
                            AI captions, text on images, image prompts, and Analytics tips for{' '}
                            {connection.pageName} follow this.
                        </p>
                    </div>
                    <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
                            filled === FIELDS.length
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        }`}
                    >
                        {filled} of {FIELDS.length} set
                    </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
                    {FIELDS.map((field) => (
                        <div key={field.key}>
                            <label
                                htmlFor={`brand-${field.key}-${connection._id}`}
                                className="text-xs font-semibold text-fg-2"
                            >
                                {field.label}
                            </label>
                            <input
                                id={`brand-${field.key}-${connection._id}`}
                                value={profile[field.key]}
                                onChange={(event) => set(field.key, event.target.value)}
                                placeholder={field.placeholder}
                                maxLength={field.key === 'keywords' ? 500 : 200}
                                className="mt-1.5 w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            />
                            {field.key === 'tone' ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {TONES.map((tone) => {
                                        const active = profile.tone.trim().toLowerCase() === tone.toLowerCase();
                                        return (
                                            <button
                                                key={tone}
                                                type="button"
                                                onClick={() => set('tone', tone)}
                                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                                    active
                                                        ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                                                        : 'border-line-strong text-muted hover:bg-hover hover:text-fg'
                                                }`}
                                            >
                                                {tone}
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : null}
                            {field.key === 'keywords' && keywords.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {keywords.slice(0, 12).map((keyword) => (
                                        <span
                                            key={keyword}
                                            className="rounded-full bg-sunken px-2.5 py-1 text-[11px] font-semibold text-fg-2"
                                        >
                                            {keyword}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            {field.key === 'audience' && vagueAudience ? (
                                <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                                    &ldquo;{profile.audience.trim()}&rdquo; is very broad. Name who you most want to
                                    reach, like &ldquo;foodies in Delhi aged 18–30&rdquo;.
                                </p>
                            ) : (
                                <p className="mt-1.5 text-[11px] text-subtle">{field.hint}</p>
                            )}
                        </div>
                    ))}
                </div>

                {summary ? (
                    <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 text-xs text-fg-2">
                        <span className="font-bold text-indigo-700 dark:text-indigo-300">How AI sees this Page: </span>
                        {summary}
                        {keywords.length > 0 ? ` It mentions ${keywords.slice(0, 3).join(', ')} where they fit.` : ''}
                    </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                    {voiceStatus ? (
                        <span
                            role="status"
                            className={`animate-fade-up mr-auto text-xs font-semibold ${
                                voiceStatus.ok
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : 'text-rose-700 dark:text-rose-300'
                            }`}
                        >
                            {voiceStatus.ok ? '✓ ' : ''}
                            {voiceStatus.text}
                        </span>
                    ) : dirty ? (
                        <span className="mr-auto text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                            Unsaved changes
                        </span>
                    ) : null}
                    {dirty ? (
                        <button
                            type="button"
                            onClick={() => {
                                setProfile(saved);
                                setVoiceStatus(null);
                            }}
                            disabled={saving}
                            className="rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-xs font-bold text-fg hover:bg-hover disabled:opacity-50"
                        >
                            Discard
                        </button>
                    ) : null}
                    <button
                        type="submit"
                        disabled={saving || !dirty}
                        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white transition-all hover:bg-indigo-500 disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save brand voice'}
                    </button>
                </div>
            </form>

            <BrandLogoSection
                connectionId={connection._id}
                pageName={connection.pageName}
                hasLogo={Boolean(connection.hasBrandLogo)}
                logoThumb={connection.logoThumb || ''}
                onNotice={setNotice}
                onError={setError}
                onLogoChange={(hasLogo, thumb) =>
                    onChange({ ...connection, hasBrandLogo: hasLogo, logoThumb: thumb })
                }
            />
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
