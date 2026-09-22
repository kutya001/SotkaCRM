'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin, requireAuth } from '@/lib/auth/check-role';
import type { Database, UserRole, SellerModerationStatus } from '@/types/database.types';

export interface LinkedLeadInfo {
  lead_id: string;
  client_name: string;
  status: string;
  created_at: string;
}

export interface SellerItem {
  seller_phone: string;
  seller_name: string;
  store: string;
  balance: number;
  plan_name: string;
  plan_id: string | null;
  moderation: SellerModerationStatus;
  is_active: boolean;
  outlets_count: number;
  employees_count: number;
  brands: string | null;
  organization_id: string | null;
  registered_at: string | null;
  last_activity: string | null;
  manager_id: string | null;
  synced_at: string;
  manager_user?: {
    user_id: string;
    full_name: string;
    role: string;
    login: string;
    color?: string;
  } | null;
  linked_lead?: LinkedLeadInfo | null;
}

export interface GetSellersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  moderation?: string;
  isActive?: string; // 'all' | 'true' | 'false'
  managerId?: string; // 'all' | 'unassigned' | string
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface SellersResponse {
  sellers: SellerItem[];
  totalCount: number;
  currentUserRole?: UserRole;
  currentUserId?: string;
  error?: string;
}

export interface SellersStats {
  total: number;
  active: number;
  pendingModeration: number;
  totalBalance: number;
  assigned: number;
}

/**
 * Получение списка продавцов с пагинацией, фильтрацией, связанным лидом и изоляцией
 */
