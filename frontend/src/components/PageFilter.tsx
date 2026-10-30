'use client';

import React from 'react';
import type { Post } from '@/lib/types';

/** The id of the Page a post belongs to, whether or not it is populated. */
export function postPageId(post: Pick<Post, 'connectionId'>): string {
    return typeof post.connectionId === 'string' ? post.connectionId : post.connectionId?._id || '';
}

/** The chosen Page, or "" (all Pages) once it has no posts left in the list. */
export function activePageId(posts: Post[], pageId: string): string {
    return pageId && posts.some((post) => postPageId(post) === pageId) ? pageId : '';
}

/** Each Page that has posts in the list, by name. */
export function pagesOf(posts: Post[]): Array<{ id: string; name: string }> {
    const pages = new Map<string, string>();
    for (const post of posts) {
        const id = postPageId(post);
        if (!id || pages.has(id)) continue;
        pages.set(id, typeof post.connectionId === 'string' ? 'Page' : post.connectionId?.pageName || 'Page');
    }
    return [...pages.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** "All Pages" or one Page; only shown when posts come from more than one. */
export function PageFilter({
    posts,
    value,
    onChange,
}: {
    posts: Post[];
    value: string;
    onChange: (pageId: string) => void;
}) {
    const pages = pagesOf(posts);
    if (pages.length < 2 && !value) return null;
    return (
        <select
            aria-label="Page"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="self-start rounded-xl border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-fg-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        >
            <option value="">All Pages</option>
            {pages.map((page) => (
                <option key={page.id} value={page.id}>
                    {page.name}
                </option>
            ))}
        </select>
    );
}
