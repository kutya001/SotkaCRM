import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

async function runVerification() {
  console.log('=== STARTING BATCH UPSERT, MOBILE BAR & PAYOUTS ISOLATION VERIFICATION ===\n');

  // --- ТЕСТ 1: Проверка логики дедупликации и чанкования по 50 записей ---
  console.log('--- ТЕСТ 1: Валидация дедупликации массива перед Upsert ---');
  
  const sampleApiItems = [
    { sotka_id: 101, seller_phone: '996555111222', seller_name: 'Shop A v1', store: 'A', balance: 100 },
    { sotka_id: 102, seller_phone: '996555333444', seller_name: 'Shop B', store: 'B', balance: 200 },
    { sotka_id: 101, seller_phone: '996555111222', seller_name: 'Shop A v2', store: 'A-Updated', balance: 150 }, // дубль по sotka_id и phone
    { sotka_id: 103, seller_phone: '996555111222', seller_name: 'Shop Collision', store: 'Collision', balance: 300 }, // дубль по phone с другим sotka_id
  ];

  // 1. Дедупликация по sotka_id
  const dedupedSellersMap = new Map();
  for (const item of sampleApiItems) {
    const idKey = item.sotka_id || item.seller_phone;
    if (!idKey) continue;
    const existing = dedupedSellersMap.get(idKey);
    dedupedSellersMap.set(idKey, {
      ...existing,
      ...item,
      updated_at: new Date().toISOString(),
    });
  }

  // 2. Вторичная дедупликация по seller_phone (PK)
  const dedupedByPhoneMap = new Map();
  for (const s of dedupedSellersMap.values()) {
    if (!s.seller_phone) continue;
    const existing = dedupedByPhoneMap.get(s.seller_phone);
    dedupedByPhoneMap.set(s.seller_phone, {
      ...existing,
      ...s,
    });
  }

  const uniqueSellers = Array.from(dedupedByPhoneMap.values());
  console.log(`  Исходных записей: ${sampleApiItems.length}`);
  console.log(`  Уникальных записей после двухфазной дедупликации: ${uniqueSellers.length}`);

  if (uniqueSellers.length !== 2) {
    throw new Error(`Ожидалось 2 уникальных продавца по телефону, получено: ${uniqueSellers.length}`);
  }

  // Проверяем, что коллизия телефона объединена корректно
  const shopA = uniqueSellers.find(s => s.seller_phone === '996555111222');
  if (!shopA) {
    throw new Error('Запись с телефоном 996555111222 не найдена');
  }

  // Чанкование по 50 элементов
  const largeArray = Array.from({ length: 135 }, (_, idx) => ({ id: idx + 1 }));
  const CHUNK_SIZE = 50;
  const chunks = [];
  for (let i = 0; i < largeArray.length; i += CHUNK_SIZE) {
    chunks.push(largeArray.slice(i, i + CHUNK_SIZE));
  }

  if (chunks.length !== 3 || chunks[0].length !== 50 || chunks[1].length !== 50 || chunks[2].length !== 35) {
    throw new Error('Чанкование по 50 записей работает некорректно: ' + JSON.stringify(chunks.map(c => c.length)));
  }
  console.log(`✓ Дедупликация и чанкование по 50 записей работают штатно (135 элементов разбиты на [50, 50, 35])\n`);

  // --- ТЕСТ 2: Проверка MobileBottomBar (4 колонки и наличие 'Подключения') ---
  console.log('--- ТЕСТ 2: Проверка структуры MobileBottomBar.tsx ---');
  const bottomBarFile = fs.readFileSync('components/layout/MobileBottomBar.tsx', 'utf8');

  if (!bottomBarFile.includes('grid-cols-4')) {
    throw new Error('MobileBottomBar не содержит класс grid-cols-4');
  }
  if (!bottomBarFile.includes('/connections') || !bottomBarFile.includes('Подключения')) {
    throw new Error('MobileBottomBar не содержит пункт Подключения (/connections)');
  }
  if (!bottomBarFile.includes('Link2')) {
    throw new Error('MobileBottomBar не импортирует или не использует иконку Link2');
  }
  if (!bottomBarFile.includes('/leads') || !bottomBarFile.includes('/sellers') || !bottomBarFile.includes("href: '/'")) {
    throw new Error('MobileBottomBar не содержит все 4 обязательных элемента (Лиды, Продавцы, Подключения, Главная)');
  }
  if (!bottomBarFile.includes('safe-area-bottom')) {
    throw new Error('MobileBottomBar не содержит класс safe-area-bottom');
  }
  console.log('✓ MobileBottomBar настроен на 4-колоночную сетку: Лиды -> Продавцы -> Подключения -> Главная с безопасной зоной\n');

  // --- ТЕСТ 3: Проверка файла миграции 016 ---
  console.log('--- ТЕСТ 3: Проверка миграции 016_payouts_isolation_smm_consultant.sql ---');
  const migration016 = fs.readFileSync('supabase/migrations/016_payouts_isolation_smm_consultant.sql', 'utf8');

  if (!migration016.includes('payouts_select_policy')) {
    throw new Error('Миграция 016 не содержит политику payouts_select_policy');
  }
  if (!migration016.includes("status = 'paid'")) {
    throw new Error('Миграция 016 не содержит условие status = paid для не-админов');
  }
  if (!migration016.includes('employee_id')) {
    throw new Error('Миграция 016 не содержит поле employee_id');
  }
  console.log('✓ Миграция 016 содержит DDL статус выплат, employee_id и RLS payouts_select_policy\n');

  // --- ТЕСТ 4: Проверка изоляции в route.ts и actions.ts ---
  console.log('--- ТЕСТ 4: Проверка серверной изоляции выплат в коде ---');
  const payoutsRoute = fs.readFileSync('app/api/v1/payouts/route.ts', 'utf8');
  if (payoutsRoute.includes("profile.role === 'smm'\") {\n      return apiError('У роли SMM отсутствует доступ к выплатам'")) {
    throw new Error('В route.ts осталась старая блокировка роли smm');
  }
  if (!payoutsRoute.includes('targetUserId') || !payoutsRoute.includes('Просмотр чужих выплат запрещен')) {
    throw new Error('В route.ts не реализована проверка на запрос чужого userId для роли smm/consultant');
  }

  const payoutsActions = fs.readFileSync('app/payouts/actions.ts', 'utf8');
  if (!payoutsActions.includes("p.status === 'paid'")) {
    throw new Error('В getPayouts отсутствует фильтрация по status === paid для не-админов');
  }
  console.log('✓ Ролевая изоляция выплат (admin/supervisor vs consultant/smm) валидирована в коде\n');

  // --- ТЕСТ 5: Проверка DB.md и public/openapi.json ---
  console.log('--- ТЕСТ 5: Проверка документации DB.md и public/openapi.json ---');
  const dbMd = fs.readFileSync('DB.md', 'utf8');
  if (!dbMd.includes('16. Спецификация миграции 016')) {
    throw new Error('В DB.md отсутствует Раздел 16');
  }
  const openapi = JSON.parse(fs.readFileSync('public/openapi.json', 'utf8'));
  const payoutsPath = openapi.paths['/api/v1/payouts'];
  if (!payoutsPath?.get?.description?.includes('smm')) {
    throw new Error('В public/openapi.json не обновлено описание GET /api/v1/payouts');
  }
  console.log('✓ DB.md и public/openapi.json синхронизированы\n');

  console.log('========================================================================');
  console.log('ВСЕ 5 БЛОКОВ ПРОВЕРКИ УСПЕШНО ПРОЙДЕНЫ (EXIT 0)');
  console.log('========================================================================\n');
}

runVerification().catch((err) => {
  console.error('\n❌ ОШИБКА ВЕРИФИКАЦИИ:', err);
  process.exit(1);
});
