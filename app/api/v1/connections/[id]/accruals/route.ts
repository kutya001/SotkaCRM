import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { profile, supabase } = await requireAuth();

    // 1. Проверяем существование подключения
    const { data: conn, error: connErr } = await supabase
      .from('connections')
      .select('connection_id, manager_id, seller_phone, seller_name, store')
      .eq('connection_id', id)
      .single();

    if (connErr || !conn) {
      return apiError('Подключение не найдено', 'NOT_FOUND', 404);
    }

    // RBAC: smm не имеет доступа; consultant только к своим
    if (profile.role === 'smm') {
      return apiError('У роли SMM отсутствует доступ к начислениям', 'FORBIDDEN', 403);
    }

    if (profile.role === 'consultant' && conn.manager_id !== profile.user_id) {
      return apiError('Доступ разрешен только куратору данного подключения', 'FORBIDDEN', 403);
    }

    // 2. Выбираем все начисления по этому подключению
    const { data: accruals, error: accErr } = await supabase
      .from('connection_accruals')
      .select(`
        id,
        connection_id,
        seller_phone,
        employee_id,
        accrual_type,
        settlement_month,
        amount,
        is_paid,
        payout_id,
        paid_at,
        notes,
        created_at,
        users:employee_id(user_id, full_name, role)
      `)
      .eq('connection_id', id)
      .order('settlement_month', { ascending: true })
      .order('accrual_type', { ascending: true });

    if (accErr) {
      throw accErr;
    }

    return apiSuccess({
      connection: conn,
      accruals: accruals || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
