/**
 * Пошаговое обучение по модулям (туры интерфейса): какие элементы подсвечиваются и что о них сказать.
 *
 * Шаг указывает элемент атрибутом data-tour (target) — разметка в DataJournal, оболочке и страницах.
 * Без target шаг — карточка по центру экрана. Шаг с permission показывается только роли с этим правом;
 * шаг, чей элемент не найден на экране (нет записей, другой вид, телефон), пропускается сам.
 * waitForClick — «нажмите сюда»: тур ждет нажатия по подсвеченному элементу (или «Далее»).
 *
 * Прохождение хранится в onboarding_progress (миграция 049) по id тура; меняя шаги тура заметно,
 * увеличьте version — администратор видит версию в отчете. Файл чистый (без импортов).
 */

export interface TourStep {
  id: string;
  /** Значение data-tour подсвечиваемого элемента; без него — карточка по центру */
  target?: string;
  title: string;
  body: string;
  /** Текст для телефона, если отличается */
  bodyMobile?: string;
  /** Шаг только для роли с этим правом */
  permission?: string;
  /** Ждать нажатия по подсвеченному элементу */
  waitForClick?: boolean;
}

export interface TourDef {
  id: string;
  /** Маршрут модуля; '*' — общий тур оболочки (запускается первым на любой странице) */
  route: string;
  title: string;
  /** Право на открытие модуля: без него тур не нужен сотруднику */
  permission: string | null;
  version: number;
  steps: TourStep[];
}

/** Значение tour_id «обучение отключено целиком» */
export const ALL_TOURS_ID = 'all';

const STEP_HELP: TourStep = {
  id: 'help',
  target: 'help',
  title: 'Подсказки всегда под «?»',
  body: 'Описание модуля и советы по работе. Там же — «Пройти обучение заново» и «Что нового».',
};

const rowStep = (body: string, bodyMobile?: string): TourStep => ({
  id: 'row',
  target: 'journal-row',
  title: 'Запись',
  body,
  bodyMobile,
});

