'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/check-role';
import {
  PayoutSchema,
  type SalaryOperationType,
  type SalaryOperationSign,
} from '@/lib/validations';
import { roundMoney } from '@/lib/utils/money';
import type { Database, UserRole, PayoutCategoryType } from '@/types/database.types';

export interface PayoutItem {
  payout_id: string;
  user_id: string;
  employee_id?: string | null;
  accrual_month: string;
  settlement_month: string;
  actual_date: string;
  payout_date: string;
  amount: number;
  operation_sign: SalaryOperationSign;
  operation_type: SalaryOperationType;
  payout_category?: PayoutCategoryType;
  payment_method: string | null;
  note?: string | null;
  comment: string | null;
  description?: string | null;
  connection_id?: string | null;
  seller_phone?: string | null;
  status?: string | null;
  created_by: string;
  created_at: string;
  recipient?: {
    user_id: string;
    full_name: string;
    role: string;
    login: string;
    color?: string;
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
  operationType?: string;
  operationSign?: string;
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
  totalAccrued: number;
  totalPaid: number;
  totalAdvances: number;
  totalDeductions: number;
  transactionsCount: number;
}

export interface CreatePayoutInput {
  user_id: string;
  employee_id?: string | null;
  accrual_month?: string;
  settlement_month?: string;
  payout_date?: string;
  actual_date?: string;
  amount: number;
  operation_sign?: SalaryOperationSign;
  operation_type?: SalaryOperationType;
  payout_category?: PayoutCategoryType;
  payment_method?: string | null;
  comment?: string | null;
  note?: string | null;
  description?: string | null;
  connection_id?: string | null;
  seller_phone?: string | null;
  accrual_ids?: string[] | null;
}

/**
 * Получение реестра операций по ЗП с учетом ролевой модели (RBAC)
 * admin / supervisor: видят операции всех сотрудников
 * consultant / smm: видят строго свои строки
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
    operationType,
    operationSign,
    sortBy = 'actual_date',
    sortOrder = 'desc',
  } = params;

  let query = supabase
    .from('employee_payouts')
    .select(
      `
      *,
      recipient:users!employee_payouts_user_id_fkey(user_id, full_name, role, login, color),
      creator:users!employee_payouts_created_by_fkey(user_id, full_name, role)
    `,
      { count: 'exact' }
    );

  const isPrivileged = profile.role === 'admin' || profile.role === 'supervisor';

  if (!isPrivileged) {
    query = query.or(`user_id.eq.${profile.user_id},employee_id.eq.${profile.user_id}`);
  } else if (userId && userId !== 'all') {
    query = query.or(`user_id.eq.${userId},employee_id.eq.${userId}`);
  }

  // Фильтр по месяцу начисления
  if (accrualMonth && accrualMonth !== 'all') {
    query = query.or(`settlement_month.eq.${accrualMonth},accrual_month.eq.${accrualMonth}`);
  }

  // Фильтр по категории
  if (category && category !== 'all') {
    query = query.eq('operation_type', category as any);
  }

  // Фильтр по виду операции
  if (operationType && operationType !== 'all') {
    query = query.eq('operation_type', operationType as any);
  }

  // Фильтр по знаку операции (+ или -)
  if (operationSign && operationSign !== 'all') {
    query = query.eq('operation_sign', operationSign as any);
  }

  // Сортировка
  const isAsc = sortOrder === 'asc';
  query = query.order(sortBy, { ascending: isAsc, nullsFirst: false });

  // Пагинация
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) {
    console.error('Error fetching salary operations:', error);
    return {
      payouts: [],
      totalCount: 0,
      currentUserRole: profile.role as UserRole,
      currentUserId: profile.user_id,
      error: error.message,
    };
  }

  let filteredPayouts: PayoutItem[] = ((data as any[]) || []).map((p) => {
    const rawSign: SalaryOperationSign =
      p.operation_sign ||
      (['salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance'].includes(p.operation_type)
        ? '+'
        : '-');

    return {
      ...p,
      status: p.status || 'paid',
      employee_id: p.employee_id || p.user_id,
      settlement_month: p.settlement_month || p.accrual_month,
      actual_date: p.actual_date || p.payout_date || p.created_at?.slice(0, 10),
      operation_sign: rawSign,
      operation_type: (p.operation_type as SalaryOperationType) || 'payout',
      note: p.note || p.comment || p.description,
    };
  });

  // Клиентский поиск по сотруднику, примечанию или кошельку
  if (search.trim()) {
    const q = search.toLowerCase().trim();
    filteredPayouts = filteredPayouts.filter(
      (p) =>
        p.recipient?.full_name?.toLowerCase().includes(q) ||
        p.recipient?.login?.toLowerCase().includes(q) ||
        p.payment_method?.toLowerCase().includes(q) ||
        p.note?.toLowerCase().includes(q) ||
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
 * Расчет сводных финансовых показателей по операциям ЗП
 */
export async function getPayoutsStats(accrualMonth?: string): Promise<PayoutsStats> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { totalAccrued: 0, totalPaid: 0, totalAdvances: 0, totalDeductions: 0, transactionsCount: 0 };
  }

  const { data: profile } = await supabase
    .from('users')
    .select('user_id, role')
    .eq('auth_id', user.id)
    .single();

  let query = supabase
    .from('employee_payouts')
    .select('amount, operation_sign, operation_type, payout_category');

  if (profile && profile.role !== 'admin' && profile.role !== 'supervisor') {
    query = query.or(`user_id.eq.${profile.user_id},employee_id.eq.${profile.user_id}`);
  }

  if (accrualMonth && accrualMonth !== 'all') {
    query = query.or(`settlement_month.eq.${accrualMonth},accrual_month.eq.${accrualMonth}`);
  }

  const { data, error } = await query;
  if (error || !data) {
    return { totalAccrued: 0, totalPaid: 0, totalAdvances: 0, totalDeductions: 0, transactionsCount: 0 };
  }

  let totalAccrued = 0;
  let totalPaid = 0;
  let totalAdvances = 0;
  let totalDeductions = 0;

  data.forEach((r: any) => {
    const amt = Number(r.amount) || 0;
    const sign =
      r.operation_sign ||
      (['salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance'].includes(r.operation_type)
        ? '+'
        : '-');

    if (sign === '+') {
      totalAccrued += amt;
    } else {
      if (r.operation_type === 'payout' || r.payout_category === 'выплата зп') {
        totalPaid += amt;
      }
      if (r.payout_category === 'аванс' || r.operation_type === 'advance') {
        totalAdvances += amt;
      }
      if (r.operation_type === 'deduction' || r.operation_type === 'fine' || r.payout_category === 'удержание') {
        totalDeductions += amt;
      }
    }
  });

  return {
    totalAccrued: roundMoney(totalAccrued),
    totalPaid: roundMoney(totalPaid),
    totalAdvances: roundMoney(totalAdvances),
    totalDeductions: roundMoney(totalDeductions),
    transactionsCount: data.length,
  };
}

