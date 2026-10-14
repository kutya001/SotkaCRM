/**
 * Периоды планов по подключениям: нормализация начала периода, конец (исключительно),
 * подписи и статус выполнения. Даты — строки «ГГГГ-ММ-ДД», без сдвига часового пояса.
 */

export const PLAN_PERIOD_KINDS = ['daily', 'weekly', 'monthly', 'quarterly', 'half_year', 'yearly'] as const;
export type PlanPeriodKind = (typeof PLAN_PERIOD_KINDS)[number];

export const PLAN_PERIOD_LABELS: Record<PlanPeriodKind, string> = {
  daily: 'Ежедневный',
  weekly: 'Еженедельный',
  monthly: 'Ежемесячный',
  quarterly: 'Квартальный',
  half_year: 'Полугодовой',
  yearly: 'Годовой',
};

export const PLAN_SCOPES = ['personal', 'team'] as const;
export type PlanScope = (typeof PLAN_SCOPES)[number];

export const PLAN_SCOPE_LABELS: Record<PlanScope, string> = {
  personal: 'Персональный',
  team: 'Общий',
};

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parse(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

export function isISODate(value: unknown): value is string {
  return typeof value === 'string' && DATE_REGEX.test(value) && !isNaN(parse(value).getTime());
}

/** Начало периода, содержащего дату: понедельник, 1-е число, начало квартала/полугодия/года */
export function normalizePeriodStart(kind: PlanPeriodKind, date: string): string {
  const d = parse(date);
  switch (kind) {
    case 'daily':
      return toISO(d);
    case 'weekly': {
      const weekday = (d.getUTCDay() + 6) % 7; // 0 = понедельник
      return toISO(addDays(d, -weekday));
    }
    case 'monthly':
      return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    case 'quarterly':
      return toISO(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)));
    case 'half_year':
      return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() < 6 ? 0 : 6, 1)));
    case 'yearly':
      return toISO(new Date(Date.UTC(d.getUTCFullYear(), 0, 1)));
  }
}

/** Конец периода (первый день следующего периода, не включается) */
export function periodEnd(kind: PlanPeriodKind, start: string): string {
  const d = parse(start);
  switch (kind) {
    case 'daily':
      return toISO(addDays(d, 1));
    case 'weekly':
      return toISO(addDays(d, 7));
    case 'monthly':
      return toISO(addMonths(d, 1));
    case 'quarterly':
      return toISO(addMonths(d, 3));
    case 'half_year':
      return toISO(addMonths(d, 6));
    case 'yearly':
      return toISO(addMonths(d, 12));
  }
}

function ddmm(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

function ddmmyyyy(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

/** Человекочитаемый период: «13.10.2026», «13.10–19.10.2026», «10.2026», «4 кв. 2026», «2-е полугодие 2026», «2026» */
export function formatPeriodLabel(kind: PlanPeriodKind, start: string): string {
  const [y, m] = start.split('-').map(Number);
  switch (kind) {
    case 'daily':
      return ddmmyyyy(start);
    case 'weekly': {
      const last = toISO(addDays(parse(start), 6));
      return `${ddmm(start)}–${ddmmyyyy(last)}`;
    }
    case 'monthly':
      return `${String(m).padStart(2, '0')}.${y}`;
    case 'quarterly':
      return `${Math.floor((m - 1) / 3) + 1} кв. ${y}`;
    case 'half_year':
      return `${m < 7 ? '1' : '2'}-е полугодие ${y}`;
    case 'yearly':
      return String(y);
  }
}

export type PlanProgressStatus = 'done' | 'active' | 'overdue' | 'upcoming';

export const PLAN_STATUS_LABELS: Record<PlanProgressStatus, string> = {
  done: 'Выполнен',
  active: 'В работе',
  overdue: 'Не выполнен',
  upcoming: 'Предстоит',
};

export function planProgressStatus(actual: number, target: number, start: string, end: string, today: string): PlanProgressStatus {
  if (target > 0 && actual >= target) return 'done';
  if (today >= end) return 'overdue';
  if (today >= start) return 'active';
  return 'upcoming';
}

/** Доля периода, которая уже прошла (0..1) — для ориентира «идем ли по графику» */
export function periodElapsedShare(start: string, end: string, today: string): number {
  const s = parse(start).getTime();
  const e = parse(end).getTime();
  const t = parse(today).getTime();
  if (t <= s) return 0;
  if (t >= e) return 1;
  return (t - s) / (e - s);
}
