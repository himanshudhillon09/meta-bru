'use client';

import React from 'react';
import { Modal } from '@/components/Modal';
import {
    isReel,
    publishedPlatforms,
    storyTarget,
    type Platform,
    type StoryShareSubject,
} from '@/lib/types';

interface StoryShareModalProps {
    post: StoryShareSubject | null;
    selected: Platform[];
    onToggle: (platform: Platform) => void;
    onClose: () => void;
    onConfirm: () => void;
}

const PLATFORM_LABELS: Record<Platform, string> = {
    facebook: 'Facebook Story',
    instagram: 'Instagram Story',
};

export function StoryShareModal({
    post,
    selected,
    onToggle,
    onClose,
    onConfirm,
}: StoryShareModalProps) {
    const platforms = post ? publishedPlatforms(post) : [];

    return (
        <Modal
            isOpen={post !== null}
            onClose={onClose}
            onConfirm={onConfirm}
            title="Share to Story"
            message={
                post && isReel(post)
                    ? 'The reel is shared as a 9:16 video Story using its first 60 seconds.'
                    : 'The image is shared as a 9:16 Story with padding that matches its edges.'
            }
            confirmText="Share to Story"
            type="info"
        >
            <div className="space-y-2">
                {platforms.map((platform) => {
                    const story = post ? storyTarget(post, platform) : undefined;
                    const shared = story?.status === 'published';

                    return (
                        <div
                            key={platform}
                            className="rounded-2xl border border-line bg-surface-2 px-4 py-3"
                        >
                            <label
                                className={`flex items-center gap-3 ${
                                    shared ? 'cursor-not-allowed' : 'cursor-pointer'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={shared || selected.includes(platform)}
                                    disabled={shared}
                                    onChange={() => onToggle(platform)}
                                    className="h-4 w-4 accent-indigo-500"
                                />
                                <span className="flex-1 text-sm font-semibold text-fg">
                                    {PLATFORM_LABELS[platform]}
                                </span>
                                <span
                                    className={`text-[10px] font-bold uppercase tracking-widest ${
                                        shared
                                            ? 'text-emerald-700 dark:text-emerald-300'
                                            : story?.status === 'failed'
                                              ? 'text-rose-700 dark:text-rose-300'
                                              : 'text-subtle'
                                    }`}
                                >
                                    {shared
                                        ? 'Shared'
                                        : story?.status === 'failed'
                                          ? 'Failed'
                                          : 'Not shared'}
                                </span>
                            </label>
                            {story?.status === 'failed' && story.error ? (
                                <p className="mt-2 text-[11px] text-rose-700/80 dark:text-rose-300/80">
                                    {story.error}
                                </p>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </Modal>
    );
}
