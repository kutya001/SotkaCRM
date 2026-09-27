import { NextRequest } from 'next/server';
import { requireRoles } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { linkSellerToLeadAction } from '@/app/sellers/actions';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sellerPhone = decodeURIComponent(id);
    const { supabase, profile } = await requireRoles(['admin', 'supervisor', 'consultant']);
    const body = await req.json();

    const leadId = body.lead_id;
    if (!leadId) {
      return apiError('Параметр lead_id обязателен', 'MISSING_LEAD_ID', 400);
    }

    // Вызов атомарной процедуры в СУБД с блокировкой FOR UPDATE
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('link_lead_to_seller', {
      p_lead_id: leadId,
      p_seller_phone: sellerPhone,
      p_user_id: profile.user_id,
      p_manager_id: undefined,
      p_assigned_by: profile.user_id,
    });

    if (!rpcErr && rpcRes) {
      const res = rpcRes as {
        success: boolean;
        error?: string;
        connection_id?: string;
        connection_fee_amount?: number;
      };

      if (!res.success) {
        return apiError(res.error || 'Ошибка при связывании продавца с лидом', 'LINK_FAILED', 400);
      }

      return apiSuccess({
        success: true,
        seller_phone: sellerPhone,
        lead_id: leadId,
        connection_id: res.connection_id,
        connection_fee_amount: res.connection_fee_amount,
      });
    }

    // Fallback на серверный экшен при недоступности RPC
    const res = await linkSellerToLeadAction(sellerPhone, leadId);

    if (!res.success) {
      return apiError(res.error || 'Ошибка при связывании продавца с лидом', 'LINK_FAILED', 400);
    }

    return apiSuccess({
      success: true,
      seller_phone: sellerPhone,
      lead_id: leadId,
      connection_fee_amount: res.connectionFeeAmount,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
