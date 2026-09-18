'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';

interface FABProps {
  onClick: () => void;
  label?: string;
}

export function FAB({ onClick, label = 'Добавить лид' }: FABProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="lg:hidden fixed bottom-24 right-5 z-50 w-14 h-14 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-2xl flex items-center justify-center island-interactive active:scale-90 transition-transform duration-150 border border-white/20 dark:border-zinc-800/40"
      aria-label={label}
      title={label}
    >
      <Plus className="w-6 h-6" strokeWidth={2.5} />
    </button>
  );
}
