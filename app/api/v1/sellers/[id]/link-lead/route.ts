import { NextRequest } from 'next/server';
import { requireRoles } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { linkLeadToSellerAtomic } from '@/lib/services/lead-linking';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sellerPhone = decodeURIComponent(id);
    // Руководитель — только просмотр (решение по матрице ролей)
    const ctx = await requireRoles(['admin', 'consultant']);
    const { supabase } = ctx;
    const body = await req.json();

    const leadId = body.lead_id;
    if (!leadId) {
      return apiError('Параметр lead_id обязателен', 'MISSING_LEAD_ID', 400);
    }

    // Проверка продавца: нельзя привязать лид к продавцу с назначенным куратором
    const { data: sellerCheck, error: sellerCheckErr } = await supabase
      .from('sellers')
      .select('seller_phone, manager_id')
      .eq('seller_phone', sellerPhone)
      .maybeSingle();

    if (sellerCheckErr) throw sellerCheckErr;
    if (!sellerCheck) {
      return apiError('Продавец не найден в базе данных Sotka', 'NOT_FOUND', 404);
    }
    if (sellerCheck.manager_id !== null) {
      return apiError(
        'Нельзя привязать лид к продавцу с назначенным куратором',
        'SELLER_HAS_CURATOR',
        400
      );
    }

    // Атомарная процедура в СУБД с блокировкой FOR UPDATE (права проверяются в хелпере)
    const res = await linkLeadToSellerAtomic(ctx, { leadId, sellerPhone });

    if (!res.success) {
      return apiError(res.error || 'Ошибка при связывании продавца с лидом', 'LINK_FAILED', 400);
    }

    return apiSuccess({
      success: true,
      seller_phone: sellerPhone,
      lead_id: leadId,
      connection_id: res.connectionId,
      connection_fee_amount: res.connectionFeeAmount,
      confirmation_status: res.confirmationStatus,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
