/**
 * HTTP-клиент BFF для взаимодействия с API Sotka (https://api.sotka.kg)
 * Реализует стандарты:
 * - Авторизация через пару phone + password с полиморфным извлечением токена
 * - Очистка телефона до 9 цифр
 * - Интерполяция путей /{param}/
 * - Постраничная выгрузка с безопасной распаковкой массивов
 * - Подробное логирование и информативные сообщения об ошибках
 */

import { sanitizePhone, extractArrayData, extractTotalCount } from './normalizers';
import type { FetchParams, SotkaAuthResponse } from './types';

const BASE_URL = (process.env.SOTKA_API_BASE_URL || 'https://api.sotka.kg').replace(/\/+$/, '');

/**
 * Авторизация в Sotka API с полиморфным извлечением JWT Bearer токена
 */
export async function authenticateSotka(): Promise<string> {
  const rawPhone = process.env.SOTKA_API_PHONE || '';
  const password = process.env.SOTKA_API_PASSWORD || '';
  const isoCodeId = Number(process.env.SOTKA_API_ISO_CODE_ID || 1);

  if (!rawPhone || !password) {
    throw new Error(
      'Учетные данные Sotka API (SOTKA_API_PHONE или SOTKA_API_PASSWORD) не заданы в переменных окружения.'
    );
  }

  const phone = sanitizePhone(rawPhone);
  if (!phone || phone.length !== 9) {
    throw new Error(
      `Номер телефона администратора Sotka API (${rawPhone}) не соответствует формату (строго 9 цифр, получено: ${phone}).`
    );
  }

  const url = `${BASE_URL}/api/public/v1/auth/pair`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      iso_code_id: isoCodeId,
      phone,
      password,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errorJson = await response.json();
      if (typeof errorJson.detail === 'string') {
        errorDetail = errorJson.detail;
      } else if (typeof errorJson.detail === 'object') {
        errorDetail = JSON.stringify(errorJson.detail);
      } else {
        errorDetail = JSON.stringify(errorJson);
      }
    } catch {
      errorDetail = await response.text();
    }
    throw new Error(`Ошибка авторизации в Sotka API (${response.status}): ${errorDetail}`);
  }

  const json: SotkaAuthResponse = await response.json();
  const token = json.access || json.access_token || json.token || json.detail?.access;

  if (!token) {
    throw new Error('Sotka API не вернул Bearer токен авторизации в теле ответа.');
  }

  return token;
}

/**
 * Инвалидация сессии администратора
 */
export async function logoutSotka(token: string): Promise<void> {
  if (!token) return;

  try {
    const url = `${BASE_URL}/api/public/v1/auth/logout`;
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
  } catch (err) {
    console.warn('[Sotka Client] Не удалось выполнить logout сессии Sotka API:', err);
  }
}

/**
 * Универсальный исполнитель HTTP-запросов к Sotka API
 */
export async function fetchSotkaApi<T = any>(
  endpoint: string,
  options: FetchParams = {}
): Promise<{ data: T[]; total: number; raw: any; detail?: any }> {
  let resolvedUrl = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  // 1. Интерполяция параметров пути: /{id}/ или /:id
  if (options.pathParams) {
    for (const [paramKey, paramValue] of Object.entries(options.pathParams)) {
      resolvedUrl = resolvedUrl
        .replace(new RegExp(`/{${paramKey}}/`, 'g'), `/${encodeURIComponent(String(paramValue))}/`)
        .replace(new RegExp(`/:${paramKey}(?=/|$)`, 'g'), `/${encodeURIComponent(String(paramValue))}`);
    }
  }

  // 2. Добавление query-параметров пагинации и фильтров
  if (options.params) {
    const urlObj = new URL(resolvedUrl);
    for (const [qKey, qValue] of Object.entries(options.params)) {
      if (qValue !== undefined && qValue !== null && qValue !== '') {
        urlObj.searchParams.set(qKey, String(qValue));
      }
    }
    resolvedUrl = urlObj.toString();
  }

  // 3. Заголовки
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // 4. Выполнение запроса
  const response = await fetch(resolvedUrl, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: options.cache || 'no-store',
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errorJson = await response.json();
      if (typeof errorJson.detail === 'string') {
        errorDetail = errorJson.detail;
      } else if (typeof errorJson.detail === 'object') {
        errorDetail = JSON.stringify(errorJson.detail);
      } else {
        errorDetail = JSON.stringify(errorJson);
      }
    } catch {
      errorDetail = await response.text();
    }
    const err = new Error(`Ошибка запроса к Sotka API [${response.status}] (${resolvedUrl}): ${errorDetail}`);
    (err as any).status = response.status;
    throw err;
  }

  const rawJson = await response.json();
  const data = extractArrayData<T>(rawJson);
  const total = extractTotalCount(rawJson, data.length);

  return {
    data,
    total,
    raw: rawJson,
    detail:
      rawJson && typeof rawJson === 'object' && 'detail' in rawJson
        ? rawJson.detail
        : undefined,
  };
}

/**
 * Выполнение HTTP-запроса к эндпоинтам с одиночным объектом полезной нагрузки
 * (например, детальная карточка продавца GET /api/private/v1/admin/sellers-overview/{id}/)
 * Безопасно распаковывает response.data.detail || response.data
 */
export async function fetchSotkaDetail<T = any>(
  endpoint: string,
  options: FetchParams = {}
): Promise<{ data: T; raw: any }> {
  let resolvedUrl = endpoint.startsWith('http')
    ? endpoint
    : `${BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  if (options.pathParams) {
    for (const [paramKey, paramValue] of Object.entries(options.pathParams)) {
      resolvedUrl = resolvedUrl
        .replace(new RegExp(`/{${paramKey}}/`, 'g'), `/${encodeURIComponent(String(paramValue))}/`)
        .replace(new RegExp(`/:${paramKey}(?=/|$)`, 'g'), `/${encodeURIComponent(String(paramValue))}`);
    }
  }

  if (options.params) {
    const urlObj = new URL(resolvedUrl);
    for (const [qKey, qValue] of Object.entries(options.params)) {
      if (qValue !== undefined && qValue !== null && qValue !== '') {
        urlObj.searchParams.set(qKey, String(qValue));
      }
    }
    resolvedUrl = urlObj.toString();
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(resolvedUrl, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: options.cache || 'no-store',
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errorJson = await response.json();
      if (typeof errorJson.detail === 'string') {
        errorDetail = errorJson.detail;
      } else if (typeof errorJson.detail === 'object') {
        errorDetail = JSON.stringify(errorJson.detail);
      } else {
        errorDetail = JSON.stringify(errorJson);
      }
    } catch {
      errorDetail = await response.text();
    }
    const err = new Error(
      `Ошибка запроса к Sotka API [${response.status}] (${resolvedUrl}): ${errorDetail}`
    );
    (err as any).status = response.status;
    throw err;
  }

  const rawJson = await response.json();
  const data: T =
    rawJson &&
    typeof rawJson === 'object' &&
    'detail' in rawJson &&
    rawJson.detail !== undefined
      ? (rawJson.detail as T)
      : (rawJson as T);

  return { data, raw: rawJson };
}

