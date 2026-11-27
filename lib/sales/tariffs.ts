/**
 * Тарифы платформы Sotka.kg для скриптов продаж (источник — страница «Тарифы» платформы).
 * Цены и состав меняются здесь: скрипты о тарифах и шпаргалка строятся из этого списка.
 * Продавец выбирает тариф при регистрации, оплата списывается с баланса помесячно (за 30 дней).
 */
export interface PlatformTariff {
  id: 'basic' | 'premium' | 'business';
  name: string;
  /** Цена за период, сом */
  price: number;
  periodDays: number;
  /** Точек продаж в тарифе (можно расширить) */
  points: number;
  /** Сотрудников в тарифе */
  employees: number;
  modules: string[];
  /** Что входит (как на странице тарифов) */
  features: string[];
}

export const PLATFORM_TARIFFS: PlatformTariff[] = [
  {
    id: 'basic',
    name: 'Базовый',
    price: 1499,
    periodDays: 30,
    points: 1,
    employees: 2,
    modules: ['Склад', 'Продажи', 'Аналитика'],
    features: [
      'Полный набор основных возможностей — доступен в любом тарифе',
      'Одна точка продажи с возможностью расширения',
      'До 2 сотрудников',
    ],
  },
  {
    id: 'premium',
    name: 'Премиум',
    price: 2599,
    periodDays: 30,
    points: 2,
    employees: 6,
    modules: ['Склад', 'Продажи', 'Рассрочки', 'Аналитика'],
    features: [
      'Полный набор основных возможностей',
      'Две точки продажи с возможностью расширения',
      'До 6 сотрудников',
      'SMS-напоминания клиентам-должникам по рассрочкам',
      'Ручное напоминание через WhatsApp клиентам-должникам по рассрочкам',
    ],
  },
  {
    id: 'business',
    name: 'Бизнес',
    price: 4999,
    periodDays: 30,
    points: 3,
    employees: 30,
    modules: ['Склад', 'Продажи', 'Рассрочки', 'Аналитика'],
    features: [
      'Полный набор основных возможностей',
      'Три точки продажи с возможностью расширения',
      'До 30 сотрудников',
      'SMS-напоминания клиентам-должникам по рассрочкам',
      'Ручное напоминание через WhatsApp клиентам-должникам по рассрочкам',
      'Автоматическое определение модели телефона по IMEI при закупе',
    ],
  },
];

/** «1 499 сом» */
export function formatTariffPrice(price: number): string {
  return `${price.toLocaleString('ru-RU').replace(/ /g, ' ')} сом`;
}

export function tariffById(id: PlatformTariff['id']): PlatformTariff {
  const tariff = PLATFORM_TARIFFS.find((t) => t.id === id);
  if (!tariff) throw new Error(`Неизвестный тариф: ${id}`);
  return tariff;
}

/** Склонение: 1 точка, 2 точки, 5 точек */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
