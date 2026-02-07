import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center p-8">
      <main className="w-full max-w-[1200px] flex flex-col gap-16 mt-16 md:mt-24">
        <div className="text-center max-w-[850px] mx-auto">
          <h1 className="text-5xl md:text-7xl font-black leading-[1.1] mb-8 tracking-tight text-white">
            Master Your Workflow with <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-rose-500 bg-clip-text text-transparent">Meta-Bru</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-400 mb-10 leading-relaxed font-medium">
            The ultimate companion for developers. Build faster, brew better, and manage your projects with ease.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login" className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl font-bold text-lg transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-500/30 text-center">
              Get Started
            </Link>
            <a href="https://nextjs.org/docs" target="_blank" className="bg-white/5 hover:bg-white/10 text-white px-8 py-4 rounded-2xl font-bold text-lg border border-white/10 transition-all hover:border-white/20 text-center">
              Documentation
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-16">
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 p-10 rounded-[32px] hover:-translate-y-2 transition-all hover:bg-slate-900/60 hover:border-indigo-500/30 group">
            <h3 className="text-2xl font-bold mb-4 text-white group-hover:text-indigo-400 transition-colors">Seamless Integration</h3>
            <p className="text-slate-400 leading-relaxed">Connect your frontend and backend effortlessly with our pre-built patterns and optimized boilerplate.</p>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 p-10 rounded-[32px] hover:-translate-y-2 transition-all hover:bg-slate-900/60 hover:border-purple-500/30 group">
            <h3 className="text-2xl font-bold mb-4 text-white group-hover:text-purple-400 transition-colors">Premium Design</h3>
            <p className="text-slate-400 leading-relaxed">Stunning glassmorphism effects, vibrant gradients, and modern typography available right out of the box.</p>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 p-10 rounded-[32px] hover:-translate-y-2 transition-all hover:bg-slate-900/60 hover:border-rose-500/30 group">
            <h3 className="text-2xl font-bold mb-4 text-white group-hover:text-rose-400 transition-colors">Developer First</h3>
            <p className="text-slate-400 leading-relaxed">Built by developers, for developers. Every component is optimized for speed, accessibility, and scalability.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