export async function getSellers(params: GetSellersParams = {}): Promise<SellersResponse> {
  let authCtx;
  try {
    authCtx = await requireAuth();
  } catch (err: any) {
    return { sellers: [], totalCount: 0, error: err?.message || 'Пользователь не аутентифицирован' };
  }
  const { profile, supabase } = authCtx;

  // Роли SMM доступ к базе продавцов строго запрещен
  if (profile.role === 'smm') {
    return {
      sellers: [],
      totalCount: 0,
      currentUserRole: 'smm',
      currentUserId: profile.user_id,
      error: 'Доступ к реестру продавцов запрещен для роли SMM',
    };
  }

  const {
    page = 1,
    pageSize = 50,
    search,
    moderation,
    isActive,
    managerId,
    sortBy = 'synced_at',
    sortOrder = 'desc',
  } = params;

  let query = supabase.from('sellers').select(
    `
      seller_phone,
      seller_name,
      store,
      balance,
      plan_name,
      plan_id,
      moderation,
      is_active,
      outlets_count,
      employees_count,
      brands,
      organization_id,
      registered_at,
      last_activity,
      manager_id,
      synced_at
    `,
    { count: 'exact' }
  );

  // СТРОГАЯ ИЗОЛЯЦИЯ: Консультант видит только не назначенных продавцов либо назначенных на него
  if (profile.role === 'consultant') {
    if (managerId === 'unassigned') {
      query = query.is('manager_id', null);
    } else if (managerId === profile.user_id || managerId === 'my') {
      query = query.eq('manager_id', profile.user_id);
    } else {
      query = query.or(`manager_id.is.null,manager_id.eq.${profile.user_id}`);
    }
  } else if (managerId && managerId !== 'all') {
    // Для администратора доступен произвольный фильтр по куратору
    if (managerId === 'unassigned') {
      query = query.is('manager_id', null);
    } else {
      query = query.eq('manager_id', managerId);
    }
  }

  // Поиск по телефону, имени продавца или названию магазина
  if (search && search.trim()) {
    const cleanSearch = search.trim();
    query = query.or(
      `seller_phone.ilike.%${cleanSearch}%,seller_name.ilike.%${cleanSearch}%,store.ilike.%${cleanSearch}%`
    );
  }

  // Фильтр по модерации
  if (moderation && moderation !== 'all') {
    query = query.eq('moderation', moderation as SellerModerationStatus);
  }

  // Фильтр по активности
  if (isActive && isActive !== 'all') {
    query = query.eq('is_active', isActive === 'true');
  }

  // Сортировка
  const ascending = sortOrder === 'asc';
  const validSortColumns = ['balance', 'registered_at', 'synced_at', 'store', 'seller_name', 'outlets_count'];
  const orderColumn = validSortColumns.includes(sortBy) ? sortBy : 'synced_at';
  query = query.order(orderColumn, { ascending, nullsFirst: false });

  // Пагинация
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data: sellersData, count, error } = await query;

  if (error) {
    console.error('Ошибка при получении продавцов:', error);
    return {
      sellers: [],
      totalCount: 0,
      currentUserRole: profile.role as UserRole,
      currentUserId: profile.user_id,
      error: error.message,
    };
  }

  // Параллельное обогащение данными менеджеров и связанных лидов
  const managerIds = Array.from(
    new Set((sellersData || []).map((s) => s.manager_id).filter((id): id is string => Boolean(id)))
  );
  const sellerPhones = (sellersData || []).map((s) => s.seller_phone);

  const [managersResult, leadsResult] = await Promise.all([
    managerIds.length > 0
      ? supabase
          .from('users')
          .select('user_id, full_name, role, login, color')
          .in('user_id', managerIds)
      : Promise.resolve({ data: null }),
    sellerPhones.length > 0
      ? supabase
          .from('leads')
          .select('lead_id, client_name, status, created_at, seller_phone')
          .in('seller_phone', sellerPhones)
      : Promise.resolve({ data: null }),
  ]);

  const managersMap = new Map<string, { user_id: string; full_name: string; role: string; login: string; color?: string }>();
  if (managersResult.data) {
    managersResult.data.forEach((m) => managersMap.set(m.user_id, m));
  }

  const leadsMap = new Map<string, LinkedLeadInfo>();
  if (leadsResult.data) {
    leadsResult.data.forEach((l) => {
      if (l.seller_phone) {
        leadsMap.set(l.seller_phone, {
          lead_id: l.lead_id,
          client_name: l.client_name,
          status: l.status,
          created_at: l.created_at,
        });
      }
    });
  }

  const enrichedSellers: SellerItem[] = (sellersData || []).map((seller) => ({
    ...seller,
    manager_user: seller.manager_id ? managersMap.get(seller.manager_id) || null : null,
    linked_lead: leadsMap.get(seller.seller_phone) || null,
  }));

  return {
    sellers: enrichedSellers,
    totalCount: count || 0,
    currentUserRole: profile.role as UserRole,
    currentUserId: profile.user_id,
  };
}

/**
 * Получение агрегированной статистики по базе продавцов с учетом роли
 */
export async function getSellersStats(): Promise<SellersStats> {
  const authCtx = await requireAuth().catch(() => null);
  if (!authCtx) {
    return {
      total: 0,
      active: 0,
      pendingModeration: 0,
      totalBalance: 0,
      assigned: 0,
    };
  }
  const { supabase } = authCtx;

  // Вызов SQL-агрегата get_sellers_kpi_stats (с изолированным расчетом)
  try {
    const { data: rpcStats, error: rpcError } = await supabase.rpc('get_sellers_kpi_stats');
    if (!rpcError && rpcStats) {
      const stats = rpcStats as Record<string, any>;
      return {
        total: Number(stats.total) || 0,
        active: Number(stats.active) || 0,
        pendingModeration: Number(stats.pendingModeration) || 0,
        totalBalance: Number(stats.totalBalance) || 0,
        assigned: Number(stats.assigned) || 0,
      };
    }
  } catch (rpcErr) {
    console.warn('RPC get_sellers_kpi_stats недоступен, fallback на агрегацию:', rpcErr);
  }

  const { data, error } = await supabase
    .from('sellers')
    .select('is_active, moderation, balance, manager_id');

  if (error || !data) {
    return {
      total: 0,
      active: 0,
      pendingModeration: 0,
      totalBalance: 0,
      assigned: 0,
    };
  }

  let active = 0;
  let pendingModeration = 0;
  let totalBalance = 0;
  let assigned = 0;

  for (const s of data) {
    if (s.is_active) active++;
    if (s.moderation === 'pending') pendingModeration++;
    if (s.balance) totalBalance += Number(s.balance);
    if (s.manager_id) assigned++;
  }

  return {
    total: data.length,
    active,
    pendingModeration,
    totalBalance,
    assigned,
  };
}

