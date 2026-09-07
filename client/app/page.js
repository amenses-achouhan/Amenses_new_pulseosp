'use client';

import { useState } from 'react';
import Link from 'next/link';
import ThemeToggle from './_components/ThemeToggle';
import {
  GitBranch,
  MessageSquare,
  ListTodo,
  Shield,
  Zap,
  Layers,
  ArrowRight,
  Menu,
  X,
  CheckCircle2,
  Lock,
  RefreshCw,
  Search,
  ExternalLink,
  Code2,
  Terminal,
  Activity,
  Cpu,
} from 'lucide-react';

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] font-sans selection:bg-indigo-100 selection:text-indigo-900 dark:selection:bg-indigo-900/40 dark:selection:text-indigo-100 transition-colors duration-200">
      {/* ---------------- 1. NAVBAR ---------------- */}
      <header className="sticky top-0 z-50 bg-[var(--bg)]/90 backdrop-blur-md border-b border-[var(--border)] transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between py-4">
          {/* Left: Brand Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="h-8 w-8 rounded-lg bg-slate-900 dark:bg-slate-100 flex items-center justify-center text-white dark:text-slate-900 shadow-sm group-hover:scale-105 transition-all">
              {/* 3 rounded vertical bars logo icon */}
              <div className="flex items-center gap-0.5">
                <span className="w-1 h-3.5 bg-white dark:bg-slate-900 rounded-full"></span>
                <span className="w-1 h-5 bg-white dark:bg-slate-900 rounded-full"></span>
                <span className="w-1 h-3.5 bg-white dark:bg-slate-900 rounded-full"></span>
              </div>
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-[var(--text-primary)]">
              PulseOps
            </span>
          </Link>

          {/* Center Navigation Links (Desktop) */}
          <nav className="hidden md:flex items-center gap-8">
            <a
              href="#product"
              className="text-sm font-medium text-slate-600 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors"
            >
              Product
            </a>
            <a
              href="#integrations"
              className="text-sm font-medium text-slate-600 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors"
            >
              Integrations
            </a>
            <a
              href="#pricing"
              className="text-sm font-medium text-slate-600 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors"
            >
              Pricing
            </a>
            <a
              href="#docs"
              className="text-sm font-medium text-slate-600 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors"
            >
              Docs
            </a>
            <a
              href="#changelog"
              className="text-sm font-medium text-slate-600 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors"
            >
              Changelog
            </a>
          </nav>

          {/* Right Action CTAs */}
          <div className="hidden md:flex items-center gap-4">
            <ThemeToggle />
            <Link
              href="/login"
              className="text-sm font-semibold text-slate-700 dark:text-[var(--text-secondary)] hover:text-slate-900 dark:hover:text-[var(--text-primary)] px-3 py-2 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="text-sm font-semibold text-white bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 px-4 py-2 rounded-xl transition-all shadow-sm hover:shadow-md"
            >
              Get Started
            </Link>
          </div>

          {/* Mobile Hamburger Toggle Button */}
          <div className="md:hidden flex items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-slate-600 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] focus:outline-none"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-[var(--surface)] border-b border-[var(--border)] px-4 pt-3 pb-6 space-y-3 shadow-lg">
            <a
              href="#product"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-base font-medium text-slate-700 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] py-1"
            >
              Product
            </a>
            <a
              href="#integrations"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-base font-medium text-slate-700 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] py-1"
            >
              Integrations
            </a>
            <a
              href="#pricing"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-base font-medium text-slate-700 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] py-1"
            >
              Pricing
            </a>
            <a
              href="#docs"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-base font-medium text-slate-700 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] py-1"
            >
              Docs
            </a>
            <a
              href="#changelog"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-base font-medium text-slate-700 dark:text-[#9B9B9B] hover:text-slate-900 dark:hover:text-[#E9E9E7] py-1"
            >
              Changelog
            </a>
            <div className="pt-3 border-t border-slate-100 dark:border-[#2F2F2F] flex flex-col gap-2">
              <Link
                href="/login"
                className="w-full text-center py-2.5 text-sm font-semibold text-slate-800 dark:text-[#E9E9E7] bg-slate-100 dark:bg-[#202020] rounded-xl"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="w-full text-center py-2.5 text-sm font-semibold text-white bg-slate-900 dark:bg-indigo-600 rounded-xl"
              >
                Get Started
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* ---------------- 2. HERO SECTION ---------------- */}
      <section className="relative pt-16 md:pt-24 pb-12 overflow-hidden" id="product">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          
          {/* Rotated Sticky Note Tag (Top-right of Hero) */}
          <div className="hidden lg:block absolute top-0 right-12 z-20">
            <div className="relative rotate-[-4deg] bg-[#FFFDF7] dark:bg-[#202020] border border-amber-200/70 dark:border-amber-700/50 rounded-xl p-4 shadow-md shadow-amber-900/5 max-w-[190px]">
              <p className="font-handwriting text-slate-800 dark:text-amber-200 text-xl font-bold leading-tight">
                Less switching.
                <br />
                More shipping.
              </p>
              {/* Hand-drawn arrow pointing down-left toward headline */}
              <svg
                viewBox="0 0 50 50"
                fill="none"
                stroke="currentColor"
                className="w-8 h-8 text-slate-400 dark:text-amber-500/60 absolute -bottom-6 -left-5 rotate-12"
              >
                <path
                  d="M40 5 C 25 15, 10 25, 12 40 M 12 40 L 5 32 M 12 40 L 20 38"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          {/* Hero Content Center Stack */}
          <div className="max-w-3xl">
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 mb-6">
              <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400"></span>
              <span className="text-[11px] sm:text-xs font-bold tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">
                ONE WORKSPACE. FULL CONTEXT.
              </span>
            </div>

            {/* Main Headline with Indigo Hand-drawn Underline */}
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-slate-900 dark:text-[#E9E9E7] leading-[1.08]">
              Everything in{' '}
              <span className="relative inline-block text-slate-900 dark:text-[#E9E9E7]">
                one place.
                {/* Indigo Curved Hand-drawn SVG Underline */}
                <svg
                  viewBox="0 0 240 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="absolute -bottom-2 left-0 w-full h-5 text-indigo-600 dark:text-indigo-400 overflow-visible pointer-events-none"
                >
                  <path
                    d="M 4 14 Q 120 4 236 12 C 180 18 60 18 20 15"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </h1>

            {/* Subcopy */}
            <p className="mt-6 text-lg sm:text-xl text-slate-600 dark:text-[#9B9B9B] leading-relaxed font-normal max-w-2xl">
              PulseOps unifies your repositories, communication, and task management so your team always knows what&apos;s happening.
            </p>

            {/* Mobile note callout display */}
            <div className="lg:hidden mt-6 inline-block bg-[#FFFDF7] dark:bg-[#202020] border border-amber-200/70 dark:border-amber-700/50 rounded-xl p-3 shadow-sm rotate-[-2deg]">
              <span className="font-handwriting text-slate-800 dark:text-amber-200 text-lg font-bold">
                Less switching. More shipping. ✨
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 3. CORE PRODUCT FLOW ---------------- */}
      <section className="py-12 md:py-20 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Horizontal desktop flow container / Vertical mobile stack */}
          <div className="relative">
            
            {/* Background Connector Line (Desktop Horizontal) */}
            <div className="hidden md:block absolute top-[44px] left-[10%] right-[10%] h-[2px] z-0 bg-gradient-to-r from-indigo-400 via-emerald-400 via-amber-400 to-slate-900 dark:from-indigo-600 dark:via-emerald-600 dark:via-amber-600 dark:to-indigo-500" />
            
            {/* Step Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-4 lg:gap-6 relative z-10 items-start">
              
              {/* ------------ Step 01: Repository ------------ */}
              <div className="flex flex-col items-center text-center group">
                <div className="relative">
                  {/* Soft Indigo Splash Backdrop */}
                  <div className="absolute inset-0 bg-indigo-200/60 dark:bg-indigo-900/30 rounded-3xl blur-xl group-hover:scale-110 transition-transform" />
                  
                  {/* Icon Box */}
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 bg-white dark:bg-[#202020] border border-slate-200/80 dark:border-[#2F2F2F] rounded-2xl shadow-sm flex items-center justify-center group-hover:shadow-md transition-shadow">
                    <svg
                      className="w-10 h-10 text-slate-900 dark:text-[#E9E9E7]"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                      />
                    </svg>
                  </div>
                </div>

                {/* Badge & Arrow Container */}
                <div className="flex items-center gap-2 mt-4 mb-2">
                  <span className="bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-bold text-xs px-2.5 py-0.5 rounded-full">
                    01
                  </span>
                  <span className="text-slate-400 dark:text-[#6F6F6F] hidden md:inline text-xs font-mono">→</span>
                  <span className="text-slate-400 dark:text-[#6F6F6F] md:hidden text-xs font-mono">↓</span>
                </div>

                <h3 className="font-bold text-slate-900 dark:text-[#E9E9E7] text-base sm:text-lg">
                  Repository
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-[#9B9B9B] mt-1 max-w-[200px] leading-relaxed">
                  All your code, commits, PRs, and issues.
                </p>
              </div>

              {/* ------------ Step 02: Communication ------------ */}
              <div className="flex flex-col items-center text-center group">
                <div className="relative">
                  {/* Soft Green Splash Backdrop */}
                  <div className="absolute inset-0 bg-emerald-200/60 dark:bg-emerald-900/30 rounded-3xl blur-xl group-hover:scale-110 transition-transform" />
                  
                  {/* Icon Box */}
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 bg-white dark:bg-[#202020] border border-slate-200/80 dark:border-[#2F2F2F] rounded-2xl shadow-sm flex items-center justify-center group-hover:shadow-md transition-shadow">
                    <MessageSquare className="w-10 h-10 text-slate-900 dark:text-[#E9E9E7]" strokeWidth={1.75} />
                  </div>
                </div>

                {/* Badge & Arrow Container */}
                <div className="flex items-center gap-2 mt-4 mb-2">
                  <span className="bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold text-xs px-2.5 py-0.5 rounded-full">
                    02
                  </span>
                  <span className="text-slate-400 dark:text-[#6F6F6F] hidden md:inline text-xs font-mono">→</span>
                  <span className="text-slate-400 dark:text-[#6F6F6F] md:hidden text-xs font-mono">↓</span>
                </div>

                <h3 className="font-bold text-slate-900 dark:text-[#E9E9E7] text-base sm:text-lg">
                  Communication
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-[#9B9B9B] mt-1 max-w-[200px] leading-relaxed">
                  Conversations, updates, mentions, and decisions.
                </p>
              </div>

              {/* ------------ Step 03: Task Management ------------ */}
              <div className="flex flex-col items-center text-center group">
                <div className="relative">
                  {/* Soft Amber Splash Backdrop */}
                  <div className="absolute inset-0 bg-amber-200/60 dark:bg-amber-900/30 rounded-3xl blur-xl group-hover:scale-110 transition-transform" />
                  
                  {/* Icon Box */}
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 bg-white dark:bg-[#202020] border border-slate-200/80 dark:border-[#2F2F2F] rounded-2xl shadow-sm flex items-center justify-center group-hover:shadow-md transition-shadow">
                    <ListTodo className="w-10 h-10 text-slate-900 dark:text-[#E9E9E7]" strokeWidth={1.75} />
                  </div>
                </div>

                {/* Badge & Arrow Container */}
                <div className="flex items-center gap-2 mt-4 mb-2">
                  <span className="bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 font-bold text-xs px-2.5 py-0.5 rounded-full">
                    03
                  </span>
                  <span className="text-slate-400 dark:text-[#6F6F6F] hidden md:inline text-xs font-mono">→</span>
                  <span className="text-slate-400 dark:text-[#6F6F6F] md:hidden text-xs font-mono">↓</span>
                </div>

                <h3 className="font-bold text-slate-900 dark:text-[#E9E9E7] text-base sm:text-lg">
                  Task Management
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-[#9B9B9B] mt-1 max-w-[200px] leading-relaxed">
                  Tasks, milestones, deadlines, and progress.
                </p>
              </div>

              {/* ------------ Step 04: PulseOps (Destination) ------------ */}
              <div className="flex flex-col items-center text-center group">
                <div className="relative flex items-center justify-center">
                  {/* Dashed Circular Orbit Ring */}
                  <div className="absolute w-32 h-32 sm:w-36 sm:h-36 border-2 border-dashed border-slate-300 dark:border-[#2F2F2F] rounded-full animate-[spin_40s_linear_infinite]" />
                  
                  {/* Dark Icon Card */}
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 bg-slate-900 dark:bg-[#202020] border border-slate-800 dark:border-[#2F2F2F] rounded-2xl shadow-xl flex items-center justify-center group-hover:scale-105 transition-transform z-10">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-5 bg-white rounded-full"></span>
                      <span className="w-1.5 h-8 bg-white rounded-full"></span>
                      <span className="w-1.5 h-5 bg-white rounded-full"></span>
                    </div>
                  </div>
                </div>

                {/* Badge Container */}
                <div className="flex items-center gap-2 mt-4 mb-2">
                  <span className="bg-slate-900 dark:bg-indigo-600 text-white font-bold text-xs px-2.5 py-0.5 rounded-full">
                    04
                  </span>
                </div>

                <h3 className="font-bold text-slate-900 dark:text-[#E9E9E7] text-base sm:text-lg">
                  PulseOps
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-[#9B9B9B] mt-1 max-w-[200px] font-medium leading-relaxed">
                  One workspace.
                  <br />
                  Full context.
                  <br />
                  Total clarity.
                </p>
              </div>

            </div>
          </div>



        </div>
      </section>

      {/* ---------------- 4. VALUE / WHY PULSEOPS ---------------- */}
      <section className="py-16 md:py-24 bg-white dark:bg-[#18191B] border-y border-slate-200/60 dark:border-[#2F2F2F]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <span className="text-xs font-bold tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">
              WHY PULSEOPS
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-[#E9E9E7] mt-2 tracking-tight">
              One source of truth for engineering teams
            </h2>
            <p className="text-slate-600 dark:text-[#9B9B9B] mt-4 text-base sm:text-lg leading-relaxed">
              Stop stitching together disconnected tools. PulseOps unifies your entire development lifecycle into a single, contextual workspace.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12 sm:mt-16">
            
            <div className="p-6 rounded-2xl bg-[#FAFAFC] dark:bg-[#202020] border border-slate-200/80 dark:border-[#2F2F2F] space-y-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-[#E9E9E7]">
                Less Tool Switching
              </h3>
              <p className="text-sm text-slate-600 dark:text-[#9B9B9B] leading-relaxed">
                Eliminate constant tab-hopping between repository hosts, team chat, and project management boards.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-[#FAFAFC] dark:bg-[#202020] border border-slate-200/80 dark:border-[#2F2F2F] space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <Activity className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-[#E9E9E7]">
                Real-Time Project Visibility
              </h3>
              <p className="text-sm text-slate-600 dark:text-[#9B9B9B] leading-relaxed">
                Get an instant pulse on commit velocity, active discussions, PR status, and blockers across all projects.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-[#FAFAFC] dark:bg-[#202020] border border-slate-200/80 dark:border-[#2F2F2F] space-y-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-[#E9E9E7]">
                Complete Project Awareness
              </h3>
              <p className="text-sm text-slate-600 dark:text-[#9B9B9B] leading-relaxed">
                Every code change is linked to its discussion thread and task milestone. Never lose context again.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* ---------------- 5. INTEGRATIONS ---------------- */}
      <section className="py-16 md:py-24" id="integrations">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <span className="text-xs font-bold tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">
              ECOSYSTEM & INTEGRATIONS
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-[#E9E9E7] mt-2 tracking-tight">
              Connect your stack in minutes
            </h2>
            <p className="text-slate-600 dark:text-[#9B9B9B] mt-3 text-base sm:text-lg">
              PulseOps seamlessly connects with the tools your team relies on daily.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 sm:gap-6 mt-12">
            {[
              { name: 'GitHub', desc: 'Repos, PRs & Commits' },
              { name: 'Slack', desc: 'Channels & Mentions' },
              { name: 'Jira', desc: 'Tasks & Milestones' },
              { name: 'Linear', desc: 'Issues & Cycles' },
              { name: 'GitLab', desc: 'CI/CD & Code' },
              { name: 'Notion', desc: 'Docs & Wiki' },
            ].map((tool) => (
              <div
                key={tool.name}
                className="bg-white dark:bg-[#202020] border border-slate-200/80 dark:border-[#2F2F2F] rounded-2xl p-5 text-center flex flex-col items-center justify-center shadow-sm hover:shadow-md transition-shadow group"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-50 dark:bg-[#2A2A2A] border border-slate-100 dark:border-[#3D3F41] flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <Terminal className="w-6 h-6 text-slate-800 dark:text-[#E9E9E7]" />
                </div>
                <h4 className="font-bold text-slate-900 dark:text-[#E9E9E7] text-sm">{tool.name}</h4>
                <p className="text-[11px] text-slate-500 dark:text-[#9B9B9B] mt-1">{tool.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- 6. HOW IT WORKS ---------------- */}
      <section className="py-16 md:py-24 bg-white dark:bg-[#18191B] border-y border-slate-200/60 dark:border-[#2F2F2F]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-bold tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">
              WORKFLOW
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-[#E9E9E7] mt-2 tracking-tight">
              How PulseOps works
            </h2>
            <p className="text-slate-600 dark:text-[#9B9B9B] mt-3 text-base sm:text-lg">
              Four steps from fragmented tools to total engineering clarity.
            </p>
          </div>

          <div className="relative">
            {/* Desktop Connector Line */}
            <div className="hidden md:block absolute top-6 left-[12%] right-[12%] h-[2px] bg-slate-200 dark:bg-[#2F2F2F] z-0" />

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative z-10">
              {[
                {
                  step: '01',
                  title: 'Connect your tools',
                  desc: 'Link your repositories, communication channels, and task boards in under 2 minutes.',
                },
                {
                  step: '02',
                  title: 'Bring activity together',
                  desc: 'PulseOps automatically streams commits, PRs, comments, and task updates into one feed.',
                },
                {
                  step: '03',
                  title: 'Understand what’s happening',
                  desc: 'Cross-reference code changes directly with discussions and team decisions in real time.',
                },
                {
                  step: '04',
                  title: 'Ship with full context',
                  desc: 'Deliver software faster with zero tool-switching friction and zero context loss.',
                },
              ].map((item) => (
                <div key={item.step} className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-slate-900 dark:bg-[#202020] border border-transparent dark:border-[#2F2F2F] text-white dark:text-[#E9E9E7] font-bold flex items-center justify-center mb-4 text-sm shadow-md">
                    {item.step}
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-[#E9E9E7] text-base">{item.title}</h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-[#9B9B9B] mt-2 leading-relaxed max-w-[220px]">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 7. SECURITY / CONTROL ---------------- */}
      <section className="py-16 md:py-24" id="docs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <span className="text-xs font-bold tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">
              SECURITY & PRIVACY
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-[#E9E9E7] mt-2 tracking-tight">
              Your data. Your control.
            </h2>
            <p className="text-slate-600 dark:text-[#9B9B9B] mt-4 text-base sm:text-lg">
              Enterprise-grade security and total ownership built into every level of the platform.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12 sm:mt-16">
            <div className="p-6 rounded-2xl bg-white dark:bg-[#202020] border border-slate-200/80 dark:border-[#2F2F2F] shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-[#2A2A2A] flex items-center justify-center text-slate-900 dark:text-[#E9E9E7]">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-[#E9E9E7]">Data Ownership</h3>
              <p className="text-sm text-slate-500 dark:text-[#9B9B9B] leading-relaxed">
                Your code and conversations remain 100% strictly yours. We never train AI models on your private data.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white dark:bg-[#202020] border border-slate-200/80 dark:border-[#2F2F2F] shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-[#2A2A2A] flex items-center justify-center text-slate-900 dark:text-[#E9E9E7]">
                <Shield className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-[#E9E9E7]">Controlled Access</h3>
              <p className="text-sm text-slate-500 dark:text-[#9B9B9B] leading-relaxed">
                Granular role-based permissions (Owner, Admin, Tech Lead, Dev) across all workspaces and repos.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white dark:bg-[#202020] border border-slate-200/80 dark:border-[#2F2F2F] shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-[#2A2A2A] flex items-center justify-center text-slate-900 dark:text-[#E9E9E7]">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-[#E9E9E7]">End-to-End Security</h3>
              <p className="text-sm text-slate-500 dark:text-[#9B9B9B] leading-relaxed">
                Encrypted data in transit and at rest, automated vulnerability scanning, and hardened API endpoints.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 8. FINAL CTA ---------------- */}
      <section className="py-12 md:py-16 bg-white dark:bg-[#18191B] border-t border-slate-200/60 dark:border-[#2F2F2F]" id="pricing">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-slate-900 dark:bg-[#202020] border border-transparent dark:border-[#2F2F2F] text-white rounded-2xl sm:rounded-3xl py-8 sm:py-10 px-6 sm:px-12 text-center relative overflow-hidden shadow-2xl">
            <div className="relative z-10 max-w-3xl mx-auto space-y-4">
              <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight">
                Everything your team needs. One place.
              </h2>
              <p className="text-slate-300 text-sm sm:text-base">
                Join engineering teams shipping faster with full project context. Set up your workspace in under 2 minutes.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
                <Link
                  href="/register"
                  className="w-full sm:w-auto bg-white hover:bg-slate-100 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-slate-900 dark:text-white font-bold px-6 py-3 rounded-xl transition-all shadow-md text-sm"
                >
                  Get Started
                </Link>
                <a
                  href="#integrations"
                  className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 dark:bg-[#2A2A2A] dark:hover:bg-[#333333] text-slate-200 font-semibold px-6 py-3 rounded-xl transition-all border border-slate-700 dark:border-[#3D3F41] text-sm"
                >
                  Explore Integrations
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 9. FOOTER ---------------- */}
      <footer className="bg-[#FAFAFC] dark:bg-[#18191B] border-t border-slate-200/80 dark:border-[#2F2F2F] py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            
            {/* Logo Wordmark */}
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-slate-900 dark:bg-indigo-600 flex items-center justify-center text-white">
                <div className="flex items-center gap-0.5">
                  <span className="w-1 h-3 bg-white rounded-full"></span>
                  <span className="w-1 h-4.5 bg-white rounded-full"></span>
                  <span className="w-1 h-3 bg-white rounded-full"></span>
                </div>
              </div>
              <span className="text-lg font-bold text-slate-900 dark:text-[#E9E9E7] tracking-tight">
                PulseOps
              </span>
            </div>

            {/* Nav Footer Links */}
            <div className="flex flex-wrap items-center justify-center gap-6 text-xs sm:text-sm font-medium text-slate-600 dark:text-[#9B9B9B]">
              <a href="#product" className="hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors">
                Product
              </a>
              <a href="#integrations" className="hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors">
                Integrations
              </a>
              <a href="#pricing" className="hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors">
                Pricing
              </a>
              <a href="#docs" className="hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors">
                Docs
              </a>
              <a href="#changelog" className="hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors">
                Changelog
              </a>
              <Link href="/login" className="hover:text-slate-900 dark:hover:text-[#E9E9E7] transition-colors">
                Sign in
              </Link>
              <Link href="/register" className="hover:text-slate-900 dark:hover:text-indigo-400 transition-colors font-semibold text-slate-900 dark:text-indigo-400">
                Get Started
              </Link>
            </div>

          </div>

          <div className="mt-8 pt-6 border-t border-slate-200/60 dark:border-[#2F2F2F] flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 dark:text-[#6F6F6F] gap-4">
            <p>© {new Date().getFullYear()} PulseOps, Inc. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <a href="#docs" className="hover:text-slate-700 dark:hover:text-[#9B9B9B]">Privacy Policy</a>
              <a href="#docs" className="hover:text-slate-700 dark:hover:text-[#9B9B9B]">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
