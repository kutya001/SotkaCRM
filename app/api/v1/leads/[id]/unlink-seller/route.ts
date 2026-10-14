import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { isLeadInScope, leadActorFrom } from '@/lib/leads/status-rules';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleUnlink(params);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleUnlink(params);
}

async function handleUnlink(paramsPromise: Promise<{ id: string }>) {
  try {
    const { id } = await paramsPromise;
    const ctx = await requirePermission('leads.unlink_seller');
    const admin = createAdminClient();

    // Область видимости проверяется до любой записи (RPC доступна только service_role)
    const { data: lead, error: leadErr } = await admin
      .from('leads')
      .select('lead_id, seller_phone, status, created_by, assigned_to')
      .eq('lead_id', id)
      .maybeSingle();

    if (leadErr || !lead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    if (!isLeadInScope(leadActorFrom(ctx), lead)) {
      return apiError('Лид вне вашей области видимости', 'FORBIDDEN', 403);
    }

    // 1. Попытка вызова атомарной процедуры в СУБД
    const { data: rpcData, error: rpcErr } = await (admin.rpc as any)('unlink_lead_and_seller', {
      p_lead_id: id,
    });

    if (!rpcErr && rpcData && (rpcData as any).success) {
      return apiSuccess({
        success: true,
        lead_id: id,
        message: 'Лид успешно отвязан от продавца и возвращен в статус "Назначен"',
        ...(rpcData as any),
      });
    }

    // 2. Резервный механизм (TypeScript fallback при отсутствии RPC в базе)
    if (!lead.seller_phone) {
      return apiError('Лид не привязан к продавцу', 'NOT_LINKED', 400);
    }

    const prevSellerPhone = lead.seller_phone;

    // Сбрасываем привязку в лиде и переводим в статус "Назначен"
    const { error: updLeadErr } = await admin
      .from('leads')
      .update({
        seller_phone: null,
        linked_at: null,
        status: 'Назначен',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('lead_id', id);

    if (updLeadErr) throw updLeadErr;

    // Сбрасываем назначенного консультанта у продавца
    await admin
      .from('sellers')
      .update({ manager_id: null } as any)
      .eq('seller_phone', prevSellerPhone);

    return apiSuccess({
      success: true,
      lead_id: id,
      seller_phone: prevSellerPhone,
      new_status: 'Назначен',
      message: 'Лид успешно отвязан от продавца и возвращен в статус "Назначен"',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
