'use client';

import React from 'react';
import { songLabel } from '@/lib/music';
import type { PostMusic } from '@/lib/types';

/** The track a post plays. */
export function MusicChip({ music }: { music: PostMusic | null | undefined }) {
    if (!music?.track) return null;
    const label = songLabel(music.track);

    return (
        <span
            title={label}
            className="inline-flex max-w-full items-center gap-1 truncate text-[10px] font-bold px-2.5 py-1 rounded-full border bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20"
        >
            ♪ <span className="truncate">{label}</span>
        </span>
    );
}
