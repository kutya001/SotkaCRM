'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserCheck, LayoutDashboard, Store, User, Link2, ListTodo } from 'lucide-react';
import type { UserRole } from '@/types/database.types';
import { useUser } from '@/components/auth/AuthProvider';

interface MobileBottomBarProps {
  userRole?: UserRole;
}

interface BottomNavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  /** Ключ права «видеть в меню» (см. lib/auth/permissions-catalog) */
  permission: string;
}

/** Пять ключевых модулей нижней панели (слева направо) */
const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  { title: 'Главная', href: '/', icon: LayoutDashboard, permission: 'dashboard.menu' },
  { title: 'Лиды', href: '/leads', icon: UserCheck, permission: 'leads.menu' },
  { title: 'Продавцы', href: '/sellers', icon: Store, permission: 'sellers.menu' },
  { title: 'Подключения', href: '/connections', icon: Link2, permission: 'connections.menu' },
  { title: 'Задачи', href: '/tasks', icon: ListTodo, permission: 'tasks.menu' },
];

const PROFILE_ITEM: BottomNavItem = { title: 'Профиль', href: '/profile', icon: User, permission: 'profile.menu' };

/** Пункты нижней панели по правам роли; если модулей меньше трех — добавляется «Профиль» */
export function useBottomBarItems(): BottomNavItem[] {
  const user = useUser();
  return React.useMemo(() => {
    const allowed = BOTTOM_NAV_ITEMS.filter((item) => user.can(item.permission));
    if (allowed.length < 3) allowed.push(PROFILE_ITEM);
    return allowed;
  }, [user]);
}

export function MobileBottomBar(_props: MobileBottomBarProps) {
  const pathname = usePathname();
  const items = useBottomBarItems();

  const columnsClass =
    items.length >= 5 ? 'grid-cols-5' : items.length === 4 ? 'grid-cols-4' : items.length === 3 ? 'grid-cols-3' : items.length === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <nav
      className={`lg:hidden fixed left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 rounded-2xl island-glass shadow-md grid ${columnsClass} h-16 px-1`}
    >
      {items.map((item) => {
        const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-0.5 py-1 px-0.5 rounded-xl transition-all island-interactive min-h-[48px] min-w-0 ${
              isActive
                ? 'text-blue-600 dark:text-blue-400 font-semibold'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <div
              className={`p-1 rounded-xl transition-colors ${
                isActive ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.75} />
            </div>
            <span className="text-[10px] font-medium tracking-tight truncate max-w-full">{item.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
