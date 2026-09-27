import { NextRequest } from 'next/server';
import { requireRoles } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleUnlinkFromSeller(params);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleUnlinkFromSeller(params);
}

async function handleUnlinkFromSeller(paramsPromise: Promise<{ id: string }>) {
  try {
    const { id } = await paramsPromise;
    const { supabase } = await requireRoles(['admin', 'supervisor']);

    // 1. Поиск продавца по seller_id или seller_phone
    let { data: seller } = await supabase
      .from('sellers')
      .select('seller_id, seller_phone, seller_name, manager_id')
      .or(`seller_id.eq.${id},seller_phone.eq.${id}`)
      .maybeSingle();

    if (!seller) {
      // Попробуем поиск чисто по seller_phone
      const fallback = await supabase
        .from('sellers')
        .select('seller_id, seller_phone, seller_name, manager_id')
        .eq('seller_phone', id)
        .maybeSingle();
      seller = fallback.data;
    }

    if (!seller) {
      return apiError('Продавец не найден', 'NOT_FOUND', 404);
    }

    // 2. Поиск привязанного лида
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('lead_id, client_name, seller_phone, status')
      .eq('seller_phone', seller.seller_phone)
      .maybeSingle();

    if (leadErr || !lead) {
      // Если лид не найден по seller_phone, но у продавца есть manager_id, просто сбрасываем manager_id
      await supabase
        .from('sellers')
        .update({ manager_id: null } as any)
        .eq('seller_phone', seller.seller_phone);

      return apiSuccess({
        success: true,
        seller_phone: seller.seller_phone,
        message: 'Куратор продавца сброшен (привязанный лид не был обнаружен)',
      });
    }

    // 3. Вызов RPC unlink_lead_and_seller
    const { data: rpcRes, error: rpcErr } = await (supabase.rpc as any)('unlink_lead_and_seller', {
      p_lead_id: lead.lead_id,
    });

    if (!rpcErr && rpcRes && (rpcRes as any).success) {
      return apiSuccess({
        success: true,
        lead_id: lead.lead_id,
        seller_phone: seller.seller_phone,
        message: 'Лид успешно отвязан от продавца и возвращен в статус "Назначен"',
      });
    }

    // 4. Резервный механизм
    await supabase
      .from('leads')
      .update({
        seller_phone: null,
        linked_at: null,
        status: 'Назначен',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('lead_id', lead.lead_id);

    await supabase
      .from('sellers')
      .update({ manager_id: null } as any)
      .eq('seller_phone', seller.seller_phone);

    return apiSuccess({
      success: true,
      lead_id: lead.lead_id,
      seller_phone: seller.seller_phone,
      new_status: 'Назначен',
      message: 'Лид успешно отвязан от продавца',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
