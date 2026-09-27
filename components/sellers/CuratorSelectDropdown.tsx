'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, UserMinus, Search } from 'lucide-react';
import { EmployeeColorDot } from '@/components/ui/EmployeeBadge';

export interface CuratorManager {
  user_id: string;
  full_name: string;
  role?: string;
  color?: string;
}

interface CuratorSelectDropdownProps {
  value: string | null | undefined;
  managers: CuratorManager[];
  onChange: (managerId: string | null) => Promise<void> | void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export const CuratorSelectDropdown: React.FC<CuratorSelectDropdownProps> = ({
  value,
  managers,
  onChange,
  disabled = false,
  size = 'sm',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedManager = managers.find((m) => m.user_id === value);
  const isUnassigned = !selectedManager;

  // Закрытие при клике вне компонента
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = async (mgrId: string | null) => {
    if (disabled || isUpdating) return;
    setIsUpdating(true);
    try {
      await onChange(mgrId);
    } finally {
      setIsUpdating(false);
      setIsOpen(false);
      setSearchTerm('');
    }
  };

  const filteredManagers = managers.filter((m) =>
    m.full_name.toLowerCase().includes(searchTerm.toLowerCase().trim())
  );

  const isSmall = size === 'sm';

  return (
    <div
      ref={containerRef}
      className={`relative inline-block text-left ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Кнопка-триггер селектора */}
      <button
        type="button"
        disabled={disabled || isUpdating}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-1.5 transition-all text-left rounded-lg font-medium border shadow-xs cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${
          isSmall ? 'h-7 px-2 text-[11px]' : 'h-9 px-3 text-xs'
        } ${
          isUnassigned
            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
            : 'bg-white/80 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 border-zinc-200/80 dark:border-zinc-700/80 hover:bg-white dark:hover:bg-zinc-800'
        }`}
      >
        <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
          <EmployeeColorDot
            color={selectedManager?.color || (isUnassigned ? '#9CA3AF' : undefined)}
            size={isSmall ? 'xs' : 'sm'}
          />
          <span
            className="truncate font-medium"
            style={selectedManager?.color ? { color: selectedManager.color } : undefined}
          >
            {selectedManager ? selectedManager.full_name : '— Не назначен —'}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Изолированное всплывающее меню (никаких янтарных каскадов) */}
      {isOpen && (
        <div
          ref={menuRef}
          className="absolute z-50 mt-1 min-w-[200px] w-full max-w-[260px] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200/90 dark:border-zinc-800/90 shadow-2xl rounded-xl p-1 text-zinc-900 dark:text-zinc-100 animate-in fade-in zoom-in-95 duration-100 right-0 sm:right-auto sm:left-0"
        >
          {/* Быстрый поиск если менеджеров больше 5 */}
          {managers.length > 5 && (
            <div className="p-1 border-b border-zinc-100 dark:border-zinc-800/80 mb-1">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-100/80 dark:bg-zinc-800/80 text-zinc-500">
                <Search className="w-3.5 h-3.5" />
                <input
                  type="text"
                  placeholder="Поиск куратора..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-transparent text-[11px] text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
                  autoFocus
                />
              </div>
            </div>
          )}

          <div className="max-h-52 overflow-y-auto space-y-0.5 custom-scrollbar">
            {/* Опция отмены назначения */}
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                isUnassigned
                  ? 'bg-zinc-100 dark:bg-zinc-800/70 font-semibold text-zinc-700 dark:text-zinc-300'
                  : 'hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <UserMinus className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="truncate italic">Не назначен</span>
              </div>
              {isUnassigned && <Check className="w-3.5 h-3.5 text-zinc-500 shrink-0 ml-1" />}
            </button>

            {/* Список кураторов с точечной подсветкой */}
            {filteredManagers.map((mgr) => {
              const isSelected = mgr.user_id === value;
              return (
                <button
                  key={mgr.user_id}
                  type="button"
                  onClick={() => handleSelect(mgr.user_id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-zinc-100/90 dark:bg-zinc-800/80 font-semibold'
                      : 'hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs ring-1 ring-black/10 dark:ring-white/10"
                      style={{ backgroundColor: mgr.color || '#94a3b8' }}
                    />
                    <span
                      className="truncate font-medium"
                      style={mgr.color ? { color: mgr.color } : undefined}
                    >
                      {mgr.full_name}
                    </span>
                  </div>
                  {isSelected && (
                    <Check
                      className="w-3.5 h-3.5 shrink-0 ml-1"
                      style={mgr.color ? { color: mgr.color } : undefined}
                    />
                  )}
                </button>
              );
            })}

            {filteredManagers.length === 0 && (
              <div className="px-3 py-2 text-center text-[11px] text-zinc-400">
                Куратор не найден
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
