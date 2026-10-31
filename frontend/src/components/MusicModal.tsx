'use client';

import React, { useEffect, useState } from 'react';
import { MusicPicker } from '@/components/MusicPicker';
import { postsApi } from '@/lib/apiClient';
import {
    NO_MUSIC,
    PHOTO_REEL_SECONDS,
    hasMusic,
    musicFromPost,
    musicInput,
    musicProblem,
    type MusicChoice,
} from '@/lib/music';
import { isReel, type Post } from '@/lib/types';

interface MusicModalProps {
    /** The post whose music is being changed; null closes the dialog. */
    post: Post | null;
    onClose: () => void;
    onSaved: (post: Post) => void;
}

/** Changes, adjusts, or removes a queued post's music without leaving the Queue. */
export function MusicModal({ post, onClose, onSaved }: MusicModalProps) {
    // Keyed by post, so the form starts from each post's own music.
    return post ? <MusicDialog key={post._id} post={post} onClose={onClose} onSaved={onSaved} /> : null;
}

function MusicDialog({ post, onClose, onSaved }: MusicModalProps & { post: Post }) {
    const [choice, setChoice] = useState<MusicChoice>(() => musicFromPost(post));
    const [photoSeconds, setPhotoSeconds] = useState<number>(() =>
        post.photo ? Math.round(post.mediaDuration ?? 0) : PHOTO_REEL_SECONDS.default
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !saving) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [saving, onClose]);

    // A photo reel is still an image post to the user.
    const isImage = !isReel(post) || Boolean(post.photo);
    const problem = musicProblem(choice);
    const unchanged = !hasMusic(choice) && !hasMusic(musicFromPost(post));
    const makesReel = isImage && hasMusic(choice);

    const save = async () => {
        setSaving(true);
        setError('');
        try {
            const data = await postsApi.update(post._id, {
                music: musicInput(choice),
                ...(makesReel ? { photoSeconds } : {}),
            });
            onSaved((data as { post: Post }).post);
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Could not save the music');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-sm" onClick={saving ? undefined : onClose} />
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Music"
                className="relative flex max-h-[90vh] w-full max-w-lg animate-pop-in flex-col rounded-3xl border border-line-strong bg-surface shadow-2xl"
            >
                <div className="border-b border-line px-6 py-4">
                    <h2 className="text-lg font-bold text-fg">Music</h2>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">{post.caption}</p>
                </div>
                <div className="overflow-y-auto px-6 py-4">
                    <MusicPicker
                        value={choice}
                        onChange={setChoice}
                        isImage={isImage}
                        photoSeconds={photoSeconds}
                        onPhotoSecondsChange={setPhotoSeconds}
                    />
                    {error ? (
                        <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                            {error}
                        </p>
                    ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4">
                    <button
                        type="button"
                        onClick={() => setChoice(NO_MUSIC)}
                        disabled={saving || !hasMusic(choice)}
                        className="rounded-xl px-3 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-500/10 disabled:opacity-40 dark:text-rose-300"
                    >
                        Remove music
                    </button>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className="rounded-xl border border-line-strong bg-hover px-4 py-2.5 text-xs font-bold text-fg hover:bg-hover-strong"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => void save()}
                            disabled={saving || Boolean(problem) || unchanged}
                            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                        >
                            {saving ? (makesReel ? 'Making the reel…' : 'Saving…') : 'Save music'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
