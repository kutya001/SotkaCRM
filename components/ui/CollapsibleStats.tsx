'use client';

import * as React from 'react';
import { ChevronDown, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface CollapsibleStatsProps {
  /** Ключ localStorage: состояние запоминается отдельно для каждого модуля */
  storageKey: string;
  title?: string;
  /** Краткая сводка, видимая в свернутом состоянии (например, «30 активных · 41 без консультанта») */
  summary?: React.ReactNode;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
  className?: string;
}

const PREFIX = 'sotka_stats_collapsed_';

/**
 * Сворачиваемый блок статистики над журналом модуля: освобождает место под данные,
 * состояние хранится в браузере отдельно для каждого модуля.
 */
export function CollapsibleStats({ storageKey, title = 'Статистика', summary, defaultCollapsed = false, children, className }: CollapsibleStatsProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(PREFIX + storageKey);
      if (saved === '1') setCollapsed(true);
      else if (saved === '0') setCollapsed(false);
    } catch {}
    setReady(true);
  }, [storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PREFIX + storageKey, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  return (
    <section className={cn('space-y-2', className)} data-collapsed={collapsed ? '' : undefined}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="w-full h-8 px-2.5 rounded-xl flex items-center justify-between gap-2 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-white/60 dark:hover:bg-zinc-900/60 transition-colors"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <BarChart3 className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
          <span>{title}</span>
          {collapsed && summary && <span className="font-normal text-zinc-400 truncate">· {summary}</span>}
        </span>
        <span className="flex items-center gap-1 flex-shrink-0">
          <span className="hidden sm:inline font-normal">{collapsed ? 'Показать' : 'Скрыть'}</span>
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', collapsed && '-rotate-90')} strokeWidth={2} />
        </span>
      </button>
      <div className={cn(collapsed ? 'hidden' : 'block', !ready && 'transition-none')}>{children}</div>
    </section>
  );
}
