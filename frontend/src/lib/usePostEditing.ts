'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { postsApi } from '@/lib/apiClient';
import type { Post, PostStatus } from '@/lib/types';

/** Statuses the server still lets the Composer and Reels page edit. */
export const EDITABLE_STATUSES: PostStatus[] = ['draft', 'queued', 'failed'];

const noSubscription = () => () => undefined;

/** True when the page was opened from a Queue "Edit" link (`?edit=<id>`). */
export function isEditLink(): boolean {
    return new URLSearchParams(window.location.search).has('edit');
}

/**
 * The post id from a Queue "Edit" link, or '' for a new post. Read through
 * useSyncExternalStore so the server render and hydration agree.
 */
export function useEditId(): string {
    const search = useSyncExternalStore(
        noSubscription,
        () => window.location.search,
        () => ''
    );
    return new URLSearchParams(search).get('edit') ?? '';
}

/** Loads the post being edited once and hands it to the page. */
export function useEditedPost(
    editId: string,
    onLoad: (post: Post) => void,
    onError: (message: string) => void
): void {
    const requested = useRef('');

    useEffect(() => {
        if (!editId || requested.current === editId) return;
        requested.current = editId;

        postsApi
            .get(editId)
            .then((data) => {
                if (!EDITABLE_STATUSES.includes(data.post.status)) {
                    onError('This post has already been published, so it can no longer be edited.');
                    return;
                }
                onLoad(data.post);
            })
            .catch((err) => onError(typeof err === 'string' ? err : 'Could not load this post'));
    }, [editId, onLoad, onError]);
}
