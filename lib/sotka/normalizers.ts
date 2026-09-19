/**
 * Нормализаторы и утилиты трансформации данных для Sotka API
 */

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
