/**
 * Сервисный слой взаимодействия с внешним API платформы Sotka (https://api.sotka.kg)
 * Построен поверх отказоустойчивого ядра lib/sotka
 */

import {
  authenticateSotka,
  logoutSotka,
  fetchSotkaApi,
  type SotkaSellerItem,
  type SotkaTransactionItem,
  type SotkaAuthResponse,
} from '@/lib/sotka';

export type { SotkaAuthResponse, SotkaSellerItem, SotkaTransactionItem };

export interface SellersOverviewResponse {
  status?: string;
  detail?: {
    total?: number;
    total_balance?: number;
    items?: SotkaSellerItem[];
  };
}

export interface TransactionsResponse {
  status?: string;
  detail?: {
    total?: number;
    items?: SotkaTransactionItem[];
  };
}

/**
 * 1. Авторизация администратора CRM и получение Bearer токена доступа
 */
export async function authenticateSotkaAdmin(): Promise<string> {
  return authenticateSotka();
}

/**
 * 2. Инвалидация сессии администратора
 */
export async function logoutSotkaSession(token: string): Promise<void> {
  return logoutSotka(token);
}

/**
 * 3. Постраничная выгрузка реестра продавцов
 */
export async function fetchSellersOverview(
  token: string,
  offset = 0,
  limit = 100
): Promise<{ items: SotkaSellerItem[]; total: number }> {
  const res = await fetchSotkaApi<SotkaSellerItem>(
    '/api/private/v1/admin/sellers-overview/',
    {
      token,
      params: { limit, offset },
    }
  );
  return { items: res.data, total: res.total };
}

/**
 * 4. Постраничная выгрузка транзакций с поддержкой fallback-маршрута
 */
export async function fetchTransactions(
  token: string,
  offset = 0,
  limit = 100
): Promise<{ items: SotkaTransactionItem[]; total: number }> {
  try {
    const res = await fetchSotkaApi<SotkaTransactionItem>(
      '/api/private/v1/admin/transactions/',
      {
        token,
        params: { limit, offset },
      }
    );
    return { items: res.data, total: res.total };
  } catch (err: any) {
    if (err.status === 404) {
      const fallbackRes = await fetchSotkaApi<SotkaTransactionItem>(
        '/api/private/v1/subscriptions/billing/transactions/',
        {
          token,
          params: { limit, offset },
        }
      );
      return { items: fallbackRes.data, total: fallbackRes.total };
    }
    throw err;
  }
}
