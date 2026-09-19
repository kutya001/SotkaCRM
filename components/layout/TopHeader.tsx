'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
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
}: TopHeaderProps) {
  const pathname = usePathname();
  const currentTitle = MODULE_TITLES[pathname] || 'SotkaCRM';
  const [isFilterOpen, setIsFilterOpen] = React.useState(false);
  const filterDropdownRef = React.useRef<HTMLDivElement>(null);
  const filterButtonRef = React.useRef<HTMLButtonElement>(null);

  // Закрытие выпадающего окна фильтров по клику вне области и Escape
  React.useEffect(() => {
    if (!isFilterOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        filterDropdownRef.current &&
        !filterDropdownRef.current.contains(target) &&
        filterButtonRef.current &&
        !filterButtonRef.current.contains(target)
      ) {
        setIsFilterOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFilterOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFilterOpen]);

  // Закрытие фильтров при смене маршрута
  React.useEffect(() => {
    setIsFilterOpen(false);
  }, [pathname]);

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

      {/* 2. Центральная часть: Единый глобальный поиск и кнопка «Фильтры» */}
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

        {/* Кнопка «Фильтры» с бейджем активных условий */}
        {filterContent && (
          <div className="relative flex-shrink-0">
            <button
              ref={filterButtonRef}
              type="button"
              onClick={() => setIsFilterOpen((prev) => !prev)}
              className={`min-w-[44px] h-10 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all island-interactive ${
                filterCount > 0 || isFilterOpen
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent shadow-sm'
                  : 'bg-zinc-200/50 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200/60 dark:border-zinc-700/60'
              }`}
              title="Фильтрация реестра"
              aria-label="Фильтры"
            >
              <SlidersHorizontal className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
              <span>Фильтры</span>
              {filterCount > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-blue-600 text-white text-[11px] flex items-center justify-center font-bold">
                  {filterCount}
                </span>
              )}
            </button>

            {/* Выпадающее окно фильтров (Popover) */}
            {isFilterOpen && (
              <div
                ref={filterDropdownRef}
                className="absolute left-0 sm:left-auto sm:right-0 top-12 z-50 w-80 sm:w-96 p-4 rounded-3xl backdrop-blur-2xl bg-white/95 dark:bg-zinc-900/95 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-3.5 animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between border-b border-zinc-200/60 dark:border-zinc-800/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-zinc-500" strokeWidth={1.75} />
                    <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                      Фильтры реестра
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsFilterOpen(false)}
                    className="w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors"
                    title="Закрыть (Escape)"
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                  </button>
                </div>

                {/* Вложенное содержимое фильтров страницы */}
                <div className="space-y-3">{filterContent}</div>
              </div>
            )}
          </div>
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

        {/* Переключатель темы оформления */}
        <ThemeToggle />

        {/* Мини-аватар профиля */}
        <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center text-xs font-bold shadow-sm flex-shrink-0">
          {userName.slice(0, 2).toUpperCase()}
        </div>
      </div>
    </header>
  );
}
