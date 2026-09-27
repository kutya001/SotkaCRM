'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  UserCheck,
  LayoutDashboard,
  Store,
  User,
  Link2,
} from 'lucide-react';
import type { UserRole } from '@/types/database.types';
import { useUser } from '@/components/auth/AuthProvider';

interface MobileBottomBarProps {
  userRole?: UserRole;
}

export function MobileBottomBar({ userRole }: MobileBottomBarProps) {
  const pathname = usePathname();
  const user = useUser();
  const effectiveRole = userRole || user.role || 'consultant';

  // Для SMM-специалиста доступны только Лиды и Профиль (без доступа к продавцам и финансам)
  if (effectiveRole === 'smm') {
    const smmItems = [
      { title: 'Лиды', href: '/leads', icon: UserCheck },
      { title: 'Профиль', href: '/profile', icon: User },
    ];
    return (
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-200/80 dark:border-zinc-800/80 grid grid-cols-2 h-16 safe-area-bottom pb-[env(safe-area-inset-bottom)] px-4 shadow-lg">
        {smmItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-xl transition-all island-interactive min-h-[48px] ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400 font-semibold'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl transition-colors ${
                  isActive
                    ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.75} />
              </div>
              <span className="text-[10px] font-medium tracking-tight">{item.title}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  // Строго 4 ключевые кнопки (слева направо):
  // 1. Лиды (/leads)
  // 2. Продавцы (/sellers)
  // 3. Подключения (/connections)
  // 4. Главная (/)
  const navItems = [
    { title: 'Лиды', href: '/leads', icon: UserCheck },
    { title: 'Продавцы', href: '/sellers', icon: Store },
    { title: 'Подключения', href: '/connections', icon: Link2 },
    { title: 'Главная', href: '/', icon: LayoutDashboard },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-200/80 dark:border-zinc-800/80 grid grid-cols-4 h-16 safe-area-bottom pb-[env(safe-area-inset-bottom)] px-1 shadow-lg">
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
            className={`flex flex-col items-center justify-center gap-0.5 py-1 px-1 rounded-xl transition-all island-interactive min-h-[48px] ${
              isActive
                ? 'text-blue-600 dark:text-blue-400 font-semibold'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <div
              className={`p-1 rounded-xl transition-colors ${
                isActive
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.75} />
            </div>
            <span className="text-[10px] font-medium tracking-tight truncate max-w-full">
              {item.title}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