/**
 * Создание операции по ЗП (начисление, удержание, штраф или выплата) — строго роль admin
 */
export async function createPayout(
  input: CreatePayoutInput
): Promise<{ success: boolean; error?: string; payout_id?: string }> {
  try {
    const { profile, supabase } = await requireAdmin();

    const parsed = PayoutSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const valid = parsed.data;
    const currentMonth = new Date().toISOString().substring(0, 7);
    const today = new Date().toISOString().substring(0, 10);

    const effMonth = valid.settlement_month || valid.accrual_month || currentMonth;
    const effDate = valid.actual_date || valid.payout_date || today;

    const effSign: SalaryOperationSign =
      valid.operation_sign ||
      (['salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance'].includes(
        valid.operation_type || ''
      )
        ? '+'
        : '-');

    const effCategory =
      valid.operation_type === 'advance'
        ? 'аванс'
        : (valid.payout_category || 'выплата зп');

    const { data, error } = await supabase.rpc('process_employee_payout_atomic', {
      p_user_id: valid.user_id,
      p_accrual_month: effMonth,
      p_payout_date: effDate,
      p_amount: roundMoney(valid.amount),
      p_payout_category: effCategory,
      p_payment_method: valid.payment_method ? valid.payment_method.trim() : null,
      p_comment: (valid.note || valid.comment || valid.description || '').trim(),
      p_created_by: profile.user_id,
      p_operation_type: valid.operation_type || 'payout',
      p_settlement_month: effMonth,
      p_accrual_ids: valid.accrual_ids && valid.accrual_ids.length > 0 ? valid.accrual_ids : undefined,
      p_operation_sign: effSign,
      p_connection_id: valid.connection_id || undefined,
      p_seller_phone: valid.seller_phone || undefined,
    });

    if (error) {
      console.error('Error creating salary operation atomically:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/payouts');
    revalidatePath('/connections');
    revalidatePath('/profile');

    const res = data as any;
    return { success: true, payout_id: res?.payout_id };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка проведения операции по ЗП' };
  }
}

/**
 * Получение расчетного листа сотрудника за месяц
 */
export async function getPayrollSheetAction(employeeId: string, month: string) {
  const supabase = await createClient();
  const { data: userAuth } = await supabase.auth.getUser();
  if (!userAuth.user) {
    return { success: false, error: 'Пользователь не аутентифицирован' };
  }

  // 1. Попытка вызвать RPC процедуру get_employee_payroll_sheet
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('get_employee_payroll_sheet', {
      p_employee_id: employeeId,
      p_month: month,
    });

    if (!rpcErr && rpcData) {
      const sheetData = rpcData as any;
      return {
        success: true,
        sheet: {
          employee_id: employeeId,
          settlement_month: month,
          opening_balance: roundMoney(Number(sheetData.opening_balance) || 0),
          total_accrued: roundMoney(Number(sheetData.total_accrued) || 0),
          total_deductions: roundMoney(Number(sheetData.total_deductions) || 0),
          total_paid: roundMoney(Number(sheetData.total_paid) || 0),
          closing_balance: roundMoney(Number(sheetData.closing_balance) || 0),
          accruals: sheetData.accruals || [],
          deductions_and_advances: sheetData.deductions_and_advances || sheetData.deductions || [],
          payouts: sheetData.payouts || [],
          operations: sheetData.operations || [],
        },
      };
    }
  } catch (err) {
    console.warn('RPC get_employee_payroll_sheet not available, using direct query fallback');
  }

  // 2. Fallback: расчет через прямые запросы к employee_payouts с защитой от отсутствия employee_id
  let prevQuery = supabase
    .from('employee_payouts')
    .select('amount, operation_sign, operation_type')
    .lt('settlement_month', month);

  let { data: prevData, error: prevErr } = await prevQuery.or(`user_id.eq.${employeeId},employee_id.eq.${employeeId}`);
  if (prevErr) {
    const res = await supabase
      .from('employee_payouts')
      .select('amount, operation_sign, operation_type')
      .eq('user_id', employeeId)
      .lt('settlement_month', month);
    prevData = res.data;
  }

  let openingBalance = 0;
  (prevData || []).forEach((row: any) => {
    const amt = Number(row.amount) || 0;
    const sign =
      row.operation_sign ||
      (['salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance'].includes(row.operation_type)
        ? '+'
        : '-');
    if (sign === '+') openingBalance += amt;
    else openingBalance -= amt;
  });

  // Все операции за выбранный месяц
  let currentQuery = supabase
    .from('employee_payouts')
    .select('*')
    .eq('settlement_month', month)
    .order('actual_date', { ascending: true });

  let { data: currentData, error: currErr } = await currentQuery.or(`user_id.eq.${employeeId},employee_id.eq.${employeeId}`);
  if (currErr) {
    const res = await supabase
      .from('employee_payouts')
      .select('*')
      .eq('user_id', employeeId)
      .eq('settlement_month', month)
      .order('actual_date', { ascending: true });
    currentData = res.data;
  }

  let totalAccrued = 0;
  let totalDeductions = 0;
  let totalPaid = 0;

  const accrualsList: any[] = [];
  const deductionsAndAdvancesList: any[] = [];
  const payoutsList: any[] = [];

  (currentData || []).forEach((row: any) => {
    const amt = Number(row.amount) || 0;
    const sign =
      row.operation_sign ||
      (['salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance'].includes(row.operation_type)
        ? '+'
        : '-');

    if (sign === '+') {
      totalAccrued += amt;
      accrualsList.push(row);
    } else {
      if (row.operation_type === 'payout' || row.payout_category === 'выплата зп') {
        totalPaid += amt;
        payoutsList.push(row);
      } else {
        totalDeductions += amt;
        deductionsAndAdvancesList.push(row);
      }
    }
  });

  const closingBalance = openingBalance + totalAccrued - totalDeductions - totalPaid;

  return {
    success: true,
    sheet: {
      employee_id: employeeId,
      settlement_month: month,
      opening_balance: roundMoney(openingBalance),
      total_accrued: roundMoney(totalAccrued),
      total_deductions: roundMoney(totalDeductions),
      total_paid: roundMoney(totalPaid),
      closing_balance: roundMoney(closingBalance),
      accruals: accrualsList,
      deductions_and_advances: deductionsAndAdvancesList,
      payouts: payoutsList,
      operations: currentData || [],
    },
  };
}

