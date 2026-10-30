'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageAvatar } from '@/components/PageBrandPanel';
import { connectionsApi } from '@/lib/apiClient';
import type { SocialConnection } from '@/lib/types';

/**
 * Profile holds account settings only. Logos and brand voice belong to each
 * Page; this lists them with a link to edit them in Connections.
 */
export function PagesBrandSummary() {
    const [pages, setPages] = useState<SocialConnection[] | null>(null);

    useEffect(() => {
        connectionsApi
            .list()
            .then((data) => setPages((data as { connections?: SocialConnection[] }).connections || []))
            .catch(() => setPages([]));
    }, []);

    return (
        <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-fg">Page branding</h2>
                    <p className="mt-1 text-sm text-muted">
                        Each Page has its own logo frame and brand voice. The Composer uses the Page you
                        publish to.
                    </p>
                </div>
                <Link
                    href="/connections"
                    className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-bold text-fg hover:bg-hover"
                >
                    Manage in Connections →
                </Link>
            </div>

            <div className="mt-5 divide-y divide-line">
                {pages === null ? (
                    <div className="skeleton h-12 rounded-xl" />
                ) : pages.length === 0 ? (
                    <p className="text-sm text-subtle">
                        Connect a Page first, then give it a logo and brand voice.
                    </p>
                ) : (
                    pages.map((page) => (
                        <div key={page._id} className="flex items-center gap-3 py-3">
                            <PageAvatar connection={page} size="sm" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-fg">{page.pageName}</div>
                                <div className="truncate text-[11px] text-subtle">
                                    {page.brandProfile?.niche || 'No brand voice yet'}
                                </div>
                            </div>
                            <span
                                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                                    page.hasBrandLogo
                                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                        : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                }`}
                            >
                                {page.hasBrandLogo ? 'Logo frame on' : 'No logo'}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </section>
    );
}
