'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Единая кнопка CRM. Варианты:
 *  primary   — основное действие (тёмная/белая в тёмной теме)
 *  secondary — заливка zinc (второстепенное действие)
 *  outline   — контурная (Отмена, Закрыть)
 *  ghost     — без фона (иконки, ссылки)
 *  danger    — подтверждение опасного действия (сплошная rose)
 *  dangerSoft — опасное действие внутри карточки (мягкая rose)
 *  success / warning / info — тонированные действия (начисления, предупреждения, Telegram)
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold whitespace-nowrap transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 shadow-md',
        secondary:
          'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200',
        outline:
          'border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800',
        ghost: 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800',
        danger: 'bg-rose-600 hover:bg-rose-700 text-white shadow-md',
        dangerSoft:
          'border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20',
        success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md',
        warning: 'bg-amber-600 hover:bg-amber-700 text-white shadow-md',
        info: 'bg-blue-600 hover:bg-blue-700 text-white shadow-md',
      },
      size: {
        xs: 'h-7 px-2.5 text-[11px]',
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-xs',
        lg: 'h-10 px-5 text-sm',
        icon: 'h-9 w-9 p-0',
        iconSm: 'h-8 w-8 p-0',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export interface ButtonLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof buttonVariants> {
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

/** Ссылка в стиле кнопки (tel:, wa.me, внешние переходы) */
export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { className, variant, size, fullWidth, leftIcon, rightIcon, children, target, rel, ...props },
  ref
) {
  return (
    <a
      ref={ref}
      target={target}
      rel={rel ?? (target === '_blank' ? 'noreferrer' : undefined)}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </a>
  );
});

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, fullWidth, loading = false, leftIcon, rightIcon, disabled, children, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
