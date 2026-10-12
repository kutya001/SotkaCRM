'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Маска ГГГГ-ММ: только цифры, дефис подставляется автоматически, месяц не больше 12 */
function applyMonthMask(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 4) return digits;

  let month = digits.slice(4);
  // Первая цифра месяца больше 1 — значит месяц однозначный: '2026-3' → '2026-03'
  if (month.length === 1 && Number(month) > 1) month = `0${month}`;
  if (month.length === 2) {
    const m = Number(month);
    if (m === 0) month = '01';
    else if (m > 12) month = '12';
  }
  return `${digits.slice(0, 4)}-${month}`;
}

function shiftMonth(value: string, delta: number): string {
  const base = MONTH_REGEX.test(value) ? value : new Date().toISOString().slice(0, 7);
  const [y, m] = base.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function isValidSettlementMonth(value: string): boolean {
  return MONTH_REGEX.test(value);
}

interface MonthInputProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Поле расчетного месяца по шаблону ГГГГ-ММ: ввод только цифр с маской,
 * кнопки ‹ › для перехода на соседний месяц.
 */
export function MonthInput({ value, onChange, required, disabled, id, className = '' }: MonthInputProps) {
  const isInvalid = value.length > 0 && !MONTH_REGEX.test(value);

  return (
    <div className={`flex items-stretch gap-1 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(shiftMonth(value, -1))}
        className="px-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 text-zinc-500 disabled:opacity-50 cursor-pointer"
        aria-label="Предыдущий месяц"
      >
        <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="ГГГГ-ММ"
        maxLength={7}
        pattern="\d{4}-(0[1-9]|1[0-2])"
        title="Год и месяц в формате ГГГГ-ММ, например 2026-09"
        required={required}
        disabled={disabled}
        value={value}
        aria-invalid={isInvalid}
        onChange={(e) => onChange(applyMonthMask(e.target.value))}
        className={`min-w-0 flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-center disabled:opacity-50 ${
          isInvalid ? 'border-rose-500' : 'border-zinc-200 dark:border-zinc-700'
        }`}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(shiftMonth(value, 1))}
        className="px-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 text-zinc-500 disabled:opacity-50 cursor-pointer"
        aria-label="Следующий месяц"
      >
        <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
