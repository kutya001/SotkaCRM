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
    await requireRoles(['admin', 'supervisor', 'consultant']);
    const body = await req.json();

    const leadId = body.lead_id;
    if (!leadId) {
      return apiError('Параметр lead_id обязателен', 'MISSING_LEAD_ID', 400);
    }

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
