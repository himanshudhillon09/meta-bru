'use client';

import React from 'react';
import Link from 'next/link';
import { LogoMark } from '@/components/LogoMark';
import { ThemeToggle } from '@/components/ThemeToggle';

interface AuthFrameProps {
    title: string;
    subtitle: string;
    /** Card width; sign-in forms are narrow, the password change is wider. */
    width?: 'narrow' | 'wide';
    children: React.ReactNode;
}

/** Shared page frame for sign-in, sign-up, and forced password changes. */
export function AuthFrame({ title, subtitle, width = 'narrow', children }: AuthFrameProps) {
    return (
        <div className="flex min-h-screen flex-col bg-canvas">
            <header className="flex items-center justify-between px-4 py-4 sm:px-6">
                <Link href="/" className="flex items-center gap-2.5">
                    <LogoMark size={32} />
                    <span className="text-base font-bold tracking-tight text-fg">Meta-Bru</span>
                </Link>
                <ThemeToggle />
            </header>
            <main className="flex flex-1 items-center justify-center px-4 pb-16">
                <div
                    className={`w-full animate-pop-in rounded-2xl border border-line bg-surface p-8 shadow-card sm:p-10 ${
                        width === 'wide' ? 'max-w-lg' : 'max-w-[420px]'
                    }`}
                >
                    <div className="mb-8">
                        <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
                        <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
                    </div>
                    {children}
                </div>
            </main>
        </div>
    );
}
