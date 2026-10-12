'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { requireAdmin, requireAuth } from '@/lib/auth/check-role';
import {
  PayoutSchema,
  PayoutsBatchSchema,
  PG_UUID_REGEX,
  type SalaryOperationType,
  type SalaryOperationSign,
} from '@/lib/validations';
import { roundMoney } from '@/lib/utils/money';
import {
  classifySalaryOperation,
  signOfKind,
  summarizeSalaryPeriod,
  OPERATION_TYPES_BY_KIND,
  SETTLEMENT_MONTH_REGEX,
  type SalaryOperationKind,
} from '@/lib/payroll/classify';
import { computePayrollSheet, fetchSalaryOperationsForSummary } from '@/lib/payroll/server';
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
  /** Вид операции: начисление / удержание / выплата */
  kind: SalaryOperationKind;
  operation_type: SalaryOperationType;
  payout_category?: PayoutCategoryType;
  payment_method: string | null;
  note?: string | null;
  comment: string | null;
  description?: string | null;
  connection_id?: string | null;
  seller_phone?: string | null;
  source_name?: string | null;
  store?: string | null;
  seller_name?: string | null;
  status?: string | null;
  created_by: string;
  created_at: string;
  connection?: {
    connection_id: string;
    seller_name?: string | null;
    store?: string | null;
    seller_phone?: string | null;
  } | null;
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
  tab?: 'all' | 'accruals' | 'deductions' | 'payouts';
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
  /** Остаток на начало расчетного месяца (0 при «все периоды») */
  openingBalance: number;
  totalAccrued: number;
  totalDeductions: number;
  /** Выплачено, включая авансы */
  totalPaid: number;
  /** Авансы — детализация, уже входят в totalPaid */
  totalAdvances: number;
  /** Остаток на конец: openingBalance + totalAccrued − totalDeductions − totalPaid */
  closingBalance: number;
  transactionsCount: number;
  accrualsCount: number;
  deductionsCount: number;
  payoutsCount: number;
}

const EMPTY_PAYOUTS_STATS: PayoutsStats = {
  openingBalance: 0,
  totalAccrued: 0,
  totalDeductions: 0,
  totalPaid: 0,
  totalAdvances: 0,
  closingBalance: 0,
  transactionsCount: 0,
  accrualsCount: 0,
  deductionsCount: 0,
  payoutsCount: 0,
};

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
 * Автоматическое самоисцеление (Self-Healing Backfill):
 * Проверяет наличие записей в connection_accruals, отсутствующих в employee_payouts,
 * и мгновенно переносит их в единый зарплатный регистр.
 */
