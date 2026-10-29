'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { aiApi, authApi } from '@/lib/apiClient';
import type { AiModels, GeminiModelList, GeminiModelOption } from '@/lib/types';

interface AiModelsSectionProps {
    onNotice: (message: string) => void;
    onError: (message: string) => void;
}

const CUSTOM = '__custom__';

interface PickerProps {
    label: string;
    hint: string;
    value: string;
    defaultModel: string;
    options: GeminiModelOption[];
    onChange: (value: string) => void;
}

function ModelPicker({ label, hint, value, defaultModel, options, onChange }: PickerProps) {
    const listed = value === '' || options.some((option) => option.id === value);
    const [custom, setCustom] = useState(!listed);
    const showCustom = custom || !listed;

    return (
        <div>
            <label className="text-xs font-bold uppercase tracking-widest text-subtle">
                {label}
            </label>
            <select
                value={showCustom ? CUSTOM : value}
                onChange={(event) => {
                    if (event.target.value === CUSTOM) {
                        setCustom(true);
                        return;
                    }
                    setCustom(false);
                    onChange(event.target.value);
                }}
                className="mt-2 w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            >
                <option value="">Default ({defaultModel || 'deployment setting'})</option>
                {options.map((option) => (
                    <option key={option.id} value={option.id}>
                        {option.name === option.id ? option.id : `${option.name} — ${option.id}`}
                    </option>
                ))}
                <option value={CUSTOM}>Other model ID…</option>
            </select>
            {showCustom ? (
                <input
                    value={value}
                    onChange={(event) => onChange(event.target.value.trim())}
                    placeholder="e.g. gemini-2.5-flash"
                    maxLength={80}
                    className="mt-2 w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3 text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
            ) : null}
            <p className="text-xs text-subtle mt-2">{hint}</p>
        </div>
    );
}

export function AiModelsSection({ onNotice, onError }: AiModelsSectionProps) {
    const { user, updateUser } = useAuth();
    const [models, setModels] = useState<AiModels>({
        text: user?.aiModels?.text || '',
        image: user?.aiModels?.image || '',
    });
    const [list, setList] = useState<GeminiModelList | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            const data = await aiApi.models();
            setList({ defaults: data.defaults, text: data.text, image: data.image });
        } catch (err: any) {
            setLoadError(typeof err === 'string' ? err : 'Could not load Gemini models');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Initial data load; state updates happen after the request resolves.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    const save = async () => {
        setSaving(true);
        try {
            const data: any = await authApi.updateProfile({ aiModels: models });
            if (data.success) {
                updateUser(data.user);
                setModels({
                    text: data.user.aiModels?.text || '',
                    image: data.user.aiModels?.image || '',
                });
                onNotice('AI models saved.');
            }
        } catch (err: any) {
            onError(typeof err === 'string' ? err : 'Could not save AI models');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="mt-6 rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-fg">AI models</h2>
                    <p className="mt-1 text-sm text-muted">
                        Choose which Gemini model handles each AI feature. The list
                        shows the models your own Gemini key can use.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading}
                    className="self-start px-4 py-2.5 rounded-xl text-xs font-bold border border-line-strong bg-hover text-fg hover:bg-hover-strong disabled:opacity-50 transition-all"
                >
                    {loading ? 'Loading...' : 'Refresh list'}
                </button>
            </div>

            {loadError ? (
                <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                    {loadError} You can still type a model ID with “Other model ID…”.
                </div>
            ) : null}

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <ModelPicker
                    key={`text-${list ? 'loaded' : 'empty'}`}
                    label="Captions and image text"
                    hint="Writes post captions and the bold line on images."
                    value={models.text}
                    defaultModel={list?.defaults.text || ''}
                    options={list?.text || []}
                    onChange={(text) => setModels((current) => ({ ...current, text }))}
                />
                <ModelPicker
                    key={`image-${list ? 'loaded' : 'empty'}`}
                    label="Image generation"
                    hint="Makes AI images. Google has no free tier for image models, so your key's project needs billing turned on."
                    value={models.image}
                    defaultModel={list?.defaults.image || ''}
                    options={list?.image || []}
                    onChange={(image) => setModels((current) => ({ ...current, image }))}
                />
            </div>

            <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="mt-6 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-3 rounded-xl text-sm font-bold transition-all"
            >
                {saving ? 'Saving...' : 'Save AI models'}
            </button>
        </section>
    );
}
