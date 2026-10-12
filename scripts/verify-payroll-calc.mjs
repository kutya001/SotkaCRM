// Проверка расчетов модуля «Операции по ЗП»: node --experimental-strip-types scripts/verify-payroll-calc.mjs
import assert from 'node:assert/strict';
import { classifySalaryOperation, summarizeSalaryPeriod, sumSalaryOperations } from '../lib/payroll/classify.ts';

// Классификация: аванс — выплата, знак из БД игнорируется
assert.equal(classifySalaryOperation({ operation_type: 'advance', operation_sign: '+' }), 'payout');
assert.equal(classifySalaryOperation({ operation_type: 'payout', operation_sign: '+' }), 'payout');
assert.equal(classifySalaryOperation({ operation_type: 'fine' }), 'deduction');
assert.equal(classifySalaryOperation({ operation_type: 'accrual_connection', operation_sign: '-' }), 'accrual');
assert.equal(classifySalaryOperation({ operation_type: null, payout_category: 'аванс' }), 'payout');
assert.equal(classifySalaryOperation({ operation_type: null, payout_category: 'бонус' }), 'accrual');

const ops = [
  // Август: оклад 30000, бонус 1500.50, аванс 10000, штраф 500 → остаток 21000.50
  { operation_type: 'salary_base', amount: 30000, settlement_month: '2026-08' },
  { operation_type: 'accrual_connection', amount: '1500.50', settlement_month: '2026-08' },
  { operation_type: 'advance', amount: 10000, settlement_month: '2026-08', operation_sign: '+' },
  { operation_type: 'fine', amount: 500, settlement_month: '2026-08' },
  // Сентябрь: оклад 30000, выплата ЗП 21000.50 (долг за август), аванс 4000, удержание 0.1+0.2
  { operation_type: 'salary_base', amount: 30000, settlement_month: '2026-09' },
  { operation_type: 'payout', amount: 21000.5, settlement_month: '2026-09' },
  { operation_type: 'advance', amount: 4000, accrual_month: '2026-09', settlement_month: null },
  { operation_type: 'deduction', amount: 0.1, settlement_month: '2026-09' },
  { operation_type: 'deduction', amount: 0.2, settlement_month: '2026-09' },
  // Октябрь: будущий месяц не влияет на сентябрь
  { operation_type: 'salary_base', amount: 99999, settlement_month: '2026-10' },
];

const aug = summarizeSalaryPeriod(ops, '2026-08');
assert.deepEqual(
  { o: aug.openingBalance, a: aug.accrued, d: aug.deducted, p: aug.paid, adv: aug.advances, c: aug.closingBalance },
  { o: 0, a: 31500.5, d: 500, p: 10000, adv: 10000, c: 21000.5 }
);

const sep = summarizeSalaryPeriod(ops, '2026-09');
assert.equal(sep.openingBalance, 21000.5, 'остаток на начало сентября = остаток на конец августа');
assert.equal(sep.accrued, 30000);
assert.equal(sep.deducted, 0.3, 'без ошибки float 0.1+0.2');
assert.equal(sep.paid, 25000.5, 'выплачено включает аванс');
assert.equal(sep.advances, 4000);
assert.equal(sep.closingBalance, 26000 - 0.3, 'остаток на конец');
assert.equal(sep.count, 5);

const all = summarizeSalaryPeriod(ops);
const total = sumSalaryOperations(ops);
assert.equal(all.openingBalance, 0);
assert.equal(all.closingBalance, total.net);
assert.equal(all.closingBalance, Math.round((sep.closingBalance + 99999) * 100) / 100, 'итог за все время = конец сентября + октябрь');

// Непрерывность: конец месяца N = начало месяца N+1
const oct = summarizeSalaryPeriod(ops, '2026-10');
assert.equal(oct.openingBalance, sep.closingBalance);
console.log('✓ Расчеты операций по ЗП корректны');
