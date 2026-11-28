/**
 * Подсчет лидов по статусам и причинам отмены (вкладки «Лидов», аналитика, воронки API).
 * Файл чистый: импортирует только чистые модули — используется на сервере, в браузере и в проверках.
 */
import { CANCEL_REASONS, cancelReasonLabel } from './cancel-reasons.ts';

export interface LeadStatusCounts {
  total: number;
  open: number;
  noAnswer: number;
  processed: number;
  assigned: number;
  meeting: number;
  callback: number;
  signed: number;
  cancelled: number;
  /** «Перезвонить» с датой контакта не позже конца сегодняшнего дня (включая просроченные) */
  callbackDue: number;
  /** «Встреча» сегодня */
  meetingsToday: number;
}

export const EMPTY_LEAD_STATUS_COUNTS: LeadStatusCounts = {
  total: 0,
  open: 0,
  noAnswer: 0,
  processed: 0,
  assigned: 0,
  meeting: 0,
  callback: 0,
  signed: 0,
  cancelled: 0,
  callbackDue: 0,
  meetingsToday: 0,
};

/** Ключ счетчика для статуса */
export const STATUS_COUNT_KEY: Record<string, keyof LeadStatusCounts> = {
  Открыт: 'open',
  'Нет ответа': 'noAnswer',
  Обработан: 'processed',
  Назначен: 'assigned',
  Встреча: 'meeting',
  Перезвонить: 'callback',
  Подписан: 'signed',
  Отмена: 'cancelled',
};

/** Часовой пояс CRM — Бишкек (UTC+6, без перехода на летнее время) */
const BISHKEK_OFFSET_MS = 6 * 3_600_000;

/** Границы «сегодня» по Бишкеку в UTC: [начало, конец) */
export function bishkekDayBounds(now: Date = new Date()): { start: number; end: number } {
  const local = new Date(now.getTime() + BISHKEK_OFFSET_MS);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = startLocal - BISHKEK_OFFSET_MS;
  return { start, end: start + 86_400_000 };
}

export interface LeadStatsRow {
  status: string;
  meeting_at?: string | null;
  next_contact_at?: string | null;
}

/** Звонок, срок которого наступил (сегодня или просрочен) */
export function isCallbackDue(row: LeadStatsRow, now: Date = new Date()): boolean {
  return row.status === 'Перезвонить' && Boolean(row.next_contact_at) && Date.parse(row.next_contact_at as string) < bishkekDayBounds(now).end;
}

/** Встреча сегодня (по Бишкеку) */
export function isMeetingToday(row: LeadStatsRow, now: Date = new Date()): boolean {
  if (row.status !== 'Встреча' || !row.meeting_at) return false;
  const t = Date.parse(row.meeting_at);
  const { start, end } = bishkekDayBounds(now);
  return t >= start && t < end;
}

/** Вкладка «На сегодня»: встречи сегодня и звонки, срок которых наступил */
export function isLeadDueToday(row: LeadStatsRow, now: Date = new Date()): boolean {
  return isCallbackDue(row, now) || isMeetingToday(row, now);
}

export function countLeadStatuses(rows: LeadStatsRow[], now: Date = new Date()): LeadStatusCounts {
  const counts: LeadStatusCounts = { ...EMPTY_LEAD_STATUS_COUNTS, total: rows.length };
  for (const row of rows) {
    const key = STATUS_COUNT_KEY[row.status];
    if (key) counts[key]++;
    if (isCallbackDue(row, now)) counts.callbackDue++;
    if (isMeetingToday(row, now)) counts.meetingsToday++;
  }
  return counts;
}

export interface CancelReasonCount {
  code: string;
  label: string;
  count: number;
}

/** Отмены по причинам (в порядке списка, «Не указана» — старые отмены без кода — в конце) */
export function countCancelReasons(rows: { status: string; cancel_reason_code?: string | null }[]): CancelReasonCount[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== 'Отмена') continue;
    const code = row.cancel_reason_code || 'unknown';
    map.set(code, (map.get(code) || 0) + 1);
  }
  const ordered: CancelReasonCount[] = CANCEL_REASONS.filter((r) => map.has(r.code)).map((r) => ({
    code: r.code,
    label: r.label,
    count: map.get(r.code) || 0,
  }));
  if (map.has('unknown')) ordered.push({ code: 'unknown', label: cancelReasonLabel(null), count: map.get('unknown') || 0 });
  return ordered;
}
