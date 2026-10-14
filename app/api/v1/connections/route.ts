import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { connectionOwnScopeFilter, loadMaintenanceAssignments, loadParticipants } from '@/lib/services/connections';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('connections.menu');
    const { profile } = ctx;
    // Права роли могут превышать базовую RLS-роль: сервисный клиент + явный фильтр области видимости
    const supabase = createAdminClient();
    const viewAll = ctx.canViewAll('connections');

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = searchParams.get('search');
    const accrualMonth = searchParams.get('accrualMonth');
    const clientStatus = searchParams.get('clientStatus');
    const confirmation = searchParams.get('confirmation');
    const managerId = searchParams.get('managerId');
    const sortBy = searchParams.get('sortBy') || 'assigned_at';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

    let query = (supabase as any).from('connections_with_accruals').select('*', { count: 'exact' });
    // Число подключений, ожидающих подтверждения (в той же ролевой видимости)
    let pendingQuery = (supabase as any)
      .from('connections')
      .select('connection_id', { count: 'exact', head: true })
      .eq('confirmation_status', 'pending');

    // Область видимости: без «connections.view_all» — свои подключения (подключил) и те, где я сопровождаю (042)
    if (!viewAll) {
      const scopeFilter = await connectionOwnScopeFilter(profile.user_id);
      query = query.or(scopeFilter);
      pendingQuery = pendingQuery.or(scopeFilter);
    } else if (managerId && managerId !== 'all') {
      query = query.eq('manager_id', managerId);
    }

    if (accrualMonth && accrualMonth !== 'all') {
      query = query.eq('accrual_month', accrualMonth);
    }

    if (clientStatus && clientStatus !== 'all') {
      query = query.eq('client_status', clientStatus as any);
    }

    if (confirmation && confirmation !== 'all' && ['pending', 'confirmed', 'rejected'].includes(confirmation)) {
      query = query.eq('confirmation_status', confirmation);
    }

    if (search && search.trim()) {
      const q = search.trim();
      query = query.or(
        `seller_phone.ilike.%${q}%,seller_name.ilike.%${q}%,store.ilike.%${q}%`
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false }).range(from, to);

    const [{ data: connections, count, error }, { count: pendingCount }] = await Promise.all([query, pendingQuery]);
    if (error) throw error;

    // Обогащаем данными менеджеров, назначивших и подтвердивших
    const managerIds: string[] = Array.from(
      new Set(
        (connections || [])
          .flatMap((c: any) => [c.manager_id, c.assigned_by, c.confirmed_by])
          .filter(Boolean)
      )
    );

    let managersMap = new Map();
    if (managerIds.length > 0) {
      const { data: managers } = await supabase
        .from('users')
        .select('user_id, full_name, role, login, color')
        .in('user_id', managerIds);

      if (managers) {
        managers.forEach((m) => managersMap.set(m.user_id, m));
      }
    }

    // Обогащаем данными оплат
    const connectionIds: string[] = (connections || []).map((c: any) => c.connection_id).filter(Boolean);
    const accrualsMap = new Map<string, { totalPaid: number }>();
    if (connectionIds.length > 0) {
      const { data: payouts } = await supabase
        .from('employee_payouts')
        .select('connection_id, amount, status')
        .in('connection_id', connectionIds)
        .eq('operation_sign', '+');

      if (payouts) {
        payouts.forEach((p: any) => {
          const cur = accrualsMap.get(p.connection_id) || { totalPaid: 0 };
          const amt = Number(p.amount) || 0;
          if (p.status === 'paid') {
            cur.totalPaid += amt;
          }
          accrualsMap.set(p.connection_id, cur);
        });
      }
    }

    // Сопровождение по месяцам (042) и список сотрудников для назначения (право «connections.edit»)
    const [assignmentsMap, participantsMap] = await Promise.all([
      loadMaintenanceAssignments(connectionIds),
      loadParticipants(connectionIds),
    ]);
    let employees: { user_id: string; full_name: string; login: string; role: string; color: string | null }[] = [];
    if (ctx.can('connections.edit')) {
      const { data: users } = await supabase
        .from('users')
        .select('user_id, full_name, login, role, color')
        .eq('is_active', true)
        .in('role', ['consultant', 'admin', 'supervisor'])
        .order('full_name');
      employees = (users || []).map((u) => ({ ...u, color: u.color ?? null }));
    }

    const enriched = (connections || []).map((c: any) => {
      const acc = accrualsMap.get(c.connection_id) || { totalPaid: 0 };
      const bonusConnection = Number(c.bonus_connection_accrued || 0);
      const bonusMaintenance = Number(c.bonus_maintenance_accrued || 0);
      const totalBonus = Number(c.total_bonuses_accrued || 0);
      const totalPaid = acc.totalPaid || 0;
      const balanceRemaining = Math.max(0, totalBonus - totalPaid);

      return {
        ...c,
        bonus_connection: bonusConnection,
        bonus_maintenance: bonusMaintenance,
        total_bonuses: totalBonus,
        total_bonus: totalBonus,
        connection_bonus_accrued: bonusConnection,
        maintenance_bonus_accrued: bonusMaintenance,
        has_connection_accrual: bonusConnection > 0,
        has_maintenance_accrual: bonusMaintenance > 0,
        total_paid: totalPaid,
        balance_remaining: balanceRemaining,
        tariff_connection_fee: Number(c.connection_fee || c.connection_fee_amount || 0),
        tariff_maintenance_fee_monthly: Number(c.maintenance_fee_monthly || 0),
        manager_user: c.manager_id ? managersMap.get(c.manager_id) || null : null,
        assigned_user: c.assigned_by ? managersMap.get(c.assigned_by) || null : null,
        confirmed_user: c.confirmed_by ? managersMap.get(c.confirmed_by) || null : null,
        maintenance_assignments: assignmentsMap.get(c.connection_id) || [],
        participants: participantsMap.get(c.connection_id) || [],
      };
    });

    return apiSuccess({
      items: enriched,
      total: count || 0,
      pending_count: pendingCount || 0,
      employees,
      page,
      pageSize,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile } = await requirePermission('connections.create');
    const supabase = createAdminClient();
    const body = await req.json();

    const sellerPhone = (body.seller_phone || '').replace(/\D/g, '');
    if (!sellerPhone) {
      return apiError('Номер телефона продавца обязателен', 'MISSING_PHONE', 400);
    }

    const nowIso = new Date().toISOString();
    const currentMonth = body.accrual_month || nowIso.substring(0, 7);
    const planPrice = Number(body.plan_price) || 2500;
    const feePercent = Number(body.connection_fee_percent) || 30;
    const feeAmount = Math.round(((planPrice * feePercent) / 100) * 100) / 100;

    const insertPayload = {
      seller_phone: sellerPhone,
      seller_name: (body.seller_name || 'Без имени').trim(),
      store: (body.store || 'Без названия').trim(),
      manager_id: body.manager_id || profile.user_id,
      assigned_by: profile.user_id,
      assigned_at: nowIso,
      status: body.status || 'подключен',
      plan_id: body.plan_id || null,
      plan_price: planPrice,
      connection_fee_percent: feePercent,
      connection_fee_amount: feeAmount,
      accrual_month: currentMonth,
      client_status: body.client_status || 'новый',
      maintenance_months_limit: Number(body.maintenance_months_limit) || 3,
      maintenance_months_accrued: 0,
      // Создано вручную сотрудником с правом «connections.create» — подтверждения не требует
      confirmation_status: 'confirmed' as const,
      confirmed_by: profile.user_id,
      confirmed_at: nowIso,
    };

    const { data: newConn, error } = await supabase
      .from('connections')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) throw error;

    // Консультант получает уведомление о подключении и автоматическом начислении
    scheduleTelegramDispatch();
    return apiSuccess(newConn, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
