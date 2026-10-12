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
    const ctx = await requireRoles(['admin', 'supervisor', 'consultant']);
    const body = await req.json();

    const sellerPhone = body.seller_phone;
    if (!sellerPhone) {
      return apiError('Номер телефона продавца обязателен', 'MISSING_SELLER_PHONE', 400);
    }

    // Атомарная процедура в СУБД с блокировкой FOR UPDATE (права проверяются в хелпере)
    const result = await linkLeadToSellerAtomic(ctx, {
      leadId: id,
      sellerPhone,
      managerId: body.manager_id,
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
    const { supabase } = await requireRoles(['admin', 'supervisor']);

    const { data: lead } = await supabase
      .from('leads')
      .select('lead_id, seller_phone')
      .eq('lead_id', id)
      .single();

    if (!lead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    if (!lead.seller_phone) {
      return apiError('Лид не связан с продавцом', 'NOT_LINKED', 400);
    }

    const prevSellerPhone = lead.seller_phone;

    // Обнуляем seller_phone в лиде и возвращаем статус в Обработан
    const { error: updateLeadError } = await supabase
      .from('leads')
      .update({
        seller_phone: null,
        linked_at: null,
        status: 'Обработан',
        updated_at: new Date().toISOString(),
      })
      .eq('lead_id', id);

    if (updateLeadError) throw updateLeadError;

    // Отвязываем куратора у продавца
    await supabase
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
