// Проверка телефонов (lib/utils/phone.ts) и форматов дат (lib/utils/format.ts).
// Запуск: node --experimental-strip-types scripts/verify-phone-format.mjs
import assert from 'node:assert/strict';
import {
  PHONE_COUNTRIES,
  normalizeNational,
  isValidNational,
  splitFullNumber,
  toFullDigits,
  toE164,
  formatPhoneDisplay,
  fullDigitsFrom,
  telHref,
  waHref,
} from '../lib/utils/phone.ts';
import { formatDate, formatDateTime, formatDateOnly, formatMonth } from '../lib/utils/format.ts';

// --- Нормализация национального номера ---------------------------------------------------
assert.equal(normalizeNational('+996 700 123 456', '996'), '700123456', 'код страны срезается');
assert.equal(normalizeNational('0700123456', '996'), '700123456', 'ведущий ноль срезается');
assert.equal(normalizeNational('700123456', '996'), '700123456');
assert.equal(normalizeNational('+7 900 123 45 67', '7'), '9001234567');
assert.equal(normalizeNational('998901234567', '998'), '901234567');
assert.equal(normalizeNational('65123456', '993'), '65123456', 'Туркменистан: 8 цифр');
assert.equal(normalizeNational('7001234', '996'), '7001234', 'короткий номер не трогаем');

// --- Длина по стране --------------------------------------------------------------------
for (const c of PHONE_COUNTRIES) {
  assert.equal(isValidNational(c.placeholder, c.code), true, `${c.iso}: placeholder валиден`);
  assert.equal(isValidNational(c.placeholder.slice(1), c.code), false, `${c.iso}: на цифру короче`);
  assert.equal(isValidNational(`${c.placeholder}1`, c.code), false, `${c.iso}: на цифру длиннее`);
}
assert.equal(isValidNational('070012345', '996'), false, 'ведущий ноль недопустим');
assert.equal(isValidNational('', '996'), false);
assert.equal(isValidNational('700123456', 'xx'), true, 'неизвестный код → длина по умолчанию 9');

// --- Разбор полного номера ---------------------------------------------------------------
assert.deepEqual(splitFullNumber('+996700123456'), { countryCode: '996', national: '700123456' });
assert.deepEqual(splitFullNumber('996700123456'), { countryCode: '996', national: '700123456' });
assert.deepEqual(splitFullNumber('79001234567'), { countryCode: '7', national: '9001234567' });
assert.deepEqual(splitFullNumber('87011234567'), { countryCode: '7', national: '7011234567' }, 'через 8');
assert.deepEqual(splitFullNumber('700123456'), { countryCode: '996', national: '700123456' }, 'без кода → KG');
assert.deepEqual(splitFullNumber('375291234567'), { countryCode: '375', national: '291234567' });
assert.deepEqual(splitFullNumber('37491123456'), { countryCode: '374', national: '91123456' });
assert.equal(splitFullNumber('12345'), null);
assert.equal(splitFullNumber(''), null);
assert.equal(splitFullNumber(null), null);

// --- Сборка полного номера ---------------------------------------------------------------
assert.equal(toFullDigits('996', '700 123 456'), '996700123456');
assert.equal(toFullDigits(null, '700123456'), '996700123456', 'код по умолчанию');
assert.equal(toE164('7', '9001234567'), '+79001234567');

// --- Отображение: никогда «++» -----------------------------------------------------------
assert.equal(formatPhoneDisplay('+996700123456'), '+996 700 123 456');
assert.equal(formatPhoneDisplay('996700123456'), '+996 700 123 456');
assert.equal(formatPhoneDisplay('700123456', '996'), '+996 700 123 456');
assert.equal(formatPhoneDisplay('+996700123456', '996'), '+996 700 123 456', 'лид с кодом в номере');
assert.equal(formatPhoneDisplay('9001234567', '7'), '+7 900 123 45 67');
assert.equal(formatPhoneDisplay('65123456', '993'), '+993 65 12 34 56');
assert.equal(formatPhoneDisplay(''), '—');
assert.equal(formatPhoneDisplay(null), '—');
assert.equal(formatPhoneDisplay('12345'), '+12345', 'нераспознанный номер выводится как есть');
for (const raw of ['+996700123456', '996700123456', '+79001234567']) {
  assert.ok(!formatPhoneDisplay(raw).includes('++'), `нет «++» для ${raw}`);
}

// --- Ссылки tel:/wa.me -------------------------------------------------------------------
assert.equal(fullDigitsFrom('+996 700 123 456'), '996700123456');
assert.equal(fullDigitsFrom('700123456', '996'), '996700123456');
assert.equal(telHref('700123456', '996'), 'tel:+996700123456');
assert.equal(waHref('+996700123456'), 'https://wa.me/996700123456');
assert.equal(telHref(''), '#');
assert.equal(waHref(null), '#');

// --- Даты: «ДД.ММ.ГГГГ - чч:мм:сс», DATE без сдвига, «ММ.ГГГГ» ---------------------------
assert.equal(formatDateTime('2026-03-05T18:04:09Z'), '06.03.2026 - 00:04:09', 'UTC → Бишкек (+6)');
assert.equal(formatDateTime('2026-03-05T05:04:09.123Z'), '05.03.2026 - 11:04:09');
assert.equal(formatDate('2026-03-05T18:04:09Z'), '06.03.2026');
assert.equal(formatDateTime('2026-03-05'), '05.03.2026', 'DATE без времени — только дата');
assert.equal(formatDate('2026-03-05'), '05.03.2026');
assert.equal(formatDateOnly('2026-03-05'), '05.03.2026', 'без сдвига пояса');
assert.equal(formatDateOnly('2026-12-31'), '31.12.2026');
assert.equal(formatMonth('2026-03'), '03.2026');
assert.equal(formatMonth('2026-03-05T18:04:09Z'), '03.2026');
assert.equal(formatDateTime(null), '—');
assert.equal(formatDateTime(''), '—');
assert.equal(formatDateTime('мусор'), '—');
assert.equal(formatMonth('abc'), '—');
assert.equal(formatDateOnly(null), '—');

console.log('verify-phone-format: OK');
