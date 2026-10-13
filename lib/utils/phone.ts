/**
 * Телефоны: коды стран СНГ, длина национального номера, нормализация и отображение.
 *
 * Хранение: лиды — country_code + phone (национальный номер без кода);
 * сотрудники — полный номер цифрами («996555123456»); продавцы (Sotka) — «+996…».
 */

export interface PhoneCountry {
  iso: 'KG' | 'RU' | 'KZ' | 'UZ' | 'TJ' | 'TM' | 'BY' | 'UA' | 'AM' | 'AZ' | 'MD';
  code: string;
  name: string;
  flag: string;
  /** Длина национального номера (без кода страны) */
  nationalLength: number;
  placeholder: string;
}

export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: 'KG', code: '996', name: 'Кыргызстан', flag: '🇰🇬', nationalLength: 9, placeholder: '700123456' },
  { iso: 'RU', code: '7', name: 'Россия', flag: '🇷🇺', nationalLength: 10, placeholder: '9001234567' },
  { iso: 'KZ', code: '7', name: 'Казахстан', flag: '🇰🇿', nationalLength: 10, placeholder: '7011234567' },
  { iso: 'UZ', code: '998', name: 'Узбекистан', flag: '🇺🇿', nationalLength: 9, placeholder: '901234567' },
  { iso: 'TJ', code: '992', name: 'Таджикистан', flag: '🇹🇯', nationalLength: 9, placeholder: '901234567' },
  { iso: 'TM', code: '993', name: 'Туркменистан', flag: '🇹🇲', nationalLength: 8, placeholder: '65123456' },
  { iso: 'BY', code: '375', name: 'Беларусь', flag: '🇧🇾', nationalLength: 9, placeholder: '291234567' },
  { iso: 'UA', code: '380', name: 'Украина', flag: '🇺🇦', nationalLength: 9, placeholder: '501234567' },
  { iso: 'AM', code: '374', name: 'Армения', flag: '🇦🇲', nationalLength: 8, placeholder: '91123456' },
  { iso: 'AZ', code: '994', name: 'Азербайджан', flag: '🇦🇿', nationalLength: 9, placeholder: '501234567' },
  { iso: 'MD', code: '373', name: 'Молдова', flag: '🇲🇩', nationalLength: 8, placeholder: '69123456' },
];

export const DEFAULT_COUNTRY_CODE = '996';

/** Уникальные коды стран (RU и KZ делят «7») */
export const PHONE_COUNTRY_CODES: readonly string[] = Array.from(new Set(PHONE_COUNTRIES.map((c) => c.code)));

export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function findPhoneCountry(code: string | null | undefined): PhoneCountry | undefined {
  const clean = digitsOnly(code);
  return PHONE_COUNTRIES.find((c) => c.code === clean);
}

export function nationalLengthFor(code: string | null | undefined): number {
  return findPhoneCountry(code)?.nationalLength ?? 9;
}

/**
 * Национальный номер из пользовательского ввода: убираются нецифры, код страны
 * (если ввели вместе с ним) и ведущий ноль («0700123456» → «700123456»).
 */
export function normalizeNational(raw: unknown, countryCode: string | null | undefined): string {
  const code = digitsOnly(countryCode) || DEFAULT_COUNTRY_CODE;
  const expected = nationalLengthFor(code);
  let digits = digitsOnly(raw);

  if (digits.length > expected && digits.startsWith(code)) {
    digits = digits.slice(code.length);
  }
  if (digits.length === expected + 1 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

export function isValidNational(national: unknown, countryCode: string | null | undefined): boolean {
  const digits = digitsOnly(national);
  return digits.length > 0 && digits.length === nationalLengthFor(countryCode) && !digits.startsWith('0');
}

export function isKnownCountryCode(code: unknown): boolean {
  return PHONE_COUNTRY_CODES.includes(digitsOnly(code));
}

/**
 * Разбор полного номера («+996700123456», «996700123456», «87011234567») на код и национальный номер.
 * Коды сравниваются от длинных к коротким, «7» — последним, чтобы «700…» не считалось Россией.
 */
export function splitFullNumber(raw: unknown): { countryCode: string; national: string } | null {
  const digits = digitsOnly(raw);
  if (!digits) return null;

  const codes = [...PHONE_COUNTRY_CODES].sort((a, b) => b.length - a.length);
  for (const code of codes) {
    if (digits.startsWith(code) && digits.length === code.length + nationalLengthFor(code)) {
      return { countryCode: code, national: digits.slice(code.length) };
    }
  }

  // Казахстанский/российский номер через «8»
  if (digits.length === 11 && digits.startsWith('8')) {
    return { countryCode: '7', national: digits.slice(1) };
  }

  // Национальный номер без кода: принимаем за Кыргызстан, если длина подходит
  if (digits.length === nationalLengthFor(DEFAULT_COUNTRY_CODE)) {
    return { countryCode: DEFAULT_COUNTRY_CODE, national: digits };
  }

  return null;
}

/** «996700123456» — хранение полного номера цифрами */
export function toFullDigits(countryCode: string | null | undefined, national: unknown): string {
  return `${digitsOnly(countryCode) || DEFAULT_COUNTRY_CODE}${digitsOnly(national)}`;
}

/** «+996700123456» */
export function toE164(countryCode: string | null | undefined, national: unknown): string {
  return `+${toFullDigits(countryCode, national)}`;
}

function groupNational(national: string): string {
  // 700 123 456 / 900 123 45 67 / 65 12 34 56
  if (national.length === 10) return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6, 8)} ${national.slice(8)}`;
  if (national.length === 9) return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
  if (national.length === 8) return `${national.slice(0, 2)} ${national.slice(2, 4)} ${national.slice(4, 6)} ${national.slice(6)}`;
  return national;
}

/**
 * Отображение номера: «+996 700 123 456». Принимает «+996…», «996…», или
 * национальный номер с отдельным кодом; никогда не выводит «++».
 */
export function formatPhoneDisplay(raw: unknown, countryCode?: string | null): string {
  const digits = digitsOnly(raw);
  if (!digits) return '—';

  if (countryCode) {
    const code = digitsOnly(countryCode) || DEFAULT_COUNTRY_CODE;
    const national = normalizeNational(digits, code);
    return `+${code} ${groupNational(national)}`;
  }

  const parts = splitFullNumber(digits);
  if (parts) return `+${parts.countryCode} ${groupNational(parts.national)}`;
  return `+${digits}`;
}

/** Полный номер цифрами для ссылок tel:/wa.me из любого хранимого формата */
export function fullDigitsFrom(raw: unknown, countryCode?: string | null): string {
  const digits = digitsOnly(raw);
  if (!digits) return '';
  if (countryCode) return toFullDigits(countryCode, normalizeNational(digits, countryCode));
  const parts = splitFullNumber(digits);
  return parts ? toFullDigits(parts.countryCode, parts.national) : digits;
}

export function telHref(raw: unknown, countryCode?: string | null): string {
  const full = fullDigitsFrom(raw, countryCode);
  return full ? `tel:+${full}` : '#';
}

export function waHref(raw: unknown, countryCode?: string | null): string {
  const full = fullDigitsFrom(raw, countryCode);
  return full ? `https://wa.me/${full}` : '#';
}
