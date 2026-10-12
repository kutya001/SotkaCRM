/**
 * Порядок начислений по продавцу: сначала «за подключение», «за сопровождение» —
 * только со следующего месяца после подключения. В одном месяце по одному продавцу
 * нельзя начислить и то и другое.
 *
 * Та же проверка выполняется в БД (payroll_connection_order_error, миграция 034):
 * эта копия нужна резервным TypeScript-путям начисления, чтобы пропускать такие
 * подключения, а не падать на ошибке триггера.
 */

export type ConnectionAccrualType = 'accrual_connection' | 'accrual_maintenance';

export interface ConnectionAccrualHistoryRow {
  operation_type: string | null;
  settlement_month?: string | null;
  accrual_month?: string | null;
  seller_phone?: string | null;
  connection_id?: string | null;
}

function rowMonth(row: ConnectionAccrualHistoryRow): string | null {
  return row.settlement_month || row.accrual_month || null;
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y, m, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Текст ошибки, если начисление нарушает порядок; null — начислять можно */
export function connectionOrderError(
  operationType: string,
  month: string | null | undefined,
  target: { sellerPhone?: string | null; connectionId?: string | null },
  history: readonly ConnectionAccrualHistoryRow[]
): string | null {
  if (operationType !== 'accrual_connection' && operationType !== 'accrual_maintenance') return null;
  if (!month || (!target.sellerPhone && !target.connectionId)) return null;

  const sameSeller = (row: ConnectionAccrualHistoryRow) =>
    (Boolean(target.sellerPhone) && row.seller_phone === target.sellerPhone) ||
    (Boolean(target.connectionId) && row.connection_id === target.connectionId);

  const earliest = (type: ConnectionAccrualType) =>
    history
      .filter((row) => row.operation_type === type && sameSeller(row))
      .map(rowMonth)
      .filter((m): m is string => Boolean(m))
      .sort()[0] ?? null;

  if (operationType === 'accrual_maintenance') {
    const connMonth = earliest('accrual_connection');
    if (!connMonth) {
      return 'Сопровождение начисляется только после начисления за подключение этого продавца';
    }
    if (month <= connMonth) {
      return `За подключение этого продавца начислено в ${connMonth}: сопровождение можно начислять с ${nextMonth(connMonth)}`;
    }
    return null;
  }

  const maintMonth = earliest('accrual_maintenance');
  if (maintMonth && month >= maintMonth) {
    return `По этому продавцу уже начислено сопровождение за ${maintMonth}: за подключение можно начислить только в более раннем месяце`;
  }
  return null;
}
