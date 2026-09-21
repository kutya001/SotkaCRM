'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { EMPLOYEE_COLORS } from '@/lib/constants/colors';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  className?: string;
}

export function ColorPicker({
  value,
  onChange,
  label = 'Цвет сотрудника',
  className = '',
}: ColorPickerProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 block">
          {label}
        </label>
      )}
      <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700">
        {EMPLOYEE_COLORS.map((col) => {
          const isSelected = value.toLowerCase() === col.value.toLowerCase();
          return (
            <button
              key={col.value}
              type="button"
              onClick={() => onChange(col.value)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${col.dotClass} hover:scale-110 active:scale-95 shadow-sm relative ${
                isSelected
                  ? 'ring-2 ring-offset-2 ring-zinc-900 dark:ring-white ring-offset-white dark:ring-offset-zinc-900 scale-105'
                  : 'opacity-85 hover:opacity-100'
              }`}
              title={col.label}
              aria-label={col.label}
            >
              {isSelected && (
                <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
