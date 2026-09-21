'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { PlanUpdateSchema } from '@/lib/validations';
import { roundMoney } from '@/lib/utils/money';
import type { Database, UserRole } from '@/types/database.types';

export interface PlanItem {
  plan_id: string;
  plan_name: string;
  price: number;
  billing_period: string;
  description: string | null;
  is_active: boolean;
  updated_at: string;
}

export interface PlanHistoryItem {
  history_id: string;
  plan_id: string;
  plan_name: string;
  old_price: number;
  new_price: number;
  changed_by: string | null;
  changed_at: string;
  changer?: {
    full_name: string;
    role: string;
  } | null;
}

export interface PlanPriceItem {
  price_id: string;
  plan_id: string;
  price: number;
  effective_from: string; // YYYY-MM-DD
  created_at: string;
  created_by: string | null;
}

/**
 * Получение каталога тарифов
 */
export async function getPlans(): Promise<{
  plans: PlanItem[];
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

  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('price', { ascending: true });

  if (error) {
    return { plans: [], currentUserRole, error: error.message };
  }

  return { plans: (data as PlanItem[]) || [], currentUserRole };
}

/**
 * Обновление параметров тарифа (строго admin)
 * При смене price срабатывает триггер audit_plan_price_trigger
 */
/**
 * Обновление параметров тарифа (строго admin)
 * При смене price срабатывает триггер audit_plan_price_trigger
 * и фиксируется запись в plan_prices с датой начала действия
 */