/**
 * Получение неоплаченных начислений сотрудника
 */
export async function getUnpaidAccrualsAction(
  employeeId: string,
  settlementMonth?: string
) {
  const supabase = await createClient();
  let query = supabase
    .from('connection_accruals')
    .select(`
      id,
      connection_id,
      seller_phone,
      employee_id,
      accrual_type,
      settlement_month,
      amount,
      is_paid,
      notes,
      created_at,
      sellers(seller_name, store)
    `)
    .eq('employee_id', employeeId)
    .eq('is_paid', false)
    .order('settlement_month', { ascending: true })
    .order('created_at', { ascending: true });

  if (settlementMonth && settlementMonth !== 'all') {
    query = query.eq('settlement_month', settlementMonth);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching unpaid accruals:', error);
    return { success: false, error: error.message, accruals: [] };
  }

  return { success: true, accruals: data || [] };
}

/**
 * Получение списка активных сотрудников для селекторов
 */
export async function getEmployeesList(): Promise<
  { user_id: string; full_name: string; role: string; login: string; color?: string }[]
> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('users')
    .select('user_id, full_name, role, login, color')
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
    .select('settlement_month, accrual_month')
    .order('settlement_month', { ascending: false });

  const currentMonth = new Date().toISOString().substring(0, 7);
  const months = new Set<string>([currentMonth]);

  if (data) {
    data.forEach((r: any) => {
      if (r.settlement_month) months.add(r.settlement_month);
      else if (r.accrual_month) months.add(r.accrual_month);
    });
  }

  return Array.from(months).sort().reverse();
}
