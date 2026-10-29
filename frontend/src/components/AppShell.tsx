'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoMark } from '@/components/LogoMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/context/AuthContext';

interface NavItem {
    href: string;
    label: string;
    icon: IconName;
}

interface NavGroup {
    label: string;
    items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
    {
        label: 'Workspace',
        items: [
            { href: '/dashboard', label: 'Overview', icon: 'grid' },
            { href: '/queue', label: 'Queue', icon: 'list' },
            { href: '/activity', label: 'Activity', icon: 'clock' },
            { href: '/analytics', label: 'Analytics', icon: 'chart' },
        ],
    },
    {
        label: 'Create',
        items: [
            { href: '/composer', label: 'Composer', icon: 'plus' },
            { href: '/reels', label: 'Reels', icon: 'film' },
        ],
    },
    {
        label: 'Setup',
        items: [
            { href: '/connections', label: 'Connections', icon: 'link' },
            { href: '/storage', label: 'Storage', icon: 'cloud' },
            { href: '/settings', label: 'Profile', icon: 'settings' },
        ],
    },
];

type IconName =
    | 'grid'
    | 'plus'
    | 'film'
    | 'list'
    | 'clock'
    | 'link'
    | 'cloud'
    | 'chart'
    | 'settings'
    | 'menu'
    | 'close'
    | 'logout';

const ICON_PATHS: Record<IconName, React.ReactNode> = {
    grid: (
        <>
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    film: (
        <>
            <rect x="3" y="3" width="18" height="18" rx="2.5" />
            <path d="M3 8h18M3 16h18M8 3v5M16 3v5M8 16v5M16 16v5" />
        </>
    ),
    list: (
        <>
            <path d="M8 6h13M8 12h13M8 18h13" />
            <circle cx="3.5" cy="6" r="1" />
            <circle cx="3.5" cy="12" r="1" />
            <circle cx="3.5" cy="18" r="1" />
        </>
    ),
    clock: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </>
    ),
    link: (
        <>
            <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
        </>
    ),
    cloud: <path d="M7 18a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.7 9 4 4 0 0 1 17 17H7Z" />,
    chart: (
        <>
            <path d="M4 19V5" />
            <path d="M4 19h16" />
            <path d="M8 16v-5" />
            <path d="M12 16V8" />
            <path d="M16 16v-3" />
        </>
    ),
    settings: (
        <>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
        </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    logout: (
        <>
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
            <path d="M10 17l-5-5 5-5M5 12h11" />
        </>
    ),
};

function Icon({ name, className = 'w-5 h-5' }: { name: IconName; className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            {ICON_PATHS[name]}
        </svg>
    );
}

function Brand() {
    return (
        <Link href="/dashboard" className="flex items-center gap-3">
            <LogoMark size={36} />
            <div className="leading-tight">
                <div className="text-base font-bold tracking-tight text-fg">Meta-Bru</div>
                <div className="text-[11px] font-medium text-subtle">Auto poster</div>
            </div>
        </Link>
    );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
    const { user, logout } = useAuth();
    const pathname = usePathname();

    const isActive = (href: string) =>
        href === '/dashboard'
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

    return (
        <div className="flex h-full flex-col">
            <div className="px-5 pt-6 pb-5">
                <Brand />
            </div>

            <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
                {NAV_GROUPS.map((group) => (
                    <div key={group.label} className="mb-5">
                        <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                            {group.label}
                        </div>
                        <ul className="space-y-0.5">
                            {group.items.map((item) => {
                                const active = isActive(item.href);
                                return (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            onClick={onNavigate}
                                            aria-current={active ? 'page' : undefined}
                                            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                                                active
                                                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                                                    : 'text-muted hover:bg-hover hover:text-fg'
                                            }`}
                                        >
                                            <Icon
                                                name={item.icon}
                                                className={`w-[18px] h-[18px] ${active ? '' : 'text-subtle'}`}
                                            />
                                            {item.label}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </nav>

            <div className="border-t border-line p-4 space-y-3">
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                        {user?.name?.[0]?.toUpperCase() || 'U'}
                    </div>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-fg">{user?.name}</div>
                        <div className="truncate text-xs text-subtle">{user?.email}</div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <ThemeToggle withLabel className="flex-1 justify-center" />
                    <button
                        type="button"
                        onClick={logout}
                        title="Log out"
                        aria-label="Log out"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-muted hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-300 dark:hover:bg-rose-500/10 transition-colors"
                    >
                        <Icon name="logout" className="w-[18px] h-[18px]" />
                    </button>
                </div>
            </div>
        </div>
    );
}

interface AppShellProps {
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
    const [menuOpen, setMenuOpen] = useState(false);

    // Close the drawer with Escape, and keep the page from scrolling behind it.
    useEffect(() => {
        if (!menuOpen) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMenuOpen(false);
        };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', onKey);
        };
    }, [menuOpen]);

    return (
        <div className="min-h-screen bg-canvas text-fg lg:flex">
            <aside className="hidden lg:block lg:w-64 shrink-0 border-r border-line bg-surface sticky top-0 h-screen">
                <SidebarContent />
            </aside>

            {menuOpen ? (
                <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
                    <button
                        type="button"
                        aria-label="Close menu"
                        onClick={() => setMenuOpen(false)}
                        className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
                    />
                    <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface shadow-2xl">
                        <button
                            type="button"
                            onClick={() => setMenuOpen(false)}
                            aria-label="Close menu"
                            className="absolute right-3 top-6 inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-fg"
                        >
                            <Icon name="close" />
                        </button>
                        <SidebarContent onNavigate={() => setMenuOpen(false)} />
                    </div>
                </div>
            ) : null}

            <div className="flex-1 min-w-0">
                <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur">
                    <button
                        type="button"
                        onClick={() => setMenuOpen(true)}
                        aria-label="Open menu"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-fg hover:bg-hover"
                    >
                        <Icon name="menu" />
                    </button>
                    <Brand />
                    <ThemeToggle />
                </header>

                <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
                    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{title}</h1>
                            {subtitle ? <p className="mt-1.5 max-w-2xl text-sm text-muted sm:text-base">{subtitle}</p> : null}
                        </div>
                        {actions ? <div className="flex shrink-0 flex-wrap gap-3 whitespace-nowrap">{actions}</div> : null}
                    </div>
                    {children}
                </main>
            </div>
        </div>
    );
}
