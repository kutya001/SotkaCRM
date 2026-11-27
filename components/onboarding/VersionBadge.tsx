'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { APP_VERSION } from '@/lib/changelog';
import { useGuide } from './GuideProvider';
import { cn } from '@/lib/utils/cn';

interface VersionBadgeProps {
  /** compact — только номер (свернутое меню) */
  variant?: 'full' | 'compact';
  className?: string;
  onOpened?: () => void;
}

/** Номер версии приложения; нажатие открывает «Что нового». Точка — новую версию еще не смотрели */
export function VersionBadge({ variant = 'full', className, onOpened }: VersionBadgeProps) {
  const guide = useGuide();
  const unseen = Boolean(guide?.hasUnseenVersion);
  return (
    <button
      type="button"
      data-tour="version"
      onClick={() => {
        guide?.openWhatsNew();
        onOpened?.();
      }}
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-xl text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors island-interactive',
        variant === 'compact' ? 'px-1.5 py-1' : 'px-2.5 py-1.5',
        className
      )}
      title="Что нового: журнал изменений"
      aria-label={`Версия ${APP_VERSION}. Что нового`}
    >
      {variant === 'full' && <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />}
      <span className="font-mono">{variant === 'compact' ? `v${APP_VERSION.split('.').slice(0, 2).join('.')}` : `Версия ${APP_VERSION}`}</span>
      {variant === 'full' && <span className="text-zinc-400">· Что нового</span>}
      {unseen && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500" />}
    </button>
  );
}
