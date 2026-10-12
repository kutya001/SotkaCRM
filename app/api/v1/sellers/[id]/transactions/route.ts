import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { authenticateSotkaAdmin, fetchSellerDetail, logoutSotkaSession } from '@/lib/services/sotka-api';
import { normalizeSellerTransactions } from '@/lib/sotka';
import { findSellerByKey } from '@/lib/services/sellers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { profile, supabase } = await requireAuth();

    if (profile.role === 'smm') {
      return apiError('У роли SMM отсутствует доступ к транзакциям продавцов', 'FORBIDDEN', 403);
    }

    // 1. Поиск продавца для извлечения organization_id (sotka_id)
    const seller = await findSellerByKey(supabase, id, [
      'seller_phone',
      'seller_name',
      'store',
      'organization_id',
      'manager_id',
    ] as const);

    if (!seller) {
      return apiError('Продавец не найден', 'NOT_FOUND', 404);
    }

    // Ролевая проверка для consultant: только свои продавцы
    if (profile.role === 'consultant' && seller.manager_id !== profile.user_id) {
      return apiError('Доступ к транзакциям открыт только куратору данного продавца', 'FORBIDDEN', 403);
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
    // Права уже проверены выше (admin, supervisor, куратор-консультант), поэтому запрос идет напрямую,
    // без серверного действия getSellerDetailFromSotka, доступного только администратору.
    let token = '';
    try {
      token = await authenticateSotkaAdmin();
      const detail = await fetchSellerDetail(token, seller.organization_id);

      return apiSuccess({
        organization_id: seller.organization_id,
        seller_phone: seller.seller_phone,
        transactions: normalizeSellerTransactions(detail?.transactions),
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
