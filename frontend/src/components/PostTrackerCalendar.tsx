'use client';

import React, { useMemo } from 'react';
import {
    formatElapsed,
    formatIstDateTime,
    type AnalyticsPost,
} from '@/lib/types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dayKey(value: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
    }).format(new Date(value));
}

function shiftMonth(month: string, delta: number): string {
    const [year, monthNumber] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function PostTrackerCalendar({
    month,
    posts,
    selectedDay,
    onSelectDay,
    onMonthChange,
    loading,
    now = Date.now(),
}: {
    month: string;
    posts: AnalyticsPost[];
    selectedDay: string | null;
    onSelectDay: (day: string | null) => void;
    onMonthChange: (month: string) => void;
    loading: boolean;
    now?: number;
}) {
    const [year, monthNumber] = month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const firstWeekday =
        (new Date(`${month}-01T12:00:00+05:30`).getUTCDay() + 6) % 7;
    const monthLabel = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        month: 'long',
        year: 'numeric',
    }).format(new Date(`${month}-15T12:00:00+05:30`));
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
    }).format(new Date(now));

    const byDay = useMemo(() => {
        const map = new Map<string, AnalyticsPost[]>();
        for (const post of posts) {
            for (const target of post.targets) {
                const key = dayKey(target.publishedAt);
                const list = map.get(key) ?? [];
                if (!list.some((item) => item.postId === post.postId)) {
                    list.push(post);
                }
                map.set(key, list);
            }
        }
        return map;
    }, [posts]);

    const selectedPosts = selectedDay ? byDay.get(selectedDay) ?? [] : [];
    const selectedLabel = selectedDay
        ? new Intl.DateTimeFormat('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
          }).format(new Date(`${selectedDay}T12:00:00+05:30`))
        : '';

    return (
        <div className="space-y-5">
            <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-white">
                        Post date &amp; time tracker
                    </h2>
                    <span className="text-[10px] text-slate-500">IST</span>
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onMonthChange(shiftMonth(month, -1))}
                            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
                        >
                            ←
                        </button>
                        <span className="min-w-36 text-center text-xs font-bold text-white">
                            {monthLabel}
                        </span>
                        <button
                            type="button"
                            onClick={() => onMonthChange(shiftMonth(month, 1))}
                            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
                        >
                            →
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                onMonthChange(today.slice(0, 7));
                                onSelectDay(today);
                            }}
                            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-indigo-300"
                        >
                            Today
                        </button>
                    </div>
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-4 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                        Facebook
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-pink-400" />
                        Instagram
                    </span>
                </div>

                {loading ? (
                    <div className="flex justify-center py-16">
                        <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-indigo-500" />
                    </div>
                ) : (
                    <div className="grid grid-cols-7 gap-1">
                        {WEEKDAYS.map((day) => (
                            <div
                                key={day}
                                className="pb-2 text-center text-[10px] font-bold uppercase tracking-widest text-slate-600"
                            >
                                {day}
                            </div>
                        ))}
                        {Array.from({ length: firstWeekday }, (_, index) => (
                            <div key={`blank-${index}`} />
                        ))}
                        {Array.from({ length: daysInMonth }, (_, index) => {
                            const dayNumber = index + 1;
                            const key = `${month}-${String(dayNumber).padStart(2, '0')}`;
                            const dayPosts = byDay.get(key) ?? [];
                            const isSelected = selectedDay === key;
                            const isToday = today === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => onSelectDay(key)}
                                    aria-label={`${key}, ${dayPosts.length} published posts`}
                                    className={`min-h-16 rounded-xl border p-1.5 text-left transition-colors ${
                                        isSelected
                                            ? 'border-indigo-500/30 bg-indigo-500/10'
                                            : isToday
                                              ? 'border-white/15 bg-slate-950/40'
                                              : 'border-white/5 bg-slate-950/20 hover:border-white/10'
                                    }`}
                                >
                                    <div className="text-[10px] font-bold text-slate-400">
                                        {dayNumber}
                                    </div>
                                    {dayPosts.length > 0 ? (
                                        <div className="mt-1 flex flex-wrap items-center gap-1">
                                            <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">
                                                {dayPosts.length}
                                            </span>
                                            {dayPosts.some((post) =>
                                                post.targets.some(
                                                    (target) =>
                                                        target.platform ===
                                                        'facebook'
                                                )
                                            ) ? (
                                                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                                            ) : null}
                                            {dayPosts.some((post) =>
                                                post.targets.some(
                                                    (target) =>
                                                        target.platform ===
                                                        'instagram'
                                                )
                                            ) ? (
                                                <span className="h-1.5 w-1.5 rounded-full bg-pink-400" />
                                            ) : null}
                                        </div>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>

            <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                <h2 className="mb-4 text-sm font-bold text-white">
                    {selectedDay
                        ? `Posts on ${selectedLabel} (IST)`
                        : 'Select a day'}
                </h2>
                {selectedPosts.length === 0 ? (
                    <div className="text-sm text-slate-500">
                        {selectedDay
                            ? 'No published posts on this day.'
                            : 'Choose a date on the calendar to see publish times and engagement.'}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {selectedPosts.map((post) => (
                            <div
                                key={post.postId}
                                className="rounded-2xl border border-white/5 bg-slate-950/40 p-4"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-white">
                                        {post.connection.pageName}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-widest text-slate-500">
                                        {post.status}
                                    </span>
                                </div>
                                <p className="mt-1 line-clamp-1 text-xs text-slate-400">
                                    {post.caption}
                                </p>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    {post.targets
                                        .filter(
                                            (target) =>
                                                dayKey(target.publishedAt) ===
                                                selectedDay
                                        )
                                        .map((target) => (
                                            <div
                                                key={target.platform}
                                                className="rounded-xl border border-white/5 bg-slate-900/40 p-3"
                                            >
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">
                                                        {target.platform}
                                                    </span>
                                                    <span className="text-[11px] text-slate-400">
                                                        {formatIstDateTime(
                                                            target.publishedAt
                                                        )}
                                                    </span>
                                                    <span className="text-[10px] text-slate-600">
                                                        {formatElapsed(
                                                            target.publishedAt,
                                                            now
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
                                                    <span>
                                                        Reach{' '}
                                                        <strong className="text-white">
                                                            {target.metrics
                                                                ?.reach ??
                                                                '—'}
                                                        </strong>
                                                    </span>
                                                    <span>
                                                        Interactions{' '}
                                                        <strong className="text-white">
                                                            {target.metrics
                                                                ?.interactions ??
                                                                '—'}
                                                        </strong>
                                                    </span>
                                                    <span>
                                                        Rate{' '}
                                                        <strong className="text-emerald-300">
                                                            {target.metrics
                                                                ?.engagementRate ===
                                                                null ||
                                                            target.metrics
                                                                ?.engagementRate ===
                                                                undefined
                                                                ? '—'
                                                                : `${target.metrics.engagementRate}%`}
                                                        </strong>
                                                    </span>
                                                </div>
                                                {target.status ===
                                                'permission_error' ? (
                                                    <div className="mt-2 text-[10px] text-amber-300">
                                                        Reconnect this Page to
                                                        load insights.
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
