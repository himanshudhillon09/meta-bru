'use client';

import React from 'react';
import { songLabel } from '@/lib/music';
import type { PostMusic } from '@/lib/types';

/** The music a post plays: an Instagram song, one of the user's tracks, or both. */
export function MusicChip({ music }: { music: PostMusic | null | undefined }) {
    if (!music || (!music.instagram && !music.track)) return null;

    const parts = [
        music.instagram ? `${songLabel(music.instagram)} · Instagram` : '',
        music.track ? `${songLabel(music.track)} · Your track` : '',
    ].filter(Boolean);

    return (
        <span
            title={parts.join('\n')}
            className="inline-flex max-w-full items-center gap-1 truncate text-[10px] font-bold px-2.5 py-1 rounded-full border bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20"
        >
            ♪ <span className="truncate">{parts.join(' + ')}</span>
        </span>
    );
}
