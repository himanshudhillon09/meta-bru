'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/context/AuthContext';

interface Feature {
    title: string;
    body: string;
    icon: React.ReactNode;
    tint: string;
}

const iconProps = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'w-5 h-5',
    'aria-hidden': true,
};

const FEATURES: Feature[] = [
    {
        title: 'AI captions and images',
        body: 'Gemini drafts captions from your topic or photo and creates images that match your brand profile.',
        tint: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
        icon: (
            <svg {...iconProps}>
                <path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8L12 3Z" />
                <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />
            </svg>
        ),
    },
    {
        title: 'Reels',
        body: 'Upload a vertical video straight to your own Cloudinary and publish it as a Facebook and Instagram reel.',
        tint: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
        icon: (
            <svg {...iconProps}>
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M10 9l5 3-5 3V9Z" />
            </svg>
        ),
    },
    {
        title: 'Stories',
        body: 'Share any published post or reel to Facebook and Instagram Stories, automatically or with one click.',
        tint: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
        icon: (
            <svg {...iconProps}>
                <circle cx="12" cy="12" r="9" strokeDasharray="4 3" />
                <circle cx="12" cy="12" r="4.5" />
            </svg>
        ),
    },
    {
        title: 'A schedule that runs itself',
        body: 'Pick up to ten posting times per Page. The queue publishes in order, in your timezone.',
        tint: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
        icon: (
            <svg {...iconProps}>
                <rect x="3" y="5" width="18" height="16" rx="2.5" />
                <path d="M3 10h18M8 3v4M16 3v4M8 14h3" />
            </svg>
        ),
    },
    {
        title: 'Brand frame and bold text',
        body: 'Frame every image with your logo and add a bold, reel-style line that stands out in the feed.',
        tint: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
        icon: (
            <svg {...iconProps}>
                <rect x="3" y="3" width="18" height="18" rx="2.5" />
                <path d="M7 16h10M9 12h6" />
            </svg>
        ),
    },
    {
        title: 'Analytics and storage',
        body: 'See reach and engagement for every post, and keep your Cloudinary storage free of duplicates.',
        tint: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
        icon: (
            <svg {...iconProps}>
                <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" />
            </svg>
        ),
    },
];

const YEAR = new Date().getFullYear();

const STEPS = [
    {
        title: 'Connect your Page',
        body: 'Sign in with Facebook. Meta-Bru finds the Instagram Business account linked to each Page.',
    },
    {
        title: 'Create with AI',
        body: 'Write or generate a caption, add an image or reel, and choose Facebook, Instagram, or both.',
    },
    {
        title: 'Queue it and relax',
        body: 'Posts publish at your daily times. Retry anything that fails, or post right away when you need to.',
    },
];

function ProductPreview() {
    return (
        <div className="relative mx-auto w-full max-w-md">
            <div className="absolute -inset-6 -z-10 rounded-[40px] bg-gradient-to-br from-indigo-200/60 via-violet-200/40 to-rose-200/50 blur-2xl dark:from-indigo-500/20 dark:via-violet-500/10 dark:to-rose-500/15" />
            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xl shadow-slate-900/5">
                <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                        B
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-fg">Your Brand</div>
                        <div className="text-[11px] text-subtle">Facebook + Instagram</div>
                    </div>
                    <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        Queued · 6:00 PM
                    </span>
                </div>
                <div className="relative aspect-[4/5] bg-gradient-to-br from-indigo-500 via-violet-500 to-rose-400">
                    <svg viewBox="0 0 200 250" className="absolute inset-0 h-full w-full opacity-30" aria-hidden="true">
                        <circle cx="150" cy="60" r="38" fill="white" />
                        <path d="M0 190 60 130l40 40 30-30 70 70v40H0z" fill="white" />
                    </svg>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-6 pb-8 pt-24 text-center">
                        <p className="text-[22px] font-extrabold leading-tight text-white">
                            Monday plans vs <span className="text-yellow-300">Monday reality</span>
                        </p>
                    </div>
                </div>
                <div className="space-y-2 px-4 py-4">
                    <div className="h-2.5 w-11/12 rounded-full bg-sunken" />
                    <div className="h-2.5 w-3/4 rounded-full bg-sunken" />
                    <div className="h-2.5 w-1/2 rounded-full bg-indigo-100 dark:bg-indigo-500/20" />
                </div>
            </div>
            <div className="absolute -right-3 top-24 hidden rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-fg shadow-lg sm:block">
                ✨ Caption drafted by AI
            </div>
            <div className="absolute -left-4 bottom-20 hidden rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-fg shadow-lg sm:block">
                Shared to Story
            </div>
        </div>
    );
}

