/**
 * Форматирование дат и времени в едином стиле CRM с детерминированным часовым поясом
 * (Asia/Bishkek): одинаковый вывод на сервере (Vercel, UTC) и в браузере — без ошибок гидратации.
 *
 *  - отметка времени (TIMESTAMPTZ): «ДД.ММ.ГГГГ - чч:мм:сс»  → formatDateTime
 *  - дата без времени (DATE «ГГГГ-ММ-ДД»): «ДД.ММ.ГГГГ»      → formatDateOnly (без сдвига пояса)
 *  - месяц («ГГГГ-ММ»): «ММ.ГГГГ»                           → formatMonth
 */

export const BISHKEK_TIMEZONE = 'Asia/Bishkek';

type DateInput = string | number | Date | null | undefined;

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_REGEX = /^(\d{4})-(\d{2})$/;

function toParts(date: DateInput): Record<string, string> | null {
  if (date === null || date === undefined || date === '') return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: BISHKEK_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

/** «ДД.ММ.ГГГГ» по отметке времени (в поясе Бишкека) */
export function formatDate(date: DateInput): string {
  if (typeof date === 'string' && DATE_ONLY_REGEX.test(date)) return formatDateOnly(date);
  const p = toParts(date);
  return p ? `${p.day}.${p.month}.${p.year}` : '—';
}

/** «ДД.ММ.ГГГГ - чч:мм:сс» по отметке времени (в поясе Бишкека) */
export function formatDateTime(date: DateInput): string {
  if (typeof date === 'string' && DATE_ONLY_REGEX.test(date)) return formatDateOnly(date);
  const p = toParts(date);
  return p ? `${p.day}.${p.month}.${p.year} - ${p.hour}:${p.minute}:${p.second}` : '—';
}

/**
 * «ДД.ММ.ГГГГ» для значений без времени (колонки DATE: дата операции, дата рождения).
 * Строка «ГГГГ-ММ-ДД» разбирается без Date, чтобы день не сдвигался часовым поясом.
 */
export function formatDateOnly(date: DateInput): string {
  if (typeof date === 'string') {
    const m = date.match(DATE_ONLY_REGEX);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  }
  return formatDate(date);
}

/** «ММ.ГГГГ» для расчетного месяца «ГГГГ-ММ» */
export function formatMonth(month: DateInput): string {
  if (typeof month === 'string') {
    const m = month.match(MONTH_REGEX);
    if (m) return `${m[2]}.${m[1]}`;
  }
  const p = toParts(month);
  return p ? `${p.month}.${p.year}` : '—';
}

/** @deprecated используйте formatDateTime */
export const formatShortDateTime = formatDateTime;

/** @deprecated используйте formatDate */
export const formatShortDate = formatDate;

/** @deprecated используйте formatMonth */
export const formatMonthYear = formatMonth;

/** Текущая дата в поясе Бишкека как «ГГГГ-ММ-ДД» (для значений по умолчанию в формах) */
export function todayISODate(): string {
  const p = toParts(new Date());
  return p ? `${p.year}-${p.month}-${p.day}` : new Date().toISOString().slice(0, 10);
}

/** Текущий месяц в поясе Бишкека как «ГГГГ-ММ» */
export function currentMonthISO(): string {
  return todayISODate().slice(0, 7);
}
