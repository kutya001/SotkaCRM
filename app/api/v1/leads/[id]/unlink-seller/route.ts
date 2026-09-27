import { NextRequest } from 'next/server';
import { requireRoles } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

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
    const { supabase } = await requireRoles(['admin', 'supervisor']);

    // 1. Попытка вызова атомарной процедуры в СУБД
    const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)('unlink_lead_and_seller', {
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
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('lead_id, seller_phone, status')
      .eq('lead_id', id)
      .maybeSingle();

    if (leadErr || !lead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    if (!lead.seller_phone) {
      return apiError('Лид не привязан к продавцу', 'NOT_LINKED', 400);
    }

    const prevSellerPhone = lead.seller_phone;

    // Сбрасываем привязку в лиде и переводим в статус "Назначен"
    const { error: updLeadErr } = await supabase
      .from('leads')
      .update({
        seller_phone: null,
        linked_at: null,
        status: 'Назначен',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('lead_id', id);

    if (updLeadErr) throw updLeadErr;

    // Сбрасываем назначенного куратора у продавца
    await supabase
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
