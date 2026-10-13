'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Единые поля форм CRM: подпись, подсказка, ошибка и поля ввода одной высоты
 * с одним кольцом фокуса. Используются во всех модальных формах.
 */

export const fieldLabelClass = 'text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5';

export const fieldControlClass =
  'w-full rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-blue-500/60 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:disabled:bg-zinc-800';

const sizeClass = {
  sm: 'h-8 px-2.5',
  md: 'h-9 px-3',
  lg: 'h-10 px-3.5',
} as const;

export type FieldSize = keyof typeof sizeClass;

interface FormFieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Текст справа от подписи (например, «клик для копирования») */
  labelRight?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function FormField({ label, htmlFor, required, hint, error, labelRight, className, children }: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {(label || labelRight) && (
        <div className="flex items-center justify-between gap-2">
          {label ? (
            <label htmlFor={htmlFor} className={fieldLabelClass}>
              <span>{label}</span>
              {required && <span className="text-rose-500">*</span>}
            </label>
          ) : (
            <span />
          )}
          {labelRight && <span className="text-[10px] text-zinc-400">{labelRight}</span>}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-[10px] text-rose-500">{error}</p>
      ) : hint ? (
        <p className="text-[10px] text-zinc-400 leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: FieldSize;
  invalid?: boolean;
  mono?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = 'md', invalid, mono, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        fieldControlClass,
        sizeClass[size],
        mono && 'font-mono',
        invalid && 'border-rose-500 focus:ring-rose-500/40 focus:border-rose-500',
        className
      )}
      {...props}
    />
  );
});

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: FieldSize;
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, size = 'md', invalid, children, ...props },
  ref
) {
  return (
    <select
      ref={ref}
      className={cn(
        fieldControlClass,
        sizeClass[size],
        'cursor-pointer',
        invalid && 'border-rose-500 focus:ring-rose-500/40 focus:border-rose-500',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 3, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        fieldControlClass,
        'px-3 py-2 resize-y min-h-[72px]',
        invalid && 'border-rose-500 focus:ring-rose-500/40 focus:border-rose-500',
        className
      )}
      {...props}
    />
  );
});

/** Статичное значение в режиме просмотра (та же геометрия, что у Input) */
export function ReadOnlyValue({ children, className, mono }: { children: React.ReactNode; className?: string; mono?: boolean }) {
  return (
    <div
      className={cn(
        'min-h-[36px] px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/60 dark:border-zinc-800/60 text-xs text-zinc-900 dark:text-zinc-100 flex items-center break-words',
        mono && 'font-mono',
        className
      )}
    >
      {children}
    </div>
  );
}
