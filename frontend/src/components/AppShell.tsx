'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

interface NavItem {
    href: string;
    label: string;
    icon: string;
}

const NAV_ITEMS: NavItem[] = [
    { href: '/dashboard', label: 'Overview', icon: 'grid' },
    { href: '/composer', label: 'Composer', icon: 'plus' },
    { href: '/reels', label: 'Reels', icon: 'film' },
    { href: '/queue', label: 'Queue', icon: 'list' },
    { href: '/analytics', label: 'Analytics', icon: 'chart' },
    { href: '/activity', label: 'Activity', icon: 'clock' },
    { href: '/connections', label: 'Connections', icon: 'link' },
    { href: '/storage', label: 'Storage', icon: 'cloud' },
    { href: '/settings', label: 'Profile', icon: 'settings' },
];

function NavIcon({ name }: { name: string }) {
    const common = {
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        viewBox: '0 0 24 24',
        className: 'w-5 h-5',
    };

    if (name === 'grid') {
        return (
            <svg {...common}>
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
        );
    }
    if (name === 'plus') {
        return (
            <svg {...common}>
                <path d="M12 5v14M5 12h14" />
            </svg>
        );
    }
    if (name === 'film') {
        return (
            <svg {...common}>
                <rect x="3" y="3" width="18" height="18" rx="2.5" />
                <path d="M3 8h18M3 16h18M8 3v5M16 3v5M8 16v5M16 16v5" />
            </svg>
        );
    }
    if (name === 'list') {
        return (
            <svg {...common}>
                <path d="M8 6h13M8 12h13M8 18h13" />
                <circle cx="3.5" cy="6" r="1" />
                <circle cx="3.5" cy="12" r="1" />
                <circle cx="3.5" cy="18" r="1" />
            </svg>
        );
    }
    if (name === 'clock') {
        return (
            <svg {...common}>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
            </svg>
        );
    }
    if (name === 'link') {
        return (
            <svg {...common}>
                <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
                <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
            </svg>
        );
    }
    if (name === 'cloud') {
        return (
            <svg {...common}>
                <path d="M7 18a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.7 9 4 4 0 0 1 17 17H7Z" />
            </svg>
        );
    }
    if (name === 'chart') {
        return (
            <svg {...common}>
                <path d="M4 19V5" />
                <path d="M4 19h16" />
                <path d="M8 16v-5" />
                <path d="M12 16V8" />
                <path d="M16 16v-3" />
            </svg>
        );
    }
    return (
        <svg {...common}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
    );
}

interface AppShellProps {
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
    const { user, logout } = useAuth();
    const pathname = usePathname();

    const isActive = (href: string) =>
        href === '/dashboard'
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 lg:flex">
            <aside className="hidden lg:flex lg:w-64 shrink-0 flex-col border-r border-white/5 bg-slate-900/40 p-6 sticky top-0 h-screen">
                <Link href="/dashboard" className="flex items-center gap-3 mb-10">
                    <Image
                        src="/icon.png"
                        alt="Meta-Bru"
                        width={40}
                        height={40}
                        className="rounded-xl shadow-lg shadow-indigo-500/20"
                    />
                    <div>
                        <div className="text-lg font-black tracking-tight text-white">
                            Meta-Bru
                        </div>
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                            Auto Poster
                        </div>
                    </div>
                </Link>

                <nav className="flex flex-col gap-1.5">
                    {NAV_ITEMS.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition-all ${
                                isActive(item.href)
                                    ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/20'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                            }`}
                        >
                            <NavIcon name={item.icon} />
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="mt-auto pt-6 border-t border-white/5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-slate-800 border border-white/5 flex items-center justify-center font-bold text-indigo-400">
                            {user?.name?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm font-semibold text-white truncate">
                                {user?.name}
                            </div>
                            <div className="text-[11px] text-slate-500 capitalize">
                                {user?.role}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={logout}
                        className="w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-semibold text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/10 transition-all"
                    >
                        Log Out
                    </button>
                </div>
            </aside>

            <div className="flex-1 min-w-0">
                <header className="lg:hidden flex items-center justify-between px-4 py-4 border-b border-white/5 bg-slate-900/50 backdrop-blur">
                    <Link href="/dashboard" className="flex items-center gap-2.5">
                        <Image
                            src="/icon.png"
                            alt="Meta-Bru"
                            width={32}
                            height={32}
                            className="rounded-lg"
                        />
                        <span className="font-black text-white">Meta-Bru</span>
                    </Link>
                    <button
                        onClick={logout}
                        className="text-xs font-bold text-rose-400 px-3 py-2 rounded-lg bg-rose-500/10"
                    >
                        Log Out
                    </button>
                </header>

                <div className="lg:hidden grid grid-cols-3 gap-1 px-3 py-2.5 border-b border-white/5 bg-slate-950/80">
                    {NAV_ITEMS.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`text-center px-2 py-2 rounded-lg text-xs font-bold ${
                                isActive(item.href)
                                    ? 'bg-indigo-500/15 text-indigo-300'
                                    : 'text-slate-400'
                            }`}
                        >
                            {item.label}
                        </Link>
                    ))}
                </div>

                <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-8">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                                {title}
                            </h1>
                            {subtitle ? (
                                <p className="text-slate-400 mt-1">{subtitle}</p>
                            ) : null}
                        </div>
                        {actions ? <div className="flex gap-3">{actions}</div> : null}
                    </div>
                    {children}
                </main>
            </div>
        </div>
    );
}
