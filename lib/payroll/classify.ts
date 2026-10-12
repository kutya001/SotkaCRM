/**
 * Классификация операций по ЗП и расчет сальдо.
 * Единый источник правил для итогов реестра, расчетного листа и таблицы операций.
 *
 * Три вида операций:
 *  - Начисление (+): оклад, надбавки, бонусы за подключение и сопровождение
 *  - Удержание (−): удержания и штрафы
 *  - Выплата (−): выплата ЗП и аванс
 *
 * Остаток на конец = Остаток на начало + Начислено − Удержано − Выплачено.
 * Остаток на начало месяца = сумма всех операций предыдущих расчетных месяцев.
 */

import type { SalaryOperationType } from '@/lib/validations';

export type SalaryOperationKind = 'accrual' | 'deduction' | 'payout';

export const SALARY_OPERATION_KIND_LABELS: Record<SalaryOperationKind, string> = {
  accrual: 'Начисление',
  deduction: 'Удержание',
  payout: 'Выплата',
};

export const OPERATION_TYPES_BY_KIND: Record<SalaryOperationKind, SalaryOperationType[]> = {
  accrual: ['salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance'],
  deduction: ['deduction', 'fine'],
  payout: ['payout', 'advance'],
};

export interface SalaryOperationLike {
  operation_type?: string | null;
  payout_category?: string | null;
  operation_sign?: string | null;
  amount?: number | string | null;
  settlement_month?: string | null;
  accrual_month?: string | null;
}

/**
 * Вид операции определяется по operation_type (затем по категории для старых записей).
 * Поле operation_sign не используется как источник истины: в БД у него DEFAULT '+',
 * и операции, созданные без явного знака, получали неверный знак.
 */
export function classifySalaryOperation(row: SalaryOperationLike): SalaryOperationKind {
  const type = row.operation_type || '';
  for (const kind of Object.keys(OPERATION_TYPES_BY_KIND) as SalaryOperationKind[]) {
    if ((OPERATION_TYPES_BY_KIND[kind] as string[]).includes(type)) return kind;
  }

  switch (row.payout_category) {
    case 'бонус':
    case 'прочие начисления':
      return 'accrual';
    case 'удержание':
      return 'deduction';
    case 'аванс':
    case 'выплата зп':
      return 'payout';
  }

  return row.operation_sign === '+' ? 'accrual' : 'payout';
}

export function signOfKind(kind: SalaryOperationKind): '+' | '-' {
  return kind === 'accrual' ? '+' : '-';
}

/** Расчетный месяц операции (YYYY-MM) */
export function operationMonth(row: SalaryOperationLike): string {
  return row.settlement_month || row.accrual_month || '';
}

/** Сумма в тыйынах: суммирование целых исключает накопление ошибки float */
function toTiyin(amount: number | string | null | undefined): number {
  return Math.round((Number(amount) || 0) * 100);
}

export interface SalaryTotals {
  accrued: number;
  deducted: number;
  paid: number;
  /** Часть выплат: авансы (детализация, уже включены в paid) */
  advances: number;
  /** accrued − deducted − paid */
  net: number;
  count: number;
}

export function sumSalaryOperations(rows: SalaryOperationLike[]): SalaryTotals {
  let accrued = 0;
  let deducted = 0;
  let paid = 0;
  let advances = 0;

  for (const row of rows) {
    const amount = toTiyin(row.amount);
    const kind = classifySalaryOperation(row);
    if (kind === 'accrual') accrued += amount;
    else if (kind === 'deduction') deducted += amount;
    else {
      paid += amount;
      if (row.operation_type === 'advance' || row.payout_category === 'аванс') advances += amount;
    }
  }

  return {
    accrued: accrued / 100,
    deducted: deducted / 100,
    paid: paid / 100,
    advances: advances / 100,
    net: (accrued - deducted - paid) / 100,
    count: rows.length,
  };
}

export interface SalaryPeriodSummary extends SalaryTotals {
  /** Остаток на начало периода (сумма операций предыдущих месяцев) */
  openingBalance: number;
  /** Остаток на конец периода: openingBalance + accrued − deducted − paid */
  closingBalance: number;
}

/**
 * Итоги за расчетный месяц с остатками на начало и конец.
 * month = undefined/'all' — за все время: остаток на начало 0, на конец — текущая задолженность.
 */
export function summarizeSalaryPeriod(
  rows: SalaryOperationLike[],
  month?: string
): SalaryPeriodSummary {
  if (!month || month === 'all') {
    const totals = sumSalaryOperations(rows);
    return { ...totals, openingBalance: 0, closingBalance: totals.net };
  }

  const before: SalaryOperationLike[] = [];
  const current: SalaryOperationLike[] = [];
  for (const row of rows) {
    const m = operationMonth(row);
    if (m && m < month) before.push(row);
    else if (m === month) current.push(row);
  }

  const opening = sumSalaryOperations(before).net;
  const totals = sumSalaryOperations(current);
  return {
    ...totals,
    openingBalance: opening,
    closingBalance: Math.round((opening + totals.net) * 100) / 100,
  };
}

/** Шаблон расчетного месяца: ГГГГ-ММ с месяцем 01–12 */
export const SETTLEMENT_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
