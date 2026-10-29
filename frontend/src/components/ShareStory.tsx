'use client';

import React, { useState } from 'react';
import { StoryShareModal } from '@/components/StoryShareModal';
import { postsApi } from '@/lib/apiClient';
import {
    publishedPlatforms,
    unsharedStoryPlatforms,
    type Platform,
    type Post,
    type StoryShareSubject,
} from '@/lib/types';

export interface StoryShareOutcome {
    tone: 'success' | 'error';
    message: string;
}

/**
 * Share-to-Story flow for any list of published posts: pick platforms in the
 * modal, share, then hand the updated post back to the page.
 */
export function useStoryShare(onShared: (post: Post) => void) {
    const [subject, setSubject] = useState<StoryShareSubject | null>(null);
    const [selection, setSelection] = useState<Platform[]>([]);
    const [sharingId, setSharingId] = useState('');
    const [outcome, setOutcome] = useState<StoryShareOutcome | null>(null);

    const open = (post: StoryShareSubject) => {
        setOutcome(null);
        setSelection(unsharedStoryPlatforms(post));
        setSubject(post);
    };

    const share = async (post: StoryShareSubject, platforms: Platform[]) => {
        if (platforms.length === 0) return;
        setSharingId(post._id);
        setOutcome(null);
        try {
            const data = await postsApi.shareStory(post._id, platforms);
            onShared(data.post);
            const failed = (data.post.storyTargets ?? []).filter(
                (target) => platforms.includes(target.platform) && target.status === 'failed'
            );
            setOutcome(
                failed.length > 0
                    ? {
                          tone: 'error',
                          message: failed
                              .map((target) => `${target.platform} Story: ${target.error}`)
                              .join(' | '),
                      }
                    : { tone: 'success', message: 'Shared to Story.' }
            );
        } catch (err) {
            setOutcome({
                tone: 'error',
                message: typeof err === 'string' ? err : 'Could not share to Story',
            });
        } finally {
            setSharingId('');
        }
    };

    const modal = (
        <StoryShareModal
            post={subject}
            selected={selection}
            onToggle={(platform) =>
                setSelection((current) =>
                    current.includes(platform)
                        ? current.filter((item) => item !== platform)
                        : [...current, platform]
                )
            }
            onClose={() => setSubject(null)}
            onConfirm={() => {
                if (subject) void share(subject, selection);
            }}
        />
    );

    return { open, modal, sharingId, outcome, clearOutcome: () => setOutcome(null) };
}

/** A small banner for the result of the last share. */
export function StoryShareNotice({
    outcome,
    onDismiss,
}: {
    outcome: StoryShareOutcome | null;
    onDismiss: () => void;
}) {
    if (!outcome) return null;
    return (
        <div
            className={`animate-fade-up mb-6 flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
                outcome.tone === 'success'
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300'
            }`}
        >
            <span>{outcome.message}</span>
            <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss"
                className="shrink-0 rounded-lg px-1.5 text-current opacity-70 hover:opacity-100"
            >
                ✕
            </button>
        </div>
    );
}

/**
 * "Share to Story" for a published post. Hidden until something published;
 * shows "Shared to Story" once every published platform has its Story.
 */
export function ShareStoryButton({
    post,
    onOpen,
    sharing,
    disabled = false,
    size = 'md',
}: {
    post: StoryShareSubject;
    onOpen: (post: StoryShareSubject) => void;
    sharing: boolean;
    disabled?: boolean;
    size?: 'sm' | 'md';
}) {
    if (publishedPlatforms(post).length === 0) return null;
    const left = unsharedStoryPlatforms(post).length;
    const done = left === 0;

    return (
        <button
            type="button"
            onClick={() => onOpen(post)}
            disabled={disabled || sharing || done}
            title={done ? 'Already shared to Story on every published platform.' : undefined}
            className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border font-bold transition-all disabled:cursor-not-allowed ${
                size === 'sm' ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2.5 text-xs'
            } ${
                done
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/25 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-200'
            }`}
        >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
                {done ? (
                    <path d="m5 12 4.5 4.5L19 7" />
                ) : (
                    <>
                        <circle cx="12" cy="12" r="9" strokeDasharray="4 3" />
                        <path d="M12 8v8M8 12h8" />
                    </>
                )}
            </svg>
            {sharing ? 'Sharing...' : done ? 'Shared to Story' : 'Share to Story'}
        </button>
    );
}
