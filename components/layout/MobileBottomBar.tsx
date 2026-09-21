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
  Menu,
  User,
} from 'lucide-react';
import type { UserRole } from '@/types/database.types';
import { useUser } from '@/components/auth/AuthProvider';
import { MobileMenuDrawer } from '@/components/layout/MobileMenuDrawer';

interface MobileBottomBarProps {
  userRole?: UserRole;
}

export function MobileBottomBar({ userRole }: MobileBottomBarProps) {
  const pathname = usePathname();
  const user = useUser();
  const effectiveRole = userRole || user.role || 'consultant';
  const [isMenuDrawerOpen, setIsMenuDrawerOpen] = React.useState(false);

  // Для SMM-специалиста доступны только Лиды и Профиль
  if (effectiveRole === 'smm') {
    const smmItems = [
      { title: 'Лиды', href: '/leads', icon: UserCheck },
      { title: 'Профиль', href: '/profile', icon: User },
    ];
    return (
      <nav className="lg:hidden fixed bottom-4 left-4 right-4 h-16 rounded-2xl z-40 island-glass flex items-center justify-around px-2 shadow-xl border border-white/20 dark:border-zinc-800/40">
        {smmItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 py-1 px-4 rounded-xl transition-all island-interactive ${
                isActive
                  ? 'text-zinc-950 dark:text-zinc-100 font-semibold'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-zinc-200/70 dark:bg-zinc-800/80 text-zinc-900 dark:text-white'
                    : ''
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.75} />
              </div>
              <span className="text-[10px] tracking-tight">{item.title}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  // Для Администратора и Консультанта
  const primaryNavItems = [
    { title: 'Главная', href: '/', icon: LayoutDashboard },
    { title: 'Лиды', href: '/leads', icon: UserCheck },
    { title: 'Продавцы', href: '/sellers', icon: Store },
    { title: 'Подключения', href: '/connections', icon: Link2 },
    { title: 'Выплаты', href: '/payouts', icon: Banknote },
  ];

  // Проверка активности вторичных разделов (Сотрудники, Тарифы, Аналитика, Профиль)
  const isSecondaryActive =
    pathname.startsWith('/employees') ||
    pathname.startsWith('/plans') ||
    pathname.startsWith('/analytics') ||
    pathname.startsWith('/profile');

  return (
    <>
      <MobileMenuDrawer
        isOpen={isMenuDrawerOpen}
        onClose={() => setIsMenuDrawerOpen(false)}
      />

      <nav className="lg:hidden fixed bottom-4 left-4 right-4 h-16 rounded-2xl z-40 island-glass flex items-center justify-around px-1 shadow-xl border border-white/20 dark:border-zinc-800/40">
        {primaryNavItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 py-1 px-2 rounded-xl transition-all island-interactive ${
                isActive
                  ? 'text-zinc-950 dark:text-zinc-100 font-semibold'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-zinc-200/70 dark:bg-zinc-800/80 text-zinc-900 dark:text-white'
                    : ''
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.75} />
              </div>
              <span className="text-[10px] tracking-tight truncate max-w-[54px]">
                {item.title}
              </span>
            </Link>
          );
        })}

        {/* Кнопка открытия всех разделов (Меню) */}
        <button
          type="button"
          onClick={() => setIsMenuDrawerOpen(true)}
          className={`flex flex-col items-center justify-center gap-1 py-1 px-2 rounded-xl transition-all island-interactive ${
            isSecondaryActive
              ? 'text-blue-600 dark:text-blue-400 font-semibold'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
          title="Все разделы"
        >
          <div
            className={`p-1 rounded-lg transition-colors ${
              isSecondaryActive
                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                : ''
            }`}
          >
            <Menu className="w-5 h-5" strokeWidth={isSecondaryActive ? 2.2 : 1.75} />
          </div>
          <span className="text-[10px] tracking-tight">Меню</span>
        </button>
      </nav>
    </>
  );
}
