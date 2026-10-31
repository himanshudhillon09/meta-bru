'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { aiApi, authApi } from '@/lib/apiClient';
import type {
    AiModels,
    AiProvider,
    ClaudeModelList,
    GeminiModelList,
    GeminiModelOption,
} from '@/lib/types';

interface AiModelsSectionProps {
    onNotice: (message: string) => void;
    onError: (message: string) => void;
    /** Which API keys are saved, from the credentials below; null while loading. */
    keys: { gemini: boolean; anthropic: boolean } | null;
}

const CUSTOM = '__custom__';

interface PickerProps {
    label: string;
    hint: string;
    value: string;
    defaultModel: string;
    options: GeminiModelOption[];
    placeholder: string;
    onChange: (value: string) => void;
}

function ModelPicker({ label, hint, value, defaultModel, options, placeholder, onChange }: PickerProps) {
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
                    placeholder={placeholder}
                    maxLength={80}
                    className="mt-2 w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3 text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
            ) : null}
            <p className="text-xs text-subtle mt-2">{hint}</p>
        </div>
    );
}

const PROVIDERS: Array<{ id: AiProvider; name: string; detail: string }> = [
    { id: 'gemini', name: 'Gemini', detail: 'Google · your Gemini key' },
    { id: 'claude', name: 'Claude', detail: 'Anthropic · your Claude key' },
];

