/**
 * Нормализаторы и утилиты трансформации данных для Sotka API
 */

import type { SotkaSellerOverviewItem, NormalizedSotkaSeller } from './types';
import type { SellerModerationStatus } from '@/types/database.types';

/**
 * 1. Очистка и санитизация номера телефона
 * API Sotka строго требует 9 цифр без кода страны и без ведущего нуля
 * Пример: +996 (700) 888-268 -> 700888268
 * 0700888268 -> 700888268
 * 996700888268 -> 700888268
 */
export function sanitizePhone(phone: string): string {
  if (!phone) return '';

  // Оставляем строго цифры
  let digits = String(phone).replace(/\D/g, '');

  // Если 12 цифр и начинается с кода Кыргызстана (996...)
  if (digits.length === 12 && digits.startsWith('996')) {
    digits = digits.slice(3);
  }
  // Если 10 цифр и начинается с 0 (локальный формат 0700...)
  else if (digits.length === 10 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  // Если больше 9 цифр, берем последние 9 цифр абонента
  else if (digits.length > 9) {
    digits = digits.slice(-9);
  }

  return digits;
}

/**
 * 2. Полиморфная распаковка массивов из любых форматов ответов Sotka API:
 * - Прямой массив: [...]
 * - Django REST Framework: { results: [...] }
 * - Вложенный в detail: { detail: { items: [...] } } или { detail: { results: [...] } }
 * - Объект с items: { items: [...] }
 * - Массив в detail: { detail: [...] }
 * - Массив в data: { data: [...] }
 * - Одиночный объект: { ... } -> [...]
 */
export function extractArrayData<T = any>(json: unknown): T[] {
  if (!json) return [];

  if (Array.isArray(json)) {
    return json as T[];
  }

  if (typeof json === 'object') {
    const obj = json as Record<string, any>;

    // Django REST Framework
    if (Array.isArray(obj.results)) {
      return obj.results as T[];
    }

    // items на верхнем уровне
    if (Array.isArray(obj.items)) {
      return obj.items as T[];
    }

    // detail.items или detail.results
    if (obj.detail && typeof obj.detail === 'object') {
      if (Array.isArray(obj.detail.items)) {
        return obj.detail.items as T[];
      }
      if (Array.isArray(obj.detail.results)) {
        return obj.detail.results as T[];
      }
      if (Array.isArray(obj.detail)) {
        return obj.detail as T[];
      }
    }

    // data массив
    if (Array.isArray(obj.data)) {
      return obj.data as T[];
    }

    // Если это одиночный полезный объект (не сообщение об ошибке)
    if (!obj.detail || typeof obj.detail !== 'string') {
      // Исключаем системные служебные ответы об ошибках
      if (!obj.error && !obj.errors) {
        if (obj.detail && typeof obj.detail === 'object') {
          return [obj.detail as T];
        }
        return [obj as T];
      }
    }
  }

  return [];
}

/**
 * 3. Извлечение общего количества записей (total count) для пагинации
 */
export function extractTotalCount(json: unknown, itemsLength = 0): number {
  if (!json || typeof json !== 'object') return itemsLength;
  const obj = json as Record<string, any>;

  if (typeof obj.total === 'number') return obj.total;
  if (typeof obj.count === 'number') return obj.count;
  if (obj.detail && typeof obj.detail.total === 'number') return obj.detail.total;
  if (obj.detail && typeof obj.detail.count === 'number') return obj.detail.count;

  return itemsLength;
}

/**
 * 4. Рекурсивное сглаживание вложенных объектов (denormalizer)
 */
export function flattenObject(
  obj: Record<string, any>,
  prefix = ''
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const prefixedKey = prefix ? `${prefix}_${key}` : key;

    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      Object.assign(result, flattenObject(value, prefixedKey));
    } else {
      result[prefixedKey] = value;
    }
  }

  return result;
}

/**
 * 5. Преобразование даты в формат ISO 8601 для безопасной вставки в PostgreSQL TIMESTAMPTZ
 * Предотвращает ошибку 'date/time field value out of range' при получении дат в формате DD.MM.YYYY HH:mm
 * Все локализованные даты без часового пояса интерпретируются в поясе Бишкека (UTC+6).
 */
