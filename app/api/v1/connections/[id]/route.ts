import { NextRequest } from 'next/server';
import { requireAuth, requireRoles, requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { profile, supabase } = await requireAuth();

    if (profile.role === 'smm') {
      return apiError('У роли SMM отсутствует доступ к подключениям', 'FORBIDDEN', 403);
    }

    let query = (supabase as any)
      .from('connections_with_accruals')
      .select('*')
      .eq('connection_id', id);

    if (profile.role === 'consultant') {
      query = query.eq('manager_id', profile.user_id);
    }

    const { data: conn, error } = await query.single();
    if (error || !conn) {
      return apiError('Подключение не найдено', 'NOT_FOUND', 404);
    }

    // Обогащаем данными продавца и менеджера
    let seller = null;
    let manager = null;
    if (conn.seller_phone) {
      const { data: s } = await supabase
        .from('sellers')
        .select('seller_name, store, plan_id, plan_expires_at, is_active')
        .eq('seller_phone', conn.seller_phone)
        .maybeSingle();
      seller = s;
    }
    if (conn.manager_id) {
      const { data: m } = await supabase
        .from('users')
        .select('user_id, full_name, role')
        .eq('user_id', conn.manager_id)
        .maybeSingle();
      manager = m;
    }

    const result = {
      ...conn,
      bonus_connection: Number(conn.bonus_connection_accrued || 0),
      bonus_maintenance: Number(conn.bonus_maintenance_accrued || 0),
      total_bonuses: Number(conn.total_bonuses_accrued || 0),
      total_bonus: Number(conn.total_bonuses_accrued || 0),
      connection_bonus_accrued: Number(conn.bonus_connection_accrued || 0),
      maintenance_bonus_accrued: Number(conn.bonus_maintenance_accrued || 0),
      has_connection_accrual: Number(conn.bonus_connection_accrued || 0) > 0,
      has_maintenance_accrual: Number(conn.bonus_maintenance_accrued || 0) > 0,
      tariff_connection_fee: Number(conn.connection_fee || conn.connection_fee_amount || 0),
      tariff_maintenance_fee_monthly: Number(conn.maintenance_fee_monthly || 0),
      seller,
      manager,
    };

    return apiSuccess(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase } = await requireRoles(['admin', 'supervisor']);
    const body = await req.json();

    const allowed = [
      'status',
      'client_status',
      'manager_id',
      'plan_id',
      'plan_price',
      'connection_fee_percent',
      'connection_fee_amount',
      'connection_fee',
      'maintenance_fee_monthly',
      'maintenance_months_total',
      'maintenance_month_start',
      'accrual_month',
      'maintenance_months_limit',
      'maintenance_months_accrued',
    ];

    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates[key] = body[key];
      }
    }

    const { data: updated, error } = await supabase
      .from('connections')
      .update(updates as any)
      .eq('connection_id', id)
      .select('*')
      .single();

    if (error || !updated) {
      return apiError('Подключение не найдено или не удалось обновить', 'NOT_FOUND', 404);
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

    // 1. Поиск подключения для извлечения seller_phone
    const { data: conn, error: getErr } = await supabase
      .from('connections')
      .select('connection_id, seller_phone')
      .eq('connection_id', id)
      .maybeSingle();

    if (getErr) throw getErr;
    if (!conn) {
      return apiError('Подключение не найдено', 'NOT_FOUND', 404);
    }

    // 2. Сброс назначенного куратора у продавца в NULL
    if (conn.seller_phone) {
      const { error: sellerErr } = await supabase
        .from('sellers')
        .update({ manager_id: null })
        .eq('seller_phone', conn.seller_phone);

      if (sellerErr) {
        console.error('[DELETE connection] Ошибка сброса куратора продавца:', sellerErr);
      }
    }

    // 3. Удаление связанных начислений кураторам из обоих регистров
    await supabase
      .from('connection_accruals')
      .delete()
      .eq('connection_id', id);

    await supabase
      .from('employee_payouts')
      .delete()
      .eq('connection_id', id)
      .eq('operation_sign', '+');

    // 4. Попытка удаления из client_maintenance (если таблица задействована)
    try {
      await supabase
        .from('client_maintenance')
        .delete()
        .eq('connection_id', id);
    } catch {}

    // 5. Удаление самого подключения
    const { error: delErr } = await supabase
      .from('connections')
      .delete()
      .eq('connection_id', id);

    if (delErr) throw delErr;

    return apiSuccess({
      success: true,
      deleted_id: id,
      reset_seller_phone: conn.seller_phone,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