export const TOURS: TourDef[] = [
  {
    id: 'welcome',
    route: '*',
    title: 'Знакомство с SotkaCRM',
    permission: null,
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Добро пожаловать в SotkaCRM',
        body: 'Короткое обучение покажет, где что находится. В каждом модуле при первом открытии появятся свои подсказки — под вашу роль. Пропустить можно в любой момент.',
      },
      {
        id: 'nav',
        target: 'nav',
        title: 'Разделы',
        body: 'Меню слева — модули, доступные вашей роли. Свернуть меню можно кнопкой вверху.',
        bodyMobile: 'Нижняя панель — главные модули. Нажмите, чтобы перейти.',
      },
      {
        id: 'menu',
        target: 'menu',
        title: 'Все разделы',
        body: 'Полный список модулей, профиль и выход из аккаунта.',
      },
      {
        id: 'search',
        target: 'search',
        title: 'Поиск',
        body: 'Ищет по открытому модулю: имя, телефон, заметка.',
      },
      {
        id: 'create',
        target: 'create',
        title: 'Добавить запись',
        body: 'Кнопка «+» создает запись в открытом модуле, если ваша роль это позволяет.',
      },
      {
        id: 'version',
        target: 'version',
        title: 'Версия и «Что нового»',
        body: 'Номер версии приложения. Нажмите, чтобы посмотреть, что изменилось.',
      },
      STEP_HELP,
      {
        id: 'done',
        title: 'Готово',
        body: 'Дальше подсказки появятся в каждом модуле при первом открытии. Пройти обучение заново можно в окне «?».',
      },
    ],
  },
  {
    id: 'dashboard',
    route: '/',
    title: 'Главная',
    permission: 'dashboard.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Главная',
        body: 'Сводка: лиды, подключения и начисления. Карточки показателей ведут в свои модули. Без права «видеть все» показатели считаются только по вашим данным.',
      },
      STEP_HELP,
    ],
  },
  {
    id: 'leads',
    route: '/leads',
    title: 'Лиды',
    permission: 'leads.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Лиды — входящие заявки',
        body: 'Воронка: Открыт → Обработан → Назначен → Подписан или Отмена. «Подписан» ставится только привязкой к продавцу, «Отмена» требует причину.',
      },
      {
        id: 'tabs',
        target: 'journal-tabs',
        title: 'Этапы воронки',
        body: 'Вкладки — быстрый фильтр по статусу; число — сколько лидов на этапе.',
      },
      {
        id: 'create',
        target: 'create',
        title: 'Новый лид',
        body: 'Добавьте заявку: имя, телефон, первый комментарий.',
        bodyMobile: 'Круглая кнопка «+» добавляет заявку: имя, телефон, первый комментарий.',
        permission: 'leads.create',
      },
      {
        id: 'view',
        target: 'journal-view',
        title: 'Таблица, карточки, канбан',
        body: 'Переключает вид списка. В канбане карточки перетаскиваются между статусами и ответственными.',
        bodyMobile: 'Кнопка переключает вид: таблица, карточки, канбан. В канбане карточку переносят, удерживая ее.',
      },
      {
        id: 'scripts',
        target: 'leads-scripts',
        title: 'Скрипты продаж',
        body: 'Готовые сообщения в порядке диалога и шпаргалка по тарифам. Нажатие на карточку скрипта копирует текст.',
        permission: 'leads.scripts',
      },
      {
        id: 'whatsapp',
        target: 'row-whatsapp',
        title: 'WhatsApp',
        body: 'Открывает чат с клиентом: без текста или по скрипту — имя клиента и ваше имя подставятся сами.',
      },
      {
        id: 'open',
        target: 'journal-row',
        title: 'Откройте лид',
        body: 'Нажмите на лид — откроется его карточка.',
        waitForClick: true,
      },
      {
        id: 'comment',
        target: 'lead-comment-button',
        title: 'Комментарии',
        body: 'История комментариев: кто, когда и что писал. Здесь же быстро добавляется новый комментарий — например, итог звонка.',
      },
      {
        id: 'status',
        title: 'Статус и привязка',
        body: 'Статус меняется кнопками в карточке лида или списком в строке. Когда клиент зарегистрировался на платформе, нажмите «Привязать» и выберите продавца.',
      },
      STEP_HELP,
    ],
  },
  {
    id: 'sellers',
    route: '/sellers',
    title: 'Продавцы',
    permission: 'sellers.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Продавцы платформы',
        body: 'Организации Sotka из Sotka HQ: баланс, итоги транзакций и подписка («Подписка активна», «Без подписки»).',
      },
      {
        id: 'sync',
        target: 'sellers-sync',
        title: 'Синхронизация',
        body: 'Загружает свежие данные из Sotka HQ. Итоги транзакций обновляются в фоне.',
        permission: 'sellers.sync',
      },
      {
        id: 'tabs',
        target: 'journal-tabs',
        title: 'Подборки',
        body: 'Вкладки — быстрые фильтры: свободные, мои и другие подборки.',
      },
      {
        id: 'stats',
        target: 'journal-stats',
        title: 'Показатели',
        body: 'Показывает или скрывает плитки. Плитки «С подпиской» и «Без подписки» работают как фильтр.',
      },
      rowStep(
        'Нажмите на продавца, чтобы открыть карточку. Правая кнопка мыши или «⋯» — меню: «Подключить…», «Связать с лидом».',
        'Нажмите на продавца, чтобы открыть карточку. Значки внизу карточки — действия: подключить, связать с лидом.'
      ),
      STEP_HELP,
    ],
  },
  {
    id: 'connections',
    route: '/connections',
    title: 'Подключения',
    permission: 'connections.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Подключения',
        body: 'Закрепление продавца за сотрудниками: до трех участников, бонус делится поровну. Начисление создается после подтверждения администратором.',
      },
      {
        id: 'tabs',
        target: 'journal-tabs',
        title: 'Ожидают подтверждения',
        body: 'Вкладка «Ожидают» — подключения, которые ждут решения администратора.',
      },
      {
        id: 'confirm',
        title: 'Подтверждение',
        body: 'Подтвердите или отклоните подключение из меню строки; отклонение требует причину. Запрос приходит и в Telegram со ссылкой «Подтвердить».',
        permission: 'connections.confirm',
      },
      rowStep('Меню строки — «Сотрудники подключения…»: участники и сопровождающие по каждому месяцу.'),
      {
        id: 'view',
        target: 'journal-view',
        title: 'Вид списка',
        body: 'Таблица или карточки — выбор запоминается.',
      },
      STEP_HELP,
    ],
  },
  {
    id: 'payouts',
    route: '/payouts',
    title: 'Операции по ЗП',
    permission: 'payouts.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Операции по ЗП',
        body: 'Начисления, удержания и выплаты по расчетным месяцам. Начисления за подключения появляются здесь автоматически.',
      },
      {
        id: 'tabs',
        target: 'journal-tabs',
        title: 'Тип операции',
        body: 'Вкладки делят операции: начисления, удержания, выплаты.',
      },
      {
        id: 'stats',
        target: 'journal-stats',
        title: 'Итоги и сальдо',
        body: 'Сумма за период и сальдо на начало и конец месяца.',
      },
      {
        id: 'create',
        target: 'create',
        title: 'Новая операция',
        body: 'Начисление, удержание или выплата сотруднику.',
        permission: 'payouts.create',
      },
      STEP_HELP,
    ],
  },
  {
    id: 'employees',
    route: '/employees',
    title: 'Сотрудники',
    permission: 'employees.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Сотрудники',
        body: 'Учетные записи CRM, роли и доступы. Отключенные сотрудники скрыты до кнопки «Показать отключенных».',
      },
      {
        id: 'sections',
        target: 'employees-sections',
        title: 'Разделы',
        body: '«Роли — Доступы» — права каждой роли по модулям. «Обучение» — кто какие инструкции прошел.',
      },
      {
        id: 'create',
        target: 'create',
        title: 'Новый сотрудник',
        body: 'Логин, пароль, роль. Пароль можно отправить в Telegram при сбросе.',
        permission: 'employees.create',
      },
      rowStep('Меню строки: изменить анкету, сбросить пароль, заблокировать.'),
      STEP_HELP,
    ],
  },
  {
    id: 'plans',
    route: '/plans',
    title: 'Тарифы',
    permission: 'plans.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Тарифы',
        body: 'Каталог тарифных планов и история цен: новая цена добавляется с датой начала, прошлые сохраняются.',
      },
      {
        id: 'create',
        target: 'create',
        title: 'Новый тариф',
        body: 'Название, цена и дата начала действия.',
        permission: 'plans.manage',
      },
      rowStep('Нажмите на тариф, чтобы открыть карточку и историю цен.'),
      STEP_HELP,
    ],
  },
  {
    id: 'rates',
    route: '/rates',
    title: 'Персональные ставки',
    permission: 'employees.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Персональные ставки',
        body: 'Индивидуальные проценты и ставки сотрудников. Они применяются при расчете начислений.',
      },
      rowStep('Нажмите на ставку, чтобы открыть или изменить ее.'),
      STEP_HELP,
    ],
  },
  {
    id: 'analytics',
    route: '/analytics',
    title: 'Аналитика',
    permission: 'analytics.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Аналитика',
        body: 'Воронка лидов, клиентская база и фонд выплат за выбранный период. Период и разрез по сотрудникам задаются в панели фильтров на странице.',
      },
      STEP_HELP,
    ],
  },
  {
    id: 'tasks',
    route: '/tasks',
    title: 'Задачи',
    permission: 'tasks.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Задачи',
        body: 'Поручения и сроки. Ответственный получает уведомление в Telegram при назначении.',
      },
      {
        id: 'tabs',
        target: 'journal-tabs',
        title: 'Статусы задач',
        body: 'Вкладки — фильтр по статусу задачи.',
      },
      {
        id: 'create',
        target: 'create',
        title: 'Новая задача',
        body: 'Что сделать, кому и к какому сроку.',
        permission: 'tasks.create',
      },
      rowStep('Нажмите на задачу, чтобы открыть ее. Статус меняется в строке, в карточке или массово.'),
      STEP_HELP,
    ],
  },
  {
    id: 'goals',
    route: '/goals',
    title: 'Планы',
    permission: 'goals.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Планы по подключениям',
        body: 'Персональные планы и общий план команды. Факт — подтвержденные подключения за период.',
      },
      {
        id: 'create',
        target: 'create',
        title: 'Новый план',
        body: 'Сотрудник (или вся команда), период и число подключений.',
        permission: 'goals.manage',
      },
      rowStep('Прогресс считается автоматически по подтвержденным подключениям.'),
      STEP_HELP,
    ],
  },
  {
    id: 'telegram',
    route: '/telegram',
    title: 'Telegram',
    permission: 'telegram.menu',
    version: 1,
    steps: [
      {
        id: 'intro',
        title: 'Telegram',
        body: 'Журнал уведомлений сотрудникам, рассылка и привязка Telegram-аккаунтов. Свои уведомления сотрудник подключает в профиле.',
      },
      {
        id: 'tabs',
        target: 'journal-tabs',
        title: 'Разделы',
        body: 'Журнал сообщений и подключения сотрудников.',
      },
      rowStep('Неотправленное сообщение можно повторить из меню строки.'),
      STEP_HELP,
    ],
  },
];

/** Тур модуля для маршрута (без общего тура оболочки) */
export function tourForPath(pathname: string): TourDef | null {
  if (pathname === '/') return TOURS.find((t) => t.route === '/') || null;
  return TOURS.find((t) => t.route !== '*' && t.route !== '/' && (pathname === t.route || pathname.startsWith(`${t.route}/`))) || null;
}

export function tourById(id: string): TourDef | null {
  return TOURS.find((t) => t.id === id) || null;
}

/** Тур нужен сотруднику: модуль ему доступен */
export function isTourAvailable(tour: TourDef, can: (key: string) => boolean): boolean {
  return !tour.permission || can(tour.permission);
}

/** Шаги тура для роли сотрудника (по правам) */
export function stepsFor(tour: TourDef, can: (key: string) => boolean): TourStep[] {
  return tour.steps.filter((s) => !s.permission || can(s.permission));
}
