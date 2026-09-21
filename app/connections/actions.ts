'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { Database, UserRole, ClientLifecycleStatus } from '@/types/database.types';

export interface ConnectionItem {
  connection_id: string;
  seller_phone: string;
  seller_name: string;
  store: string;
  manager_id: string;
  assigned_by: string;
  assigned_at: string;
  status: string;
  plan_id: string | null;
  plan_price: number;
  connection_fee_percent: number;
  connection_fee_amount: number;
  accrual_month: string;
  maintenance_months_limit: number;
  maintenance_months_accrued: number;
  client_status: ClientLifecycleStatus;
  manager_user?: {
    user_id: string;
    full_name: string;
    role: string;
    login: string;
    color?: string;
  } | null;
  assigned_user?: {
    user_id: string;
    full_name: string;
    role: string;
    login: string;
    color?: string;
  } | null;
}

export interface GetConnectionsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  accrualMonth?: string;
  clientStatus?: string;
  managerId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ConnectionsResponse {
  connections: ConnectionItem[];
  totalCount: number;
  currentUserRole?: UserRole;
  currentUserId?: string;
  error?: string;
}

export interface ConnectionsStats {
  total: number;
  newThisMonth: number;
  inMaintenance: number;
  totalBonusAmount: number;
}

/**
 * Получение списка закреплений клиентов с учетом ролевой модели (RBAC)
 * admin: видит все закрепления
 * consultant: видит только свои (manager_id = current_user_id)
 * smm: доступ закрыт
 */
export async function getConnections(
  params: GetConnectionsParams = {}
): Promise<ConnectionsResponse> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { connections: [], totalCount: 0, error: 'Пользователь не аутентифицирован' };
  }

  const { data: profile } = await supabase
    .from('users')
    .select('user_id, role, full_name')
    .eq('auth_id', user.id)
    .single();

  if (!profile) {
    return { connections: [], totalCount: 0, error: 'Профиль пользователя не найден' };
  }

  // Роли SMM доступ к модулю подключений закрыт
  if (profile.role === 'smm') {
    return {
      connections: [],
      totalCount: 0,
      currentUserRole: 'smm',
      error: 'Доступ к реестру подключений запрещен для роли SMM',
    };
  }

  const {
    page = 1,
    pageSize = 1000,
    search,
    accrualMonth,
    clientStatus,
    managerId,
    sortBy = 'assigned_at',
    sortOrder = 'desc',
  } = params;

  let query = supabase.from('connections').select('*', { count: 'exact' });

  // Ограничение видимости для консультанта (строго свои)
  if (profile.role === 'consultant') {
    query = query.eq('manager_id', profile.user_id);
  } else if (profile.role === 'admin' && managerId && managerId !== 'all') {
    query = query.eq('manager_id', managerId);
  }

  // Фильтр по расчетному месяцу
  if (accrualMonth && accrualMonth !== 'all') {
    query = query.eq('accrual_month', accrualMonth);
  }

  // Фильтр по статусу жизненного цикла
  if (clientStatus && clientStatus !== 'all') {
    query = query.eq('client_status', clientStatus as ClientLifecycleStatus);
  }

  // Текстовый поиск
  if (search && search.trim()) {
    const q = search.trim();
    query = query.or(
      `seller_phone.ilike.%${q}%,seller_name.ilike.%${q}%,store.ilike.%${q}%`
    );
  }

  // Сортировка
  const ascending = sortOrder === 'asc';
  const validSortColumns = [
    'assigned_at',
    'connection_fee_amount',
    'plan_price',
    'seller_name',
    'store',
    'accrual_month',
  ];
  const orderColumn = validSortColumns.includes(sortBy) ? sortBy : 'assigned_at';
  query = query.order(orderColumn, { ascending, nullsFirst: false });

  // Пагинация
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data: rawConnections, count, error } = await query;

  if (error) {
    console.error('Ошибка при запросе подключений:', error);
    return {
      connections: [],
      totalCount: 0,
      currentUserRole: profile.role as UserRole,
      currentUserId: profile.user_id,
      error: error.message,
    };
  }

  // Обогащение именами сотрудников
  const userIds = Array.from(
    new Set(
      (rawConnections || [])
        .flatMap((c) => [c.manager_id, c.assigned_by])
        .filter((id): id is string => Boolean(id))
    )
  );

  const usersMap = new Map<string, { user_id: string; full_name: string; role: string; login: string; color?: string }>();

  if (userIds.length > 0) {
    const { data: usersData } = await supabase
      .from('users')
      .select('user_id, full_name, role, login, color')
      .in('user_id', userIds);

    if (usersData) {
      usersData.forEach((u) => usersMap.set(u.user_id, u));
    }
  }

  const enriched: ConnectionItem[] = (rawConnections || []).map((conn) => ({
    ...conn,
    plan_price: Number(conn.plan_price) || 0,
    connection_fee_percent: Number(conn.connection_fee_percent) || 0,
    connection_fee_amount: Number(conn.connection_fee_amount) || 0,
    manager_user: usersMap.get(conn.manager_id) || null,
    assigned_user: usersMap.get(conn.assigned_by) || null,
  }));

  return {
    connections: enriched,
    totalCount: count || 0,
    currentUserRole: profile.role as UserRole,
    currentUserId: profile.user_id,
  };
}

