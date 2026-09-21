'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  UserCheck,
  Store,
  Link2,
  Banknote,
  Users,
  BookOpen,
  BarChart3,
  User,
  X,
  LogOut,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Shield,
} from 'lucide-react';
import { useUser } from '@/components/auth/AuthProvider';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import type { UserRole } from '@/types/database.types';

interface MobileMenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  roles: UserRole[];
}

const ALL_NAV_ITEMS: NavItem[] = [
  {
    title: 'Главная',
    href: '/',
    icon: LayoutDashboard,
    roles: ['admin', 'consultant'],
  },
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
    title: 'Тарифы',
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
  {
    title: 'Профиль',
    href: '/profile',
    icon: User,
    roles: ['admin', 'consultant', 'smm'],
  },
];

export function MobileMenuDrawer({ isOpen, onClose }: MobileMenuDrawerProps) {
  const pathname = usePathname();
  const user = useUser();
  const effectiveRole = user.role || 'consultant';

  const navItems = ALL_NAV_ITEMS.filter((item) =>
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

  if (!isOpen) return null;

  return (
    <div className="lg:hidden fixed inset-0 z-[70] animate-in fade-in duration-200">
      {/* Матовая подложка */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Выдвижная панель меню */}
      <div className="fixed inset-y-0 left-0 w-[280px] max-w-[85vw] backdrop-blur-2xl bg-white/95 dark:bg-zinc-900/95 border-r border-white/20 dark:border-zinc-800/60 shadow-2xl flex flex-col justify-between z-10 animate-in slide-in-from-left duration-200">
        <div>
          {/* Шапка меню */}
          <div className="h-16 px-4 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between">
            <Link
              href="/"
              onClick={onClose}
              className="flex items-center gap-2.5 overflow-hidden"
            >
              <div className="w-8 h-8 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center font-bold shadow-sm flex-shrink-0">
                <Layers className="w-4.5 h-4.5" strokeWidth={2} />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-100">
                  SotkaCRM
                </span>
                <span className="text-[9px] text-zinc-400 uppercase font-medium tracking-wider">
                  Все разделы
                </span>
              </div>
            </Link>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              title="Закрыть меню"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>

          {/* Карточка пользователя */}
          <div className="p-3 mx-3 my-2.5 rounded-2xl bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-zinc-700/40">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold text-xs flex items-center justify-center flex-shrink-0">
                {user.userName ? user.userName.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                  {user.userName || 'Пользователь'}
                </p>
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                  <RoleIcon className="w-3 h-3 text-blue-500" strokeWidth={2} />
                  <span>{roleLabel}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Список навигационных ссылок */}
          <nav className="px-3 py-1 space-y-1 max-h-[calc(100vh-230px)] overflow-y-auto">
            {navItems.map((item) => {
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-sm font-bold'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={isActive ? 2.2 : 1.75} />
                  <span className="truncate">{item.title}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Подвал панели: Тема и Выход */}
        <div className="p-3 border-t border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="text-[11px] text-zinc-400 font-medium">Тема оформления</span>
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              user.signOut();
            }}
            className="p-2 rounded-xl text-rose-500 hover:bg-rose-500/10 transition-colors"
            title="Выйти из системы"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
