import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { revalidatePath } from 'next/cache';

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireAdmin();

    let targetMonth = new Date().toISOString().slice(0, 7);
    try {
      const text = await req.text();
      if (text && text.trim().length > 0) {
        const body = JSON.parse(text);
        if (body?.settlement_month && typeof body.settlement_month === 'string') {
          targetMonth = body.settlement_month.trim();
        } else if (body?.month && typeof body.month === 'string') {
          targetMonth = body.month.trim();
        } else if (body?.settlementMonth && typeof body.settlementMonth === 'string') {
          targetMonth = body.settlementMonth.trim();
        }
      }
    } catch {
      // При ошибке десериализации или пустом теле используем дефолтный targetMonth
    }

    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      return apiError('Неверный формат месяца. Ожидается YYYY-MM', 'VALIDATION_ERROR', 400);
    }

    // Первичный вызов объединенной RPC процедуры
    let { data, error } = await supabase.rpc('process_unified_connection_accruals', {
      p_settlement_month: targetMonth,
    });

    // Fallback на accrue_all_connections_bonuses если миграция 020 еще не была применена к БД
    if (error && (error.message.includes('does not exist') || error.code === '42883')) {
      const fallback = await supabase.rpc('accrue_all_connections_bonuses', {
        p_settlement_month: targetMonth,
      });
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error('Error executing connection accruals RPC:', error);
      return apiError(error.message, 'ACCRUAL_BATCH_ERROR', 500);
    }

    revalidatePath('/connections');
    revalidatePath('/payouts');
    revalidatePath('/profile');

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}