/**
 * Получение KPI-метрик по закреплениям
 */
export async function getConnectionsStats(accrualMonth?: string): Promise<ConnectionsStats> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { total: 0, newThisMonth: 0, inMaintenance: 0, totalBonusAmount: 0 };
  }

  const { data: profile } = await supabase
    .from('users')
    .select('user_id, role')
    .eq('auth_id', user.id)
    .single();

  if (!profile || profile.role === 'smm') {
    return { total: 0, newThisMonth: 0, inMaintenance: 0, totalBonusAmount: 0 };
  }

  let query = supabase.from('connections').select('client_status, connection_fee_amount, accrual_month, manager_id');

  if (profile.role === 'consultant') {
    query = query.eq('manager_id', profile.user_id);
  }

  if (accrualMonth && accrualMonth !== 'all') {
    query = query.eq('accrual_month', accrualMonth);
  }

  const { data, error } = await query;

  if (error || !data) {
    return { total: 0, newThisMonth: 0, inMaintenance: 0, totalBonusAmount: 0 };
  }

  let newThisMonth = 0;
  let inMaintenance = 0;
  let totalBonusAmount = 0;

  const currentMonth = new Date().toISOString().substring(0, 7);

  for (const c of data) {
    if (c.client_status === 'новый' || c.accrual_month === currentMonth) {
      newThisMonth++;
    }
    if (c.client_status === 'сопровождение' || c.client_status === 'подключен') {
      inMaintenance++;
    }
    totalBonusAmount += Number(c.connection_fee_amount) || 0;
  }

  return {
    total: data.length,
    newThisMonth,
    inMaintenance,
    totalBonusAmount: Math.round(totalBonusAmount * 100) / 100,
  };
}

/**
 * Изменение статуса сопровождения клиента (строго для роли admin)
 */
export async function updateConnectionClientStatus(
  connectionId: string,
  newStatus: ClientLifecycleStatus
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Пользователь не аутентифицирован' };
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('auth_id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Изменение статуса жизненного цикла доступно только администратору' };
  }

  const { error } = await supabase
    .from('connections')
    .update({ client_status: newStatus })
    .eq('connection_id', connectionId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/connections');
  return { success: true };
}

/**
 * Получение списка расчетных месяцев
 */
export async function getAccrualMonthsList(): Promise<string[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('connections')
    .select('accrual_month')
    .order('accrual_month', { ascending: false });

  const currentMonth = new Date().toISOString().substring(0, 7);
  const months = new Set<string>([currentMonth]);

  if (data) {
    data.forEach((row) => {
      if (row.accrual_month) months.add(row.accrual_month);
    });
  }

  return Array.from(months).sort().reverse();
}

/**
 * Получение активных тарифов для выбора в подключении
 */
export async function getActivePlansList(): Promise<
  { plan_id: string; plan_name: string; price: number }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('plans')
    .select('plan_id, plan_name, price')
    .eq('is_active', true)
    .order('price', { ascending: true });

  return (data || []).map((d) => ({
    plan_id: d.plan_id,
    plan_name: d.plan_name,
    price: Number(d.price),
  }));
}

/**
 * Изменение тарифа и стоимости на подключении (строго admin)
 * Не изменяет самого продавца в sellers, пересчитывает connection_fee_amount
 */
export async function updateConnectionTariffAndPrice(
  connectionId: string,
  params: {
    plan_id: string | null;
    plan_price: number;
  }
): Promise<{ success: boolean; error?: string; recalculatedBonus?: number }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не аутентифицирован' };
    }

    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return {
        success: false,
        error: 'Редактирование тарифа подключения разрешено только администратору',
      };
    }

    const { data: conn, error: connErr } = await supabase
      .from('connections')
      .select('*')
      .eq('connection_id', connectionId)
      .single();

    if (connErr || !conn) {
      return { success: false, error: 'Подключение не найдено' };
    }

    const roundedPrice = Math.round(Number(params.plan_price) * 100) / 100;
    const feePercent = Number(conn.connection_fee_percent) || 0;
    const recalculatedBonus = Math.round(((roundedPrice * feePercent) / 100) * 100) / 100;

    const { error: updateError } = await supabase
      .from('connections')
      .update({
        plan_id: params.plan_id || null,
        plan_price: roundedPrice,
        connection_fee_amount: recalculatedBonus,
      })
      .eq('connection_id', connectionId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Обновляем начисление в сопровождении, если есть запись за расчетный месяц
    if (conn.accrual_month) {
      await supabase
        .from('client_maintenance')
        .update({
          plan_price: roundedPrice,
          maintenance_amount: Math.round(((roundedPrice * feePercent) / 100) * 100) / 100,
        })
        .eq('connection_id', connectionId)
        .eq('accrual_month', conn.accrual_month);
    }

    revalidatePath('/connections');
    revalidatePath('/payouts');
    return { success: true, recalculatedBonus };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка обновления тарифа' };
  }
}
