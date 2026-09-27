import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getSellerDetailFromSotka } from '@/app/sellers/actions';

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
    let { data: seller, error: sellerErr } = await supabase
      .from('sellers')
      .select('seller_id, seller_phone, seller_name, store, organization_id, manager_id')
      .or(`seller_id.eq.${id},seller_phone.eq.${id}`)
      .maybeSingle();

    if (!seller) {
      const fallback = await supabase
        .from('sellers')
        .select('seller_id, seller_phone, seller_name, store, organization_id, manager_id')
        .eq('seller_phone', id)
        .maybeSingle();
      seller = fallback.data;
    }

    if (sellerErr || !seller) {
      return apiError('Продавец не найден', 'NOT_FOUND', 404);
    }

    // Ролевая проверка для consultant: только свои продавцы
    if (profile.role === 'consultant' && seller.manager_id !== profile.user_id) {
      return apiError('Доступ к транзакциям открыт только куратору данного продавца', 'FORBIDDEN', 403);
    }

    if (!seller.organization_id) {
      return apiSuccess({
        organization_id: null,
        seller_phone: seller.seller_phone,
        transactions: {
          items: [],
          total: 0,
          total_topups: 0,
          total_charges: 0,
          total_amount: 0,
        },
        message: 'Организация не синхронизирована с Sotka HQ (отсутствует organization_id)',
      });
    }

    // 2. Получение детальной карточки продавца через Sotka HQ API
    const res = await getSellerDetailFromSotka(seller.organization_id);

    if (!res.success || !res.detail) {
      return apiSuccess({
        organization_id: seller.organization_id,
        seller_phone: seller.seller_phone,
        transactions: {
          items: [],
          total: 0,
          total_topups: 0,
          total_charges: 0,
          total_amount: 0,
        },
        warning: res.error || 'Не удалось получить данные из Sotka HQ API',
      });
    }

    const tx = res.detail.transactions || {
      items: [],
      total: 0,
      total_topups: 0,
      total_charges: 0,
      total_amount: 0,
    };

    return apiSuccess({
      organization_id: seller.organization_id,
      seller_phone: seller.seller_phone,
      transactions: tx,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
