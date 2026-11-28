// Проверка счетчиков воронки лидов (lib/leads/stats.ts), «На сегодня» по Бишкеку и ключа дубля номера
// (lib/leads/duplicates.ts). Запуск: node --experimental-strip-types scripts/verify-lead-funnel.mjs
import assert from 'node:assert/strict';
import {
  STATUS_COUNT_KEY,
  bishkekDayBounds,
  countCancelReasons,
  countLeadStatuses,
  isCallbackDue,
  isLeadDueToday,
  isMeetingToday,
} from '../lib/leads/stats.ts';
import { countPhoneKeys, leadPhoneKey } from '../lib/leads/duplicates.ts';
import { LEAD_STATUSES } from '../lib/leads/status-rules.ts';

// Каждому статусу — свой счетчик
for (const s of LEAD_STATUSES) assert.ok(STATUS_COUNT_KEY[s], `нет счетчика для «${s}»`);

// Сутки по Бишкеку (UTC+6): 28.11.2026 03:00 по Бишкеку = 27.11 21:00 UTC
const now = new Date('2026-11-27T21:00:00Z');
const { start, end } = bishkekDayBounds(now);
assert.equal(new Date(start).toISOString(), '2026-11-27T18:00:00.000Z', 'начало 28.11 по Бишкеку');
assert.equal(new Date(end).toISOString(), '2026-11-28T18:00:00.000Z');

const rows = [
  { status: 'Открыт' },
  { status: 'Нет ответа' },
  { status: 'Встреча', meeting_at: '2026-11-28T10:00:00Z' }, // 16:00 по Бишкеку сегодня
  { status: 'Встреча', meeting_at: '2026-11-29T04:00:00Z' }, // завтра
  { status: 'Перезвонить', next_contact_at: '2026-11-26T05:00:00Z' }, // просрочено
  { status: 'Перезвонить', next_contact_at: '2026-11-28T12:00:00Z' }, // сегодня
  { status: 'Перезвонить', next_contact_at: '2026-11-30T04:00:00Z' }, // позже
  { status: 'Отмена', cancel_reason_code: 'too_expensive' },
  { status: 'Отмена', cancel_reason_code: 'too_expensive' },
  { status: 'Отмена', cancel_reason_code: null },
  { status: 'Подписан' },
];
const c = countLeadStatuses(rows, now);
assert.equal(c.total, 11);
assert.equal(c.open, 1);
assert.equal(c.noAnswer, 1);
assert.equal(c.meeting, 2);
assert.equal(c.callback, 3);
assert.equal(c.cancelled, 3);
assert.equal(c.signed, 1);
assert.equal(c.meetingsToday, 1);
assert.equal(c.callbackDue, 2, 'сегодня и просроченные');
assert.equal(isMeetingToday(rows[3], now), false);
assert.equal(isCallbackDue(rows[6], now), false);
assert.equal(rows.filter((r) => isLeadDueToday(r, now)).length, 3);
assert.deepEqual(countCancelReasons(rows), [
  { code: 'too_expensive', label: 'Дорого', count: 2 },
  { code: 'unknown', label: 'Не указана', count: 1 },
]);

// Ключ номера: один номер в разных форматах — один ключ
assert.equal(leadPhoneKey('700123456', '996'), '996700123456');
assert.equal(leadPhoneKey('0700123456', '996'), '996700123456');
assert.equal(leadPhoneKey('+996 700 123 456', null), '996700123456');
assert.equal(leadPhoneKey('', '996'), '');
const counts = countPhoneKeys([
  { phone: '700123456', country_code: '996' },
  { phone: '996700123456', country_code: '996' },
  { phone: '555000111', country_code: '996' },
]);
assert.equal(counts.get('996700123456'), 2);
assert.equal(counts.get('996555000111'), 1);

console.log('verify-lead-funnel: OK');
