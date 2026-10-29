import React, { useId } from 'react';

interface LogoMarkProps {
    size?: number;
    className?: string;
}

/**
 * The Meta-Bru mark: a bold "M" on an indigo-to-violet tile, with a yellow
 * dot that echoes the highlighted words in post text. Keep in sync with
 * app/icon1.svg, which is the favicon.
 */
export function LogoMark({ size = 32, className = '' }: LogoMarkProps) {
    // Unique gradient id, so several marks on one page don't share one.
    const gradientId = `logo-${useId().replace(/:/g, '')}`;

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 64 64"
            className={`shrink-0 ${className}`}
            role="img"
            aria-label="Meta-Bru"
        >
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#4F46E5" />
                    <stop offset="1" stopColor="#8B5CF6" />
                </linearGradient>
            </defs>
            <rect width="64" height="64" rx="15" fill={`url(#${gradientId})`} />
            <path
                d="M16 46V22.5l14.5 14.5L45 22.5V46"
                fill="none"
                stroke="#fff"
                strokeWidth="6.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="50" cy="14" r="4.5" fill="#FDE047" />
        </svg>
    );
}
