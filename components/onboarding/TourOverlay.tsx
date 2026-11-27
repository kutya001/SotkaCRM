'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, GraduationCap, MousePointerClick, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { TourDef, TourStep } from '@/lib/onboarding/tours';

interface TourOverlayProps {
  tour: TourDef;
  steps: TourStep[];
  /** Тур пройден до конца */
  onComplete: (stepsSeen: number, total: number) => void;
  /** Тур пропущен; disableAll — «Больше не показывать обучение» */
  onSkip: (stepsSeen: number, total: number, disableAll: boolean) => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Отступ подсветки вокруг элемента */
const PAD = 6;
/** Сколько ждать появления элемента шага, прежде чем пропустить шаг */
const FIND_TIMEOUT_MS = 1200;
const Z_INDEX = 1250;

/** Первый видимый элемент с меткой data-tour (у одной метки бывают варианты для телефона и компьютера) */
function findTarget(name: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour~="${name.replace(/"/g, '')}"]`);
  for (const el of Array.from(nodes)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    return el;
  }
  return null;
}

function sameBox(a: Box | null, b: DOMRect): boolean {
  return Boolean(
    a &&
      Math.round(a.top) === Math.round(b.top) &&
      Math.round(a.left) === Math.round(b.left) &&
      Math.round(a.width) === Math.round(b.width) &&
      Math.round(a.height) === Math.round(b.height)
  );
}

