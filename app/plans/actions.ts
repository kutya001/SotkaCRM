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
export async function updatePlan(
  planId: string,
  data: {
    plan_name: string;
    price: number;
    billing_period: string;
    description?: string | null;
    is_active: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = PlanUpdateSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const valid = parsed.data;

    const { error } = await supabase
      .from('plans')
      .update({
        plan_name: valid.plan_name,
        price: roundMoney(valid.price),
        billing_period: valid.billing_period,
        description: valid.description ?? null,
        is_active: valid.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('plan_id', planId);

    if (error) {
      return { success: false, error: error.message };
    }

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
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireAdmin();

    if (!data.plan_id || data.plan_id.trim().length < 2) {
      return { success: false, error: 'Идентификатор тарифа должен содержать не менее 2 символов' };
    }

    const parsed = PlanUpdateSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const valid = parsed.data;

    const { error } = await supabase.from('plans').insert({
      plan_id: data.plan_id.toUpperCase().trim(),
      plan_name: valid.plan_name,
      price: roundMoney(valid.price),
      billing_period: valid.billing_period,
      description: valid.description ?? null,
      is_active: valid.is_active,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/plans');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка создания тарифа' };
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
