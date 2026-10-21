'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';

export default function Home() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center p-8">
      {user && (
        <div className="fixed top-8 right-8 z-50">
          <button
            onClick={logout}
            className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          >
            Log Out
          </button>
        </div>
      )}
      <main className="w-full max-w-[1200px] flex flex-col gap-16 mt-16 md:mt-24">
        <div className="text-center max-w-[850px] mx-auto flex flex-col items-center">
          <Image
            src="/icon.png"
            alt="Meta-Bru Logo"
            width={80}
            height={80}
            className="mb-8 rounded-2xl shadow-2xl shadow-indigo-500/20"
          />
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm font-semibold mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            Built for Facebook Pages + Instagram
          </div>
          <h1 className="text-5xl md:text-7xl font-black leading-[1.1] mb-8 tracking-tight text-white">
            One great post, <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-rose-500 bg-clip-text text-transparent">every day</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-400 mb-10 leading-relaxed font-medium">
            Connect your Pages, let Gemini help with the caption or image, and
            publish one image post per day to Facebook and Instagram on a
            schedule you control.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {user ? (
              <Link href="/dashboard" className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl font-bold text-lg transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-500/30 text-center">
                Go to Dashboard
              </Link>
            ) : (
              <Link href="/login" className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl font-bold text-lg transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-500/30 text-center">
                Start publishing
              </Link>
            )}
            <a href="#features" className="bg-white/5 hover:bg-white/10 text-white px-8 py-4 rounded-2xl font-bold text-lg border border-white/10 transition-all hover:border-white/20 text-center">
              Explore Features
            </a>
          </div>
        </div>

        <div id="features" className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-16">
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 p-10 rounded-[32px] hover:-translate-y-2 transition-all hover:bg-slate-900/60 hover:border-indigo-500/30 group">
            <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center mb-6 border border-indigo-500/20 group-hover:bg-indigo-500/30 transition-colors">
              <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            </div>
            <h3 className="text-2xl font-bold mb-4 text-white group-hover:text-indigo-400 transition-colors">Unified connections</h3>
            <p className="text-slate-400 leading-relaxed">Connect a Facebook Page once. Meta-Bru detects its linked Instagram Business account and keeps both destinations in one daily queue.</p>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 p-10 rounded-[32px] hover:-translate-y-2 transition-all hover:bg-slate-900/60 hover:border-purple-500/30 group">
            <div className="w-12 h-12 bg-purple-500/20 rounded-2xl flex items-center justify-center mb-6 border border-purple-500/20 group-hover:bg-purple-500/30 transition-colors">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            </div>
            <h3 className="text-2xl font-bold mb-4 text-white group-hover:text-purple-400 transition-colors">AI creative studio</h3>
            <p className="text-slate-400 leading-relaxed">Draft captions and generate images with Gemini, guided by the brand profile you set once in Settings.</p>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 p-10 rounded-[32px] hover:-translate-y-2 transition-all hover:bg-slate-900/60 hover:border-rose-500/30 group">
            <div className="w-12 h-12 bg-rose-500/20 rounded-2xl flex items-center justify-center mb-6 border border-rose-500/20 group-hover:bg-rose-500/30 transition-colors">
              <svg className="w-6 h-6 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </div>
            <h3 className="text-2xl font-bold mb-4 text-white group-hover:text-rose-400 transition-colors">Daily growth automation</h3>
            <p className="text-slate-400 leading-relaxed">Queue image posts in order and let the scheduler publish the next one at each Page&apos;s local time. Pause or reconnect any Page at any time.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
