'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SlackSidebarSection from './SlackSidebarSection';
import { isSectionVisible } from './sidebarRbacConfig';
import {
  LayoutDashboard,
  GitBranch,
  MessagesSquare,
  ListTodo,
  BarChart,
  Users,
  UserPlus,
  FileText,
  Ticket,
  Puzzle,
  Key,
  FolderKanban,
} from 'lucide-react';

import { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { hasPermission } from '../_lib/permissions';

import API_BASE from '../../lib/api';
import { fetchWithTimeout } from '../../lib/fetchWithTimeout';

export const ACCENT_SWATCHES = [
  { id: 'violet', label: 'Violet', hex: '#4F46E5', hover: '#4338CA', lightBg: '#EEF2FF' },
  { id: 'blue', label: 'Deep Blue', hex: '#2563EB', hover: '#1D4ED8', lightBg: '#EFF6FF' },
  { id: 'teal', label: 'Teal', hex: '#0D9488', hover: '#0F766E', lightBg: '#F0FDFA' },
  { id: 'emerald', label: 'Emerald', hex: '#059669', hover: '#047857', lightBg: '#ECFDF5' },
  { id: 'rose', label: 'Rose', hex: '#E11D48', hover: '#BE123C', lightBg: '#FFF1F2' },
  { id: 'amber', label: 'Amber', hex: '#D97706', hover: '#B45309', lightBg: '#FFFBEB' },
  { id: 'purple', label: 'Purple', hex: '#7C3AED', hover: '#6D28D9', lightBg: '#F5F3FF' },
  { id: 'slate', label: 'Slate', hex: '#475569', hover: '#334155', lightBg: '#F8FAFC' },
];

export default function WorkspaceSidebar({ workspaceId, role }) {
  const pathname = usePathname();
  const base = `/workspace/${workspaceId}`;
  const userRole = (role || 'developer').toLowerCase();
  const [activeAccent, setActiveAccent] = useState('#4F46E5');

  const applyAccentColor = useCallback((hex) => {
    const swatch = ACCENT_SWATCHES.find((s) => s.hex.toLowerCase() === hex.toLowerCase()) || ACCENT_SWATCHES[0];
    setActiveAccent(swatch.hex);
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--accent-500', swatch.hex);
      document.documentElement.style.setProperty('--accent-600', swatch.hover);
      document.documentElement.style.setProperty('--accent-50', swatch.lightBg);
    }
  }, []);

  // Fetch / restore active workspace accent choice on mount & workspace change
  useEffect(() => {
    if (!workspaceId) return;

    // Restore from localStorage instantly for zero flash
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

  const allItems = [
    { href: base, label: 'Overview', matchExact: true, icon: LayoutDashboard, permission: 'view_analytics' },
    { href: `${base}/projects`, label: 'Workspace', icon: FolderKanban, permission: 'view_projects' },
    { href: `${base}/repositories`, label: 'Repositories', icon: GitBranch, permission: 'view_repositories' },
    { href: `${base}/communication`, label: 'Communication', icon: MessagesSquare, permission: 'view_communication' },
    { href: `${base}/reports`, label: 'Reports', icon: FileText, permission: 'view_reports' },
    { href: `${base}/analytics`, label: 'Analytics', icon: BarChart, permission: 'view_analytics' },
    { href: `${base}/developers`, label: 'Developers', icon: Users, permission: 'view_developers' },
    { href: `${base}/tasks`, label: 'Tasks', icon: ListTodo, permission: 'view_tasks' },
    { href: `${base}/tickets`, label: 'Tickets', icon: Ticket, permission: 'view_tickets' },
    { href: `${base}/integrations`, label: 'Integrations', icon: Puzzle, permission: 'view_integrations' },
    { href: `${base}/invitations`, label: 'Team', icon: UserPlus, permission: 'view_team' },
    { href: `${base}/customization`, label: 'Customization', icon: SlidersHorizontal, permission: 'view_analytics' },
  ];

  const items = allItems.filter((item) => hasPermission(userRole, item.permission));

  const isActive = (item) =>
    item.matchExact
      ? pathname === item.href || pathname === `${item.href}/`
      : pathname.startsWith(item.href);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-16 md:w-64 flex-col bg-white dark:bg-[#202020] border-r border-slate-200/80 dark:border-[#2F2F2F] shadow-xs transition-colors duration-200">
      {/* ------------ Brand Header ------------ */}
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-200/80 dark:border-[#2F2F2F] px-4 md:px-5 shrink-0 transition-colors duration-200">
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center text-white shadow-sm shrink-0 transition-all duration-200"
          style={{ backgroundColor: activeAccent }}
        >
          <div className="flex items-center gap-0.5">
            <span className="w-1 h-3.5 bg-white rounded-full"></span>
            <span className="w-1 h-5 bg-white rounded-full"></span>
            <span className="w-1 h-3.5 bg-white rounded-full"></span>
          </div>
        </div>
        <span className="hidden md:inline-block text-xl font-bold tracking-tight text-slate-900 dark:text-[#E9E9E7] truncate transition-colors duration-200">
          PulseOps
        </span>
      </div>

      {/* ------------ Navigation List ------------ */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 md:px-3 py-4">
        {items.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={item.label}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                active
                  ? 'font-bold shadow-2xs'
                  : 'text-slate-600 dark:text-[#9B9B9B] hover:bg-slate-100/70 dark:hover:bg-[#2A2A2A] hover:text-slate-900 dark:hover:text-[#E9E9E7]'
              }`}
              style={
                active
                  ? {
                      backgroundColor: 'var(--accent-50)',
                      color: activeAccent,
                    }
                  : undefined
              }
            >
              {Icon && (
                <Icon
                  className="h-4 w-4 shrink-0 transition-colors"
                  style={{ color: active ? activeAccent : undefined }}
                />
              )}
              <span className="hidden md:inline-block truncate">{item.label}</span>
            </Link>
          );
        })}

        <div className="hidden md:block pt-2">
          <SlackSidebarSection workspaceId={workspaceId} />
        </div>
      </nav>
    </aside>
  );
}
