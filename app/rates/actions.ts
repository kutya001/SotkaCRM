'use server';

import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAnyPermission, requirePermission } from '@/lib/auth/check-role';
import { EmployeeRateSchema } from '@/lib/validations';
import { roundMoney } from '@/lib/utils/money';
import type { UserRole } from '@/types/database.types';

/** Чтение ставок доступно управляющему ставками и модулю сотрудников */
const RATE_READ_PERMISSIONS = ['rates.manage', 'employees.menu'];

export interface EmployeeRateItem {
  rate_id?: string;
  user_id: string;
  full_name: string;
  role: string;
  login: string;
  color?: string;
  connection_percent: number;
  maintenance_percent: number;
  effective_from: string;
  created_at?: string;
}

export interface EmployeeRateHistoryItem {
  rate_id: string;
  user_id: string;
  connection_percent: number;
  maintenance_percent: number;
  effective_from: string;
  created_at: string;
  creator?: {
    full_name: string;
  } | null;
}

/**
 * Кэшированная выборка ставок сотрудников через unstable_cache
 */
const fetchCachedEmployeeRates = unstable_cache(
  async () => {
    const supabase = createAdminClient();

    // 1. Запрашиваем всех активных сотрудников
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('user_id, full_name, role, login, color')
      .eq('is_active', true)
      .order('full_name');

    if (userError || !users) {
      return { rates: [], error: userError?.message };
    }

    // 2. Запрашиваем существующие ставки
    const { data: existingRates } = await supabase
      .from('employee_rates')
      .select('*')
      .order('effective_from', { ascending: false });

    const currentMonth = new Date().toISOString().substring(0, 7);

    // Сводим актуальную ставку для каждого пользователя
    const ratesMap = new Map<string, any>();
    if (existingRates) {
      // Сначала ищем ставки, действующие на текущий месяц
      for (const r of existingRates) {
        if (!ratesMap.has(r.user_id) && r.effective_from <= currentMonth) {
          ratesMap.set(r.user_id, r);
        }
      }
      // Если на текущий месяц нет, берем самую свежую
      for (const r of existingRates) {
        if (!ratesMap.has(r.user_id)) {
          ratesMap.set(r.user_id, r);
        }
      }
    }

    const result: EmployeeRateItem[] = users.map((u) => {
      const r = ratesMap.get(u.user_id);
      return {
        rate_id: r?.rate_id,
        user_id: u.user_id,
        full_name: u.full_name,
        role: u.role,
        login: u.login,
        color: u.color,
        connection_percent: r ? Number(r.connection_percent) : 30.0,
        maintenance_percent: r ? Number(r.maintenance_percent) : 10.0,
        effective_from: r?.effective_from || currentMonth,
        created_at: r?.created_at,
      };
    });

    return { rates: result };
  },
  ['rates-list'],
  { tags: ['rates'], revalidate: 300 }
);

/**
 * Получение персональных ставок сотрудников (rates.manage или employees.menu)
 */
export async function getEmployeeRates(): Promise<{
  rates: EmployeeRateItem[];
  currentUserRole?: UserRole;
  error?: string;
}> {
  let currentUserRole: UserRole;
  try {
    const { profile } = await requireAnyPermission(RATE_READ_PERMISSIONS);
    currentUserRole = profile.role;
  } catch (err: any) {
    return { rates: [], error: err?.message || 'Недостаточно прав' };
  }

  const cached = await fetchCachedEmployeeRates();
  return { rates: cached.rates, currentUserRole, error: cached.error };
}

/**
 * Получение истории процентных ставок по периодам для конкретного сотрудника (rates.manage или employees.menu)
 */
export async function getEmployeeRatesHistory(
  userId: string
): Promise<EmployeeRateHistoryItem[]> {
  try {
    await requireAnyPermission(RATE_READ_PERMISSIONS);
  } catch {
    return [];
  }

  const { data, error } = await createAdminClient()
    .from('employee_rates')
    .select('*, creator:users!employee_rates_created_by_fkey(full_name)')
    .eq('user_id', userId)
    .order('effective_from', { ascending: false });

  if (error || !data) return [];
  return data.map((d: any) => ({
    rate_id: d.rate_id,
    user_id: d.user_id,
    connection_percent: Number(d.connection_percent),
    maintenance_percent: Number(d.maintenance_percent),
    effective_from: d.effective_from,
    created_at: d.created_at,
    creator: d.creator,
  }));
}

/**
 * Удаление конкретного периода ставки сотрудника (rates.manage)
 */
export async function deleteEmployeeRatePeriod(
  rateId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission('rates.manage');
    const { error } = await createAdminClient().from('employee_rates').delete().eq('rate_id', rateId);
    if (error) return { success: false, error: error.message };
    revalidateTag('rates');
    revalidatePath('/rates');
    revalidatePath('/connections');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Установка или обновление персональной ставки на период (rates.manage)
 * Сохраняет историю периодов (UNIQUE по user_id, effective_from)
 */
export async function upsertEmployeeRate(data: {
  user_id: string;
  connection_percent: number;
  maintenance_percent: number;
  effective_from: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { profile } = await requirePermission('rates.manage');

    const parsed = EmployeeRateSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const validData = parsed.data;
    const connectionPercent = roundMoney(validData.connection_percent);
    const maintenancePercent = roundMoney(validData.maintenance_percent);

    const { error } = await createAdminClient().from('employee_rates').upsert(
      {
        user_id: validData.user_id,
        connection_percent: connectionPercent,
        maintenance_percent: maintenancePercent,
        effective_from: validData.effective_from,
        created_by: profile.user_id,
      },
      { onConflict: 'user_id,effective_from' }
    );

    if (error) return { success: false, error: error.message };

    revalidateTag('rates');
    revalidatePath('/rates');
    revalidatePath('/connections');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка обновления ставки' };
  }
}

/**
 * Сброс/удаление персональной ставки сотрудника (rates.manage)
 * После удаления сотрудник рассчитывается по базовым ставкам платформы (30% / 10%)
 */
export async function deleteEmployeeRate(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission('rates.manage');

    if (!userId) {
      return { success: false, error: 'Не указан идентификатор сотрудника' };
    }

    const { error } = await createAdminClient()
      .from('employee_rates')
      .delete()
      .eq('user_id', userId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidateTag('rates');
    revalidatePath('/rates');
    revalidatePath('/connections');
    revalidatePath('/payouts');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка сброса персональной ставки' };
  }
}
