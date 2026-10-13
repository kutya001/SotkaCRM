'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Единая оболочка модальных окон CRM.
 *  - портал в document.body, блокировка прокрутки страницы, role="dialog"
 *  - Escape закрывает верхнее окно стека, клик по подложке — текущее
 *  - на ПК — центрированный островок, на мобильном — bottom sheet
 *  - шапка: тонированная иконка + заголовок + подзаголовок + крестик; прокручиваемое тело; липкий футер
 */

export type ModalTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple' | 'sky';
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '5xl';

const TONE_CLASS: Record<ModalTone, string> = {
  neutral: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200',
  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
};

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'lg:max-w-sm',
  md: 'lg:max-w-md',
  lg: 'lg:max-w-lg',
  xl: 'lg:max-w-xl',
  '2xl': 'lg:max-w-2xl',
  '5xl': 'lg:max-w-5xl',
};

// Стек открытых окон: Escape закрывает только верхнее
const modalStack: string[] = [];
let scrollLockCount = 0;

function lockScroll() {
  if (scrollLockCount === 0) {
    document.body.dataset.prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount++;
}

function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = document.body.dataset.prevOverflow || '';
    delete document.body.dataset.prevOverflow;
  }
}

/** Поведение окна: стек Escape, блокировка прокрутки, возврат фокуса */
export function useModalBehavior(open: boolean, onClose: () => void, options: { closeOnEscape?: boolean; busy?: boolean } = {}) {
  const { closeOnEscape = true, busy = false } = options;
  const idRef = React.useRef<string>('');
  if (!idRef.current) idRef.current = Math.random().toString(36).slice(2, 10);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = React.useRef(busy);
  busyRef.current = busy;

  React.useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    modalStack.push(id);
    lockScroll();
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !closeOnEscape) return;
      if (modalStack[modalStack.length - 1] !== id) return;
      if (busyRef.current) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const idx = modalStack.lastIndexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);
      unlockScroll();
      previouslyFocused?.focus?.();
    };
  }, [open, closeOnEscape]);
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  tone?: ModalTone;
  size?: ModalSize;
  /** Вложенное окно поверх другого */
  level?: 1 | 2;
  /** Элементы справа в шапке (до крестика) */
  headerRight?: React.ReactNode;
  /** Строка под шапкой (быстрые действия, вкладки) */
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  footerClassName?: string;
  children: React.ReactNode;
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
  /** Идет операция: окно нельзя закрыть подложкой, Escape и крестиком */
  busy?: boolean;
  /** На мобильном — шторка снизу (по умолчанию) или центр */
  mobileSheet?: boolean;
  bodyClassName?: string;
  /** Тело без собственных отступов (таблицы, карты) */
  bodyPadding?: boolean;
  /** Форма: тело оборачивается в <form>, футер может содержать кнопку type="submit" с form={formId} */
  formId?: string;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Без кнопки-крестика (подтверждения) */
  hideClose?: boolean;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon: Icon,
  tone = 'neutral',
  size = 'md',
  level = 1,
  headerRight,
  headerExtra,
  footer,
  footerClassName,
  children,
  closeOnOverlay = true,
  closeOnEscape = true,
  busy = false,
  mobileSheet = true,
  bodyClassName,
  bodyPadding = true,
  formId,
  onSubmit,
  hideClose = false,
  className,
}: ModalProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  useModalBehavior(open, onClose, { closeOnEscape, busy });

  const titleId = React.useId();
  const overlayMouseDownTarget = React.useRef<EventTarget | null>(null);

  if (!open || !mounted) return null;

  const handleOverlayMouseDown = (e: React.MouseEvent) => {
    overlayMouseDownTarget.current = e.target;
  };
  const handleOverlayClick = (e: React.MouseEvent) => {
    // Закрываем только если и нажатие, и отпускание были на подложке (а не выделение текста в окне)
    if (!closeOnOverlay || busy) return;
    if (e.target === e.currentTarget && overlayMouseDownTarget.current === e.currentTarget) onClose();
  };

  const body = (
    <div className={cn('flex-1 overflow-y-auto overscroll-contain', bodyPadding && 'px-6 py-5', bodyClassName)}>
      {children}
    </div>
  );

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex justify-center bg-black/45 dark:bg-black/65 backdrop-blur-sm animate-in fade-in duration-150',
        mobileSheet ? 'items-end lg:items-center p-0 lg:p-4' : 'items-center p-4',
        level === 2 ? 'z-modal-2' : 'z-modal'
      )}
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          'relative w-full max-h-[92vh] lg:max-h-[90vh] flex flex-col bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl overflow-hidden animate-in duration-200',
          mobileSheet ? 'rounded-t-3xl lg:rounded-3xl slide-in-from-bottom-6 lg:slide-in-from-bottom-0 lg:zoom-in-95' : 'rounded-3xl zoom-in-95',
          SIZE_CLASS[size],
          className
        )}
      >
        {mobileSheet && (
          <div className="lg:hidden pt-3 pb-1 flex justify-center" aria-hidden>
            <div className="w-12 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full" />
          </div>
        )}

        {(title || Icon || !hideClose || headerRight) && (
          <div className="px-6 pt-5 pb-4 border-b border-zinc-200/70 dark:border-zinc-800/70">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {Icon && (
                  <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0', TONE_CLASS[tone])}>
                    <Icon className="w-5 h-5" strokeWidth={1.75} />
                  </div>
                )}
                <div className="min-w-0">
                  {title && (
                    <h2 id={titleId} className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">
                      {title}
                    </h2>
                  )}
                  {subtitle && <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">{subtitle}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {headerRight}
                {!hideClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500 transition-colors disabled:opacity-50"
                    aria-label="Закрыть"
                  >
                    <X className="w-4 h-4" strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
            {headerExtra && <div className="mt-3">{headerExtra}</div>}
          </div>
        )}

        {formId ? (
          <form id={formId} onSubmit={onSubmit} className="flex-1 min-h-0 flex flex-col">
            {body}
          </form>
        ) : (
          body
        )}

        {footer && (
          <div
            className={cn(
              'px-6 py-4 border-t border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/80 dark:bg-zinc-900/80 flex items-center justify-end gap-2.5 flex-wrap safe-area-bottom',
              footerClassName
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** Подсветка-«плашка» внутри окна (предупреждение, пояснение) */
export function ModalCallout({ tone = 'warning', children, className }: { tone?: ModalTone; children: React.ReactNode; className?: string }) {
  const toneClass: Record<ModalTone, string> = {
    neutral: 'bg-zinc-100 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300',
    info: 'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300',
    success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    warning: 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300',
    danger: 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-300',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-700 dark:text-purple-300',
    sky: 'bg-sky-500/10 border-sky-500/20 text-sky-700 dark:text-sky-300',
  };
  return <div className={cn('p-3.5 rounded-2xl border text-xs leading-relaxed', toneClass[tone], className)}>{children}</div>;
}
