'use client';

import React, { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/lib/apiClient';
import {
    getInitialTimezoneOptions,
    getTimezoneOptions,
} from '@/lib/timezones';

export default function SettingsPage() {
    const { user, updateUser } = useAuth();
    const [name, setName] = useState('');
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

    useEffect(() => {
        if (!user) return;
        setName(user.name || '');
        setTimezone(user.timezone || 'Asia/Kolkata');
        setNiche(user.brandProfile?.niche || '');
        setTone(user.brandProfile?.tone || '');
        setAudience(user.brandProfile?.audience || '');
        setKeywords(user.brandProfile?.keywords || '');
    }, [user]);

    useEffect(() => {
        setTimezones(getTimezoneOptions(timezone));
    }, [timezone]);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        setNotice('');

        try {
            const data: any = await authApi.updateProfile({
                name,
                timezone,
                brandProfile: { niche, tone, audience, keywords },
            });
            if (data.success) {
                updateUser(data.user);
                setNotice('Settings saved.');
            }
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not save settings');
        } finally {
            setSaving(false);
        }
    };

    if (!user) return null;

    return (
        <AppShell
            title="Settings"
            subtitle="Your profile, timezone, and the brand context used by AI assist."
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

            <form onSubmit={save} className="grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-6 items-start">
                <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
                    <h2 className="text-lg font-bold text-white mb-6">Account</h2>

                    <div className="space-y-5">
                        <div>
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Full name
                            </label>
                            <input
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Email
                            </label>
                            <div className="mt-2 w-full bg-slate-950/40 border border-white/5 rounded-xl px-4 py-3.5 text-sm text-slate-400">
                                {user.email}
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Default timezone
                            </label>
                            <select
                                value={timezone}
                                onChange={(event) => setTimezone(event.target.value)}
                                className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
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

                    <div className="mt-8 pt-6 border-t border-white/5 text-xs text-slate-500">
                        Role: <span className="capitalize text-slate-300">{user.role}</span>
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
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Niche
                            </label>
                            <input
                                value={niche}
                                onChange={(event) => setNiche(event.target.value)}
                                placeholder="e.g. sustainable fashion, local bakery, fitness coaching"
                                className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Tone
                            </label>
                            <input
                                value={tone}
                                onChange={(event) => setTone(event.target.value)}
                                placeholder="e.g. warm, bold, playful, professional"
                                className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Audience
                            </label>
                            <input
                                value={audience}
                                onChange={(event) => setAudience(event.target.value)}
                                placeholder="Who are you talking to?"
                                className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Keywords
                            </label>
                            <input
                                value={keywords}
                                onChange={(event) => setKeywords(event.target.value)}
                                placeholder="Words or phrases to include naturally"
                                className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={saving}
                        className="mt-7 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-6 py-3 rounded-xl text-sm font-bold transition-all"
                    >
                        {saving ? 'Saving...' : 'Save settings'}
                    </button>
                </section>
            </form>
        </AppShell>
    );
}
