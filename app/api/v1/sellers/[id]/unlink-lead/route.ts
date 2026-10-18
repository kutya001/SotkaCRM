import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { findSellerByKey } from '@/lib/services/sellers';
import { unlinkLeadFromSeller } from '@/lib/services/lead-linking';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleUnlinkFromSeller(params);
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleUnlinkFromSeller(params);
}

/**
 * Отвязка лида со стороны продавца (046): лид — «Назначен»; ожидающее подключение снимается,
 * подтвержденное остается (консультант продавца не трогается — им управляет подключение).
 */
async function handleUnlinkFromSeller(paramsPromise: Promise<{ id: string }>) {
  try {
    const { id } = await paramsPromise;
    await requirePermission('sellers.unlink_lead');
    const supabase = createAdminClient();

    const seller = await findSellerByKey(supabase, id, ['seller_phone', 'seller_name', 'manager_id'] as const);
    if (!seller) return apiError('Продавец не найден', 'NOT_FOUND', 404);

    const { data: lead } = await supabase
      .from('leads')
      .select('lead_id, client_name, seller_phone, status')
      .eq('seller_phone', seller.seller_phone)
      .maybeSingle();
    if (!lead) return apiError('У продавца нет привязанного лида', 'NOT_LINKED', 400);

    const res = await unlinkLeadFromSeller(lead.lead_id);
    if (!res.success) return apiError(res.error || 'Ошибка отвязки лида', 'UNLINK_FAILED', 400);

    return apiSuccess({
      success: true,
      lead_id: lead.lead_id,
      seller_phone: seller.seller_phone,
      new_status: 'Назначен',
      connection_deleted: res.connectionDeleted,
      message: res.connectionDeleted
        ? 'Лид отвязан, ожидавшее подтверждения подключение снято'
        : 'Лид отвязан от продавца и возвращен в статус «Назначен»',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
