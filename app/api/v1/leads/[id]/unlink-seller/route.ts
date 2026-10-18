import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { isLeadInScope, leadActorFrom } from '@/lib/leads/status-rules';
import { unlinkLeadFromSeller } from '@/lib/services/lead-linking';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleUnlink(params);
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleUnlink(params);
}

/**
 * Отвязка лида от продавца (046): лид — «Назначен», ответственный сохраняется;
 * ожидающее подключение снимается, подтвержденное остается (unlinkLeadFromSeller).
 */
async function handleUnlink(paramsPromise: Promise<{ id: string }>) {
  try {
    const { id } = await paramsPromise;
    const ctx = await requirePermission('leads.unlink_seller');

    // Область видимости проверяется до любой записи (RPC доступна только service_role)
    const { data: lead, error: leadErr } = await createAdminClient()
      .from('leads')
      .select('lead_id, seller_phone, status, created_by, assigned_to')
      .eq('lead_id', id)
      .maybeSingle();
    if (leadErr || !lead) return apiError('Лид не найден', 'NOT_FOUND', 404);
    if (!isLeadInScope(leadActorFrom(ctx), lead)) return apiError('Лид вне вашей области видимости', 'FORBIDDEN', 403);
    if (!lead.seller_phone) return apiError('Лид не привязан к продавцу', 'NOT_LINKED', 400);

    const res = await unlinkLeadFromSeller(id);
    if (!res.success) return apiError(res.error || 'Ошибка отвязки лида', 'UNLINK_FAILED', 400);

    return apiSuccess({
      success: true,
      lead_id: id,
      seller_phone: res.sellerPhone,
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
