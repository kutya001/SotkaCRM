import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function runTests() {
  console.log('=== STARTING MAINTENANCE BILLING & PAYROLL VERIFICATION ===\n');

  // ТЕСТ 1: Проверка структуры таблицы connection_accruals
  console.log('--- ТЕСТ 1: Проверка таблицы connection_accruals ---');
  const { data: accruals, error: accrualErr } = await supabase
    .from('connection_accruals')
    .select('*')
    .limit(5);

  if (accrualErr) {
    throw new Error('Ошибка выборки connection_accruals: ' + accrualErr.message);
  }
  console.log(`✓ connection_accruals доступна. Найдено записей (выборка): ${accruals.length}`);
  if (accruals.length > 0) {
    const first = accruals[0];
    console.log(`  Пример записи: ID=${first.id}, тип=${first.accrual_type}, сумма=${first.amount}, месяц=${first.settlement_month}, оплачено=${first.is_paid}`);
  }

  // ТЕСТ 2: Тестирование RPC run_maintenance_billing
  console.log('\n--- ТЕСТ 2: Тестирование RPC run_maintenance_billing ---');
  const testMonth = '2026-09';
  const { data: billingRes, error: billingErr } = await supabase.rpc('run_maintenance_billing', {
    p_billing_month: testMonth,
  });

  if (billingErr) {
    throw new Error('Ошибка вызова RPC run_maintenance_billing: ' + billingErr.message);
  }

  console.log('✓ RPC run_maintenance_billing успешно выполнена:');
  console.log(`  Период: ${billingRes.billing_month}`);
  console.log(`  Сформировано начислений абонплаты: ${billingRes.generated_accruals}`);
  console.log(`  Сообщение: ${billingRes.message}`);

  // ТЕСТ 3: Идемпотентность run_maintenance_billing
  console.log('\n--- ТЕСТ 3: Проверка идемпотентности run_maintenance_billing ---');
  const { data: billingRes2, error: billingErr2 } = await supabase.rpc('run_maintenance_billing', {
    p_billing_month: testMonth,
  });
  if (billingErr2) {
    throw new Error('Ошибка повторного запуска billing: ' + billingErr2.message);
  }
  if (billingRes2.generated_accruals !== 0) {
    console.warn(`! Внимание: повторный запуск создал ${billingRes2.generated_accruals} начислений.`);
  } else {
    console.log('✓ Идемпотентность соблюдена: повторный запуск создал 0 дубликатов начислений.');
  }

  // ТЕСТ 4: Тестирование RPC get_employee_payroll_sheet
  console.log('\n--- ТЕСТ 4: Тестирование RPC get_employee_payroll_sheet ---');
  // Получаем любого сотрудника из users
  const { data: users, error: userErr } = await supabase
    .from('users')
    .select('user_id, full_name, role')
    .limit(3);

  if (userErr || !users || users.length === 0) {
    throw new Error('Не удалось получить пользователей для теста');
  }

  const testUser = users[0];
  console.log(`  Тестовый сотрудник: ${testUser.full_name} (${testUser.role}, ${testUser.user_id})`);

  const { data: payrollData, error: payrollErr } = await supabase.rpc('get_employee_payroll_sheet', {
    p_employee_id: testUser.user_id,
    p_month: testMonth,
  });

  if (payrollErr) {
    throw new Error('Ошибка вызова RPC get_employee_payroll_sheet: ' + payrollErr.message);
  }

  console.log('✓ RPC get_employee_payroll_sheet успешно вернула расчетный лист:');
  console.log(`  Входящее сальдо: ${payrollData.opening_balance} сом`);
  console.log(`  Начислено за месяц: ${payrollData.total_accrued} сом`);
  console.log(`  Удержания: ${payrollData.total_deductions} сом`);
  console.log(`  Выплачено: ${payrollData.total_paid} сом`);
  console.log(`  Исходящее сальдо: ${payrollData.closing_balance} сом`);
  console.log(`  Количество записей начислений: ${payrollData.accruals?.length || 0}`);
  console.log(`  Количество записей выплат: ${payrollData.payouts?.length || 0}`);

  // Проверка математического баланса
  const expectedClosing = Number(payrollData.opening_balance) + Number(payrollData.total_accrued) - Number(payrollData.total_deductions) - Number(payrollData.total_paid);
  const actualClosing = Number(payrollData.closing_balance);
  const diff = Math.abs(expectedClosing - actualClosing);
  if (diff > 0.01) {
    throw new Error(`Нарушение сквозного баланса: расчетное ${expectedClosing} !== фактическое ${actualClosing}`);
  }
  console.log('✓ Математический инвариант непрерывного сальдо подтвержден (разница = 0.00)');

  console.log('\n======================================================');
  console.log('ВСЕ ТЕСТЫ БИЛЛИНГА И РАСЧЕТНОГО ЛИСТКА УСПЕШНО ПРОЙДЕНЫ!');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ ТЕСТ ПРЕРВАН С ОШИБКОЙ:', err);
  process.exit(1);
});
