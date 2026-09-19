/**
 * Финансовые вычисления с фиксированной точностью до 2 знаков (тыйынов).
 * Устраняет погрешности чисел с плавающей точкой в JS (IEEE 754).
 */

export function roundMoney(amount: number | string | null | undefined): number {
  const val = Number(amount) || 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function formatMoney(
  amount: number | string | null | undefined,
  currency = 'сом'
): string {
  const rounded = roundMoney(amount);
  return `${rounded.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

export function calculatePercent(
  baseAmount: number | string,
  percent: number | string
): number {
  const base = roundMoney(baseAmount);
  const p = Number(percent) || 0;
  return roundMoney((base * p) / 100);
}
