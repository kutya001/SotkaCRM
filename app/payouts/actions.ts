'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { PayoutSchema } from '@/lib/validations';
import { roundMoney } from '@/lib/utils/money';
import type { Database, UserRole, PayoutCategoryType } from '@/types/database.types';

export interface PayoutItem {
  payout_id: string;
  user_id: string;
  accrual_month: string;
  payout_date: string;
  amount: number;
  payout_category: PayoutCategoryType;
  payment_method: string;
  comment: string | null;
  created_by: string;
  created_at: string;
  recipient?: {
    user_id: string;
    full_name: string;
    role: string;
    login: string;
  } | null;
  creator?: {
    user_id: string;
    full_name: string;
    role: string;
  } | null;
}

export interface GetPayoutsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  accrualMonth?: string;
  category?: string;
  userId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PayoutsResponse {
  payouts: PayoutItem[];
  totalCount: number;
  currentUserRole?: UserRole;
  currentUserId?: string;
  error?: string;
}

export interface PayoutsStats {
  totalPaid: number;
  totalAdvances: number;
  totalDeductions: number;
  transactionsCount: number;
}

/**
 * Получение реестра выплат сотрудникам с учетом ролевой модели (RBAC)
 * admin: видит выплаты всех сотрудников
 * consultant / smm: видят строго свои начисления (user_id = current_user_id)
 */
export async function getPayouts(
  params: GetPayoutsParams = {}
): Promise<PayoutsResponse> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { payouts: [], totalCount: 0, error: 'Пользователь не аутентифицирован' };
  }

  const { data: profile } = await supabase
    .from('users')
    .select('user_id, role, full_name')
    .eq('auth_id', user.id)
    .single();

  if (!profile) {
    return { payouts: [], totalCount: 0, error: 'Профиль пользователя не найден' };
  }

  const {
    page = 1,
    pageSize = 50,
    search = '',
    accrualMonth,
    category,
    userId,
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = params;

  let query = supabase
    .from('employee_payouts')
    .select(
      `
      *,
      recipient:users!employee_payouts_user_id_fkey(user_id, full_name, role, login),
      creator:users!employee_payouts_created_by_fkey(user_id, full_name, role)
    `,
      { count: 'exact' }
    );

  // RBAC фильтрация
  if (profile.role !== 'admin') {
    query = query.eq('user_id', profile.user_id);
  } else if (userId) {
    query = query.eq('user_id', userId);
  }

  // Фильтр по месяцу
  if (accrualMonth && accrualMonth !== 'all') {
    query = query.eq('accrual_month', accrualMonth);
  }

  // Фильтр по категории выплаты
  if (category && category !== 'all') {
    query = query.eq('payout_category', category as PayoutCategoryType);
  }

  // Сортировка
  const isAsc = sortOrder === 'asc';
  query = query.order(sortBy, { ascending: isAsc });

  // Пагинация
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) {
    console.error('Error fetching payouts:', error);
    return {
      payouts: [],
      totalCount: 0,
      currentUserRole: profile.role as UserRole,
      currentUserId: profile.user_id,
      error: error.message,
    };
  }

  let filteredPayouts = (data as unknown as PayoutItem[]) || [];

  // Клиентский поиск по имени получателя, комментарию или способу оплаты
  if (search.trim()) {
    const q = search.toLowerCase().trim();
    filteredPayouts = filteredPayouts.filter(
      (p) =>
        p.recipient?.full_name?.toLowerCase().includes(q) ||
        p.recipient?.login?.toLowerCase().includes(q) ||
        p.payment_method?.toLowerCase().includes(q) ||
        p.comment?.toLowerCase().includes(q)
    );
  }

  return {
    payouts: filteredPayouts,
    totalCount: count || filteredPayouts.length,
    currentUserRole: profile.role as UserRole,
    currentUserId: profile.user_id,
  };
}

/**
 * Расчет финансовых показателей фонда выплат через оптимизированный PostgreSQL RPC get_payouts_summary
 */
export async function getPayoutsStats(accrualMonth?: string): Promise<PayoutsStats> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { totalPaid: 0, totalAdvances: 0, totalDeductions: 0, transactionsCount: 0 };
  }

  const { data: profile } = await supabase
    .from('users')
    .select('user_id, role')
    .eq('auth_id', user.id)
    .single();

  if (!profile) {
    return { totalPaid: 0, totalAdvances: 0, totalDeductions: 0, transactionsCount: 0 };
  }

  const { data: summary, error } = await supabase.rpc('get_payouts_summary', {
    p_accrual_month: accrualMonth && accrualMonth !== 'all' ? accrualMonth : undefined,
    p_user_id: profile.role !== 'admin' ? profile.user_id : undefined,
  });

  if (error || !summary) {
    console.error('Error in get_payouts_summary RPC:', error);
    return { totalPaid: 0, totalAdvances: 0, totalDeductions: 0, transactionsCount: 0 };
  }

  const res = summary as any;
  return {
    totalPaid: Number(res.totalPaid) || 0,
    totalAdvances: Number(res.totalAdvances) || 0,
    totalDeductions: Number(res.totalDeductions) || 0,
    transactionsCount: Number(res.transactionsCount) || 0,
  };
}

export interface CreatePayoutInput {
  user_id: string;
  accrual_month: string;
  payout_date: string;
  amount: number;
  payout_category: PayoutCategoryType;
  payment_method: string;
  comment?: string;
}

/**
 * Создание записи о выплате сотруднику (строго роль admin)
 * Выполняется через атомарную функцию process_employee_payout_atomic с блокировкой FOR UPDATE
 */
export async function createPayout(
  input: CreatePayoutInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const { profile, supabase } = await requireAdmin();

    const parsed = PayoutSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const valid = parsed.data;

    const { data, error } = await supabase.rpc('process_employee_payout_atomic', {
      p_user_id: valid.user_id,
      p_accrual_month: valid.accrual_month,
      p_payout_date: valid.payout_date,
      p_amount: roundMoney(valid.amount),
      p_payout_category: valid.payout_category,
      p_payment_method: valid.payment_method.trim(),
      p_comment: valid.comment?.trim() || '',
      p_created_by: profile.user_id,
    });

    if (error) {
      console.error('Error creating payout atomically:', error);
      if (error.code === '23505' || error.message.includes('unique') || error.message.includes('idx_payouts_unique_salary_period')) {
        return { success: false, error: 'За данный расчетный месяц сотруднику уже оформлена выплата зарплаты' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath('/payouts');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка проведения выплаты' };
  }
}

/**
 * Получение списка активных сотрудников для селекторов
 */
export async function getEmployeesList(): Promise<
  { user_id: string; full_name: string; role: string; login: string }[]
> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('users')
    .select('user_id, full_name, role, login')
    .eq('is_active', true)
    .order('full_name');

  return data || [];
}

/**
 * Получение списка доступных расчетных месяцев
 */
export async function getPayoutMonthsList(): Promise<string[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('employee_payouts')
    .select('accrual_month')
    .order('accrual_month', { ascending: false });

  const currentMonth = new Date().toISOString().substring(0, 7);
  const months = new Set<string>([currentMonth]);

  if (data) {
    data.forEach((r) => {
      if (r.accrual_month) months.add(r.accrual_month);
    });
  }

  return Array.from(months).sort().reverse();
}
