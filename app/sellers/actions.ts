'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/check-role';
import type { Database, UserRole, SellerModerationStatus } from '@/types/database.types';

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
  } | null;
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
 * Получение списка продавцов с пагинацией, фильтрацией и обогащением куратором
 */
export async function getSellers(params: GetSellersParams = {}): Promise<SellersResponse> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { sellers: [], totalCount: 0, error: 'Пользователь не аутентифицирован' };
  }

  // Получаем профиль текущего пользователя и проверяем роль (RBAC)
  const { data: profile } = await supabase
    .from('users')
    .select('user_id, role, full_name')
    .eq('auth_id', user.id)
    .single();

  if (!profile) {
    return { sellers: [], totalCount: 0, error: 'Профиль пользователя не найден' };
  }

  // Роли SMM доступ к базе продавцов строго запрещен
  if (profile.role === 'smm') {
    return {
      sellers: [],
      totalCount: 0,
      currentUserRole: 'smm',
      error: 'Доступ к реестру продавцов запрещен для роли SMM',
    };
  }

  const {
    page = 1,
    pageSize = 1000,
    search,
    moderation,
    isActive,
    managerId,
    sortBy = 'synced_at',
    sortOrder = 'desc',
  } = params;

  let query = supabase.from('sellers').select('*', { count: 'exact' });

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
  if (isActive === 'true') {
    query = query.eq('is_active', true);
  } else if (isActive === 'false') {
    query = query.eq('is_active', false);
  }

  // Фильтр по куратору
  if (managerId && managerId !== 'all') {
    if (managerId === 'unassigned') {
      query = query.is('manager_id', null);
    } else {
      query = query.eq('manager_id', managerId);
    }
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

  // Обогащение данными менеджеров
  const managerIds = Array.from(
    new Set((sellersData || []).map((s) => s.manager_id).filter((id): id is string => Boolean(id)))
  );

  const managersMap = new Map<string, { user_id: string; full_name: string; role: string; login: string }>();

  if (managerIds.length > 0) {
    const { data: managers } = await supabase
      .from('users')
      .select('user_id, full_name, role, login')
      .in('user_id', managerIds);

    if (managers) {
      managers.forEach((m) => managersMap.set(m.user_id, m));
    }
  }

  const enrichedSellers: SellerItem[] = (sellersData || []).map((seller) => ({
    ...seller,
    manager_user: seller.manager_id ? managersMap.get(seller.manager_id) || null : null,
  }));

  return {
    sellers: enrichedSellers,
    totalCount: count || 0,
    currentUserRole: profile.role as UserRole,
    currentUserId: profile.user_id,
  };
}

/**
 * Получение агрегированной статистики по базе продавцов
 */
export async function getSellersStats(): Promise<SellersStats> {
  const supabase = await createClient();

  // Попытка вызвать предвычисленный SQL-агрегат get_sellers_kpi_stats (миграция 003)
  try {
    const { data: rpcStats, error: rpcError } = await supabase.rpc('get_sellers_kpi_stats');
    if (!rpcError && rpcStats) {
      return {
        total: Number(rpcStats.total) || 0,
        active: Number(rpcStats.active) || 0,
        pendingModeration: Number(rpcStats.pendingModeration) || 0,
        totalBalance: Number(rpcStats.totalBalance) || 0,
        assigned: Number(rpcStats.assigned) || 0,
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
  { user_id: string; full_name: string; role: string; login: string }[]
> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('users')
    .select('user_id, full_name, role, login')
    .eq('is_active', true)
    .in('role', ['admin', 'consultant'])
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Ошибка при получении списка кураторов:', error);
    return [];
  }

  return data || [];
}

/**
 * Назначение/изменение куратора продавца (только для роли admin)
 */
export async function assignSellerManager(
  sellerPhone: string,
  managerId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireAdmin();

    if (!sellerPhone) {
      return { success: false, error: 'Не указан номер телефона продавца' };
    }

    const { error } = await supabase
      .from('sellers')
      .update({ manager_id: managerId })
      .eq('seller_phone', sellerPhone);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/sellers');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка назначения куратора' };
  }
}
