'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { authApi } from '@/lib/apiClient';

export default function RegisterPage() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            await authApi.register({ name, email, password });
            setSuccess('Registration successful! You can now log in.');
            // Clear form
            setName('');
            setEmail('');
            setPassword('');
        } catch (err: any) {
            setError(err || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="bg-slate-900/70 backdrop-blur-xl border border-white/10 rounded-[24px] p-8 md:p-12 w-full max-w-[440px] shadow-2xl">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-extrabold mb-2 bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
                        Create Account
                    </h1>
                    <p className="text-slate-400">Join Meta-Bru today</p>
                </div>

                <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-slate-400 ml-1" htmlFor="name">
                            Full Name
                        </label>
                        <input
                            className="bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                            id="name"
                            type="text"
                            placeholder="John Doe"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-slate-400 ml-1" htmlFor="email">
                            Email Address
                        </label>
                        <input
                            className="bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                            id="email"
                            type="email"
                            placeholder="johndoe@gmail.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-slate-400 ml-1" htmlFor="password">
                            Password
                        </label>
                        <input
                            className="bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                            id="password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {error && (
                        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-xl text-sm text-center">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-3 rounded-xl text-sm text-center">
                            {success}
                        </div>
                    )}

                    <button
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3.5 rounded-xl transition-all hover:-translate-y-0.5 active:translate-y-0 shadow-lg shadow-indigo-500/25 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
                        type="submit"
                        disabled={loading}
                    >
                        {loading ? 'Creating account...' : 'Create Account'}
                    </button>

                    <p className="text-center text-slate-400 text-sm mt-4">
                        Already have an account?{' '}
                        <Link href="/login" className="text-indigo-400 hover:text-indigo-300 font-semibold">
                            Sign In
                        </Link>
                    </p>
                </form>
            </div>
        </div>
    );
}
