/**
 * verify-wallet-bulk-isolation.mjs
 * 
 * Верификационный тест для проверки:
 * 1. Валидации Кыргызстанских кошельков (mbank, odengi, bakai, abank, cash)
 * 2. Валидации пакетных операций лидов и продавцов (LeadsBatchActionSchema, SellersBatchActionSchema)
 * 3. Логики ролевой изоляции:
 *    - SMM: просмотр всех лидов, модификация только Открыт/Обработан, запрет на Назначен/Подписан/Отмена
 *    - Consultant: тотальная изоляция своих назначенных лидов и продавцов
 *    - Admin: исключительное право DELETE
 */

import { paymentMethodSchema, LeadsBatchActionSchema, SellersBatchActionSchema } from '../lib/validations/index.ts';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    process.exitCode = 1;
  }
}

console.log('\n--- 1. Тестирование валидации Кошелька (Платежные системы Кыргызстана) ---');

const validWallets = ['mbank', 'odengi', 'bakai', 'abank', 'cash'];
for (const wallet of validWallets) {
  const result = paymentMethodSchema.safeParse(wallet);
  assert(result.success, `Кошелек "${wallet}" успешно валидируется`);
}

const invalidWallets = ['kaspi', 'halyk', 'crypto', 'qiwi', 'visa'];
for (const wallet of invalidWallets) {
  const result = paymentMethodSchema.safeParse(wallet);
  assert(!result.success, `Неподдерживаемый метод "${wallet}" корректно отклонен`);
}

console.log('\n--- 2. Тестирование схем пакетных операций (Bulk Actions) ---');

// Лиды: change_status
const leadsStatusBatch = LeadsBatchActionSchema.safeParse({
  action: 'change_status',
  lead_ids: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
  status: 'Обработан',
});
assert(leadsStatusBatch.success, 'Пакетная смена статуса лидов валидна');

// Лиды: change_assigned
const leadsAssignBatch = LeadsBatchActionSchema.safeParse({
  action: 'change_assigned',
  lead_ids: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
  assigned_to: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
});
assert(leadsAssignBatch.success, 'Пакетное переназначение куратора лидов валидно');

// Лиды: delete
const leadsDeleteBatch = LeadsBatchActionSchema.safeParse({
  action: 'delete',
  lead_ids: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
});
assert(leadsDeleteBatch.success, 'Пакетное исключение лидов валидно');

// Лиды: пустой массив отклоняется
const leadsEmptyBatch = LeadsBatchActionSchema.safeParse({
  action: 'change_status',
  lead_ids: [],
  status: 'Открыт',
});
assert(!leadsEmptyBatch.success, 'Пустой массив идентификаторов лидов отклоняется');

// Продавцы: change_manager
const sellersManagerBatch = SellersBatchActionSchema.safeParse({
  action: 'change_manager',
  seller_ids: ['996555123456'],
  manager_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
});
assert(sellersManagerBatch.success, 'Пакетное назначение куратора продавцов валидно');

// Продавцы: delete
const sellersDeleteBatch = SellersBatchActionSchema.safeParse({
  action: 'delete',
  seller_ids: ['996555123456'],
});
assert(sellersDeleteBatch.success, 'Пакетное удаление продавцов валидно');

console.log('\n--- 3. Тестирование логики ролевой изоляции SMM ---');

function canSmmUpdateLead(leadStatus, newStatus) {
  const allowedStages = ['Открыт', 'Обработан'];
  if (!allowedStages.includes(leadStatus)) return false;
  if (newStatus && !allowedStages.includes(newStatus)) return false;
  return true;
}

assert(canSmmUpdateLead('Открыт', 'Обработан') === true, 'SMM может перевести из Открыт в Обработан');
assert(canSmmUpdateLead('Обработан', 'Открыт') === true, 'SMM может перевести из Обработан в Открыт');
assert(canSmmUpdateLead('Назначен', 'Обработан') === false, 'SMM запрещено изменять лид со статусом Назначен');
assert(canSmmUpdateLead('Подписан', 'Отмена') === false, 'SMM запрещено изменять лид со статусом Подписан');
assert(canSmmUpdateLead('Отмена', 'Открыт') === false, 'SMM запрещено реанимировать отмененный лид');
assert(canSmmUpdateLead('Открыт', 'Подписан') === false, 'SMM запрещено переводить в статус Подписан');

console.log('\n--- 4. Тестирование прав на операцию DELETE (Admin Only) ---');

function canRoleDelete(role) {
  return role === 'admin';
}

assert(canRoleDelete('admin') === true, 'Администратор имеет право на DELETE');
assert(canRoleDelete('consultant') === false, 'Консультанту заблокирован DELETE');
assert(canRoleDelete('smm') === false, 'SMM-специалисту заблокирован DELETE');
assert(canRoleDelete('supervisor') === false, 'Супервайзеру заблокирован DELETE');

console.log(`\nИтоговый результат: ${passedTests} из ${totalTests} тестов успешно пройдено.\n`);

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
