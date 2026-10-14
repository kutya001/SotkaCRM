import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { authenticateSotkaAdmin, fetchSellerDetail, logoutSotkaSession } from '@/lib/services/sotka-api';
import { normalizeSellerTransactions } from '@/lib/sotka';
import { findSellerByKey } from '@/lib/services/sellers';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('sellers.transactions');
    const { profile } = ctx;

    // 1. Поиск продавца для извлечения organization_id (sotka_id)
    const seller = await findSellerByKey(createAdminClient(), id, [
      'seller_phone',
      'seller_name',
      'store',
      'organization_id',
      'manager_id',
    ] as const);

    if (!seller) {
      return apiError('Продавец не найден', 'NOT_FOUND', 404);
    }

    // Область видимости: без «sellers.view_all» — только транзакции своих продавцов
    if (!ctx.canViewAll('sellers') && seller.manager_id !== profile.user_id) {
      return apiError('Доступ к транзакциям открыт только консультанту данного продавца', 'FORBIDDEN', 403);
    }

    const emptyTransactions = normalizeSellerTransactions(null);

    if (!seller.organization_id) {
      return apiSuccess({
        organization_id: null,
        seller_phone: seller.seller_phone,
        transactions: emptyTransactions,
        message: 'Организация не синхронизирована с Sotka HQ (отсутствует organization_id)',
      });
    }

    // 2. Детальная карточка продавца в Sotka HQ: GET /api/private/v1/admin/sellers-overview/{organization_id}/
    // Право «sellers.transactions» и область видимости уже проверены выше, поэтому запрос идет напрямую,
    // без серверного действия getSellerDetailFromSotka, требующего право «sellers.sync».
    let token = '';
    try {
      token = await authenticateSotkaAdmin();
      const detail = await fetchSellerDetail(token, seller.organization_id);
      const transactions = normalizeSellerTransactions(detail?.transactions);

      // Итоги пополнений/списаний кэшируются в карточке продавца для колонки реестра
      try {
        await createAdminClient()
          .from('sellers')
          .update({
            hq_topups_total: transactions.total_topups,
            hq_charges_total: transactions.total_charges,
            hq_tx_synced_at: new Date().toISOString(),
          } as any)
          .eq('seller_phone', seller.seller_phone);
      } catch (cacheErr: any) {
        console.warn('[Seller Transactions] Не удалось сохранить итоги транзакций:', cacheErr?.message);
      }

      return apiSuccess({
        organization_id: seller.organization_id,
        seller_phone: seller.seller_phone,
        transactions,
      });
    } catch (sotkaErr: any) {
      console.warn('[Seller Transactions] Sotka HQ API недоступен:', sotkaErr?.message);
      return apiSuccess({
        organization_id: seller.organization_id,
        seller_phone: seller.seller_phone,
        transactions: emptyTransactions,
        warning: sotkaErr?.message || 'Не удалось получить данные из Sotka HQ API',
      });
    } finally {
      if (token) await logoutSotkaSession(token);
    }
  } catch (err) {
    return handleApiError(err);
  }
}
