/**
 * Сервисный слой взаимодействия с внешним API платформы Sotka (https://api.sotka.kg)
 * Реализован строго по спецификации sotka-api.json
 */

export interface SotkaAuthResponse {
  status?: string;
  access?: string;
  access_token?: string;
  detail?: {
    access?: string;
  };
}

export interface SotkaSellerItem {
  seller_name: string;
  seller_phone: string;
  iso_code?: string;
  stores?: string[];
  outlets_count?: number;
  employees_count?: number;
  plans?: string[];
  brands?: string[];
  balance?: number;
  moderation?: 'approved' | 'pending' | 'rejected' | 'blocked';
  is_active?: boolean;
  registered_at?: string;
  last_activity?: string;
  organization_id?: number | string;
}

export interface SellersOverviewResponse {
  status?: string;
  detail?: {
    total?: number;
    total_balance?: number;
    items?: SotkaSellerItem[];
  };
}

export interface SotkaTransactionItem {
  payment_id: string | number;
  user_phone: string;
  iso_code?: string;
  user_id?: number | string;
  user_name?: string;
  amount?: number;
  date_time?: string;
  tran_type?: string;
  description?: string;
  status?: string;
}

export interface TransactionsResponse {
  status?: string;
  detail?: {
    total?: number;
    items?: SotkaTransactionItem[];
  };
}

const BASE_URL = process.env.SOTKA_API_BASE_URL || 'https://api.sotka.kg';

/**
 * 1. Авторизация администратора CRM и получение Bearer токена доступа
 */
export async function authenticateSotkaAdmin(): Promise<string> {
  const rawPhone = process.env.SOTKA_API_PHONE || '';
  const password = process.env.SOTKA_API_PASSWORD || '';
  const isoCodeId = Number(process.env.SOTKA_API_ISO_CODE_ID || 1);

  if (!rawPhone || !password) {
    throw new Error('Учетные данные SOTKA_API_PHONE или SOTKA_API_PASSWORD не заданы в .env');
  }

  // Очистка телефона: строго 9 цифр без кода страны
  const cleanDigits = rawPhone.replace(/\D/g, '');
  const phone = cleanDigits.startsWith('996') && cleanDigits.length > 9
    ? cleanDigits.substring(3)
    : cleanDigits;

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
    const errorText = await response.text();
    throw new Error(`Ошибка авторизации в Sotka API (${response.status}): ${errorText}`);
  }

  const json: SotkaAuthResponse = await response.json();
  const token = json.access || json.access_token || json.detail?.access;

  if (!token) {
    throw new Error('Sotka API не вернул Bearer токен в теле ответа');
  }

  return token;
}

/**
 * 2. Инвалидация сессии администратора
 */
export async function logoutSotkaSession(token: string): Promise<void> {
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
    console.warn('Не удалось выполнить logout сессии Sotka API:', err);
  }
}

/**
 * 3. Постраничная выгрузка реестра продавцов
 */
export async function fetchSellersOverview(
  token: string,
  offset = 0,
  limit = 100
): Promise<{ items: SotkaSellerItem[]; total: number }> {
  const url = `${BASE_URL}/api/private/v1/admin/sellers-overview/?limit=${limit}&offset=${offset}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ошибка выгрузки продавцов (${response.status}): ${errorText}`);
  }

  const json: SellersOverviewResponse = await response.json();
  const total = json.detail?.total || 0;
  const items = json.detail?.items || [];

  return { items, total };
}

/**
 * 4. Постраничная выгрузка транзакций с поддержкой fallback-маршрута
 */
export async function fetchTransactions(
  token: string,
  offset = 0,
  limit = 100
): Promise<{ items: SotkaTransactionItem[]; total: number }> {
  const primaryUrl = `${BASE_URL}/api/private/v1/admin/transactions/?limit=${limit}&offset=${offset}`;

  let response = await fetch(primaryUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  // Если основной маршрут вернул 404, пробуем fallback-маршрут
  if (response.status === 404) {
    const fallbackUrl = `${BASE_URL}/api/private/v1/subscriptions/billing/transactions/?limit=${limit}&offset=${offset}`;
    response = await fetch(fallbackUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ошибка выгрузки транзакций (${response.status}): ${errorText}`);
  }

  const json: TransactionsResponse = await response.json();
  const total = json.detail?.total || 0;
  const items = json.detail?.items || [];

  return { items, total };
}
