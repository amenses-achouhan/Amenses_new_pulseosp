'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { Check, Sun, Moon, Monitor, Palette, SlidersHorizontal } from 'lucide-react';
import { ACCENT_SWATCHES } from '../../../_components/WorkspaceSidebar';

import API_BASE from '../../../../lib/api';
import { fetchWithTimeout } from '../../../../lib/fetchWithTimeout';

export default function CustomizationPage() {
  const params = useParams();
  const { data: session } = useSession();
  const workspaceId = params?.workspaceId || session?.user?.activeOrganizationId;

  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [activeAccent, setActiveAccent] = useState('#4F46E5');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const applyAccentColor = useCallback((hex) => {
    const swatch = ACCENT_SWATCHES.find((s) => s.hex.toLowerCase() === hex.toLowerCase()) || ACCENT_SWATCHES[0];
    setActiveAccent(swatch.hex);
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--accent-500', swatch.hex);
      document.documentElement.style.setProperty('--accent-600', swatch.hover);
      document.documentElement.style.setProperty('--accent-50', swatch.lightBg);
    }
  }, []);

  // Fetch / restore active workspace accent choice
  useEffect(() => {
    if (!workspaceId) return;

    // Restore from localStorage
    const cached = typeof window !== 'undefined' ? localStorage.getItem(`pulseops_accent_${workspaceId}`) : null;
    if (cached) {
      applyAccentColor(cached);
    }

    let token = null;
    try { token = localStorage.getItem('pulseops_token'); } catch {}
    if (!token) return;

    fetchWithTimeout(`${API_BASE}/api/organizations/settings`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-organization-id': workspaceId,
      },
    }, 10000)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const color = data?.organization?.themeSettings?.primaryColor;
        if (color) {
          applyAccentColor(color);
          try { localStorage.setItem(`pulseops_accent_${workspaceId}`, color); } catch {}
        }
      })
      .catch(() => {});
  }, [workspaceId, applyAccentColor]);

  const handleSelectAccent = async (swatch) => {
    applyAccentColor(swatch.hex);
    try { localStorage.setItem(`pulseops_accent_${workspaceId}`, swatch.hex); } catch {}

    let token = null;
    try { token = localStorage.getItem('pulseops_token'); } catch {}
    if (!token || !workspaceId) return;

    setSaving(true);
    try {
      await fetchWithTimeout(`${API_BASE}/api/organizations/theme`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-organization-id': workspaceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ primaryColor: swatch.hex }),
      }, 10000);
    } catch (e) {
      console.error('Failed to persist workspace accent:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#E9E9E7] flex items-center gap-2.5">
          <SlidersHorizontal className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          Customization
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-[#9B9B9B]">
          Personalize your PulseOps workspace appearance and preferences.
        </p>
      </div>

      {/* Card 1: Workspace Theme Color */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] p-6 sm:p-7 shadow-2xs space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-[#E9E9E7] flex items-center gap-2">
              <Palette className="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
              Workspace Theme
            </h2>
            <p className="text-sm text-slate-500 dark:text-[#9B9B9B] mt-0.5">
              Choose the primary accent color for your workspace buttons, navigation, and focus indicators.
            </p>
          </div>
          {saving && (
            <span className="text-xs font-semibold text-slate-400 dark:text-[#6F6F6F] animate-pulse">
              Saving…
            </span>
          )}
        </div>

        {/* Swatches Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 pt-1">
          {ACCENT_SWATCHES.map((swatch) => {
            const isSelected = activeAccent.toLowerCase() === swatch.hex.toLowerCase();
            return (
              <button
                key={swatch.id}
                type="button"
                onClick={() => handleSelectAccent(swatch)}
                aria-label={`${swatch.label} theme`}
                aria-pressed={isSelected}
                className={`relative flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all outline-none focus:ring-2 focus:ring-indigo-500 ${
                  isSelected
                    ? 'border-slate-400 dark:border-[#4E5052] bg-slate-50/70 dark:bg-[#2A2A2A] shadow-2xs'
                    : 'border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] hover:border-slate-300 dark:hover:border-[#383838] hover:bg-slate-50/50 dark:hover:bg-[#262626]'
                }`}
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-2xs transition-transform"
                  style={{ backgroundColor: swatch.hex }}
                >
                  {isSelected && <Check className="h-4 w-4 text-white" />}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-slate-900 dark:text-[#E9E9E7] truncate">
                    {swatch.label}
                  </span>
                  <span className="block text-[10px] font-mono text-slate-400 dark:text-[#6F6F6F]">
                    {swatch.hex}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Card 2: Appearance (Light / Dark / System) */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] p-6 sm:p-7 shadow-2xs space-y-6">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-[#E9E9E7] flex items-center gap-2">
            <Sun className="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
            Appearance
          </h2>
          <p className="text-sm text-slate-500 dark:text-[#9B9B9B] mt-0.5">
            Select your preferred display theme interface for PulseOps.
          </p>
        </div>

        {mounted ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1">
            {/* Light */}
            <button
              type="button"
              onClick={() => setTheme('light')}
              aria-label="Light theme mode"
              aria-pressed={theme === 'light'}
              className={`flex items-center gap-3 rounded-xl border p-4 transition-all outline-none focus:ring-2 focus:ring-indigo-500 ${
                theme === 'light'
                  ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-200 font-bold shadow-2xs'
                  : 'border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] text-slate-700 dark:text-[#E9E9E7] hover:bg-slate-50 dark:hover:bg-[#2A2A2A]'
              }`}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-[#191919] text-amber-500">
                <Sun className="h-4.5 w-4.5" />
              </div>
              <div className="text-left">
                <span className="block text-sm font-semibold">Light</span>
                <span className="block text-xs font-normal text-slate-400 dark:text-[#6F6F6F]">Clean light background</span>
              </div>
            </button>

            {/* Dark */}
            <button
              type="button"
              onClick={() => setTheme('dark')}
              aria-label="Dark theme mode"
              aria-pressed={theme === 'dark'}
              className={`flex items-center gap-3 rounded-xl border p-4 transition-all outline-none focus:ring-2 focus:ring-indigo-500 ${
                theme === 'dark'
                  ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-200 font-bold shadow-2xs'
                  : 'border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] text-slate-700 dark:text-[#E9E9E7] hover:bg-slate-50 dark:hover:bg-[#2A2A2A]'
              }`}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-[#191919] text-indigo-400">
                <Moon className="h-4.5 w-4.5" />
              </div>
              <div className="text-left">
                <span className="block text-sm font-semibold">Dark</span>
                <span className="block text-xs font-normal text-slate-400 dark:text-[#6F6F6F]">Notion dark surface</span>
              </div>
            </button>

            {/* System */}
            <button
              type="button"
              onClick={() => setTheme('system')}
              aria-label="System default theme mode"
              aria-pressed={theme === 'system'}
              className={`flex items-center gap-3 rounded-xl border p-4 transition-all outline-none focus:ring-2 focus:ring-indigo-500 ${
                theme === 'system'
                  ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-200 font-bold shadow-2xs'
                  : 'border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] text-slate-700 dark:text-[#E9E9E7] hover:bg-slate-50 dark:hover:bg-[#2A2A2A]'
              }`}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-[#191919] text-slate-500 dark:text-slate-400">
                <Monitor className="h-4.5 w-4.5" />
              </div>
              <div className="text-left">
                <span className="block text-sm font-semibold">System</span>
                <span className="block text-xs font-normal text-slate-400 dark:text-[#6F6F6F]">Sync with OS preferences</span>
              </div>
            </button>
          </div>
        ) : (
          <div className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-[#2A2A2A]" />
        )}
      </div>
    </div>
  );
}
