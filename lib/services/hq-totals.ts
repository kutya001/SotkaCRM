import { createAdminClient } from '@/lib/supabase/admin';
import { fetchSellerDetail } from '@/lib/services/sotka-api';
import { normalizeSellerTransactions, sellerSubscriptionColumns } from '@/lib/sotka';

const CONCURRENCY = 5;

/**
 * Колонки подписки организации (миграция 047) есть в базе. Пока миграция не применена,
 * итоги транзакций обновляются без подписки, а не падают на неизвестной колонке.
 */
export async function hasSubscriptionColumns(): Promise<boolean> {
  const { error } = await createAdminClient().from('sellers').select('subscription_state').limit(1);
  if (error) console.warn('[hq-totals] Колонки подписки (миграция 047) недоступны:', error.message);
  return !error;
}

export interface RefreshHqTotalsOptions {
  /** Bearer-токен администратора Sotka HQ (уже полученный вызывающим кодом) */
  token: string;
  /** Ограничить набор продавцов (например, только видимые сотруднику) — PostgREST-фильтр .or() */
  scopeFilter?: string | null;
  /** Только эти номера продавцов (например, свежесинхронизированные) */
  phones?: string[];
  /** Обновлять записи старше N часов (null — только без итогов) */
  staleHours?: number | null;
  /** Максимум продавцов за один запуск */
  limit?: number;
  /** Бюджет времени, мс */
  timeBudgetMs?: number;
  startedAt?: number;
}

export interface RefreshHqTotalsResult {
  refreshed: number;
  queued: number;
  remaining: number;
}

/**
 * Итоги транзакций Sotka HQ (пополнения / списания по успешным операциям) и подписка организации
 * (047) из детальной карточки организации: кэшируются в sellers.hq_* / subscription_state для реестра.
 * Сначала обновляются продавцы без итогов или без проверенной подписки, затем самые давно
 * не обновлявшиеся — в пределах лимита и бюджета времени.
 */
export async function refreshSellersHqTotals(options: RefreshHqTotalsOptions): Promise<RefreshHqTotalsResult> {
  const {
    token,
    scopeFilter,
    phones,
    staleHours = 24,
    limit = 60,
    timeBudgetMs = 20_000,
    startedAt = Date.now(),
  } = options;
  const admin = createAdminClient();
  // До применения миграции 047 колонок подписки нет: итоги транзакций обновляются без них
  const withSubscription = await hasSubscriptionColumns();

  let query = admin
    .from('sellers')
    .select(withSubscription ? 'seller_phone, organization_id, hq_tx_synced_at, hq_subscription_synced_at' : 'seller_phone, organization_id, hq_tx_synced_at')
    .not('organization_id', 'is', null)
    .eq('is_deleted_from_source', false);
  if (scopeFilter) query = query.or(scopeFilter);
  if (phones && phones.length > 0) query = query.in('seller_phone', phones);
  // Подписка еще не проверялась — обновляется вне очереди, даже при свежих итогах транзакций
  const subscriptionPending = withSubscription ? ',hq_subscription_synced_at.is.null' : '';
  if (staleHours === null) {
    query = query.or(`hq_tx_synced_at.is.null${subscriptionPending}`);
  } else {
    const threshold = new Date(Date.now() - staleHours * 3_600_000).toISOString();
    query = query.or(`hq_tx_synced_at.is.null,hq_tx_synced_at.lt.${threshold}${subscriptionPending}`);
  }
  if (withSubscription) query = query.order('hq_subscription_synced_at', { ascending: true, nullsFirst: true });
  const { data, error } = await query.order('hq_tx_synced_at', { ascending: true, nullsFirst: true });
  if (error) throw error;
  const rows = (data || []) as unknown as { seller_phone: string; organization_id: string | null }[];

  const all = rows.filter((r) => r.organization_id);
  const queue = all.slice(0, limit);
  let refreshed = 0;
  let processed = 0;

  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > timeBudgetMs) break;
    await Promise.all(
      queue.slice(i, i + CONCURRENCY).map(async (row) => {
        processed++;
        try {
          const detail = await fetchSellerDetail(token, row.organization_id as string);
          const totals = normalizeSellerTransactions(detail?.transactions);
          const { error: updErr } = await admin
            .from('sellers')
            .update({
              hq_topups_total: totals.total_topups,
              hq_charges_total: totals.total_charges,
              hq_tx_synced_at: new Date().toISOString(),
              ...(withSubscription ? sellerSubscriptionColumns(detail) : {}),
            })
            .eq('seller_phone', row.seller_phone);
          if (!updErr) refreshed++;
        } catch (err: any) {
          console.warn(`[hq-totals] Итоги транзакций организации ${row.organization_id} недоступны:`, err?.message);
        }
      })
    );
  }

  return { refreshed, queued: queue.length, remaining: Math.max(0, all.length - processed) };
}
