import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { linkLeadToSellerAtomic } from '@/lib/services/lead-linking';
import { isLeadInScope, leadActorFrom } from '@/lib/leads/status-rules';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('leads.link_seller');
    const body = await req.json();

    const sellerPhone = body.seller_phone;
    if (!sellerPhone) {
      return apiError('Номер телефона продавца обязателен', 'MISSING_SELLER_PHONE', 400);
    }

    // Атомарная процедура в СУБД с блокировкой FOR UPDATE (область видимости, выбор консультанта
    // и статус подтверждения проверяются в хелпере по правам)
    const result = await linkLeadToSellerAtomic(ctx, {
      leadId: id,
      sellerPhone,
      managerId: body.manager_id,
      via: 'lead',
    });

    if (!result.success) {
      return apiError(result.error || 'Ошибка связывания лида с продавцом', 'LINK_FAILED', 400);
    }

    return apiSuccess({
      success: true,
      lead_id: id,
      seller_phone: sellerPhone,
      connection_id: result.connectionId,
      connection_fee_amount: result.connectionFeeAmount,
      confirmation_status: result.confirmationStatus,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('leads.unlink_seller');
    const admin = createAdminClient();

    const { data: lead } = await admin
      .from('leads')
      .select('lead_id, seller_phone, created_by, assigned_to')
      .eq('lead_id', id)
      .single();

    if (!lead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    if (!isLeadInScope(leadActorFrom(ctx), lead)) {
      return apiError('Лид вне вашей области видимости', 'FORBIDDEN', 403);
    }

    if (!lead.seller_phone) {
      return apiError('Лид не связан с продавцом', 'NOT_LINKED', 400);
    }

    const prevSellerPhone = lead.seller_phone;

    // Обнуляем seller_phone в лиде и возвращаем статус в Обработан
    const { error: updateLeadError } = await admin
      .from('leads')
      .update({
        seller_phone: null,
        linked_at: null,
        status: 'Обработан',
        updated_at: new Date().toISOString(),
      })
      .eq('lead_id', id);

    if (updateLeadError) throw updateLeadError;

    // Отвязываем консультанта у продавца
    await admin
      .from('sellers')
      .update({ manager_id: null })
      .eq('seller_phone', prevSellerPhone);

    return apiSuccess({
      success: true,
      lead_id: id,
      seller_phone: null,
      message: 'Лид успешно отвязан от продавца',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
