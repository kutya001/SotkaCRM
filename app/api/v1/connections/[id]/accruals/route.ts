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

    // 2. Сначала пробуем получить реальные проводки из employee_payouts
    let postings: any[] = [];
    let hasPayoutsRows = false;

    try {
      const { data: realPostings, error: pErr } = await supabase
        .from('employee_payouts')
        .select(`
          payout_id,
          user_id,
          employee_id,
          connection_id,
          seller_phone,
          operation_type,
          operation_sign,
          settlement_month,
          accrual_month,
          actual_date,
          payout_date,
          amount,
          note,
          comment,
          description,
          status,
          payment_method,
          created_at,
          users:user_id(user_id, full_name, role)
        `)
        .eq('connection_id', id)
        .order('actual_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (!pErr && realPostings && realPostings.length > 0) {
        hasPayoutsRows = true;
        postings = realPostings.map((p: any) => ({
          id: p.payout_id || p.id,
          connection_id: p.connection_id || id,
          seller_phone: p.seller_phone || conn.seller_phone,
          employee_id: p.employee_id || p.user_id,
          operation_type: p.operation_type || 'accrual_connection',
          operation_sign: p.operation_sign || '+',
          settlement_month: p.settlement_month || p.accrual_month || '',
          actual_date: p.actual_date || p.payout_date || p.created_at?.slice(0, 10),
          amount: Number(p.amount) || 0,
          note: p.note || p.comment || p.description || '',
          status: p.status || 'completed',
          payment_method: p.payment_method,
          created_at: p.created_at,
          users: p.users,
          is_paid: true,
        }));
      }
    } catch (err) {
      console.warn('[Accruals] Could not query employee_payouts by connection_id:', err);
    }

    // 3. Если реальных проводок в employee_payouts нет или колонка connection_id отсутствует, берем из connection_accruals
    if (!hasPayoutsRows) {
      const { data: legacyAccruals, error: accErr } = await supabase
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

      postings = (legacyAccruals || []).map((acc: any) => ({
        id: acc.id,
        connection_id: acc.connection_id,
        seller_phone: acc.seller_phone,
        employee_id: acc.employee_id,
        operation_type: acc.accrual_type === 'connection' ? 'accrual_connection' : 'accrual_maintenance',
        operation_sign: '+',
        settlement_month: acc.settlement_month,
        actual_date: acc.paid_at ? acc.paid_at.slice(0, 10) : acc.created_at?.slice(0, 10) || `${acc.settlement_month}-01`,
        amount: Number(acc.amount) || 0,
        note: acc.notes || '',
        status: acc.is_paid ? 'completed' : 'pending',
        is_paid: !!acc.is_paid,
        created_at: acc.created_at,
        users: acc.users,
      }));
    }

    return apiSuccess({
      connection: conn,
      accruals: postings,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