export function AiModelsSection({ onNotice, onError, keys }: AiModelsSectionProps) {
    const { user, updateUser } = useAuth();
    const provider: AiProvider = user?.aiProvider === 'claude' ? 'claude' : 'gemini';
    const [models, setModels] = useState<AiModels>({
        text: user?.aiModels?.text || '',
        image: user?.aiModels?.image || '',
        claude: user?.aiModels?.claude || '',
    });
    const [list, setList] = useState<GeminiModelList | null>(null);
    const [claudeList, setClaudeList] = useState<ClaudeModelList | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [claudeError, setClaudeError] = useState('');
    const [saving, setSaving] = useState(false);
    const [switching, setSwitching] = useState(false);

    const load = useCallback(async (which: AiProvider) => {
        setLoading(true);
        setLoadError('');
        setClaudeError('');
        const gemini = aiApi
            .models()
            .then((data) => setList({ defaults: data.defaults, text: data.text, image: data.image }))
            .catch((err) => setLoadError(typeof err === 'string' ? err : 'Could not load Gemini models'));
        // Claude's list needs the Claude key, so it loads only when Claude is chosen.
        const claude =
            which === 'claude'
                ? aiApi
                      .claudeModels()
                      .then((data) => setClaudeList({ default: data.default, models: data.models }))
                      .catch((err) =>
                          setClaudeError(typeof err === 'string' ? err : 'Could not load Claude models')
                      )
                : Promise.resolve();
        await Promise.all([gemini, claude]);
        setLoading(false);
    }, []);

    // Saving or removing a key below changes which lists can load.
    const keyState = keys ? `${keys.gemini}-${keys.anthropic}` : '';
    useEffect(() => {
        // Initial data load; state updates happen after the request resolves.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load(provider);
    }, [load, provider, keyState]);

    const choose = async (next: AiProvider) => {
        if (next === provider || switching) return;
        setSwitching(true);
        try {
            const data: any = await authApi.updateProfile({ aiProvider: next });
            if (data.success) {
                updateUser(data.user);
                onNotice(
                    next === 'claude'
                        ? 'Claude now writes captions, image text, image prompts, and Analytics tips. Gemini still draws AI images.'
                        : 'Gemini now handles every AI feature.'
                );
            }
        } catch (err: any) {
            onError(typeof err === 'string' ? err : 'Could not switch the AI provider');
        } finally {
            setSwitching(false);
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            const data: any = await authApi.updateProfile({ aiModels: models });
            if (data.success) {
                updateUser(data.user);
                setModels({
                    text: data.user.aiModels?.text || '',
                    image: data.user.aiModels?.image || '',
                    claude: data.user.aiModels?.claude || '',
                });
                onNotice('AI models saved.');
            }
        } catch (err: any) {
            onError(typeof err === 'string' ? err : 'Could not save AI models');
        } finally {
            setSaving(false);
        }
    };

    const missingKey =
        keys === null ? false : provider === 'claude' ? !keys.anthropic : !keys.gemini;

    return (
        <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-fg">AI provider and models</h2>
                    <p className="mt-1 text-sm text-muted">
                        Choose which AI writes captions, the bold text on images, image
                        prompts, and Analytics tips. Claude can&apos;t draw pictures, so
                        Gemini always draws AI images.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void load(provider)}
                    disabled={loading}
                    className="self-start whitespace-nowrap px-4 py-2.5 rounded-xl text-xs font-bold border border-line-strong bg-hover text-fg hover:bg-hover-strong disabled:opacity-50 transition-all"
                >
                    {loading ? 'Loading...' : 'Refresh list'}
                </button>
            </div>

            <div
                role="radiogroup"
                aria-label="AI provider"
                className="mt-6 grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface-2 p-1.5 sm:max-w-md"
            >
                {PROVIDERS.map((option) => {
                    const selected = option.id === provider;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => void choose(option.id)}
                            disabled={switching}
                            className={`rounded-xl px-4 py-2.5 text-left transition-all disabled:opacity-60 ${
                                selected
                                    ? 'bg-indigo-600 text-white shadow-card'
                                    : 'text-fg hover:bg-hover'
                            }`}
                        >
                            <span className="block text-sm font-bold">{option.name}</span>
                            <span
                                className={`block text-[11px] ${
                                    selected ? 'text-indigo-100' : 'text-subtle'
                                }`}
                            >
                                {option.detail}
                            </span>
                        </button>
                    );
                })}
            </div>

            {missingKey ? (
                <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                    {provider === 'claude'
                        ? 'Add your Anthropic API key below to use Claude.'
                        : 'Add your Gemini API key below to use Gemini.'}
                </div>
            ) : null}
            {provider === 'claude' && keys !== null && !keys.gemini ? (
                <div className="mt-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
                    AI images still need a Gemini key: Claude writes the art direction and
                    Gemini draws it.
                </div>
            ) : null}

            {/* A missing key is already explained above; skip the list error it causes. */}
            {loadError && keys?.gemini !== false ? (
                <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                    {loadError} You can still type a model ID with “Other model ID…”.
                </div>
            ) : null}
            {provider === 'claude' && claudeError && keys?.anthropic !== false ? (
                <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                    {claudeError} You can still type a model ID with “Other model ID…”.
                </div>
            ) : null}

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                {provider === 'claude' ? (
                    <ModelPicker
                        key={`claude-${claudeList ? 'loaded' : 'empty'}`}
                        label="Claude model"
                        hint="Writes captions, the bold line on images, image prompts, and Analytics tips. It reads your uploaded or generated image too."
                        value={models.claude || ''}
                        defaultModel={claudeList?.default || 'claude-opus-5-5'}
                        options={claudeList?.models || []}
                        placeholder="e.g. claude-opus-5-5"
                        onChange={(claude) => setModels((current) => ({ ...current, claude }))}
                    />
                ) : (
                    <ModelPicker
                        key={`text-${list ? 'loaded' : 'empty'}`}
                        label="Captions and image text"
                        hint="Writes post captions and the bold line on images."
                        value={models.text}
                        defaultModel={list?.defaults.text || ''}
                        options={list?.text || []}
                        placeholder="e.g. gemini-2.5-flash"
                        onChange={(text) => setModels((current) => ({ ...current, text }))}
                    />
                )}
                <ModelPicker
                    key={`image-${list ? 'loaded' : 'empty'}`}
                    label="Image generation (Gemini)"
                    hint={
                        provider === 'claude'
                            ? "Draws the picture from Claude's art direction. Google has no free tier for image models, so your Gemini key's project needs billing turned on."
                            : "Makes AI images. Google has no free tier for image models, so your key's project needs billing turned on."
                    }
                    value={models.image}
                    defaultModel={list?.defaults.image || ''}
                    options={list?.image || []}
                    placeholder="e.g. gemini-2.5-flash-image"
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
