import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';

/** Смена статуса операции: payouts.status */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requirePermission('payouts.status');
    const body = await req.json();

    const status = body.status;
    const transactionRef = body.transaction_ref;

    if (!status) {
      return apiError('Статус обязателен для заполнения', 'MISSING_STATUS', 400);
    }

    const { data: updated, error } = await createAdminClient()
      .from('employee_payouts')
      .update({
        comment: transactionRef ? `[Транзакция: ${transactionRef}]` : undefined,
        payout_date: new Date().toISOString().substring(0, 10),
      })
      .eq('payout_id', id)
      .select('*')
      .single();

    if (error || !updated) {
      return apiError('Выплата не найдена', 'NOT_FOUND', 404);
    }

    return apiSuccess({ id, status, updated });
  } catch (err) {
    return handleApiError(err);
  }
}
