import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { revalidatePath } from 'next/cache';

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireAdmin();

    let month: string | undefined;
    try {
      const body = await req.json();
      month = body.month || body.settlement_month || body.settlementMonth;
    } catch {
      // тело может отсутствовать
    }

    const currentMonth = new Date().toISOString().substring(0, 7);
    const effMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth;

    const { data, error } = await supabase.rpc('accrue_all_connections_bonuses', {
      p_settlement_month: effMonth,
    });

    if (error) {
      console.error('Error executing accrue_all_connections_bonuses:', error);
      return apiError(error.message, 'ACCRUAL_BATCH_ERROR', 400);
    }

    revalidatePath('/connections');
    revalidatePath('/payouts');
    revalidatePath('/profile');

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}
