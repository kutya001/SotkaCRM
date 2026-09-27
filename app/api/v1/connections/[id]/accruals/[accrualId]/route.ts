import { NextRequest } from 'next/server';
import { requireRoles, requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { revalidatePath } from 'next/cache';
import type { Database } from '@/types/database.types';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accrualId: string }> }
) {
  try {
    const { id, accrualId } = await params;
    const { supabase } = await requireRoles(['admin', 'supervisor']);
    const body = await req.json();

    const updates: Database['public']['Tables']['connection_accruals']['Update'] = {};

    if (body.amount !== undefined) updates.amount = body.amount;
    if (body.settlement_month !== undefined) updates.settlement_month = body.settlement_month;
    if (body.is_paid !== undefined) updates.is_paid = body.is_paid;
    if (body.notes !== undefined) updates.notes = body.notes;

    if (body.is_paid !== undefined) {
      if (body.is_paid === true) {
        updates.paid_at = new Date().toISOString();
      } else {
        updates.paid_at = null;
        updates.payout_id = null;
      }
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('connection_accruals')
      .update(updates)
      .eq('id', accrualId)
      .eq('connection_id', id)
      .select('*')
      .single();

    if (error || !updated) {
      return apiError('Начисление не найдено или не удалось обновить', 'NOT_FOUND', 404);
    }

    revalidatePath('/connections');
    revalidatePath('/payouts');
    revalidatePath('/profile');

    return apiSuccess(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accrualId: string }> }
) {
  try {
    const { id, accrualId } = await params;
    const { supabase } = await requireAdmin();

    // Запрещено удалять уже оплаченные начисления
    const { data: existing } = await supabase
      .from('connection_accruals')
      .select('is_paid')
      .eq('id', accrualId)
      .eq('connection_id', id)
      .single();

    if (existing?.is_paid) {
      return apiError('Нельзя удалить уже оплаченное начисление', 'CONFLICT', 409);
    }

    const { error } = await supabase
      .from('connection_accruals')
      .delete()
      .eq('id', accrualId)
      .eq('connection_id', id);

    if (error) throw error;

    revalidatePath('/connections');
    revalidatePath('/payouts');
    revalidatePath('/profile');

    return apiSuccess({ success: true, deleted_id: accrualId });
  } catch (err) {
    return handleApiError(err);
  }
}