export default function Home() {
    const { user } = useAuth();
    const primaryHref = user ? '/dashboard' : '/register';
    const primaryLabel = user ? 'Open dashboard' : 'Create an account';

    return (
        <div className="min-h-screen bg-canvas text-fg">
            <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
                    <Link href="/" className="flex items-center gap-2.5">
                        <Image src="/icon.png" alt="" width={32} height={32} className="rounded-lg" />
                        <span className="text-base font-bold tracking-tight">Meta-Bru</span>
                    </Link>
                    <nav className="hidden items-center gap-6 text-sm font-medium text-muted md:flex">
                        <a href="#features" className="hover:text-fg">Features</a>
                        <a href="#how-it-works" className="hover:text-fg">How it works</a>
                    </nav>
                    <div className="ml-auto flex items-center gap-2">
                        <ThemeToggle />
                        {user ? null : (
                            <Link
                                href="/login"
                                className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-fg-2 hover:bg-hover sm:inline-flex"
                            >
                                Sign in
                            </Link>
                        )}
                        <Link
                            href={primaryHref}
                            className="inline-flex rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                        >
                            {user ? 'Dashboard' : 'Get started'}
                        </Link>
                    </div>
                </div>
            </header>

            <main>
                <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
                    <div>
                        <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                            For Facebook Pages and Instagram
                        </span>
                        <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
                            Plan once.
                            <br />
                            <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-rose-500 bg-clip-text text-transparent dark:from-indigo-400 dark:via-violet-400 dark:to-rose-400">
                                Publish every day.
                            </span>
                        </h1>
                        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
                            Create posts and reels with AI help, queue them, and Meta-Bru
                            publishes to Facebook and Instagram at the times you choose,
                            Stories included.
                        </p>
                        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                            <Link
                                href={primaryHref}
                                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-500"
                            >
                                {primaryLabel}
                            </Link>
                            <a
                                href="#features"
                                className="inline-flex items-center justify-center rounded-xl border border-line-strong bg-surface px-6 py-3 text-base font-semibold text-fg hover:bg-hover"
                            >
                                See what it does
                            </a>
                        </div>
                        <ul className="mt-8 grid gap-2 text-sm text-muted sm:grid-cols-2">
                            {[
                                'Posts, reels, and Stories',
                                'Your own Meta, Cloudinary, and Gemini keys',
                                'Up to ten posting times a day',
                                'Light and dark mode',
                            ].map((item) => (
                                <li key={item} className="flex items-center gap-2">
                                    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" fill="currentColor" aria-hidden="true">
                                        <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z" />
                                    </svg>
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <ProductPreview />
                </section>

                <section id="features" className="border-y border-line bg-surface">
                    <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
                        <div className="max-w-2xl">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                                Everything your Page needs to stay active
                            </h2>
                            <p className="mt-3 text-lg text-muted">
                                From the first idea to the published post, in one place.
                            </p>
                        </div>
                        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                            {FEATURES.map((feature) => (
                                <div
                                    key={feature.title}
                                    className="rounded-2xl border border-line bg-canvas p-6 transition-colors hover:border-line-strong"
                                >
                                    <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${feature.tint}`}>
                                        {feature.icon}
                                    </div>
                                    <h3 className="mt-4 text-base font-semibold text-fg">{feature.title}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-muted">{feature.body}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
                    <ol className="mt-10 grid gap-6 md:grid-cols-3">
                        {STEPS.map((step, index) => (
                            <li key={step.title} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                                    {index + 1}
                                </div>
                                <h3 className="mt-4 text-base font-semibold text-fg">{step.title}</h3>
                                <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
                            </li>
                        ))}
                    </ol>
                </section>

                <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
                    <div className="flex flex-col items-start gap-6 rounded-2xl bg-indigo-600 px-8 py-10 text-white sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-2xl font-bold tracking-tight">Ready to fill your queue?</h2>
                            <p className="mt-2 text-indigo-100">
                                Connect a Page and schedule your first post in a few minutes.
                            </p>
                        </div>
                        <Link
                            href={primaryHref}
                            className="inline-flex shrink-0 rounded-xl bg-white px-6 py-3 text-base font-semibold text-indigo-700 hover:bg-indigo-50"
                        >
                            {primaryLabel}
                        </Link>
                    </div>
                </section>
            </main>

            <footer className="border-t border-line">
                <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <span>© {YEAR} Meta-Bru</span>
                    <span>Made for Facebook Pages and Instagram Business accounts.</span>
                </div>
            </footer>
        </div>
    );
}
