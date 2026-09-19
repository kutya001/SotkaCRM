'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Search, RefreshCw, X, ShieldAlert } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import type { UserRole } from '@/types/database.types';

interface TopHeaderProps {
  collapsed: boolean;
  userRole?: UserRole;
  userName?: string;
  onSyncApi?: () => void;
  isSyncing?: boolean;
  lastSyncedAt?: string | null;
}

const MODULE_TITLES: Record<string, string> = {
  '/': 'Дашборд',
  '/leads': 'Лиды (Воронка)',
  '/sellers': 'База продавцов',
  '/payments': 'Транзакции и платежи',
  '/connections': 'Закрепления и связи',
  '/payouts': 'Журнал выплат',
  '/plans': 'Справочники и тарифы',
  '/analytics': 'KPI и аналитика',
};

export function TopHeader({
  collapsed,
  userRole = 'admin',
  userName = 'Сотрудник',
  onSyncApi,
  isSyncing = false,
  lastSyncedAt,
}: TopHeaderProps) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = React.useState('');

  const currentTitle = MODULE_TITLES[pathname] || 'SotkaCRM';

  return (
    <header
      className={`hidden lg:flex items-center justify-between fixed top-4 right-4 z-30 h-16 rounded-2xl island-glass px-5 transition-all duration-300 ${
        collapsed ? 'left-24' : 'left-72'
      }`}
    >
      {/* Название текущего модуля / Хлебные крошки */}
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">
          {currentTitle}
        </h1>
      </div>

      {/* Центральная часть: строка быстрого поиска */}
      <div className="flex-1 max-w-md mx-6">
        <div className="relative flex items-center">
          <Search
            className="w-4 h-4 absolute left-3 text-zinc-400 pointer-events-none"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Быстрый поиск по телефону, имени или магазину..."
            className="w-full h-9 pl-9 pr-8 text-xs bg-zinc-200/50 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-zinc-700/50 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-500 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {/* Правая часть: действия, тема, синхронизация */}
      <div className="flex items-center gap-2.5">
        {/* Кнопка синхронизации с API api.sotka.kg (ТОЛЬКО для роли admin) */}
        {userRole === 'admin' && (
          <button
            type="button"
            onClick={onSyncApi}
            disabled={isSyncing}
            className={`h-9 px-3 rounded-xl flex items-center gap-2 text-xs font-medium border transition-colors island-interactive ${
              isSyncing
                ? 'bg-blue-500/10 text-blue-600 border-blue-500/30 cursor-wait'
                : 'bg-zinc-200/50 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200/50 dark:border-zinc-700/50'
            }`}
            title={lastSyncedAt ? `Последняя синхронизация: ${lastSyncedAt}` : 'Запустить синхронизацию с платформой Sotka'}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
              strokeWidth={1.75}
            />
            <span>{isSyncing ? 'Синхронизация...' : 'Синхронизация API'}</span>
            {lastSyncedAt && !isSyncing && (
              <span suppressHydrationWarning className="text-[10px] text-zinc-400 font-mono hidden xl:inline">
                ({lastSyncedAt})
              </span>
            )}
          </button>
        )}

        {/* Переключатель темы оформления */}
        <ThemeToggle />

        {/* Мини-аватар профиля */}
        <div className="w-9 h-9 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center text-xs font-bold shadow-sm">
          {userName.slice(0, 2).toUpperCase()}
        </div>
      </div>
    </header>
  );
}
