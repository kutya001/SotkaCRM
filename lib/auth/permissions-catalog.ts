/**
 * Каталог прав доступа SotkaCRM (ролевая модель, миграция 040).
 *
 * Права сгруппированы по модулям; каждое право — отдельный ключ вида «модуль.действие».
 * Роль — набор ключей (таблица role_permissions). Роль с признаком is_admin имеет все права
 * всегда, включая добавленные позже ключи.
 *
 * Семантика области данных: право «<модуль>.view_all» открывает все записи модуля,
 * без него сотрудник видит только свои (назначенные ему или созданные им).
 * Остальные права действуют в пределах видимой области.
 *
 * Файл чистый (без импортов) — используется и на сервере, и в браузере, и в скриптах.
 */

export interface PermissionDef {
  key: string;
  label: string;
  hint?: string;
}

export interface PermissionModule {
  id: string;
  title: string;
  permissions: PermissionDef[];
}

export const LEAD_STATUS_KEYS = ['Открыт', 'Обработан', 'Назначен', 'Подписан', 'Отмена'] as const;

export const PERMISSION_MODULES: PermissionModule[] = [
  {
    id: 'dashboard',
    title: 'Главная (дашборд)',
    permissions: [
      { key: 'dashboard.menu', label: 'Видеть в меню и открывать', hint: 'Сводка KPI, воронка и активность' },
    ],
  },
  {
    id: 'leads',
    title: 'Лиды',
    permissions: [
      { key: 'leads.menu', label: 'Видеть в меню и открывать модуль' },
      { key: 'leads.view_all', label: 'Видеть все лиды', hint: 'Без этого права — только свои (созданные или назначенные)' },
      { key: 'leads.create', label: 'Создавать лиды' },
      { key: 'leads.edit', label: 'Полностью редактировать карточку', hint: 'Имя, телефон, Instagram и прочие поля' },
      { key: 'leads.comment', label: 'Редактировать комментарий', hint: 'Если нет полного редактирования' },
      { key: 'leads.assign', label: 'Назначать ответственного консультанта' },
      ...LEAD_STATUS_KEYS.map((status) => ({
        key: `leads.status.${status}`,
        label: `Переводить в статус «${status}»`,
      })),
      { key: 'leads.rollback', label: 'Откатывать статус назад', hint: 'Возврат на более ранний этап воронки или из «Отмена»' },
      { key: 'leads.link_seller', label: 'Связывать лид с продавцом' },
      { key: 'leads.unlink_seller', label: 'Отвязывать лид от продавца' },
      { key: 'leads.delete', label: 'Удалять лиды' },
      { key: 'leads.bulk', label: 'Массовые действия', hint: 'Выбор строк: смена статуса, назначение, удаление' },
      { key: 'leads.scripts', label: 'Открывать скрипты продаж' },
    ],
  },
  {
    id: 'sellers',
    title: 'Продавцы',
    permissions: [
      { key: 'sellers.menu', label: 'Видеть в меню и открывать модуль' },
      { key: 'sellers.view_all', label: 'Видеть всех продавцов', hint: 'Без этого права — свои и свободные одобренные' },
      { key: 'sellers.create', label: 'Создавать продавцов вручную' },
      { key: 'sellers.edit', label: 'Редактировать карточку продавца' },
      { key: 'sellers.assign', label: 'Назначать и снимать консультанта' },
      { key: 'sellers.take', label: 'Брать свободного продавца себе', hint: 'Подключение ждет подтверждения администратора' },
      { key: 'sellers.link_lead', label: 'Связывать продавца с лидом' },
      { key: 'sellers.unlink_lead', label: 'Отвязывать лид от продавца' },
      { key: 'sellers.transactions', label: 'Видеть транзакции Sotka HQ' },
      { key: 'sellers.sync', label: 'Запускать синхронизацию API Sotka HQ' },
      { key: 'sellers.delete', label: 'Удалять продавцов' },
      { key: 'sellers.bulk', label: 'Массовые действия' },
    ],
  },
  {
    id: 'connections',
    title: 'Подключения',
    permissions: [
      { key: 'connections.menu', label: 'Видеть в меню и открывать модуль' },
      { key: 'connections.view_all', label: 'Видеть все подключения', hint: 'Без этого права — только свои' },
      { key: 'connections.create', label: 'Создавать подключения' },
      { key: 'connections.edit', label: 'Редактировать подключение', hint: 'Статус клиента, тариф, цена, срок сопровождения, дата' },
      { key: 'connections.confirm', label: 'Подтверждать и отклонять подключения' },
      { key: 'connections.accrue', label: 'Запускать начисления', hint: 'Бонусы за подключение и сопровождение' },
      { key: 'connections.accruals_edit', label: 'Редактировать и удалять проводки начислений' },
      { key: 'connections.delete', label: 'Удалять подключения' },
      { key: 'connections.bulk', label: 'Массовые действия' },
    ],
  },
  {
    id: 'payouts',
    title: 'Операции по ЗП',
    permissions: [
      { key: 'payouts.menu', label: 'Видеть в меню и открывать модуль' },
      { key: 'payouts.view_all', label: 'Видеть операции всех сотрудников', hint: 'Без этого права — только свои' },
      { key: 'payouts.create', label: 'Создавать операции' },
      { key: 'payouts.edit', label: 'Редактировать операции' },
      { key: 'payouts.status', label: 'Менять статус операции', hint: 'Ожидает / проведена / оплачена' },
      { key: 'payouts.calculate', label: 'Рассчитывать начисления' },
      { key: 'payouts.delete', label: 'Удалять операции' },
      { key: 'payouts.bulk', label: 'Массовые действия' },
    ],
  },
  {
    id: 'plans',
    title: 'Тарифы и ставки',
    permissions: [
      { key: 'plans.menu', label: 'Видеть в меню и открывать модуль' },
      { key: 'plans.manage', label: 'Создавать, редактировать и удалять тарифы', hint: 'Включая историю цен' },
      { key: 'rates.manage', label: 'Управлять персональными ставками сотрудников' },
    ],
  },
  {
    id: 'analytics',
    title: 'Аналитика',
    permissions: [
      { key: 'analytics.menu', label: 'Видеть в меню и открывать модуль' },
      { key: 'analytics.view_all', label: 'Видеть показатели по всем сотрудникам', hint: 'Без этого права — только свои' },
      { key: 'analytics.employees', label: 'Видеть KPI сотрудников' },
      { key: 'analytics.export', label: 'Экспортировать отчеты' },
    ],
  },
  {
    id: 'employees',
    title: 'Сотрудники',
    permissions: [
      { key: 'employees.menu', label: 'Видеть в меню и открывать модуль' },
      { key: 'employees.create', label: 'Создавать сотрудников' },
      { key: 'employees.edit', label: 'Редактировать сотрудников', hint: 'Анкета, цвет, роль' },
      { key: 'employees.deactivate', label: 'Блокировать и разблокировать' },
      { key: 'employees.reset_password', label: 'Сбрасывать пароли' },
      { key: 'employees.roles', label: 'Управлять ролями и доступами' },
    ],
  },
  {
    id: 'tasks',
    title: 'Задачи',
    permissions: [
      { key: 'tasks.menu', label: 'Видеть в меню и открывать модуль' },
      { key: 'tasks.view_all', label: 'Видеть все задачи', hint: 'Без этого права — назначенные мне и созданные мной' },
      { key: 'tasks.create', label: 'Создавать задачи' },
      { key: 'tasks.assign', label: 'Назначать задачи другим сотрудникам' },
      { key: 'tasks.edit_any', label: 'Редактировать чужие задачи' },
      { key: 'tasks.status_any', label: 'Менять статус чужих задач' },
      { key: 'tasks.delete', label: 'Удалять задачи', hint: 'Свои задачи автор удаляет всегда' },
    ],
  },
  {
    id: 'goals',
    title: 'Планы по подключениям',
    permissions: [
      { key: 'goals.menu', label: 'Видеть в меню и открывать модуль' },
      { key: 'goals.view_all', label: 'Видеть персональные планы всех сотрудников', hint: 'Без этого права — общие и свои' },
      { key: 'goals.manage', label: 'Ставить, менять и удалять планы' },
    ],
  },
  {
    id: 'telegram',
    title: 'Telegram',
    permissions: [
      { key: 'telegram.menu', label: 'Видеть в меню и открывать модуль' },
      { key: 'telegram.manage', label: 'Управлять привязками и журналом сообщений' },
      { key: 'telegram.broadcast', label: 'Делать рассылки' },
    ],
  },
  {
    id: 'system',
    title: 'Система',
    permissions: [
      { key: 'docs.menu', label: 'Открывать документацию API' },
      { key: 'profile.others', label: 'Открывать профили других сотрудников' },
    ],
  },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_MODULES.flatMap((m) => m.permissions.map((p) => p.key));

export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_MODULES.flatMap((m) => m.permissions.map((p) => [p.key, `${m.title}: ${p.label}`]))
);

