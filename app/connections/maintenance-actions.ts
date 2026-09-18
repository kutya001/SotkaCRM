'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { Database, MaintenanceStatus, ClientLifecycleStatus } from '@/types/database.types';

export interface MaintenanceAccrualResult {
  success: boolean;
  count: number;
  totalAmount: number;
  skippedCount: number;
  targetMonth: string;
  error?: string;
  details?: {
    seller_name: string;
    seller_phone: string;
    manager_name: string;
    amount: number;
    percent: number;
  }[];
}

/**
 * Ежемесячный биллинг сопровождения клиентов (строго роль admin)
 * Начисляет бонусы консультантам за удержание активных продавцов
 */
export async function generateMonthlyMaintenanceAccruals(
  targetMonth?: string
): Promise<MaintenanceAccrualResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      count: 0,
      totalAmount: 0,
      skippedCount: 0,
      targetMonth: '',
      error: 'Пользователь не аутентифицирован',
    };
  }

  const { data: adminProfile } = await supabase
    .from('users')
    .select('user_id, role')
    .eq('auth_id', user.id)
    .single();

  if (!adminProfile || adminProfile.role !== 'admin') {
    return {
      success: false,
      count: 0,
      totalAmount: 0,
      skippedCount: 0,
      targetMonth: '',
      error: 'Генерация ежемесячных начислений доступна исключительно администратору',
    };
  }

  const month = targetMonth || new Date().toISOString().substring(0, 7);

  // 1. Получаем все активные подключения в статусе 'подключен' или 'сопровождение'
  const { data: connections, error: connError } = await supabase
    .from('connections')
    .select('*, manager:users!connections_manager_id_fkey(user_id, full_name)')
    .in('client_status', ['подключен', 'сопровождение']);

  if (connError) {
    return {
      success: false,
      count: 0,
      totalAmount: 0,
      skippedCount: 0,
      targetMonth: month,
      error: connError.message,
    };
  }

  if (!connections || connections.length === 0) {
    return {
      success: true,
      count: 0,
      totalAmount: 0,
      skippedCount: 0,
      targetMonth: month,
      details: [],
    };
  }

  // 2. Получаем существующие начисления за этот месяц для исключения дубликатов
  const { data: existingAccruals } = await supabase
    .from('client_maintenance')
    .select('connection_id')
    .eq('accrual_month', month);

  const existingConnectionIds = new Set(existingAccruals?.map((a) => a.connection_id) || []);

  // 3. Получаем персональные ставки консультантов из employee_rates
  const { data: rates } = await supabase
    .from('employee_rates')
    .select('user_id, maintenance_percent, effective_from')
    .order('created_at', { ascending: false });

  const ratesMap = new Map<string, number>();
  if (rates) {
    rates.forEach((r) => {
      if (!ratesMap.has(r.user_id)) {
        ratesMap.set(r.user_id, Number(r.maintenance_percent));
      }
    });
  }

  let generatedCount = 0;
  let totalAmount = 0;
  let skippedCount = 0;
  const details: MaintenanceAccrualResult['details'] = [];

  for (const conn of connections) {
    // Проверка: исчерпан ли лимит сопровождения (обычно 3 месяца)
    if (conn.maintenance_months_accrued >= conn.maintenance_months_limit) {
      skippedCount++;
      continue;
    }

    // Проверка: было ли уже начисление в этом месяце
    if (existingConnectionIds.has(conn.connection_id)) {
      skippedCount++;
      continue;
    }

    // Расчет процента: персональный из ratesMap или дефолт 10%
    const percent = ratesMap.get(conn.manager_id) ?? 10.0;
    const planPrice = Number(conn.plan_price) || 0;
    const maintenanceAmount = Math.round((planPrice * percent) / 100 * 100) / 100;

    // Вставка в client_maintenance
    const { error: insertError } = await supabase.from('client_maintenance').insert({
      connection_id: conn.connection_id,
      accrual_month: month,
      seller_phone: conn.seller_phone,
      manager_id: conn.manager_id,
      plan_id: conn.plan_id,
      plan_price: planPrice,
      maintenance_percent: percent,
      maintenance_amount: maintenanceAmount,
      status: 'начислено',
      accrued_by: adminProfile.user_id,
    });

    if (insertError) {
      console.error('Error inserting maintenance accrual:', insertError);
      continue;
    }

    const nextMonthsAccrued = conn.maintenance_months_accrued + 1;
    const nextClientStatus: ClientLifecycleStatus =
      nextMonthsAccrued >= conn.maintenance_months_limit
        ? 'готов'
        : 'сопровождение';

    // Обновляем счетчик месяцев и статус в connections
    await supabase
      .from('connections')
      .update({
        maintenance_months_accrued: nextMonthsAccrued,
        client_status: nextClientStatus,
      })
      .eq('connection_id', conn.connection_id);

    generatedCount++;
    totalAmount += maintenanceAmount;
    details.push({
      seller_name: conn.seller_name,
      seller_phone: conn.seller_phone,
      manager_name: conn.manager?.full_name || 'Консультант',
      amount: maintenanceAmount,
      percent,
    });
  }

  revalidatePath('/connections');
  revalidatePath('/payouts');

  return {
    success: true,
    count: generatedCount,
    totalAmount: Math.round(totalAmount * 100) / 100,
    skippedCount,
    targetMonth: month,
    details,
  };
}

/**
 * Получение истории начислений за сопровождение
 */
export async function getMaintenanceAccruals(accrualMonth?: string) {
  const supabase = await createClient();

  let query = supabase
    .from('client_maintenance')
    .select(
      `
      *,
      manager:users!client_maintenance_manager_id_fkey(user_id, full_name, role),
      accrued_by_user:users!client_maintenance_accrued_by_fkey(user_id, full_name)
    `
    )
    .order('accrued_at', { ascending: false });

  if (accrualMonth && accrualMonth !== 'all') {
    query = query.eq('accrual_month', accrualMonth);
  }

  const { data, error } = await query;
  return { accruals: data || [], error: error?.message };
}