/**
 * Получение списка сотрудников для назначения куратором
 */
export async function getManagersList(): Promise<
  { user_id: string; full_name: string; role: string; login: string; color?: string }[]
> {
  const authCtx = await requireAuth().catch(() => null);
  if (!authCtx) return [];
  const { supabase } = authCtx;

  const { data, error } = await supabase
    .from('users')
    .select('user_id, full_name, role, login, color')
    .eq('is_active', true)
    .in('role', ['admin', 'consultant'])
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Ошибка при получении списка кураторов:', error);
    return [];
  }

  return (data as any) || [];
}

/**
 * Назначение/изменение куратора продавца с автоматической фиксацией связи в connections
 * и расчетом вознаграждения для зарплат и выплат (только для роли admin)
 * Поддерживает сброс обратно на null ("Не назначен")
 */
export async function assignSellerManager(
  sellerPhone: string,
  managerId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, profile } = await requireAdmin();

    if (!sellerPhone) {
      return { success: false, error: 'Не указан номер телефона продавца' };
    }

    // 1. Обновляем куратора в таблице sellers
    const { data: updatedSeller, error: updateSellerError } = await supabase
      .from('sellers')
      .update({ manager_id: managerId })
      .eq('seller_phone', sellerPhone)
      .select('seller_phone, seller_name, store, plan_id')
      .single();

    if (updateSellerError || !updatedSeller) {
      return { success: false, error: updateSellerError?.message || 'Продавец не найден' };
    }

    // Если куратор сброшен (null)
    if (!managerId) {
      await supabase
        .from('connections')
        .delete()
        .eq('seller_phone', sellerPhone);

      revalidatePath('/sellers');
      revalidatePath('/connections');
      revalidatePath('/payouts');
      revalidatePath('/analytics');
      revalidatePath('/');
      return { success: true };
    }

    // 2. Если куратор назначен, определяем тариф и ставку на дату
    let planPrice = 2500;
    const today = new Date().toISOString().substring(0, 10);
    if (updatedSeller.plan_id) {
      const { data: priceData } = await supabase.rpc('get_plan_price_on_date', {
        p_plan_id: updatedSeller.plan_id,
        p_date: today,
      });
      if (priceData && Number(priceData) > 0) {
        planPrice = Number(priceData);
      } else {
        const { data: planData } = await supabase
          .from('plans')
          .select('price')
          .eq('plan_id', updatedSeller.plan_id)
          .maybeSingle();
        if (planData) planPrice = Number(planData.price);
      }
    }

    // Получаем ставку консультанта на текущий месяц из RPC get_employee_rate_on_month
    const currentMonth = new Date().toISOString().substring(0, 7);
    let connectionPercent = 30;
    const { data: rpcRate } = await supabase.rpc('get_employee_rate_on_month', {
      p_user_id: managerId,
      p_month: currentMonth,
    });

    if (rpcRate && typeof rpcRate === 'object' && 'connection_percent' in (rpcRate as any)) {
      connectionPercent = Number((rpcRate as any).connection_percent) || 30;
    }

    const connectionFeeAmount = Math.round(((planPrice * connectionPercent) / 100) * 100) / 100;
    const nowIso = new Date().toISOString();

    // Проверяем, существует ли уже запись в connections для данного продавца
    const { data: existingConnection } = await supabase
      .from('connections')
      .select('connection_id')
      .eq('seller_phone', sellerPhone)
      .maybeSingle();

    if (existingConnection) {
      await supabase
        .from('connections')
        .update({
          manager_id: managerId,
          connection_fee_percent: connectionPercent,
          connection_fee_amount: connectionFeeAmount,
          plan_price: planPrice,
        })
        .eq('connection_id', existingConnection.connection_id);
    } else {
      await supabase.from('connections').insert({
        seller_phone: sellerPhone,
        seller_name: updatedSeller.seller_name,
        store: updatedSeller.store || 'Без названия',
        manager_id: managerId,
        assigned_by: profile.user_id,
        assigned_at: nowIso,
        status: 'подключен',
        plan_id: updatedSeller.plan_id,
        plan_price: planPrice,
        connection_fee_percent: connectionPercent,
        connection_fee_amount: connectionFeeAmount,
        accrual_month: currentMonth,
        client_status: 'новый',
        maintenance_months_limit: 3,
      });
    }

    revalidatePath('/sellers');
    revalidatePath('/connections');
    revalidatePath('/payouts');
    revalidatePath('/analytics');
    revalidatePath('/');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка назначения куратора' };
  }
}

