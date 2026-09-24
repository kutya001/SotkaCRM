/**
 * Сервисный слой взаимодействия с внешним API платформы Sotka (https://api.sotka.kg)
 * Построен поверх отказоустойчивого ядра lib/sotka
 */

import {
  authenticateSotka,
  logoutSotka,
  fetchSotkaApi,
  fetchSotkaDetail,
  type SotkaSellerOverviewItem,
  type SotkaSellerItem,
  type SotkaSellersOverviewResponse,
  type SotkaSellerDetail,
  type SotkaSellerDetailResponse,
  type SotkaTransactionItem,
  type SotkaAuthResponse,
  type NormalizedSotkaSeller,
} from '@/lib/sotka';

export type {
  SotkaAuthResponse,
  SotkaSellerOverviewItem,
  SotkaSellerItem,
  SotkaSellersOverviewResponse,
  SotkaSellerDetail,
  SotkaSellerDetailResponse,
  SotkaTransactionItem,
  NormalizedSotkaSeller,
};

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
 * Строгий URL: GET /api/private/v1/admin/sellers-overview/
 * Параметры пагинации: offset (default 0), limit (default 50, max 200)
 */
export async function fetchSellersOverview(
  token: string,
  offset = 0,
  limit = 50,
  moderationStatus?: string
): Promise<{
  items: SotkaSellerOverviewItem[];
  total: number;
  rawDetail?: SotkaSellersOverviewResponse['detail'];
}> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const params: Record<string, string | number> = {
    offset,
    limit: safeLimit,
  };
  if (moderationStatus && moderationStatus !== 'all') {
    params.moderation_status = moderationStatus;
  }

  const res = await fetchSotkaApi<SotkaSellerOverviewItem>(
    '/api/private/v1/admin/sellers-overview/',
    {
      token,
      params,
    }
  );

  return {
    items: res.data,
    total: res.total,
    rawDetail: res.detail,
  };
}

/**
 * 4. Загрузка детальной карточки продавца
 * Строгий URL: GET /api/private/v1/admin/sellers-overview/${organizationId}/
 */
export async function fetchSellerDetail(
  token: string,
  organizationId: number | string
): Promise<SotkaSellerDetail> {
  const cleanId = encodeURIComponent(String(organizationId));
  const res = await fetchSotkaDetail<SotkaSellerDetail>(
    `/api/private/v1/admin/sellers-overview/${cleanId}/`,
    { token }
  );
  return res.data;
}

/**
 * 5. Постраничная выгрузка транзакций с поддержкой fallback-маршрута
 */
export async function fetchTransactions(
  token: string,
  offset = 0,
  limit = 50
): Promise<{ items: SotkaTransactionItem[]; total: number }> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  try {
    const res = await fetchSotkaApi<SotkaTransactionItem>(
      '/api/private/v1/admin/transactions/',
      {
        token,
        params: { limit: safeLimit, offset },
      }
    );
    return { items: res.data, total: res.total };
  } catch (err: any) {
    if (err.status === 404) {
      const fallbackRes = await fetchSotkaApi<SotkaTransactionItem>(
        '/api/private/v1/subscriptions/billing/transactions/',
        {
          token,
          params: { limit: safeLimit, offset },
        }
      );
      return { items: fallbackRes.data, total: fallbackRes.total };
    }
    throw err;
  }
}
