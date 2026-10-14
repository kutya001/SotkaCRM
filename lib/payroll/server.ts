import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import {
  classifySalaryOperation,
  operationMonth,
  signOfKind,
  summarizeSalaryPeriod,
  type SalaryOperationLike,
} from '@/lib/payroll/classify';

type Client = SupabaseClient<Database>;

const PAGE_SIZE = 1000;
const SUMMARY_COLUMNS =
  'amount, operation_type, payout_category, operation_sign, settlement_month, accrual_month';

/**
 * Все операции в области видимости (сотрудник или все сотрудники), постранично:
 * PostgREST по умолчанию возвращает не более 1000 строк, итоги не должны обрезаться.
 */
export async function fetchSalaryOperationsForSummary(
  client: Client,
  employeeId?: string,
  dateRange?: { from?: string; to?: string }
): Promise<SalaryOperationLike[]> {
  const rows: SalaryOperationLike[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client
      .from('employee_payouts')
      .select(SUMMARY_COLUMNS)
      .order('payout_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (employeeId) {
      query = query.or(`user_id.eq.${employeeId},employee_id.eq.${employeeId}`);
    }
    // Период по дате операции (YYYY-MM-DD)
    if (dateRange?.from) query = query.gte('actual_date', dateRange.from.slice(0, 10));
    if (dateRange?.to) query = query.lte('actual_date', dateRange.to.slice(0, 10));

    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data as SalaryOperationLike[]) || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

export interface PayrollSheet {
  employee: {
    id: string;
    full_name: string;
    role: string;
    login: string;
    color?: string | null;
  } | null;
  employee_id: string;
  month: string;
  settlement_month: string;
  opening_balance: number;
  total_accrued: number;
  total_deductions: number;
  /** Выплаты, включая авансы */
  total_paid: number;
  /** Авансы (детализация, уже входят в total_paid) */
  total_advances: number;
  closing_balance: number;
  accruals: any[];
  deductions: any[];
  /** Совместимость со старыми клиентами: теперь только удержания (авансы — в payouts) */
  deductions_and_advances: any[];
  payouts: any[];
  operations: any[];
}

/**
 * Расчетный лист сотрудника за месяц.
 * Вызывать только после проверки прав (сотрудник видит свой лист, payouts.view_all — любой).
 */
export async function computePayrollSheet(
  client: Client,
  employeeId: string,
  month: string
): Promise<PayrollSheet> {
  const [allRows, employeeRes, monthRes] = await Promise.all([
    fetchSalaryOperationsForSummary(client, employeeId),
    client
      .from('users')
      .select('user_id, full_name, role, login, color')
      .eq('user_id', employeeId)
      .maybeSingle(),
    client
      .from('employee_payouts')
      .select(
        `*, connection:connections!employee_payouts_connection_id_fkey(connection_id, seller_name, store, seller_phone)`
      )
      .or(`user_id.eq.${employeeId},employee_id.eq.${employeeId}`)
      .or(`settlement_month.eq.${month},and(settlement_month.is.null,accrual_month.eq.${month})`)
      .order('actual_date', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);

  if (monthRes.error) throw monthRes.error;

  const summary = summarizeSalaryPeriod(allRows, month);

  const operations = ((monthRes.data as any[]) || [])
    .filter((row) => operationMonth(row) === month)
    .map((row) => {
      const kind = classifySalaryOperation(row);
      const note = row.note || row.comment || row.description || null;
      return {
        ...row,
        id: row.payout_id,
        kind,
        operation_sign: signOfKind(kind),
        settlement_month: month,
        actual_date: row.actual_date || row.payout_date || row.created_at?.slice(0, 10),
        date: row.actual_date || row.payout_date || row.created_at?.slice(0, 10),
        note,
        comment: note,
        source_name: row.connection?.store || row.connection?.seller_name || null,
        store: row.connection?.store || null,
        seller_name: row.connection?.seller_name || null,
      };
    });

  const accruals = operations.filter((op) => op.kind === 'accrual');
  const deductions = operations.filter((op) => op.kind === 'deduction');
  const payouts = operations.filter((op) => op.kind === 'payout');

  const employee = employeeRes.data
    ? {
        id: employeeRes.data.user_id,
        full_name: employeeRes.data.full_name,
        role: employeeRes.data.role as string,
        login: employeeRes.data.login,
        color: (employeeRes.data as any).color ?? null,
      }
    : null;

  return {
    employee,
    employee_id: employeeId,
    month,
    settlement_month: month,
    opening_balance: summary.openingBalance,
    total_accrued: summary.accrued,
    total_deductions: summary.deducted,
    total_paid: summary.paid,
    total_advances: summary.advances,
    closing_balance: summary.closingBalance,
    accruals,
    deductions,
    deductions_and_advances: deductions,
    payouts,
    // Список операций месяца — от новых к старым
    operations: [...operations].reverse(),
  };
}
