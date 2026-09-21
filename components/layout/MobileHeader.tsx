'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Search, SlidersHorizontal, X, Menu } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { MobileMenuDrawer } from '@/components/layout/MobileMenuDrawer';

interface MobileHeaderProps {
  onOpenFilter?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  filterCount?: number;
  filterContent?: React.ReactNode;
}

const MODULE_TITLES: Record<string, string> = {
  '/': 'Главная',
  '/leads': 'Лиды',
  '/sellers': 'База продавцов',
  '/connections': 'Подключения',
  '/payouts': 'Выплаты',
  '/plans': 'Тарифы',
  '/analytics': 'Аналитика',
  '/employees': 'Сотрудники',
  '/profile': 'Мой профиль',
};

export function MobileHeader({
  searchQuery = '',
  onSearchChange,
  searchPlaceholder = 'Поиск по номеру, имени...',
  filterCount = 0,
  filterContent,
}: MobileHeaderProps) {
  const pathname = usePathname();
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const [isFilterModalOpen, setIsFilterModalOpen] = React.useState(false);
  const [isMenuDrawerOpen, setIsMenuDrawerOpen] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const currentTitle = MODULE_TITLES[pathname] || 'SotkaCRM';

  const handleToggleSearch = () => {
    setIsSearchOpen((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => searchInputRef.current?.focus(), 100);
      } else {
        onSearchChange?.('');
      }
      return next;
    });
  };

  // Закрытие поиска и фильтров при смене маршрута
  React.useEffect(() => {
    setIsSearchOpen(false);
    setIsFilterModalOpen(false);
    setIsMenuDrawerOpen(false);
  }, [pathname]);

  return (
    <>
      <MobileMenuDrawer
        isOpen={isMenuDrawerOpen}
        onClose={() => setIsMenuDrawerOpen(false)}
      />

      <header className="lg:hidden fixed top-3 left-3 right-3 z-40 h-14 rounded-2xl island-glass px-2 flex items-center justify-between shadow-md">
        {!isSearchOpen ? (
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={() => setIsMenuDrawerOpen(true)}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors active:scale-95 flex-shrink-0"
                title="Все разделы"
                aria-label="Все разделы"
              >
                <Menu className="w-5 h-5" strokeWidth={1.75} />
              </button>
              <h1 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tracking-tight truncate max-w-[150px] sm:max-w-xs">
                {currentTitle}
              </h1>
            </div>

            <div className="flex items-center gap-1">
              {onSearchChange && (
                <button
                  type="button"
                  onClick={handleToggleSearch}
                  className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors island-interactive active:scale-95"
                  title="Поиск"
                  aria-label="Поиск"
                >
                  <Search className="w-5 h-5" strokeWidth={1.75} />
                </button>
              )}

              {filterContent && (
                <button
                  type="button"
                  onClick={() => setIsFilterModalOpen(true)}
                  className="relative min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors island-interactive active:scale-95"
                  title="Фильтры"
                  aria-label="Фильтры"
                >
                  <SlidersHorizontal className="w-5 h-5" strokeWidth={1.75} />
                  {filterCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">
                      {filterCount}
                    </span>
                  )}
                </button>
              )}

              <div className="flex items-center justify-center min-w-[44px] min-h-[44px]">
                <ThemeToggle />
              </div>
            </div>
          </>
        ) : (
          <div className="w-full flex items-center gap-2 px-1">
            <Search className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.75} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 h-10 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange?.('')}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label="Очистить"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            )}
            <button
              type="button"
              onClick={handleToggleSearch}
              className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 island-interactive active:scale-95"
              aria-label="Закрыть поиск"
            >
              <X className="w-5 h-5" strokeWidth={1.75} />
            </button>
          </div>
        )}
      </header>

      {/* Мобильная шторка фильтров (Bottom Sheet / Modal) */}
      {isFilterModalOpen && filterContent && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className="fixed inset-0"
            onClick={() => setIsFilterModalOpen(false)}
          />
          <div className="relative z-10 w-full max-h-[85vh] overflow-y-auto rounded-t-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-2xl animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between border-b border-zinc-200/60 dark:border-zinc-800/60 pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4.5 h-4.5 text-zinc-500" strokeWidth={1.75} />
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Фильтры реестра
                </span>
                {filterCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-xs font-bold">
                    {filterCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsFilterModalOpen(false)}
                className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                aria-label="Закрыть фильтры"
              >
                <X className="w-5 h-5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="space-y-4 pb-6">{filterContent}</div>
          </div>
        </div>
      )}
    </>
  );
}
