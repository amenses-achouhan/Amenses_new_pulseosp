'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

// TASK-107 — theme engine. The workspace shell exposes the active organization's
// themeSettings (primaryColor / accentColor / sidebarBg / darkMode) to the UI
// via React context AND CSS custom properties (--pulse-primary, --pulse-accent,
// --pulse-sidebar-bg). Values refresh whenever the session/token changes so
// switching workspaces re-themes the shell automatically.

import API_BASE from '../../lib/api';
import { fetchJSONWithTimeout } from '../../lib/fetchWithTimeout';
const ME_ENDPOINT = `${API_BASE}/api/auth/me`;

export const DEFAULT_THEME = {
  primaryColor: '#4F46E5',
  accentColor: '#10B981',
  sidebarBg: '#1E293B',
  darkMode: false,
};

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  applied: false,
});

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeProvider({ children }) {
  const { data: session, status } = useSession();
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [applied, setApplied] = useState(false);

  // Pull the active organization's themeSettings from /api/auth/me. The API
  // returns themeSettings only for the active organization (added in the
  // /me handler); unauthenticated or non-member requests keep defaults.
  useEffect(() => {
    if (status !== 'authenticated' || !session?.accessToken) {
      setApplied(true);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, res } = await fetchJSONWithTimeout(ME_ENDPOINT, {
          headers: { Authorization: `Bearer ${session.accessToken.trim()}` },
        }, 10000);
        if (cancelled) return;
        if (res.ok && data?.activeOrganization?.themeSettings) {
          setTheme({
            ...DEFAULT_THEME,
            ...data.activeOrganization.themeSettings,
          });
        }
      } catch (err) {
        // Network/API unavailable — keep defaults, never crash the shell.
      } finally {
        if (!cancelled) setApplied(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, session?.accessToken]);

  // Mirror the theme onto CSS custom properties so any element can consume it.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--pulse-primary', theme.primaryColor || DEFAULT_THEME.primaryColor);
    root.style.setProperty('--pulse-accent', theme.accentColor || DEFAULT_THEME.accentColor);
    root.style.setProperty('--pulse-sidebar-bg', theme.sidebarBg || DEFAULT_THEME.sidebarBg);
    if (theme.darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, applied }}>{children}</ThemeContext.Provider>
  );
}