export function isKnownPermission(key: string): boolean {
  return ALL_PERMISSION_KEYS.includes(key);
}

/** Коды системных ролей (4 роли по умолчанию, редактируемые) */
export type SystemRoleCode = 'admin' | 'founder' | 'smm' | 'consultant';

/** Соответствие устаревшего enum user_role системным ролям (для бэкфилла и запасного режима) */
export const LEGACY_ROLE_TO_CODE: Record<'admin' | 'supervisor' | 'consultant' | 'smm', SystemRoleCode> = {
  admin: 'admin',
  supervisor: 'founder',
  consultant: 'consultant',
  smm: 'smm',
};

export const SYSTEM_ROLE_NAMES: Record<SystemRoleCode, string> = {
  admin: 'Администратор',
  founder: 'Учредитель',
  smm: 'СММ',
  consultant: 'Консультант',
};

const ALL_MENU = PERMISSION_MODULES.map((m) => m.permissions.find((p) => p.key.endsWith('.menu'))?.key).filter(
  (k): k is string => Boolean(k)
);
const ALL_VIEW_ALL = ALL_PERMISSION_KEYS.filter((k) => k.endsWith('.view_all'));

/** Права системных ролей по умолчанию (admin получает все автоматически через is_admin) */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleCode, string[]> = {
  admin: [...ALL_PERMISSION_KEYS],
  founder: [
    ...ALL_MENU,
    ...ALL_VIEW_ALL,
    'leads.scripts',
    'sellers.transactions',
    'analytics.employees',
    'analytics.export',
    'tasks.create',
    'tasks.assign',
    'tasks.edit_any',
    'tasks.status_any',
    'tasks.delete',
    'goals.manage',
    'docs.menu',
    'profile.others',
  ],
  smm: [
    'leads.menu',
    'leads.create',
    'leads.edit',
    'leads.comment',
    'leads.status.Открыт',
    'leads.status.Обработан',
    'leads.status.Отмена',
    'leads.rollback',
    'leads.scripts',
    'payouts.menu',
    'tasks.menu',
    'tasks.create',
  ],
  consultant: [
    'dashboard.menu',
    'leads.menu',
    'leads.comment',
    'leads.status.Подписан',
    'leads.status.Отмена',
    'leads.link_seller',
    'leads.scripts',
    'sellers.menu',
    'sellers.take',
    'sellers.link_lead',
    'sellers.transactions',
    'connections.menu',
    'payouts.menu',
    'analytics.menu',
    'tasks.menu',
    'tasks.create',
    'goals.menu',
  ],
};

/** Порядок этапов воронки лидов для определения «отката» статуса */
export const LEAD_STAGE_ORDER: Record<string, number> = {
  Открыт: 0,
  Обработан: 1,
  Назначен: 2,
  Подписан: 3,
};

/** Переход считается откатом, если целевой этап раньше текущего либо лид возвращается из «Отмена» */
export function isLeadStatusRollback(from: string, to: string): boolean {
  if (from === to) return false;
  if (from === 'Отмена') return true;
  if (to === 'Отмена') return false;
  return (LEAD_STAGE_ORDER[to] ?? 0) < (LEAD_STAGE_ORDER[from] ?? 0);
}