export function parseDateToISO(dateInput: unknown): string | null {
  if (dateInput === null || dateInput === undefined) return null;

  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? null : dateInput.toISOString();
  }

  if (typeof dateInput === 'number') {
    const ms = dateInput < 1e11 ? dateInput * 1000 : dateInput;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (typeof dateInput !== 'string') return null;

  const trimmed = dateInput.trim();
  if (!trimmed) return null;

  // 1. Формат DD.MM.YYYY [HH:mm[:ss]] (типичный ответ API api.sotka.kg)
  const dmyMatch = trimmed.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (dmyMatch) {
    const [, rawDay, rawMonth, year, rawHours = '00', rawMinutes = '00', rawSeconds = '00'] = dmyMatch;
    const day = rawDay.padStart(2, '0');
    const month = rawMonth.padStart(2, '0');
    const hours = rawHours.padStart(2, '0');
    const minutes = rawMinutes.padStart(2, '0');
    const seconds = rawSeconds.padStart(2, '0');

    // Интерпретируем как локальное время Кыргызстана (UTC+6)
    const isoLike = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+06:00`;
    const parsed = new Date(isoLike);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  // 2. Формат YYYY-MM-DD [HH:mm[:ss]] без часового пояса
  const ymdMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (ymdMatch) {
    const [, year, month, day, rawHours = '00', rawMinutes = '00', rawSeconds = '00'] = ymdMatch;
    const hours = rawHours.padStart(2, '0');
    const minutes = rawMinutes.padStart(2, '0');
    const seconds = rawSeconds.padStart(2, '0');
    const isoLike = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+06:00`;
    const parsed = new Date(isoLike);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  // 3. Стандартный ISO 8601 или другие форматы, поддерживаемые Date.parse
  const directParsed = new Date(trimmed);
  if (!isNaN(directParsed.getTime())) {
    return directParsed.toISOString();
  }

  return null;
}

/**
 * 6. Стандартный справочник соответствий названий тарифов Sotka API -> plan_id в SotkaCRM
 */
export const STANDARD_PLAN_MAPPINGS: Record<string, string> = {
  'базовый': 'PLN-BASE',
  'base': 'PLN-BASE',
  'basic': 'PLN-BASE',
  'pln-base': 'PLN-BASE',

  'премиум': 'PLN-PREM',
  'premium': 'PLN-PREM',
  'prem': 'PLN-PREM',
  'pln-prem': 'PLN-PREM',

  'бизнес': 'PLN-BIZ',
  'business': 'PLN-BIZ',
  'biz': 'PLN-BIZ',
  'pln-biz': 'PLN-BIZ',

  'корпоративный': 'PLN-CORP',
  'корпоратив': 'PLN-CORP',
  'corporate': 'PLN-CORP',
  'corp': 'PLN-CORP',
  'pln-corp': 'PLN-CORP',
};

/**
 * Нормализация и сопоставление тарифа продавца из Sotka API с каталогом plans
 * Гарантирует предотвращение ошибки foreign key constraint "sellers_plan_id_fkey"
 */
export function resolveSotkaPlan(
  rawPlan: unknown,
  dbPlansMap?: Map<string, string>,
  validPlanIds?: Set<string>
): { planId: string | null; planName: string } {
  if (!rawPlan || typeof rawPlan !== 'string') {
    return { planId: null, planName: 'Без тарифа' };
  }

  const trimmed = rawPlan.trim();
  if (!trimmed || trimmed.toLowerCase() === 'без тарифа') {
    return { planId: null, planName: 'Без тарифа' };
  }

  const lower = trimmed.toLowerCase();

  // 1. Поиск в переданной карте БД (если предоставлена)
  if (dbPlansMap && dbPlansMap.has(lower)) {
    const candidateId = dbPlansMap.get(lower)!;
    if (!validPlanIds || validPlanIds.has(candidateId)) {
      return { planId: candidateId, planName: trimmed };
    }
  }

  // 2. Поиск в стандартных маппингах
  if (STANDARD_PLAN_MAPPINGS[lower]) {
    const candidateId = STANDARD_PLAN_MAPPINGS[lower];
    if (!validPlanIds || validPlanIds.has(candidateId)) {
      return { planId: candidateId, planName: trimmed };
    }
  }

  // 3. Поиск по частичному совпадению
  for (const [key, id] of Object.entries(STANDARD_PLAN_MAPPINGS)) {
    if (lower.includes(key) || key.includes(lower)) {
      if (!validPlanIds || validPlanIds.has(id)) {
        return { planId: id, planName: trimmed };
      }
    }
  }

  // 4. Если передан validPlanIds и candidateId в нем отсутствует - строго возвращаем null
  // для исключения нарушения внешнего ключа sellers_plan_id_fkey
  return { planId: null, planName: trimmed };
}

/**
 * 7. Форматирование номера продавца для первичного ключа sellers.seller_phone (+996XXXXXXXXX)
 */
export function formatSellerPhone(phone: unknown, isoCode?: string): string {
  if (!phone) return '';
  const str = String(phone).trim();
  const digits = str.replace(/\D/g, '');
  if (!digits) return '';

  // 12 цифр с кодом Кыргызстана 996...
  if (digits.length === 12 && digits.startsWith('996')) {
    return `+${digits}`;
  }

  // 9 цифр абонента (без кода страны) -> +996XXXXXXXXX
  if (digits.length === 9) {
    const rawIsoDigits = isoCode ? String(isoCode).replace(/\D/g, '') : '';
    const prefix = rawIsoDigits || '996';
    return `+${prefix}${digits}`;
  }

  // 10 цифр с ведущим нулем 0XXXXXXXXX -> +996XXXXXXXXX
  if (digits.length === 10 && digits.startsWith('0')) {
    return `+996${digits.slice(1)}`;
  }

  // Если уже начинается с плюса
  if (str.startsWith('+')) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

/**
 * 8. Нормализация объекта продавца из Sotka HQ API (SotkaSellerOverviewItem)
 * Преобразует элемент внешнего API в модель NormalizedSotkaSeller, готовую для
 * сохранения в Supabase (таблица sellers) и возврата в UI без undefined.
 */
export function normalizeSotkaSeller(
  item: SotkaSellerOverviewItem,
  options?: {
    dbPlansMap?: Map<string, string>;
    validPlanIds?: Set<string>;
    preservedManagerId?: string | null;
  }
): NormalizedSotkaSeller {
  const orgId =
    item.organization_id !== undefined && item.organization_id !== null
      ? String(item.organization_id)
      : '';

  const name = item.seller_name || 'Без имени';
  const phone = formatSellerPhone(item.seller_phone, item.iso_code);

  let store = 'Без названия';
  if (typeof item.store === 'string' && item.store.trim()) {
    store = item.store.trim();
  } else if (Array.isArray(item.stores) && item.stores.length > 0) {
    store = item.stores.filter(Boolean).join(', ') || 'Без названия';
  } else if (typeof (item as any).stores === 'string' && (item as any).stores.trim()) {
    store = (item as any).stores.trim();
  }

  const rawMod = String(item.moderation || 'pending').toLowerCase();
  const validModStatus: SellerModerationStatus =
    rawMod === 'approved' || rawMod === 'pending' || rawMod === 'rejected' || rawMod === 'blocked'
      ? (rawMod as SellerModerationStatus)
      : 'pending';

  const rawBalance = item.balance;
  const balanceNum =
    typeof rawBalance === 'number'
      ? rawBalance
      : typeof rawBalance === 'string'
      ? parseFloat(rawBalance) || 0
      : 0;

  const brands = Array.isArray(item.brands)
    ? item.brands.filter(Boolean).join(', ') || null
    : item.brands
    ? String(item.brands)
    : null;

  const plans = Array.isArray(item.plans) ? item.plans : [];
  const rawPlan = plans[0];
  const { planId, planName } = resolveSotkaPlan(
    rawPlan,
    options?.dbPlansMap,
    options?.validPlanIds
  );

  const registeredAt = parseDateToISO(item.registered_at);
  const lastActivity = parseDateToISO(item.last_activity);

  return {
    sotka_id: orgId,
    external_id: orgId,
    organization_id: orgId,
    name,
    seller_name: name,
    phone,
    seller_phone: phone,
    store_name: store,
    store,
    moderation_status: validModStatus,
    moderation: validModStatus,
    is_active: Boolean(item.is_active ?? true),
    outlets_count: Number(item.outlets_count || 0),
    employees_count: Number(item.employees_count || 0),
    balance: Math.round(balanceNum * 100) / 100,
    brands,
    plans,
    plan_id: planId,
    plan_name: planName,
    registered_at: registeredAt,
    last_activity: lastActivity,
    manager_id: options?.preservedManagerId ?? null,
    synced_at: new Date().toISOString(),
  };
}

