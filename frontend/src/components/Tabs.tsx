'use client';

import React, { useLayoutEffect, useRef } from 'react';

export interface TabItem<K extends string> {
    key: K;
    label: React.ReactNode;
    /** Shown as a small badge after the label. */
    count?: number;
}

interface TabsProps<K extends string> {
    items: readonly TabItem<K>[];
    value: K;
    onChange: (key: K) => void;
    /** Accessible name for the group, e.g. "Post status". */
    label: string;
    /**
     * `pills`: separate outlined buttons with a solid indigo highlight, for the
     * main view switch. `segmented`: a compact track for secondary filters.
     */
    variant?: 'pills' | 'segmented';
    size?: 'sm' | 'md';
    className?: string;
}

const PILL_SIZES = {
    sm: 'px-3 py-2 text-xs',
    md: 'px-4 py-2.5 text-xs',
};

const SEGMENT_SIZES = {
    sm: 'px-2.5 py-1.5 text-[10px]',
    md: 'px-3 py-1.5 text-[11px]',
};

/**
 * Tab and filter switcher. A highlight slides to the selected option, so the
 * current choice is obvious in both themes.
 */
export function Tabs<K extends string>({
    items,
    value,
    onChange,
    label,
    variant = 'pills',
    size = 'md',
    className = '',
}: TabsProps<K>) {
    const listRef = useRef<HTMLDivElement>(null);
    const indicatorRef = useRef<HTMLSpanElement>(null);

    // Position the highlight over the selected button. It is moved through the
    // DOM directly so resizing (fonts loading, counts changing) never re-renders.
    useLayoutEffect(() => {
        const list = listRef.current;
        const indicator = indicatorRef.current;
        if (!list || !indicator) return;

        const place = () => {
            const active = list.querySelector<HTMLElement>('[aria-selected="true"]');
            if (!active) {
                indicator.style.opacity = '0';
                return;
            }
            indicator.style.opacity = '1';
            indicator.style.width = `${active.offsetWidth}px`;
            indicator.style.height = `${active.offsetHeight}px`;
            indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
        };

        place();
        // Only animate moves after the first placement.
        const frame = requestAnimationFrame(() => {
            indicator.dataset.ready = 'true';
        });
        const observer = new ResizeObserver(place);
        observer.observe(list);
        list.querySelectorAll('[role="tab"]').forEach((tab) => observer.observe(tab));
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [value, items]);

    const segmented = variant === 'segmented';

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const index = items.findIndex((item) => item.key === value);
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = items[(index + step + items.length) % items.length];
        event.preventDefault();
        onChange(next.key);
        listRef.current
            ?.querySelector<HTMLElement>(`[data-key="${next.key}"]`)
            ?.focus();
    };

    return (
        <div
            ref={listRef}
            role="tablist"
            aria-label={label}
            onKeyDown={onKeyDown}
            className={
                segmented
                    ? `relative inline-flex gap-1 rounded-xl border border-line bg-sunken p-1 ${className}`
                    : `relative -my-1 flex gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`
            }
        >
            <span
                ref={indicatorRef}
                aria-hidden="true"
                className={`pointer-events-none absolute left-0 top-0 opacity-0 data-[ready=true]:transition-[transform,width,height] data-[ready=true]:duration-300 data-[ready=true]:ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    segmented
                        ? 'rounded-lg bg-surface shadow-sm ring-1 ring-line-strong dark:bg-indigo-500/35 dark:ring-indigo-400/50'
                        : 'rounded-xl bg-indigo-600 shadow-md shadow-indigo-600/25 dark:bg-indigo-500 dark:shadow-indigo-950/40'
                }`}
            />
            {items.map((item) => {
                const active = item.key === value;
                return (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        data-key={item.key}
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(item.key)}
                        className={
                            segmented
                                ? `relative z-10 whitespace-nowrap rounded-lg font-bold transition-colors ${SEGMENT_SIZES[size]} ${
                                      active
                                          ? 'text-indigo-700 dark:text-white'
                                          : 'text-subtle hover:text-fg'
                                  }`
                                : `relative z-10 inline-flex items-center gap-2 whitespace-nowrap rounded-xl border font-bold transition-colors ${PILL_SIZES[size]} ${
                                      active
                                          ? 'border-transparent text-white'
                                          : 'border-line bg-surface text-muted hover:border-line-strong hover:bg-hover hover:text-fg'
                                  }`
                        }
                    >
                        {item.label}
                        {item.count !== undefined ? (
                            <span
                                className={`min-w-5 rounded-full px-1.5 py-px text-center text-[10px] tabular-nums transition-colors ${
                                    active
                                        ? 'bg-white/20 text-white'
                                        : 'bg-sunken text-subtle'
                                }`}
                            >
                                {item.count}
                            </span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
