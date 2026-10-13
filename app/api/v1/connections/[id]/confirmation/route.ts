import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { setConnectionConfirmation } from '@/lib/services/connections';

/**
 * Подтверждение / отклонение подключения администратором.
 * body: { action: 'confirm' | 'reject', reason?: string } — причина обязательна при reject.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { profile } = await requireAdmin();
    const body = await req.json().catch(() => ({}));

    const action = body?.action;
    if (action !== 'confirm' && action !== 'reject') {
      return apiError('Укажите действие: confirm или reject', 'INVALID_ACTION', 400);
    }

    const res = await setConnectionConfirmation({
      connectionId: id,
      action,
      reason: typeof body?.reason === 'string' ? body.reason : null,
      actor: profile,
    });

    if (!res.success) {
      return apiError(res.error, res.code, res.status);
    }

    return apiSuccess({
      success: true,
      connection_id: res.connectionId,
      confirmation_status: res.confirmationStatus,
      seller_phone: res.sellerPhone,
      message: action === 'confirm' ? 'Подключение подтверждено, бонус начислен куратору' : 'Подключение отклонено',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