/**
 * Получение свободных лидов для привязки к продавцу
 * Приоритезирует статус 'Подписан'
 */
export async function getAvailableLeadsForSellerLinking(
  onlySigned: boolean = false
): Promise<{
  leads: {
    lead_id: string;
    client_name: string;
    phone: string;
    status: string;
    assigned_to: string | null;
    assigned_user?: {
      user_id: string;
      full_name: string;
      color?: string;
    } | null;
    created_at: string;
  }[];
  error?: string;
}> {
  try {
    const { supabase } = await requireAdmin();

    let query = supabase
      .from('leads')
      .select(`
        lead_id,
        client_name,
        phone,
        status,
        assigned_to,
        created_at,
        assigned_user:users!leads_assigned_to_fkey(user_id, full_name, color)
      `)
      .is('seller_phone', null)
      .neq('status', 'Отмена');

    if (onlySigned) {
      query = query.eq('status', 'Подписан');
    }

    query = query.order('created_at', { ascending: false }).limit(100);

    const { data, error } = await query;

    if (error) {
      return { leads: [], error: error.message };
    }

    const sortedLeads = ((data as any) || []).sort((a: any, b: any) => {
      if (a.status === 'Подписан' && b.status !== 'Подписан') return -1;
      if (a.status !== 'Подписан' && b.status === 'Подписан') return 1;
      return 0;
    });

    return { leads: sortedLeads };
  } catch (err: any) {
    return { leads: [], error: err.message || 'Ошибка загрузки доступных лидов' };
  }
}

/**
 * Ручное связывание продавца с лидом администратором с автоматическим
 * назначением куратора из лида и мгновенным расчетом выплат в connections
 */
export async function linkSellerToLeadAction(
  sellerPhone: string,
  leadId: string
): Promise<{ success: boolean; error?: string; connectionFeeAmount?: number }> {
  try {
    const { supabase, profile } = await requireAdmin();

    if (!sellerPhone || !leadId) {
      return { success: false, error: 'Не указан продавец или лид' };
    }

    const { data: rpcRes, error: rpcErr } = await supabase.rpc('link_lead_to_seller', {
      p_lead_id: leadId,
      p_seller_phone: sellerPhone,
      p_manager_id: undefined,
      p_assigned_by: profile.user_id,
    });

    if (rpcErr) {
      return { success: false, error: rpcErr.message };
    }

    const result = rpcRes as {
      success: boolean;
      error?: string;
      connection_fee_amount?: number;
    };

    if (!result.success) {
      return { success: false, error: result.error || 'Ошибка при связывании продавца с лидом' };
    }

    revalidatePath('/sellers');
    revalidatePath('/leads');
    revalidatePath('/connections');
    revalidatePath('/payouts');
    revalidatePath('/analytics');
    revalidatePath('/');

    return {
      success: true,
      connectionFeeAmount: result.connection_fee_amount,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Сбой при связывании продавца с лидом' };
  }
}

