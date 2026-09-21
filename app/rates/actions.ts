'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { EmployeeRateSchema } from '@/lib/validations';
import { roundMoney } from '@/lib/utils/money';
import type { Database, UserRole } from '@/types/database.types';

export interface EmployeeRateItem {
  rate_id?: string;
  user_id: string;
  full_name: string;
  role: string;
  login: string;
  connection_percent: number;
  maintenance_percent: number;
  effective_from: string;
  created_at?: string;
}

/**
 * Получение персональных ставок сотрудников
 */
export async function getEmployeeRates(): Promise<{
  rates: EmployeeRateItem[];
  currentUserRole?: UserRole;
  error?: string;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let currentUserRole: UserRole = 'consultant';
  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .single();
    if (profile) currentUserRole = profile.role as UserRole;
  }

  // 1. Запрашиваем всех активных сотрудников
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('user_id, full_name, role, login')
    .eq('is_active', true)
    .order('full_name');

  if (userError || !users) {
    return { rates: [], currentUserRole, error: userError?.message };
  }

  // 2. Запрашиваем существующие ставки
  const { data: existingRates } = await supabase
    .from('employee_rates')
    .select('*')
    .order('created_at', { ascending: false });

  const currentMonth = new Date().toISOString().substring(0, 7);

  // Сводим список
  const ratesMap = new Map<string, any>();
  if (existingRates) {
    existingRates.forEach((r) => {
      if (!ratesMap.has(r.user_id)) {
        ratesMap.set(r.user_id, r);
      }
    });
  }

  const result: EmployeeRateItem[] = users.map((u) => {
    const r = ratesMap.get(u.user_id);
    return {
      rate_id: r?.rate_id,
      user_id: u.user_id,
      full_name: u.full_name,
      role: u.role,
      login: u.login,
      connection_percent: r ? Number(r.connection_percent) : 30.0,
      maintenance_percent: r ? Number(r.maintenance_percent) : 10.0,
      effective_from: r?.effective_from || currentMonth,
      created_at: r?.created_at,
    };
  });

  return { rates: result, currentUserRole };
}

/**
 * Установка или обновление персональной ставки (строго admin)
 */
export async function upsertEmployeeRate(data: {
  user_id: string;
  connection_percent: number;
  maintenance_percent: number;
  effective_from: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { profile, supabase } = await requireAdmin();

    const parsed = EmployeeRateSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const validData = parsed.data;
    const connectionPercent = roundMoney(validData.connection_percent);
    const maintenancePercent = roundMoney(validData.maintenance_percent);

    // Проверяем, есть ли уже ставка для пользователя
    const { data: existing } = await supabase
      .from('employee_rates')
      .select('rate_id')
      .eq('user_id', validData.user_id)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('employee_rates')
        .update({
          connection_percent: connectionPercent,
          maintenance_percent: maintenancePercent,
          effective_from: validData.effective_from,
          created_by: profile.user_id,
        })
        .eq('rate_id', existing.rate_id);

      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await supabase.from('employee_rates').insert({
        user_id: validData.user_id,
        connection_percent: connectionPercent,
        maintenance_percent: maintenancePercent,
        effective_from: validData.effective_from,
        created_by: profile.user_id,
      });

      if (error) return { success: false, error: error.message };
    }

    revalidatePath('/rates');
    revalidatePath('/connections');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка обновления ставки' };
  }
}

/**
 * Сброс/удаление персональной ставки сотрудника (строго admin)
 * После удаления сотрудник рассчитывается по базовым ставкам платформы (30% / 10%)
 */
export async function deleteEmployeeRate(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireAdmin();

    if (!userId) {
      return { success: false, error: 'Не указан идентификатор сотрудника' };
    }

    const { error } = await supabase
      .from('employee_rates')
      .delete()
      .eq('user_id', userId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/rates');
    revalidatePath('/connections');
    revalidatePath('/payouts');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка сброса персональной ставки' };
  }
}

