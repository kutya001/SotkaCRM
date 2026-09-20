'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  UserCheck,
  Store,
  Link2,
  Banknote,
  BookOpen,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Shield,
  Layers,
  Users,
} from 'lucide-react';
import type { UserRole } from '@/types/database.types';

interface DesktopSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  userRole?: UserRole;
  userName?: string;
  userLogin?: string;
  onSignOut?: () => void;
}

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    title: 'Лиды',
    href: '/leads',
    icon: UserCheck,
    roles: ['admin', 'consultant', 'smm'],
  },
  {
    title: 'Продавцы',
    href: '/sellers',
    icon: Store,
    roles: ['admin', 'consultant'],
  },
  {
    title: 'Подключения',
    href: '/connections',
    icon: Link2,
    roles: ['admin', 'consultant'],
  },
  {
    title: 'Выплаты',
    href: '/payouts',
    icon: Banknote,
    roles: ['admin', 'consultant'],
  },
  {
    title: 'Сотрудники',
    href: '/employees',
    icon: Users,
    roles: ['admin'],
  },
  {
    title: 'Справочники',
    href: '/plans',
    icon: BookOpen,
    roles: ['admin'],
  },
  {
    title: 'Аналитика',
    href: '/analytics',
    icon: BarChart3,
    roles: ['admin', 'consultant'],
  },
];

import { useUser } from '@/components/auth/AuthProvider';

export function DesktopSidebar({
  collapsed,
  onToggleCollapse,
  userRole,
  userName,
  userLogin,
  onSignOut,
}: DesktopSidebarProps) {
  const pathname = usePathname();
  const user = useUser();
  const effectiveRole = userRole || user.role || 'consultant';
  const effectiveName = userName || user.userName || 'Сотрудник CRM';
  const effectiveLogin = userLogin || user.userLogin || 'user';

  const filteredNavItems = NAV_ITEMS.filter((item) =>
    item.roles.includes(effectiveRole)
  );

  const roleLabel = {
    admin: 'Администратор',
    consultant: 'Консультант',
    smm: 'SMM-оператор',
  }[effectiveRole];

  const RoleIcon = {
    admin: ShieldAlert,
    consultant: ShieldCheck,
    smm: Shield,
  }[effectiveRole];

  return (
    <aside
      className={`hidden lg:flex flex-col fixed top-4 left-4 bottom-4 z-40 rounded-3xl island-glass transition-all duration-300 ${
        collapsed ? 'w-[72px]' : 'w-64'
      }`}
    >
      {/* Логотип и переключатель сворачивания */}
      <div className="h-18 flex items-center justify-between px-4 border-b border-zinc-200/40 dark:border-zinc-800/40">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center font-bold shadow-sm flex-shrink-0">
              <Layers className="w-5 h-5" strokeWidth={2} />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-base tracking-tight text-zinc-900 dark:text-zinc-100">
                SotkaCRM
              </span>
              <span className="text-[10px] text-zinc-500 uppercase font-medium tracking-wider">
                Management System
              </span>
            </div>
          </Link>
        )}

        {collapsed && (
          <div className="w-full flex justify-center">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center font-bold shadow-sm">
              <Layers className="w-5 h-5" strokeWidth={2} />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleCollapse}
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors island-interactive ${
            collapsed ? 'hidden' : ''
          }`}
          title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        >
          <PanelLeftClose className="w-4.5 h-4.5" strokeWidth={1.75} />
        </button>
      </div>

      {collapsed && (
        <div className="py-2 flex justify-center">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors island-interactive"
            title="Развернуть меню"
          >
            <PanelLeftOpen className="w-4.5 h-4.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Список разделов навигации */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
        {filteredNavItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors island-interactive ${
                isActive
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/40'
              } ${collapsed ? 'justify-center px-0' : ''}`}
              title={collapsed ? item.title : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" strokeWidth={1.75} />
              {!collapsed && <span>{item.title}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Пользовательский профиль внизу сайдбара */}
      <div className="p-3 border-t border-zinc-200/40 dark:border-zinc-800/40">
        {!collapsed ? (
          <div className="flex items-center justify-between p-2 rounded-2xl bg-zinc-200/40 dark:bg-zinc-800/40 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70 transition-colors">
            <Link
              href="/profile"
              className="flex items-center gap-2.5 overflow-hidden flex-1 group"
              title="Перейти в профиль"
            >
              <div className="w-8 h-8 rounded-xl bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-800 dark:text-zinc-200 flex-shrink-0 group-hover:scale-105 transition-transform">
                {effectiveName.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex flex-col truncate">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {effectiveName}
                </span>
                <span className="text-[10px] text-zinc-500 flex items-center gap-1 truncate">
                  <RoleIcon className="w-3 h-3 flex-shrink-0" strokeWidth={1.75} />
                  {roleLabel}
                </span>
              </div>
            </Link>

            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-rose-600 hover:bg-rose-500/10 transition-colors island-interactive flex-shrink-0 ml-1"
                title="Выйти из аккаунта"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.75} />
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Link
              href="/profile"
              className="w-9 h-9 rounded-xl bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-800 dark:text-zinc-200 hover:ring-2 hover:ring-blue-500 transition-all"
              title={`Профиль: ${effectiveName} (${roleLabel})`}
            >
              {effectiveName.slice(0, 2).toUpperCase()}
            </Link>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-rose-600 hover:bg-rose-500/10 transition-colors island-interactive"
                title="Выйти из аккаунта"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.75} />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
