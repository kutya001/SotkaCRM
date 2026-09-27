import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase } = await requireAdmin();
    const body = await req.json();

    const allowed = ['amount', 'payment_method', 'comment', 'payout_category', 'payout_date'];
    const updates: Record<string, any> = {};

    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates[key] = body[key];
      }
    }

    const { data: updated, error } = await supabase
      .from('employee_payouts')
      .update(updates as any)
      .eq('payout_id', id)
      .select('*')
      .single();

    if (error || !updated) {
      return apiError('Выплата не найдена или не удалось обновить', 'NOT_FOUND', 404);
    }

    return apiSuccess(updated);
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
    const { supabase } = await requireAdmin();

    // 1. Снятие признака выплаты со всех связанных начислений
    const { error: unfreezeErr } = await supabase
      .from('connection_accruals')
      .update({
        is_paid: false,
        payout_id: null,
        paid_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('payout_id', id);

    if (unfreezeErr) {
      console.error('[DELETE payout] Ошибка разблокировки connection_accruals:', unfreezeErr);
    }

    // 2. Удаление самой выплаты
    const { error: delErr } = await supabase
      .from('employee_payouts')
      .delete()
      .eq('payout_id', id);

    if (delErr) throw delErr;

    return apiSuccess({ success: true, deleted_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
