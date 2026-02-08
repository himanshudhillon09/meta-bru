'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { authApi } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';

export default function RegisterPage() {
    const { login: authLogin } = useAuth();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const data: any = await authApi.register({ name, email, password });

            if (data && typeof data === 'object' && 'token' in data) {
                if (data.isActive) {
                    setSuccess('Registration successful! Logging you in...');
                    authLogin(data.token as string, {
                        id: data._id,
                        name: data.name,
                        email: data.email,
                        role: data.role
                    });
                } else {
                    setSuccess('Account created successfully! Your account is pending admin approval.');
                    // Clear form
                    setName('');
                    setEmail('');
                    setPassword('');
                }
            }
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
                        <div className="relative group">
                            <input
                                className="w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 pr-12 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                            >
                                {showPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.644C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                    </svg>
                                )}
                            </button>
                        </div>
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
