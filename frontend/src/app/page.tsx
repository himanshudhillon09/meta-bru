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
            Powered by Meta Graph API
          </div>
          <h1 className="text-5xl md:text-7xl font-black leading-[1.1] mb-8 tracking-tight text-white">
            Amplify your Social Impact with <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-rose-500 bg-clip-text text-transparent">Meta-Bru</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-400 mb-10 leading-relaxed font-medium">
            Harness the power of Meta's Graph API to discover inspiration, remix content with AI, and automate your social presence at scale.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {user ? (
              <Link href="/dashboard" className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl font-bold text-lg transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-500/30 text-center">
                Go to Dashboard
              </Link>
            ) : (
              <Link href="/login" className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl font-bold text-lg transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-500/30 text-center">
                Start Building
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
            <h3 className="text-2xl font-bold mb-4 text-white group-hover:text-indigo-400 transition-colors">Discovery Engine</h3>
            <p className="text-slate-400 leading-relaxed">Leverage Meta's Pages Search API to find public inspiration and trending content in real-time across the ecosystem.</p>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 p-10 rounded-[32px] hover:-translate-y-2 transition-all hover:bg-slate-900/60 hover:border-purple-500/30 group">
            <div className="w-12 h-12 bg-purple-500/20 rounded-2xl flex items-center justify-center mb-6 border border-purple-500/20 group-hover:bg-purple-500/30 transition-colors">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            </div>
            <h3 className="text-2xl font-bold mb-4 text-white group-hover:text-purple-400 transition-colors">AI Creative Studio</h3>
            <p className="text-slate-400 leading-relaxed">Turn inspiration into original masterpieces. Use integrated AI models to remix content while maintaining full copyright compliance.</p>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 p-10 rounded-[32px] hover:-translate-y-2 transition-all hover:bg-slate-900/60 hover:border-rose-500/30 group">
            <div className="w-12 h-12 bg-rose-500/20 rounded-2xl flex items-center justify-center mb-6 border border-rose-500/20 group-hover:bg-rose-500/30 transition-colors">
              <svg className="w-6 h-6 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </div>
            <h3 className="text-2xl font-bold mb-4 text-white group-hover:text-rose-400 transition-colors">Growth Automation</h3>
            <p className="text-slate-400 leading-relaxed">Schedule, manage, and publish posts directly to your own Meta pages with intelligent workflows that drive engagement.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