function useViewport() {
  const [size, setSize] = React.useState({ w: 1280, h: 800 });
  React.useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

/**
 * Пошаговая подсказка поверх интерфейса: затемнение с вырезом под элемент, рамка и карточка шага
 * («Назад», «Далее», «Пропустить»). Шаг с waitForClick пропускает нажатие на элемент и ждет его.
 */
export function TourOverlay({ tour, steps, onComplete, onSkip }: TourOverlayProps) {
  const [index, setIndex] = React.useState(0);
  const [box, setBox] = React.useState<Box | null>(null);
  const [resolved, setResolved] = React.useState(false);
  const [cardSize, setCardSize] = React.useState({ w: 360, h: 220 });
  const targetRef = React.useRef<HTMLElement | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const directionRef = React.useRef(1);
  const maxSeenRef = React.useRef(0);
  const viewport = useViewport();

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const total = steps.length;

  // Колбэки родителя — через ref: их пересоздание (например, открылось окно и страница перерисовалась)
  // не должно сбрасывать ожидание нажатия и переход к следующему шагу
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onSkipRef = React.useRef(onSkip);
  onSkipRef.current = onSkip;

  const finish = React.useCallback(() => onCompleteRef.current(maxSeenRef.current, total), [total]);
  const skip = React.useCallback((disableAll = false) => onSkipRef.current(maxSeenRef.current, total, disableAll), [total]);

  const go = React.useCallback(
    (delta: number) => {
      directionRef.current = delta >= 0 ? 1 : -1;
      setIndex((i) => {
        const next = i + delta;
        if (next >= steps.length) {
          // Завершение — после обновления состояния, чтобы не вызывать колбэк внутри setState
          window.setTimeout(finish, 0);
          return i;
        }
        return Math.max(0, next);
      });
    },
    [steps.length, finish]
  );

  // Поиск элемента шага, прокрутка к нему и слежение за его положением
  React.useEffect(() => {
    if (!step) return;
    let cancelled = false;
    let timer = 0;
    let raf = 0;
    let startedAt = Date.now();
    targetRef.current = null;
    setBox(null);
    setResolved(false);

    if (!step.target) {
      setResolved(true);
      maxSeenRef.current = Math.max(maxSeenRef.current, index + 1);
      return;
    }

    const track = () => {
      if (cancelled) return;
      const el = targetRef.current;
      if (!el || !el.isConnected) {
        // Элемент исчез (например, закрылось окно) — ищем заново
        targetRef.current = null;
        setBox(null);
        setResolved(false);
        startedAt = Date.now();
        timer = window.setTimeout(locate, 120);
        return;
      }
      const r = el.getBoundingClientRect();
      setBox((prev) => (sameBox(prev, r) ? prev : { top: r.top, left: r.left, width: r.width, height: r.height }));
      raf = window.requestAnimationFrame(track);
    };

    const locate = () => {
      if (cancelled) return;
      const el = findTarget(step.target as string);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 72 || r.bottom > window.innerHeight - 96) {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        targetRef.current = el;
        maxSeenRef.current = Math.max(maxSeenRef.current, index + 1);
        setResolved(true);
        track();
      } else if (Date.now() - startedAt > FIND_TIMEOUT_MS) {
        // Элемента нет на экране (нет записей, другой вид, нет права) — шаг пропускается;
        // назад дальше первого шага идти некуда — тогда вперед
        if (directionRef.current < 0 && index === 0) directionRef.current = 1;
        go(directionRef.current);
      } else {
        timer = window.setTimeout(locate, 120);
      }
    };

    locate();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(raf);
    };
  }, [step, index, go]);

  // «Нажмите сюда»: следующий шаг — после нажатия по подсвеченному элементу
  React.useEffect(() => {
    if (!resolved || !step?.waitForClick || !targetRef.current) return;
    const el = targetRef.current;
    let timer = 0;
    const onClick = () => {
      timer = window.setTimeout(() => go(1), 450);
    };
    el.addEventListener('click', onClick, { once: true });
    return () => {
      el.removeEventListener('click', onClick);
      window.clearTimeout(timer);
    };
  }, [resolved, step, go]);

  // Escape — пропустить тур (перехватывается раньше окон, чтобы не закрыть открытую карточку)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      skip();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [skip]);

  React.useLayoutEffect(() => {
    if (!cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    setCardSize((prev) => (Math.round(prev.w) === Math.round(r.width) && Math.round(prev.h) === Math.round(r.height) ? prev : { w: r.width, h: r.height }));
  });

  if (!step || typeof document === 'undefined') return null;
  if (step.target && !resolved) return null;

  const isPhone = viewport.w < 640;
  const isCompact = viewport.w < 1024;
  const body = isCompact && step.bodyMobile ? step.bodyMobile : step.body;

  const hole = box
    ? {
        top: Math.max(0, box.top - PAD),
        left: Math.max(0, box.left - PAD),
        width: Math.min(viewport.w, box.width + PAD * 2),
        height: Math.min(viewport.h, box.height + PAD * 2),
      }
    : null;

  // Положение карточки: телефон — у нижнего или верхнего края; компьютер — рядом с элементом
  let cardStyle: React.CSSProperties;
  if (isPhone) {
    const targetLow = hole ? hole.top + hole.height / 2 > viewport.h * 0.55 : false;
    cardStyle = targetLow
      ? { top: 'max(12px, env(safe-area-inset-top))', left: 12, right: 12 }
      : { bottom: 'max(12px, env(safe-area-inset-bottom))', left: 12, right: 12 };
  } else if (!hole) {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 380 };
  } else {
    const gap = 14;
    const w = Math.min(380, viewport.w - 24);
    const clampLeft = (x: number) => Math.min(Math.max(12, x), viewport.w - w - 12);
    const clampTop = (y: number) => Math.min(Math.max(12, y), viewport.h - cardSize.h - 12);
    if (hole.top + hole.height + gap + cardSize.h <= viewport.h - 12) {
      cardStyle = { top: hole.top + hole.height + gap, left: clampLeft(hole.left), width: w };
    } else if (hole.top - gap - cardSize.h >= 12) {
      cardStyle = { top: hole.top - gap - cardSize.h, left: clampLeft(hole.left), width: w };
    } else if (hole.left + hole.width + gap + w <= viewport.w - 12) {
      cardStyle = { top: clampTop(hole.top), left: hole.left + hole.width + gap, width: w };
    } else if (hole.left - gap - w >= 12) {
      cardStyle = { top: clampTop(hole.top), left: hole.left - gap - w, width: w };
    } else {
      cardStyle = { bottom: 16, left: clampLeft(hole.left), width: w };
    }
  }

  const dim = 'fixed bg-zinc-950/55 dark:bg-black/65';
  const block = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: Z_INDEX, pointerEvents: 'none' }}>
      {hole ? (
        <>
          <div className={dim} style={{ top: 0, left: 0, right: 0, height: hole.top, pointerEvents: 'auto' }} onClick={block} />
          <div className={dim} style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0, pointerEvents: 'auto' }} onClick={block} />
          <div className={dim} style={{ top: hole.top, left: 0, width: hole.left, height: hole.height, pointerEvents: 'auto' }} onClick={block} />
          <div
            className={dim}
            style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height, pointerEvents: 'auto' }}
            onClick={block}
          />
          {/* Без «нажмите сюда» элемент под подсветкой не нажимается */}
          {!step.waitForClick && (
            <div className="fixed" style={{ ...hole, pointerEvents: 'auto' }} onClick={block} />
          )}
          <div
            className="fixed rounded-2xl ring-2 ring-blue-500 shadow-[0_0_0_6px_rgba(59,130,246,0.25)] transition-[top,left,width,height] duration-150"
            style={{ ...hole, pointerEvents: 'none' }}
          />
        </>
      ) : (
        <div className={`${dim} inset-0`} style={{ pointerEvents: 'auto' }} onClick={block} />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Обучение: ${tour.title}`}
        className="fixed rounded-3xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200/80 dark:border-zinc-800 shadow-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150"
        style={{ ...cardStyle, pointerEvents: 'auto' }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 min-w-0 text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            <GraduationCap className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
            <span className="truncate">Обучение · {tour.title}</span>
          </span>
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[11px] font-mono text-zinc-400">
              {index + 1} / {total}
            </span>
            <button
              type="button"
              onClick={() => skip()}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Закрыть обучение"
              title="Пропустить обучение по модулю"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </span>
        </div>

        <div className="h-1 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>

        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{step.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{body}</p>
        </div>

        {step.waitForClick && (
          <div className="flex items-center gap-2 rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300 px-3 py-2 text-xs font-medium">
            <MousePointerClick className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
            Нажмите на подсвеченный элемент
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => skip()}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Пропустить
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="secondary" size="sm" onClick={() => go(-1)} leftIcon={<ChevronLeft className="w-3.5 h-3.5" strokeWidth={2} />}>
                Назад
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => (isLast ? finish() : go(1))}
              rightIcon={isLast ? undefined : <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />}
            >
              {isLast ? 'Готово' : 'Далее'}
            </Button>
          </div>
        </div>

        {index === 0 && (
          <button
            type="button"
            onClick={() => skip(true)}
            className="block text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline underline-offset-2"
          >
            Больше не показывать обучение
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
