'use client';

/**
 * Shared presentation primitives + helpers for the GitHub-focused Repository
 * Intelligence dashboard. Kept local to this page (its own directory) so the
 * app's shared/global UI is untouched. Reuses the card / badge / avatar
 * patterns already used across PulseOps.
 */

export function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatAgo(ts) {
  if (!ts) return '';
  const mins = Math.max(
    1,
    Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  );
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// Conventional commit-type prefixes, mapped to app-consistent badge colors.
const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'chore',
  'refactor',
  'test',
  'style',
  'perf',
  'build',
  'ci',
  'revert',
];

const COMMIT_TYPE_STYLE = {
  feat: 'bg-emerald-50 text-emerald-700',
  fix: 'bg-rose-50 text-rose-700',
  docs: 'bg-sky-50 text-sky-700',
  chore: 'bg-slate-100 text-slate-600',
  refactor: 'bg-violet-50 text-violet-700',
  test: 'bg-amber-50 text-amber-700',
  style: 'bg-fuchsia-50 text-fuchsia-700',
  perf: 'bg-orange-50 text-orange-700',
  build: 'bg-slate-100 text-slate-600',
  ci: 'bg-slate-100 text-slate-600',
  revert: 'bg-rose-50 text-rose-700',
};

/** Returns the conventional-commit type for a message, or null if none. */
export function commitType(message = '') {
  const m = String(message).match(/^([a-z]+)(\(.+\))?:/);
  const prefix = m ? m[1] : null;
  return prefix && COMMIT_TYPES.includes(prefix) ? prefix : null;
}

export function CommitTypeBadge({ type }) {
  if (!type) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${COMMIT_TYPE_STYLE[type] || 'bg-slate-100 text-slate-600'}`}
    >
      {type}
    </span>
  );
}

export function GitHubIcon({ className = 'h-6 w-6 text-slate-700' }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function Avatar({ url, name, size = 'h-8 w-8', textClass = 'text-[11px]' }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name || 'contributor'}
        referrerPolicy="no-referrer"
        className={`${size} shrink-0 rounded-full object-cover ring-2 ring-slate-100`}
      />
    );
  }
  const initials = (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className={`${size} ${textClass} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 font-semibold text-white ring-2 ring-slate-100`}
    >
      {initials}
    </span>
  );
}

export function Badge({ children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-[#2A2A2A] px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-[#9B9B9B] ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = '' }) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionTitle({ icon: Icon, children, aside }) {
  return (
    <div className="flex items-center justify-between px-5 pt-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-[#E9E9E7]">
        {Icon && <Icon className="h-4 w-4 text-slate-400 dark:text-[#6F6F6F]" />}
        {children}
      </h3>
      {aside}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 dark:border-[#2F2F2F] bg-slate-50/40 dark:bg-[#202020]/40 px-4 py-8 text-center">
      {Icon && <Icon className="mx-auto h-5 w-5 text-slate-300 dark:text-slate-600" />}
      <p className="mt-2 text-sm font-medium text-slate-500 dark:text-[#9B9B9B]">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400 dark:text-[#6F6F6F]">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />;
}
