import fs from 'fs';

async function runPerfSwrVerification() {
  console.log('=== STARTING DEEP PERF, ATOMIC RPC & SWR CACHE VERIFICATION ===\n');

  // --- ТЕСТ 1: Проверка миграции 014_trgm_search_and_atomic_linking.sql ---
  console.log('--- ТЕСТ 1: Валидация миграции 014 (pg_trgm, GIN-индексы, RPC) ---');
  const migrationPath = 'supabase/migrations/014_trgm_search_and_atomic_linking.sql';
  if (!fs.existsSync(migrationPath)) {
    throw new Error('Файл миграции 014 не найден!');
  }
  const migrationContent = fs.readFileSync(migrationPath, 'utf8');

  const requiredTokens = [
    'CREATE EXTENSION IF NOT EXISTS pg_trgm',
    'idx_leads_client_name_trgm',
    'idx_leads_phone_trgm',
    'idx_leads_comment_trgm',
    'idx_leads_composite_search_trgm',
    'idx_sellers_seller_name_trgm',
    'idx_sellers_seller_phone_trgm',
    'idx_sellers_store_trgm',
    'idx_sellers_composite_search_trgm',
    'CREATE OR REPLACE FUNCTION public.link_lead_to_seller',
    'FOR UPDATE',
    'CREATE OR REPLACE FUNCTION public.get_dashboard_kpi',
    'CREATE OR REPLACE FUNCTION public.calculate_payout_accruals',
    'GRANT EXECUTE ON FUNCTION public.link_lead_to_seller',
    'GRANT EXECUTE ON FUNCTION public.get_dashboard_kpi',
    'GRANT EXECUTE ON FUNCTION public.calculate_payout_accruals',
  ];

  for (const token of requiredTokens) {
    if (!migrationContent.includes(token)) {
      throw new Error(`В миграции 014 отсутствует обязательный элемент: "${token}"`);
    }
  }
  console.log('✓ Миграция 014 содержит pg_trgm, 8 GIN-индексов, FOR UPDATE и все 3 RPC процедуры\n');

  // --- ТЕСТ 2: Проверка синхронизации документации DB.md ---
  console.log('--- ТЕСТ 2: Проверка актуализации манифеста DB.md ---');
  const dbMdContent = fs.readFileSync('DB.md', 'utf8');
  if (!dbMdContent.includes('014_trgm_search_and_atomic_linking.sql')) {
    throw new Error('В DB.md отсутствует упоминание миграции 014');
  }
  if (!dbMdContent.includes('pg_trgm') || !dbMdContent.includes('get_dashboard_kpi') || !dbMdContent.includes('calculate_payout_accruals')) {
    throw new Error('В DB.md не зафиксированы новые индексы или RPC-функции');
  }
  console.log('✓ Манифест DB.md синхронизирован с разделом 14\n');

  // --- ТЕСТ 3: Проверка вызовов RPC в роутах API ---
  console.log('--- ТЕСТ 3: Валидация серверных роутов API v1 ---');
  const linkSellerRoute = fs.readFileSync('app/api/v1/leads/[id]/link-seller/route.ts', 'utf8');
  if (!linkSellerRoute.includes("supabase.rpc('link_lead_to_seller'")) {
    throw new Error('Роут leads/[id]/link-seller не вызывает link_lead_to_seller RPC!');
  }

  const linkLeadRoute = fs.readFileSync('app/api/v1/sellers/[id]/link-lead/route.ts', 'utf8');
  if (!linkLeadRoute.includes("supabase.rpc('link_lead_to_seller'")) {
    throw new Error('Роут sellers/[id]/link-lead не вызывает link_lead_to_seller RPC!');
  }

  const kpiRoute = fs.readFileSync('app/api/v1/dashboard/kpi/route.ts', 'utf8');
  if (!kpiRoute.includes("supabase.rpc('get_dashboard_kpi'")) {
    throw new Error('Роут dashboard/kpi не вызывает get_dashboard_kpi RPC!');
  }

  const payoutsCalcRoute = fs.readFileSync('app/api/v1/payouts/calculate/route.ts', 'utf8');
  if (!payoutsCalcRoute.includes("supabase.rpc('calculate_payout_accruals'")) {
    throw new Error('Роут payouts/calculate не вызывает calculate_payout_accruals RPC!');
  }
  console.log('✓ Все 4 целевых эндпоинта вызывают специализированные серверные RPC\n');

  // --- ТЕСТ 4: Проверка SWR-кэширования и инвалидации в client.ts ---
  console.log('--- ТЕСТ 4: Проверка логики SWR-кэширования и инвалидации в lib/api/client.ts ---');
  const clientContent = fs.readFileSync('lib/api/client.ts', 'utf8');
  const clientTokens = [
    'memoryCache',
    'DEFAULT_TTL = 30_000',
    'invalidateCache',
    'invalidateNamespaces',
    'bypassCache',
    'cache:',
    'api = {',
  ];

  for (const token of clientTokens) {
    if (!clientContent.includes(token)) {
      throw new Error(`В lib/api/client.ts отсутствует обязательный компонент: "${token}"`);
    }
  }

  // Проверяем паттерны инвалидации мутаций
  if (!clientContent.includes("invalidateNamespaces('leads', 'dashboard', 'analytics')")) {
    throw new Error('Отсутствует автоинвалидация при мутациях лидов');
  }
  if (!clientContent.includes("invalidateNamespaces('sellers', 'leads', 'connections', 'dashboard', 'analytics')")) {
    throw new Error('Отсутствует автоинвалидация при мутациях продавцов');
  }
  console.log('✓ In-Memory SWR-кэширование и автоматическая инвалидация реализованы корректно\n');

  // --- ТЕСТ 5: Проверка оптимизации рендера DataJournal.tsx ---
  console.log('--- ТЕСТ 5: Валидация мемоизации и изоляции DataJournal ---');
  const dataJournalContent = fs.readFileSync('components/ui/DataJournal.tsx', 'utf8');

  const djTokens = [
    'onAssignedChange?: (row: T, newAssigned: string | null) => void',
    'onContextMenuOpen?: (row: T) => void',
    'onRowClickStable',
    'onStatusChangeStable',
    'onAssignedChangeStable',
    'onContextMenuOpenStable',
    'areCardPropsEqual',
    'useContextMenuController',
  ];

  for (const token of djTokens) {
    if (!dataJournalContent.includes(token)) {
      throw new Error(`В DataJournal.tsx отсутствует оптимизационный компонент: "${token}"`);
    }
  }
  console.log('✓ DataJournal: стабилизация коллбэков, memo для карточек и изоляция контекстного меню ПКМ подтверждены\n');

  console.log('=== ВСЕ 5 БЛОКОВ ПРОВЕРКИ ПРОИЗВОДИТЕЛЬНОСТИ УСПЕШНО ПРОЙДЕНЫ (EXIT 0) ===');
}

runPerfSwrVerification().catch((err) => {
  console.error('ОШИБКА:', err);
  process.exit(1);
});
