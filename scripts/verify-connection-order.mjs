// Проверка правила «сначала подключение, сопровождение — со следующего месяца».
// Запуск: node --experimental-strip-types scripts/verify-connection-order.mjs
import assert from 'node:assert/strict';
import { connectionOrderError } from '../lib/payroll/connection-order.ts';

const seller = { sellerPhone: '996700000001', connectionId: 'c1' };
const conn10 = { operation_type: 'accrual_connection', settlement_month: '2026-10', seller_phone: '996700000001', connection_id: 'c1' };
const maint11 = { operation_type: 'accrual_maintenance', settlement_month: '2026-11', seller_phone: '996700000001', connection_id: 'c1' };

// Сопровождение без подключения — нельзя
assert.match(connectionOrderError('accrual_maintenance', '2026-10', seller, []), /только после начисления за подключение/);
// В месяце подключения — нельзя, с подсказкой следующего месяца
assert.match(connectionOrderError('accrual_maintenance', '2026-10', seller, [conn10]), /с 2026-11/);
// Раньше подключения — нельзя
assert.ok(connectionOrderError('accrual_maintenance', '2026-09', seller, [conn10]));
// Со следующего месяца — можно, в том числе через смену года
assert.equal(connectionOrderError('accrual_maintenance', '2026-11', seller, [conn10]), null);
const conn12 = { ...conn10, settlement_month: '2026-12' };
assert.match(connectionOrderError('accrual_maintenance', '2026-12', seller, [conn12]), /с 2027-01/);
assert.equal(connectionOrderError('accrual_maintenance', '2027-01', seller, [conn12]), null);
// Подключение находится по телефону продавца, даже если connection_id другой
assert.equal(connectionOrderError('accrual_maintenance', '2026-11', { sellerPhone: '996700000001', connectionId: 'c2' }, [conn10]), null);
// Месяц берется из accrual_month, если settlement_month пуст
assert.ok(connectionOrderError('accrual_maintenance', '2026-10', seller, [{ ...conn10, settlement_month: null, accrual_month: '2026-10' }]));

// Подключение в месяце сопровождения или позже — нельзя; раньше — можно
assert.match(connectionOrderError('accrual_connection', '2026-11', seller, [maint11]), /уже начислено сопровождение за 2026-11/);
assert.ok(connectionOrderError('accrual_connection', '2026-12', seller, [maint11]));
assert.equal(connectionOrderError('accrual_connection', '2026-10', seller, [maint11]), null);
assert.equal(connectionOrderError('accrual_connection', '2026-10', seller, []), null);

// Другие продавцы и операции не влияют
assert.match(connectionOrderError('accrual_maintenance', '2026-11', { sellerPhone: '996700000002', connectionId: 'c9' }, [conn10]), /только после/);
assert.equal(connectionOrderError('payout', '2026-10', seller, []), null);
assert.equal(connectionOrderError('accrual_maintenance', '2026-10', {}, []), null);

console.log('verify-connection-order: OK');
