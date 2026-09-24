'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Maximize2, Minimize2, RefreshCw, Search, X } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import type { UserRole } from '@/types/database.types';

interface TopHeaderProps {
  collapsed: boolean;
  userRole?: UserRole;
  userName?: string;
  onSyncApi?: () => void;
  isSyncing?: boolean;
  lastSyncedAt?: string | null;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  filterCount?: number;
  filterContent?: React.ReactNode;
  layoutWidth?: 'compact' | 'wide';
  onToggleLayoutWidth?: () => void;
}

const MODULE_TITLES: Record<string, string> = {
  '/': 'Дашборд',
  '/leads': 'Лиды (Воронка)',
  '/sellers': 'База продавцов',
  '/payments': 'Транзакции и платежи',
  '/connections': 'Подключения',
  '/payouts': 'Выплаты',
  '/plans': 'Справочники и тарифы',
  '/rates': 'Персональные ставки',
  '/analytics': 'KPI и аналитика',
  '/employees': 'Сотрудники',
  '/profile': 'Мой профиль',
};

export function TopHeader({
  collapsed,
  userRole = 'admin',
  userName = 'Сотрудник',
  onSyncApi,
  isSyncing = false,
  lastSyncedAt,
  searchQuery = '',
  onSearchChange,
  searchPlaceholder = 'Быстрый поиск по номеру, имени или магазину...',
  filterCount = 0,
  filterContent,
  layoutWidth = 'wide',
  onToggleLayoutWidth,
}: TopHeaderProps) {
  const pathname = usePathname();
  const currentTitle = MODULE_TITLES[pathname] || 'SotkaCRM';

  return (
    <header
      className={`hidden lg:flex items-center justify-between fixed top-4 right-4 z-40 h-16 rounded-2xl island-glass px-5 transition-all duration-300 gap-4 ${
        collapsed ? 'left-24' : 'left-72'
      }`}
    >
      {/* 1. Левая часть: Название раздела */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
          {currentTitle}
        </h1>
      </div>

      {/* 2. Центральная часть: Единый глобальный поиск */}
      <div className="flex-1 max-w-xl flex items-center gap-2.5">
        {onSearchChange ? (
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
              strokeWidth={1.75}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-10 pl-9 pr-9 text-xs bg-zinc-200/50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="w-7 h-7 absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg transition-colors"
                title="Очистить поиск"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1" />
        )}
      </div>

      {/* 3. Правая часть: системный блок (Синхронизация API, тема, профиль) */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        {/* Кнопка синхронизации с API api.sotka.kg (ТОЛЬКО для роли admin) */}
        {userRole === 'admin' && (
          <button
            type="button"
            onClick={onSyncApi}
            disabled={isSyncing}
            className={`min-w-[44px] h-10 px-3.5 rounded-xl flex items-center gap-2 text-xs font-medium border transition-colors island-interactive ${
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
            <span className="hidden xl:inline">{isSyncing ? 'Синхронизация...' : 'Синхронизация API'}</span>
            {lastSyncedAt && !isSyncing && (
              <span suppressHydrationWarning className="text-[10px] text-zinc-400 font-mono hidden 2xl:inline">
                ({lastSyncedAt})
              </span>
            )}
          </button>
        )}

        {/* Переключатель ширины экрана: Компактный / Широкий экран */}
        {onToggleLayoutWidth && (
          <button
            type="button"
            onClick={onToggleLayoutWidth}
            className="w-10 h-10 rounded-xl bg-zinc-200/50 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50 flex items-center justify-center transition-colors island-interactive"
            title={
              layoutWidth === 'wide'
                ? 'Компактный вид (max-w-7xl)'
                : 'Широкий экран (Full-Width)'
            }
            aria-label={
              layoutWidth === 'wide'
                ? 'Компактный вид'
                : 'Широкий экран'
            }
          >
            {layoutWidth === 'wide' ? (
              <Minimize2 className="w-4 h-4" strokeWidth={1.75} />
            ) : (
              <Maximize2 className="w-4 h-4" strokeWidth={1.75} />
            )}
          </button>
        )}

        {/* Переключатель темы оформления */}
        <ThemeToggle />

        {/* Мини-аватар профиля с переходом в /profile */}
        <Link
          href="/profile"
          className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center text-xs font-bold shadow-sm flex-shrink-0 hover:opacity-85 transition-opacity"
          title={`Профиль: ${userName}`}
        >
          {userName.slice(0, 2).toUpperCase()}
        </Link>
      </div>
    </header>
  );
}
