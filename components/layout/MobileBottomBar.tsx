'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserCheck, Store, Banknote, User, BarChart3 } from 'lucide-react';
import type { UserRole } from '@/types/database.types';

interface MobileBottomBarProps {
  userRole?: UserRole;
}

export function MobileBottomBar({ userRole = 'admin' }: MobileBottomBarProps) {
  const pathname = usePathname();

  const navItems = [
    {
      title: 'Лиды',
      href: '/leads',
      icon: UserCheck,
      show: true,
    },
    {
      title: 'Продавцы',
      href: '/sellers',
      icon: Store,
      show: userRole !== 'smm',
    },
    {
      title: 'Финансы',
      href: '/payouts',
      icon: Banknote,
      show: userRole !== 'smm',
    },
    {
      title: 'KPI',
      href: '/analytics',
      icon: BarChart3,
      show: userRole !== 'smm',
    },
    {
      title: 'Профиль',
      href: '/profile',
      icon: User,
      show: true,
    },
  ].filter((item) => item.show);

  return (
    <nav className="lg:hidden fixed bottom-4 left-4 right-4 h-16 rounded-2xl z-40 island-glass flex items-center justify-around px-2 shadow-xl border border-white/20 dark:border-zinc-800/40">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== '/' && pathname.startsWith(item.href));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-xl transition-all island-interactive ${
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
