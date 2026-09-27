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

    const updates: Record<string, any> = {};
    if (body.amount !== undefined) updates.amount = Number(body.amount);
    if (body.settlement_month !== undefined) updates.settlement_month = body.settlement_month;
    if (body.payout_date !== undefined) updates.payout_date = body.payout_date;
    if (body.actual_date !== undefined) {
      updates.actual_date = body.actual_date;
      if (!updates.payout_date) updates.payout_date = body.actual_date;
    }
    if (body.comment !== undefined) updates.comment = body.comment;
    if (body.note !== undefined) {
      updates.note = body.note;
      if (!updates.comment) updates.comment = body.note;
    }
    if (body.description !== undefined) updates.description = body.description;
    if (body.operation_type !== undefined) updates.operation_type = body.operation_type;
    if (body.payout_category !== undefined) updates.payout_category = body.payout_category;
    if (body.payment_method !== undefined) updates.payment_method = body.payment_method;
    if (body.status !== undefined) updates.status = body.status;

    let targetCol = 'payout_id';
    let { data: updated, error } = await supabase
      .from('employee_payouts')
      .update(updates as any)
      .eq(targetCol, id)
      .select('*')
      .maybeSingle();

    if (error && (error.message?.includes('column') || error.message?.includes('payout_id'))) {
      targetCol = 'id';
      const retry = await supabase
        .from('employee_payouts')
        .update(updates as any)
        .eq(targetCol, id)
        .select('*')
        .maybeSingle();
      updated = retry.data;
      error = retry.error;
    }

    // If still column error, strip non-core columns and try core columns (amount, comment, payout_date)
    if (error && error.message?.includes('column')) {
      const coreUpdates: Record<string, any> = {};
      if (updates.amount !== undefined) coreUpdates.amount = updates.amount;
      if (updates.comment !== undefined) coreUpdates.comment = updates.comment;
      if (updates.payout_date !== undefined) coreUpdates.payout_date = updates.payout_date;
      if (updates.settlement_month !== undefined) coreUpdates.settlement_month = updates.settlement_month;
      if (updates.operation_type !== undefined) coreUpdates.operation_type = updates.operation_type;
      
      const retry2 = await supabase
        .from('employee_payouts')
        .update(coreUpdates as any)
        .eq(targetCol, id)
        .select('*')
        .maybeSingle();
      updated = retry2.data;
      error = retry2.error;
    }

    if (error) {
      throw error;
    }

    if (!updated) {
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
