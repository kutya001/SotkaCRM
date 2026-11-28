'use client';

import * as React from 'react';
import { FormField, Textarea } from '@/components/ui/Field';
import { CANCEL_REASONS, cancelReasonByCode } from '@/lib/leads/cancel-reasons';
import { cn } from '@/lib/utils/cn';

interface CancelReasonPickerProps {
  code: string;
  comment: string;
  onChange: (next: { code: string; comment: string }) => void;
}

/** Причина отмены из списка и комментарий (для «Другое» — обязателен) */
export function CancelReasonPicker({ code, comment, onChange }: CancelReasonPickerProps) {
  const selected = cancelReasonByCode(code);
  return (
    <div className="space-y-3">
      <FormField label="Причина отмены" required>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" role="radiogroup" aria-label="Причина отмены">
          {CANCEL_REASONS.map((r) => {
            const active = r.code === code;
            return (
              <button
                key={r.code}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange({ code: r.code, comment })}
                className={cn(
                  'text-left px-3 py-2 rounded-xl border transition-colors',
                  active
                    ? 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                )}
              >
                <span className="block text-xs font-semibold">{r.label}</span>
                {r.hint && <span className="block text-[11px] text-zinc-500 mt-0.5">{r.hint}</span>}
              </button>
            );
          })}
        </div>
      </FormField>
      <FormField
        label="Комментарий"
        required={Boolean(selected?.commentRequired)}
        hint={selected?.commentRequired ? 'Опишите причину — не менее 3 символов' : 'Необязательно: подробности для коллег'}
      >
        <Textarea
          value={comment}
          onChange={(e) => onChange({ code, comment: e.target.value })}
          rows={2}
          maxLength={500}
          placeholder="Например: подумает до весны, закрыл одну из точек..."
        />
      </FormField>
    </div>
  );
}