export async function updatePlan(
  planId: string,
  data: {
    plan_name: string;
    price: number;
    billing_period: string;
    description?: string | null;
    is_active: boolean;
    effective_from?: string; // YYYY-MM-DD
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, profile } = await requireAdmin();

    const parsed = PlanUpdateSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const valid = parsed.data;
    const roundedPrice = roundMoney(valid.price);

    const { error } = await supabase
      .from('plans')
      .update({
        plan_name: valid.plan_name,
        price: roundedPrice,
        billing_period: valid.billing_period,
        description: valid.description ?? null,
        is_active: valid.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('plan_id', planId);

    if (error) {
      return { success: false, error: error.message };
    }

    // Сохраняем в версионирование по датам (plan_prices)
    const effectiveFrom = data.effective_from || new Date().toISOString().substring(0, 10);
    await supabase.from('plan_prices').upsert(
      {
        plan_id: planId,
        price: roundedPrice,
        effective_from: effectiveFrom,
        created_by: profile.user_id,
      },
      { onConflict: 'plan_id,effective_from' }
    );

    revalidatePath('/plans');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка обновления тарифа' };
  }
}

/**
 * Создание нового тарифа (строго admin)
 */
export async function createPlan(data: {
  plan_id: string;
  plan_name: string;
  price: number;
  billing_period: string;
  description?: string | null;
  is_active: boolean;
  effective_from?: string; // YYYY-MM-DD
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, profile } = await requireAdmin();

    if (!data.plan_id || data.plan_id.trim().length < 2) {
      return { success: false, error: 'Идентификатор тарифа должен содержать не менее 2 символов' };
    }

    const parsed = PlanUpdateSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const valid = parsed.data;
    const planId = data.plan_id.toUpperCase().trim();
    const roundedPrice = roundMoney(valid.price);

    const { error } = await supabase.from('plans').insert({
      plan_id: planId,
      plan_name: valid.plan_name,
      price: roundedPrice,
      billing_period: valid.billing_period,
      description: valid.description ?? null,
      is_active: valid.is_active,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Сохраняем начальную цену в plan_prices
    const effectiveFrom = data.effective_from || new Date().toISOString().substring(0, 10);
    await supabase.from('plan_prices').insert({
      plan_id: planId,
      price: roundedPrice,
      effective_from: effectiveFrom,
      created_by: profile.user_id,
    });

    revalidatePath('/plans');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка создания тарифа' };
  }
}

/**
 * Получение истории периодов цен тарифа из plan_prices
 */
export async function getPlanPrices(planId: string): Promise<PlanPriceItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('plan_prices')
    .select('*')
    .eq('plan_id', planId)
    .order('effective_from', { ascending: false });

  if (error || !data) return [];
  return data.map((d) => ({
    price_id: d.price_id,
    plan_id: d.plan_id,
    price: Number(d.price),
    effective_from: d.effective_from,
    created_at: d.created_at,
    created_by: d.created_by,
  }));
}

/**
 * Добавление или обновление цены тарифа для определенной даты
 */
export async function upsertPlanPrice(
  planId: string,
  price: number,
  effectiveFrom: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, profile } = await requireAdmin();

    if (!planId || !effectiveFrom || price <= 0) {
      return { success: false, error: 'Заполните корректную дату и стоимость' };
    }

    const roundedPrice = roundMoney(price);

    const { error } = await supabase.from('plan_prices').upsert(
      {
        plan_id: planId,
        price: roundedPrice,
        effective_from: effectiveFrom,
        created_by: profile.user_id,
      },
      { onConflict: 'plan_id,effective_from' }
    );

    if (error) {
      return { success: false, error: error.message };
    }

    // Если дата меньше или равна сегодняшней, обновляем и базовое поле price в plans
    const today = new Date().toISOString().substring(0, 10);
    if (effectiveFrom <= today) {
      // Ищем самую свежую цену на сегодня
      const { data: latestPrice } = await supabase
        .from('plan_prices')
        .select('price')
        .eq('plan_id', planId)
        .lte('effective_from', today)
        .order('effective_from', { ascending: false })
        .limit(1)
        .single();

      if (latestPrice) {
        await supabase
          .from('plans')
          .update({ price: Number(latestPrice.price) })
          .eq('plan_id', planId);
      }
    }

    revalidatePath('/plans');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Удаление записи интервала цены тарифа
 */
export async function deletePlanPrice(
  priceId: string,
  planId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireAdmin();

    // Проверяем, не является ли это единственной ценой тарифа
    const { count } = await supabase
      .from('plan_prices')
      .select('price_id', { count: 'exact', head: true })
      .eq('plan_id', planId);

    if (count && count <= 1) {
      return {
        success: false,
        error: 'Нельзя удалить единственную запись стоимости для этого тарифа',
      };
    }

    const { error } = await supabase
      .from('plan_prices')
      .delete()
      .eq('price_id', priceId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/plans');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Получение истории изменений цен тарифа из plans_history
 */
export async function getPlanHistory(planId: string): Promise<PlanHistoryItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('plans_history')
    .select(
      `
      *,
      changer:users!plans_history_changed_by_fkey(full_name, role)
    `
    )
    .eq('plan_id', planId)
    .order('changed_at', { ascending: false });

  if (error || !data) return [];
  return data as unknown as PlanHistoryItem[];
}

/**
 * Удаление тарифа (строго admin)
 * Выполняется проверка на использование в таблицах sellers и connections
 */
export async function deletePlan(planId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireAdmin();

    if (!planId) {
      return { success: false, error: 'Не указан идентификатор тарифа' };
    }

    // 1. Проверяем использование в sellers
    const { count: sellersCount, error: sellersErr } = await supabase
      .from('sellers')
      .select('seller_phone', { count: 'exact', head: true })
      .eq('plan_id', planId);

    if (sellersErr) {
      return { success: false, error: sellersErr.message };
    }

    if (sellersCount && sellersCount > 0) {
      return {
        success: false,
        error: `Тариф используется у ${sellersCount} продавцов. Удаление заблокировано для сохранения целостности.`,
      };
    }

    // 2. Проверяем использование в connections
    const { count: connCount, error: connErr } = await supabase
      .from('connections')
      .select('connection_id', { count: 'exact', head: true })
      .eq('plan_id', planId);

    if (connErr) {
      return { success: false, error: connErr.message };
    }

    if (connCount && connCount > 0) {
      return {
        success: false,
        error: `Тариф зафиксирован в ${connCount} подключениях. Удаление заблокировано.`,
      };
    }

    // 3. Удаляем связанную историю цен
    await supabase.from('plans_history').delete().eq('plan_id', planId);

    // 4. Удаляем сам тариф
    const { error: deleteErr } = await supabase.from('plans').delete().eq('plan_id', planId);

    if (deleteErr) {
      return { success: false, error: deleteErr.message };
    }

    revalidatePath('/plans');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка при удалении тарифа' };
  }
}

