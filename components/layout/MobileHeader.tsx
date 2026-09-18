'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

interface MobileHeaderProps {
  onOpenFilter?: () => void;
  onSearchChange?: (query: string) => void;
}

const MODULE_TITLES: Record<string, string> = {
  '/': 'Дашборд',
  '/leads': 'Лиды',
  '/sellers': 'Продавцы',
  '/payments': 'Платежи',
  '/connections': 'Связи',
  '/payouts': 'Выплаты',
  '/plans': 'Справочники',
  '/analytics': 'KPI',
};

export function MobileHeader({
  onOpenFilter,
  onSearchChange,
}: MobileHeaderProps) {
  const pathname = usePathname();
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const currentTitle = MODULE_TITLES[pathname] || 'SotkaCRM';

  const handleToggleSearch = () => {
    setIsSearchOpen((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => searchInputRef.current?.focus(), 100);
      } else {
        setSearchQuery('');
        onSearchChange?.('');
      }
      return next;
    });
  };

  const handleQueryChange = (val: string) => {
    setSearchQuery(val);
    onSearchChange?.(val);
  };

  return (
    <header className="lg:hidden fixed top-3 left-3 right-3 z-30 h-14 rounded-2xl island-glass px-3 flex items-center justify-between shadow-md">
      {!isSearchOpen ? (
        <>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              {currentTitle}
            </h1>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleToggleSearch}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors island-interactive"
              title="Поиск"
              aria-label="Поиск"
            >
              <Search className="w-4.5 h-4.5" strokeWidth={1.75} />
            </button>

            {onOpenFilter && (
              <button
                type="button"
                onClick={onOpenFilter}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors island-interactive"
                title="Фильтры"
                aria-label="Фильтры"
              >
                <SlidersHorizontal className="w-4.5 h-4.5" strokeWidth={1.75} />
              </button>
            )}

            <ThemeToggle />
          </div>
        </>
      ) : (
        <div className="w-full flex items-center gap-2">
          <Search className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.75} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Поиск по номеру, имени..."
            className="flex-1 h-9 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleToggleSearch}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 island-interactive"
            aria-label="Закрыть поиск"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      )}
    </header>
  );
}
