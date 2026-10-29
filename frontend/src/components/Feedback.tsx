import React from 'react';

/** Card placeholders shown while a list loads. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
    return (
        <div className="space-y-4" aria-busy="true" aria-label="Loading">
            {Array.from({ length: rows }, (_, index) => (
                <div
                    key={index}
                    className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
                >
                    <div className="flex flex-col gap-5 sm:flex-row">
                        <div className="skeleton h-40 w-full shrink-0 rounded-2xl sm:h-28 sm:w-28" />
                        <div className="flex-1 space-y-3 py-1">
                            <div className="flex gap-2">
                                <div className="skeleton h-5 w-20 rounded-full" />
                                <div className="skeleton h-5 w-32 rounded-full" />
                            </div>
                            <div className="skeleton h-3.5 w-11/12 rounded-full" />
                            <div className="skeleton h-3.5 w-3/4 rounded-full" />
                            <div className="flex gap-2 pt-1">
                                <div className="skeleton h-5 w-28 rounded-full" />
                                <div className="skeleton h-5 w-28 rounded-full" />
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Tile placeholders shown while a grid of files loads. */
export function GridSkeleton({ tiles = 6 }: { tiles?: number }) {
    return (
        <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
            aria-busy="true"
            aria-label="Loading"
        >
            {Array.from({ length: tiles }, (_, index) => (
                <div
                    key={index}
                    className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
                >
                    <div className="skeleton aspect-square w-full" />
                    <div className="space-y-2.5 p-4">
                        <div className="skeleton h-3.5 w-3/4 rounded-full" />
                        <div className="skeleton h-3 w-1/2 rounded-full" />
                    </div>
                </div>
            ))}
        </div>
    );
}

interface EmptyStateProps {
    title: string;
    body: string;
    action?: React.ReactNode;
}

/** Friendly placeholder for an empty list or a filter with no matches. */
export function EmptyState({ title, body, action }: EmptyStateProps) {
    return (
        <div className="animate-fade-up rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-6 w-6"
                    aria-hidden="true"
                >
                    <path d="M3 13h5l1.5 3h5L16 13h5" />
                    <path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2.5-8Z" />
                </svg>
            </div>
            <div className="text-lg font-bold text-fg">{title}</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">{body}</p>
            {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
        </div>
    );
}
