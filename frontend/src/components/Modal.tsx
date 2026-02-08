'use client';

import React, { useEffect, useState } from 'react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'info' | 'success';
}

export const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'info'
}) => {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setMounted(true);
            document.body.style.overflow = 'hidden';
        } else {
            const timer = setTimeout(() => setMounted(false), 300);
            document.body.style.overflow = 'unset';
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    if (!isOpen && !mounted) return null;

    const typeColors = {
        danger: 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/20',
        info: 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20',
        success: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20'
    };

    const typeIconColors = {
        danger: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
        info: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
        success: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
    };

    return (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-300 ${isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
            {/* Backdrop */}
            <div
                className={`absolute inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-md bg-slate-900/90 border border-white/10 rounded-[32px] p-8 shadow-2xl backdrop-blur-xl">
                <div className="flex flex-col items-center text-center">
                    {/* Icon */}
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 border ${typeIconColors[type]}`}>
                        {type === 'danger' && (
                            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.745-3L13.745 4c-.77-1.333-2.694-1.333-3.464 0l-6.536 11c-.77 1.333.192 3 1.745 3z" />
                            </svg>
                        )}
                        {type === 'info' && (
                            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                            </svg>
                        )}
                        {type === 'success' && (
                            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                        )}
                    </div>

                    <h3 className="text-2xl font-bold text-white mb-3 tracking-tight">{title}</h3>
                    <p className="text-slate-400 leading-relaxed mb-8">{message}</p>

                    <div className="flex items-center gap-3 w-full">
                        <button
                            onClick={onClose}
                            className="flex-1 bg-white/5 hover:bg-white/10 text-white font-semibold py-4 rounded-2xl border border-white/5 transition-all text-sm"
                        >
                            {cancelText}
                        </button>
                        <button
                            onClick={() => {
                                onConfirm();
                                onClose();
                            }}
                            className={`flex-1 font-bold py-4 rounded-2xl transition-all text-sm shadow-lg ${typeColors[type]}`}
                        >
                            {confirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
