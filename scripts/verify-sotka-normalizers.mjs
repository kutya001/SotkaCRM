// Проверка нормализаторов Sotka HQ: даты регистрации и транзакции продавца.
// Запуск: node --experimental-strip-types scripts/verify-sotka-normalizers.mjs
import assert from 'node:assert/strict';
import {
  parseDateToISO,
  normalizeSotkaSeller,
  extractSellerDetailRegisteredAt,
  normalizeSellerTransactions,
  normalizeSellerSubscription,
  sellerSubscriptionColumns,
} from '../lib/sotka/normalizers.ts';

// Даты: ISO, локальный формат API (UTC+6), запятая, доли секунд, слэши
assert.equal(parseDateToISO('2026-01-15T09:30:00Z'), '2026-01-15T09:30:00.000Z');
assert.equal(parseDateToISO('15.01.2026 09:30'), '2026-01-15T03:30:00.000Z');
assert.equal(parseDateToISO('15.01.2026, 09:30'), '2026-01-15T03:30:00.000Z');
assert.equal(parseDateToISO('15/01/2026 09:30:15.123'), '2026-01-15T03:30:15.000Z');
assert.equal(parseDateToISO('2026-01-15 09:30:00.5'), '2026-01-15T03:30:00.000Z');
assert.equal(parseDateToISO('2026-01-15T09:30:00'), '2026-01-15T03:30:00.000Z');
assert.equal(parseDateToISO('15.01.2026'), '2026-01-14T18:00:00.000Z');
assert.equal(parseDateToISO(''), null);
assert.equal(parseDateToISO(null), null);
assert.equal(parseDateToISO('мусор'), null);

// Дата регистрации из реестра под разными именами поля
const base = { organization_id: 25, seller_name: 'A', seller_phone: '700888268', iso_code: '996' };
assert.equal(normalizeSotkaSeller({ ...base, registered_at: '2026-01-15T09:30:00Z' }).registered_at, '2026-01-15T09:30:00.000Z');
assert.equal(normalizeSotkaSeller({ ...base, created_at: '15.01.2026 09:30' }).registered_at, '2026-01-15T03:30:00.000Z');
assert.equal(normalizeSotkaSeller({ ...base, platform: { registered_at: '2026-02-01T00:00:00Z' } }).registered_at, '2026-02-01T00:00:00.000Z');
assert.equal(normalizeSotkaSeller({ ...base, registered_at: null }).registered_at, null);

// Детальная карточка: platform.registered_at
assert.equal(extractSellerDetailRegisteredAt({ platform: { registered_at: '01.03.2026 12:00' } }), '2026-03-01T06:00:00.000Z');
assert.equal(extractSellerDetailRegisteredAt({ platform: { registered_at: null } }), null);
assert.equal(extractSellerDetailRegisteredAt(null), null);

// Транзакции: пустой блок, отсутствующий блок, поля админского API и итоги
assert.deepEqual(normalizeSellerTransactions(undefined), { items: [], total: 0, total_topups: 0, total_charges: 0, total_amount: 0 });
assert.deepEqual(normalizeSellerTransactions({}), { items: [], total: 0, total_topups: 0, total_charges: 0, total_amount: 0 });

const tx = normalizeSellerTransactions({
  items: [
    { payment_id: 77, date_time: '10.10.2026 10:00', tran_type: 'topup', amount: '1500.50', status: 'succeeded' },
    { id: 78, date: '2026-10-11T00:00:00Z', type: 'charge', amount: 500, description: 'Тариф' },
  ],
});
assert.equal(tx.items.length, 2);
assert.deepEqual(tx.items[0], { id: 77, date: '2026-10-10T04:00:00.000Z', type: 'topup', description: '', amount: 1500.5, status: 'succeeded' });
assert.equal(tx.items[1].amount, -500);
assert.equal(tx.total, 2);
assert.equal(tx.total_topups, 1500.5);
assert.equal(tx.total_charges, 500);
assert.equal(tx.total_amount, 1000.5);

// Неуспешные операции не входят в итоги, даже если API прислал свои суммы
const txFailed = normalizeSellerTransactions({
  total_topups: 2998,
  total_charges: 1499,
  items: [
    { id: 1, type: 'charge', amount: 1499, status: 'succeeded' },
    { id: 2, type: 'topup', amount: 1499, status: 'succeeded' },
    { id: 3, type: 'topup', amount: 1499, status: 'failed' },
  ],
});
assert.deepEqual(
  { topups: txFailed.total_topups, charges: txFailed.total_charges, amount: txFailed.total_amount },
  { topups: 1499, charges: 1499, amount: 0 }
);

// Итоги из ответа API используются только без списка операций
const txApi = normalizeSellerTransactions({ items: [], total: 12, total_topups: 100, total_charges: -40, total_amount: 60 });
assert.deepEqual(
  { total: txApi.total, topups: txApi.total_topups, charges: txApi.total_charges, amount: txApi.total_amount },
  { total: 12, topups: 100, charges: 40, amount: 60 }
);

// Подписка организации (блок platform детальной карточки)
const NOW = new Date('2026-11-27T00:00:00Z');
const subState = (detail) => normalizeSellerSubscription(detail, NOW).state;
// Пример контракта: организация без подписки — tariff и subscription_status = null
assert.equal(subState({ platform: { tariff: null, subscription_status: null } }), 'inactive');
assert.equal(subState(null), 'inactive');
assert.equal(subState({ platform: { tariff: 'Премиум', subscription_status: 'active' } }), 'active');
assert.equal(subState({ platform: { tariff: 'Премиум', subscription_status: 'Активна' } }), 'active');
assert.equal(subState({ platform: { tariff: 'Премиум', subscription_status: 'expired' } }), 'inactive');
assert.equal(subState({ platform: { tariff: 'Премиум', subscription_status: 'Истекла' } }), 'inactive');
// Нераспознанный статус не угадывается
assert.equal(subState({ platform: { tariff: 'Премиум', subscription_status: 'grace_period' } }), 'unknown');
// Тариф без статуса — действие не подтверждено
assert.equal(subState({ platform: { tariff: 'Премиум', subscription_status: null } }), 'unknown');
// Вложенный объект подписки, флаг и дата окончания
assert.equal(subState({ platform: { subscription: { status: 'paid', plan: { name: 'Бизнес' } } } }), 'active');
assert.equal(subState({ platform: { subscription: { is_active: false } } }), 'inactive');
assert.equal(subState({ platform: { subscription_active: true } }), 'active');
assert.equal(subState({ platform: { subscription_status: 'active', subscription_until: '2026-10-01T00:00:00Z' } }), 'inactive');
assert.equal(subState({ platform: { tariff: 'Премиум', subscription_until: '2027-01-01T00:00:00Z' } }), 'active');
const subFull = normalizeSellerSubscription({ platform: { tariff: { name: 'Премиум' }, subscription_status: ' Active ' } }, NOW);
assert.deepEqual(subFull, { state: 'active', status: 'Active', tariff: 'Премиум', paidUntil: null });
const subCols = sellerSubscriptionColumns({ platform: { tariff: 'Базовый', subscription_status: 'active' } }, NOW);
assert.deepEqual(subCols, {
  subscription_state: 'active',
  hq_subscription_status: 'active',
  hq_tariff: 'Базовый',
  hq_subscription_until: null,
  hq_subscription_synced_at: '2026-11-27T00:00:00.000Z',
});

console.log('verify-sotka-normalizers: OK');