async function autoHealMissingAccruals(supabase: any): Promise<number> {
  // 1. Попытка вызова быстрой RPC функции из миграции 024
  try {
    // RPC доступна только service_role (миграция 029); вызывается только для admin/supervisor
    const { data: rpcRes, error: rpcErr } = await (createAdminClient().rpc as any)('sync_missing_connection_accruals');
    if (!rpcErr && rpcRes && (rpcRes as any).synced_count > 0) {
      return (rpcRes as any).synced_count;
    }
  } catch {}

  // 2. Нативный TypeScript-перенос при отсутствии RPC
  try {
    const { data: missingAccruals } = await supabase
      .from('connection_accruals')
      .select('*')
      .limit(200);

    if (!missingAccruals || missingAccruals.length === 0) return 0;

    const { data: existingPayouts } = await supabase
      .from('employee_payouts')
      .select('connection_id, operation_type, settlement_month')
      .in('operation_type', ['accrual_connection', 'accrual_maintenance']);

    const existingMap = new Set(
      (existingPayouts || []).map(
        (p: any) => `${p.connection_id}_${p.operation_type}_${p.settlement_month || ''}`
      )
    );

    let synced = 0;
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const ma of missingAccruals) {
      const opType = ma.accrual_type === 'connection' ? 'accrual_connection' : 'accrual_maintenance';
      const key = `${ma.connection_id}_${opType}_${ma.settlement_month || ''}`;

      if (!existingMap.has(key)) {
        const { error: insErr } = await supabase.from('employee_payouts').insert({
          user_id: ma.employee_id,
          employee_id: ma.employee_id,
          connection_id: ma.connection_id,
          seller_phone: ma.seller_phone,
          operation_sign: '+',
          operation_type: opType,
          payout_category: 'бонус',
          amount: Number(ma.amount) || 0,
          settlement_month: ma.settlement_month,
          accrual_month: ma.settlement_month,
          actual_date: ma.paid_at ? ma.paid_at.slice(0, 10) : ma.created_at?.slice(0, 10) || todayStr,
          payout_date: ma.paid_at ? ma.paid_at.slice(0, 10) : ma.created_at?.slice(0, 10) || todayStr,
          status: ma.is_paid ? 'paid' : 'completed',
          note: ma.notes || (opType === 'accrual_connection' ? 'Бонус за подключение' : 'Бонус за сопровождение'),
          comment: ma.notes || (opType === 'accrual_connection' ? 'Бонус за подключение' : 'Бонус за сопровождение'),
          created_by: ma.employee_id,
        } as any);

        if (!insErr) {
          synced++;
          existingMap.add(key);
        }
      }
    }
    return synced;
  } catch (err) {
    console.warn('[AutoHeal] Could not auto-sync connection accruals:', err);
    return 0;
  }
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
    tab,
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
      connection:connections!employee_payouts_connection_id_fkey(connection_id, seller_name, store, seller_phone),
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

  // Фильтр по табу реестра: Начисления / Удержания / Выплаты (выплата ЗП и аванс)
  if (tab === 'accruals') {
    query = query.in('operation_type', OPERATION_TYPES_BY_KIND.accrual);
  } else if (tab === 'deductions') {
    query = query.in('operation_type', OPERATION_TYPES_BY_KIND.deduction);
  } else if (tab === 'payouts') {
    query = query.in('operation_type', OPERATION_TYPES_BY_KIND.payout);
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

  let { data, count, error } = await query;

  if (isPrivileged && (!data || data.length === 0)) {
    const healed = await autoHealMissingAccruals(supabase);
    if (healed > 0) {
      const retry = await query;
      data = retry.data;
      count = retry.count;
    }
  }

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
    // Знак — по виду операции, а не по полю operation_sign (DEFAULT '+' в БД)
    const kind = classifySalaryOperation(p);
    const rawSign: SalaryOperationSign = signOfKind(kind);

    const sourceName = p.connection?.store || p.connection?.seller_name || p.note;
    const store = p.connection?.store;
    const sellerName = p.connection?.seller_name;

    return {
      ...p,
      status: p.status || 'paid',
      employee_id: p.employee_id || p.user_id,
      settlement_month: p.settlement_month || p.accrual_month,
      actual_date: p.actual_date || p.payout_date || p.created_at?.slice(0, 10),
      operation_sign: rawSign,
      kind,
      operation_type: (p.operation_type as SalaryOperationType) || 'payout',
      note: p.note || p.comment || p.description,
      source_name: sourceName,
      store: store,
      seller_name: sellerName,
    };
  });

  // Клиентский поиск по сотруднику, примечанию, источнику или кошельку
  if (search.trim()) {
    const q = search.toLowerCase().trim();
    filteredPayouts = filteredPayouts.filter(
      (p) =>
        p.recipient?.full_name?.toLowerCase().includes(q) ||
        p.recipient?.login?.toLowerCase().includes(q) ||
        p.payment_method?.toLowerCase().includes(q) ||
        p.note?.toLowerCase().includes(q) ||
        p.comment?.toLowerCase().includes(q) ||
        p.source_name?.toLowerCase().includes(q) ||
        p.store?.toLowerCase().includes(q) ||
        p.seller_name?.toLowerCase().includes(q) ||
        p.seller_phone?.includes(q) ||
        p.connection_id?.includes(q)
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
 * Сводные показатели по операциям ЗП за расчетный месяц (или за все время):
 * остаток на начало, начислено, удержано, выплачено (включая авансы), остаток на конец.
 * employeeId — фильтр по сотруднику (consultant/smm всегда видят только себя).
 */
export async function getPayoutsStats(
  accrualMonth?: string,
  employeeId?: string
): Promise<PayoutsStats> {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch {
    return EMPTY_PAYOUTS_STATS;
  }
  const { supabase, profile } = ctx;

  const isPrivileged = profile.role === 'admin' || profile.role === 'supervisor';
  let scopeEmployeeId: string | undefined;
  if (!isPrivileged) {
    scopeEmployeeId = profile.user_id;
  } else if (employeeId && employeeId !== 'all' && PG_UUID_REGEX.test(employeeId)) {
    scopeEmployeeId = employeeId;
  }

  const month = accrualMonth && SETTLEMENT_MONTH_REGEX.test(accrualMonth) ? accrualMonth : undefined;

  let rows;
  try {
    rows = await fetchSalaryOperationsForSummary(supabase, scopeEmployeeId);
  } catch (err) {
    console.error('Error loading salary operations summary:', err);
    return EMPTY_PAYOUTS_STATS;
  }

  const summary = summarizeSalaryPeriod(rows, month);
  const periodRows = month
    ? rows.filter((r) => (r.settlement_month || r.accrual_month) === month)
    : rows;

  let accrualsCount = 0;
  let deductionsCount = 0;
  let payoutsCount = 0;
  for (const row of periodRows) {
    const kind = classifySalaryOperation(row);
    if (kind === 'accrual') accrualsCount++;
    else if (kind === 'deduction') deductionsCount++;
    else payoutsCount++;
  }

  return {
    openingBalance: summary.openingBalance,
    totalAccrued: summary.accrued,
    totalDeductions: summary.deducted,
    totalPaid: summary.paid,
    totalAdvances: summary.advances,
    closingBalance: summary.closingBalance,
    transactionsCount: periodRows.length,
    accrualsCount,
    deductionsCount,
    payoutsCount,
  };
}

/** Категория операции по ее виду (правила миграции 019) */
function categoryForOperationType(
  operationType: string,
  fallback?: PayoutCategoryType | null
): PayoutCategoryType {
  if (operationType === 'advance') return 'аванс';
  if (operationType === 'payout') return 'выплата зп';
  if (operationType === 'deduction' || operationType === 'fine') return 'удержание';
  if (operationType === 'salary_base' || operationType === 'accrual_maintenance') return 'прочие начисления';
  if (operationType === 'bonus_other' || operationType === 'accrual_connection') return 'бонус';
  return fallback || 'выплата зп';
}

/**
 * Прямое проведение операции по ЗП (повторяет process_employee_payout_atomic из миграции 019).
 * Используется, когда в БД нет актуальной версии RPC. Вызывать только после requireAdmin().
 */
async function insertSalaryOperationDirect(
  adminSupabase: ReturnType<typeof createAdminClient>,
  op: {
    userId: string;
    settlementMonth: string;
    date: string;
    amount: number;
    sign: SalaryOperationSign;
    operationType: string;
    category: PayoutCategoryType;
    paymentMethod: string | null;
    comment: string;
    connectionId: string | null;
    sellerPhone: string | null;
    createdBy: string;
    accrualIds?: string[];
  }
): Promise<{ success: boolean; error?: string; payoutId?: string }> {
  const { data: employee } = await adminSupabase
    .from('users')
    .select('user_id, is_active')
    .eq('user_id', op.userId)
    .maybeSingle();

  if (!employee) {
    return { success: false, error: 'Сотрудник не найден' };
  }
  if (!employee.is_active) {
    return { success: false, error: 'Невозможно провести операцию для заблокированного сотрудника' };
  }

  const category = categoryForOperationType(op.operationType, op.category);

  const { data: inserted, error: insertErr } = await adminSupabase
    .from('employee_payouts')
    .insert({
      user_id: op.userId,
      employee_id: op.userId,
      accrual_month: op.settlementMonth,
      settlement_month: op.settlementMonth,
      actual_date: op.date,
      payout_date: op.date,
      amount: op.amount,
      operation_sign: op.sign,
      operation_type: op.operationType,
      payout_category: category,
      payment_method: op.paymentMethod,
      connection_id: op.connectionId,
      seller_phone: op.sellerPhone,
      note: op.comment,
      comment: op.comment,
      description: op.comment,
      status: 'paid',
      created_by: op.createdBy,
    } as any)
    .select('payout_id')
    .single();

  if (insertErr || !inserted) {
    console.error('Error creating salary operation directly:', insertErr);
    return { success: false, error: insertErr?.message || 'Ошибка проведения операции по ЗП' };
  }

  if (op.accrualIds && op.accrualIds.length > 0) {
    // Закрываем только неоплаченные начисления этого же сотрудника
    const { error: accrualsErr } = await adminSupabase
      .from('connection_accruals')
      .update({ is_paid: true, payout_id: inserted.payout_id, paid_at: new Date().toISOString() } as any)
      .in('id', op.accrualIds)
      .eq('employee_id', op.userId)
      .eq('is_paid', false);

    if (accrualsErr) {
      console.error('Error closing accruals for payout:', accrualsErr);
    }
  }

  return { success: true, payoutId: inserted.payout_id };
}

/**
 * Создание операции по ЗП (начисление, удержание, штраф или выплата) — строго роль admin
 */
export async function createPayout(
  input: CreatePayoutInput
): Promise<{ success: boolean; error?: string; payout_id?: string }> {
  try {
    const { profile } = await requireAdmin();

    const parsed = PayoutSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const valid = parsed.data;
    const currentMonth = new Date().toISOString().substring(0, 7);
    const today = new Date().toISOString().substring(0, 10);

    const effMonth = valid.settlement_month || valid.accrual_month || currentMonth;
    const effDate = valid.actual_date || valid.payout_date || today;

    // Знак и категория определяются видом операции, а не присланным знаком
    const effSign: SalaryOperationSign = signOfKind(
      classifySalaryOperation({ operation_type: valid.operation_type })
    );
    const effCategory = categoryForOperationType(valid.operation_type || 'payout', valid.payout_category);

    const adminSupabase = createAdminClient();
    const operationType = valid.operation_type || 'payout';
    const paymentMethod = valid.payment_method ? valid.payment_method.trim() : null;
    const comment = (valid.note || valid.comment || valid.description || '').trim();
    const accrualIds = valid.accrual_ids && valid.accrual_ids.length > 0 ? valid.accrual_ids : undefined;

    // RPC доступна только service_role (миграция 029), права admin проверены выше
    const { data, error } = await adminSupabase.rpc('process_employee_payout_atomic', {
      p_user_id: valid.user_id,
      p_accrual_month: effMonth,
      p_payout_date: effDate,
      p_amount: roundMoney(valid.amount),
      p_payout_category: effCategory,
      p_payment_method: paymentMethod,
      p_comment: comment,
      p_created_by: profile.user_id,
      p_operation_type: operationType,
      p_settlement_month: effMonth,
      p_accrual_ids: accrualIds,
      p_operation_sign: effSign,
      p_connection_id: valid.connection_id || undefined,
      p_seller_phone: valid.seller_phone || undefined,
    });

    let payoutId: string | undefined = (data as any)?.payout_id;

    if (error) {
      // PGRST202: в БД нет 14-параметровой версии из миграции 019 (есть только 11-параметровая,
      // которая не знает operation_sign) — проводим операцию напрямую с той же логикой
      if (error.code !== 'PGRST202') {
        console.error('Error creating salary operation atomically:', error);
        return { success: false, error: error.message };
      }

      const direct = await insertSalaryOperationDirect(adminSupabase, {
        userId: valid.user_id,
        settlementMonth: effMonth,
        date: effDate,
        amount: roundMoney(valid.amount),
        sign: effSign,
        operationType,
        category: effCategory,
        paymentMethod,
        comment,
        connectionId: valid.connection_id || null,
        sellerPhone: valid.seller_phone || null,
        createdBy: profile.user_id,
        accrualIds,
      });
      if (!direct.success) {
        return { success: false, error: direct.error };
      }
      payoutId = direct.payoutId;
    }

    revalidatePath('/payouts');
    revalidatePath('/connections');
    revalidatePath('/profile');
    scheduleTelegramDispatch();

    return { success: true, payout_id: payoutId };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка проведения операции по ЗП' };
  }
}

/**
 * Получение расчетного листа сотрудника за месяц
 */
export async function getPayrollSheetAction(employeeId: string, month: string) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (err: any) {
    return { success: false, error: err.message || 'Пользователь не аутентифицирован' };
  }
  const { supabase, profile } = ctx;

  if (!PG_UUID_REGEX.test(employeeId) || !SETTLEMENT_MONTH_REGEX.test(month)) {
    return { success: false, error: 'Некорректные параметры расчетного листа' };
  }

  // Чужой расчетный лист доступен только admin/supervisor
  const isPrivileged = profile.role === 'admin' || profile.role === 'supervisor';
  if (!isPrivileged && employeeId !== profile.user_id) {
    return { success: false, error: 'Просмотр расчетного листка других сотрудников запрещен' };
  }

  // Расчет в одном месте с итогами реестра (lib/payroll): аванс — выплата, знак — по виду операции
  try {
    const sheet = await computePayrollSheet(supabase, employeeId, month);
    return { success: true, sheet };
  } catch (err: any) {
    console.error('Error computing payroll sheet:', err);
    return { success: false, error: err.message || 'Ошибка расчета расчетного листа' };
  }
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

/**
 * Массовое изменение или удаление операций по ЗП — строго роль admin.
 * update: расчетный месяц, дата, кошелек (только для выплат), вид операции (ручные виды), примечание.
 */
export async function batchPayoutsAction(
  input: unknown
): Promise<{ success: boolean; error?: string; updated?: number; deleted?: number; skipped?: number }> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = PayoutsBatchSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || 'Некорректные данные' };
    }
    const batch = parsed.data;
    const ids = Array.from(new Set(batch.ids));

    if (batch.action === 'delete') {
      // Начисления подключений, закрытые этими выплатами, снова становятся неоплаченными
      const { error: unfreezeErr } = await supabase
        .from('connection_accruals')
        .update({ is_paid: false, payout_id: null, paid_at: null, updated_at: new Date().toISOString() } as any)
        .in('payout_id', ids);
      if (unfreezeErr) {
        return { success: false, error: `Не удалось разблокировать начисления: ${unfreezeErr.message}` };
      }

      const { data: deletedRows, error: delErr } = await supabase
        .from('employee_payouts')
        .delete()
        .in('payout_id', ids)
        .select('payout_id');
      if (delErr) {
        return { success: false, error: delErr.message };
      }

      revalidatePath('/payouts');
      revalidatePath('/profile');
      return { success: true, deleted: deletedRows?.length || 0 };
    }

    const changes = batch.changes;
    const { data: rows, error: rowsErr } = await supabase
      .from('employee_payouts')
      .select('payout_id, operation_type, payout_category, operation_sign, payment_method')
      .in('payout_id', ids);
    if (rowsErr) {
      return { success: false, error: rowsErr.message };
    }
    if (!rows || rows.length === 0) {
      return { success: false, error: 'Операции не найдены' };
    }

    if (changes.operation_type) {
      const systemRows = rows.filter((r: any) =>
        ['accrual_connection', 'accrual_maintenance'].includes(r.operation_type)
      );
      if (systemRows.length > 0) {
        return {
          success: false,
          error: `Вид операции нельзя менять у бонусов по подключениям/сопровождению (выбрано: ${systemRows.length})`,
        };
      }
    }

    const updates = rows.map((row: any) => {
      const operationType: string = changes.operation_type || row.operation_type || 'payout';
      const kind = classifySalaryOperation({ ...row, operation_type: operationType });
      const patch: Record<string, any> = {};

      if (changes.settlement_month) {
        patch.settlement_month = changes.settlement_month;
        patch.accrual_month = changes.settlement_month;
      }
      if (changes.actual_date) {
        patch.actual_date = changes.actual_date;
        patch.payout_date = changes.actual_date;
      }
      if (changes.note !== undefined) {
        const note = changes.note?.trim() || null;
        patch.note = note;
        patch.comment = note;
        patch.description = note;
      }
      if (changes.operation_type) {
        patch.operation_type = operationType;
        patch.payout_category = categoryForOperationType(operationType, row.payout_category);
      }
      // Знак всегда приводим к виду операции (исправляет старые записи с DEFAULT '+')
      patch.operation_sign = signOfKind(kind);

      if (kind === 'payout') {
        const method = changes.payment_method || row.payment_method;
        if (!method || !['mbank', 'odengi', 'bakai', 'abank', 'cash'].includes(method)) {
          return { id: row.payout_id, patch, error: 'missing_payment_method' as const };
        }
        if (changes.payment_method) patch.payment_method = changes.payment_method;
      } else if (changes.operation_type) {
        // Кошелек относится только к выплатам
        patch.payment_method = null;
      }

      return { id: row.payout_id as string, patch, error: null };
    });

    const missingMethod = updates.filter((u) => u.error === 'missing_payment_method');
    if (missingMethod.length > 0) {
      return {
        success: false,
        error: `Для выплат и авансов нужен кошелек: выберите кошелек в массовом изменении (операций без кошелька: ${missingMethod.length})`,
      };
    }

    let updated = 0;
    const CHUNK = 20;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const results = await Promise.all(
        updates.slice(i, i + CHUNK).map((u) =>
          supabase.from('employee_payouts').update(u.patch as any).eq('payout_id', u.id).select('payout_id')
        )
      );
      for (const res of results) {
        if (res.error) {
          revalidatePath('/payouts');
          return { success: false, error: `Изменено ${updated} из ${updates.length}: ${res.error.message}`, updated };
        }
        updated += res.data?.length || 0;
      }
    }

    revalidatePath('/payouts');
    revalidatePath('/profile');
    return { success: true, updated, skipped: ids.length - rows.length };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка массового изменения операций' };
  }
}
