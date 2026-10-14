import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { connectionOwnScopeFilter, deleteConnection, isConnectionInScope, loadMaintenanceAssignments, loadParticipants, maintenanceConnectionIdsFor } from '@/lib/services/connections';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('connections.menu');
    const { profile } = ctx;
    const supabase = createAdminClient();

    let query = (supabase as any)
      .from('connections_with_accruals')
      .select('*')
      .eq('connection_id', id);

    if (!ctx.canViewAll('connections')) {
      query = query.or(await connectionOwnScopeFilter(profile.user_id));
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

    let confirmedUser = null;
    if (conn.confirmed_by) {
      const { data: cu } = await supabase
        .from('users')
        .select('user_id, full_name, role, color')
        .eq('user_id', conn.confirmed_by)
        .maybeSingle();
      confirmedUser = cu;
    }

    const [assignmentsMap, participantsMap] = await Promise.all([
      loadMaintenanceAssignments([conn.connection_id]),
      loadParticipants([conn.connection_id]),
    ]);

    const result = {
      ...conn,
      confirmed_user: confirmedUser,
      maintenance_assignments: assignmentsMap.get(conn.connection_id) || [],
      participants: participantsMap.get(conn.connection_id) || [],
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
    const ctx = await requirePermission('connections.edit');
    const supabase = createAdminClient();
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

    // Запись должна быть в области видимости сотрудника
    const { data: current, error: currentErr } = await supabase
      .from('connections')
      .select('connection_id, manager_id')
      .eq('connection_id', id)
      .maybeSingle();

    if (currentErr) throw currentErr;
    if (!current) {
      return apiError('Подключение не найдено или не удалось обновить', 'NOT_FOUND', 404);
    }
    const maintenanceIds = ctx.canViewAll('connections') ? [] : await maintenanceConnectionIdsFor(ctx.profile.user_id);
    if (!isConnectionInScope(ctx, current, maintenanceIds)) {
      return apiError('Подключение вне вашей области видимости', 'FORBIDDEN', 403);
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
    const ctx = await requirePermission('connections.delete');
    const supabase = createAdminClient();

    const { data: conn, error: getErr } = await supabase
      .from('connections')
      .select('connection_id, seller_phone, manager_id')
      .eq('connection_id', id)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!conn) {
      return apiError('Подключение не найдено', 'NOT_FOUND', 404);
    }
    const maintenanceIds = ctx.canViewAll('connections') ? [] : await maintenanceConnectionIdsFor(ctx.profile.user_id);
    if (!isConnectionInScope(ctx, conn, maintenanceIds)) {
      return apiError('Подключение вне вашей области видимости', 'FORBIDDEN', 403);
    }

    const res = await deleteConnection(id);
    if (!res.success) return apiError(res.error, res.code, res.status);

    return apiSuccess({
      success: true,
      deleted_id: id,
      reset_seller_phone: res.sellerPhone,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
