'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  UserCheck,
  LayoutDashboard,
  Store,
  User,
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

  // Для SMM-специалиста доступны только Лиды и Профиль (без доступа к продавцам)
  if (effectiveRole === 'smm') {
    const smmItems = [
      { title: 'Лиды', href: '/leads', icon: UserCheck },
      { title: 'Профиль', href: '/profile', icon: User },
    ];
    return (
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-200/80 dark:border-zinc-800/80 grid grid-cols-2 h-16 safe-area-bottom px-4 shadow-lg">
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

  // Строго 3 ключевые кнопки по центру экрана:
  // 1. Лиды (/leads)
  // 2. Главная (/)
  // 3. Продавцы (/sellers)
  const navItems = [
    { title: 'Лиды', href: '/leads', icon: UserCheck },
    { title: 'Главная', href: '/', icon: LayoutDashboard },
    { title: 'Продавцы', href: '/sellers', icon: Store },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-200/80 dark:border-zinc-800/80 grid grid-cols-3 h-16 safe-area-bottom px-2 shadow-lg">
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
            className={`flex flex-col items-center justify-center gap-1 py-1 px-2 rounded-xl transition-all island-interactive min-h-[48px] ${
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
            <span className="text-[10px] font-medium tracking-tight">
              {item.title}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
