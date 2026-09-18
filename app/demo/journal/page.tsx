'use client';

import * as React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef, PIPELINE_STATUS_OPTIONS } from '@/components/ui/DataJournal';
import { EntityModal, type EntityFieldConfig } from '@/components/ui/EntityModal';
import { useToast } from '@/components/ui/Toast';
import { Sparkles, Layers } from 'lucide-react';

interface DemoLead {
  id: string;
  client_name: string;
  phone: string;
  store: string;
  amount: number;
  status: 'Открыт' | 'Обработан' | 'Назначен' | 'Подписан' | 'Отмена';
  consultant: string;
  created_at: string;
  comment?: string;
}

const INITIAL_DEMO_LEADS: DemoLead[] = [
  {
    id: 'lead-9482-a01',
    client_name: 'Айбек Исмаилов',
    phone: '+996 555 101 202',
    store: 'ЦУМ — Береке',
    amount: 24500,
    status: 'Открыт',
    consultant: 'Эльдар Жумабеков',
    created_at: '18.09.2026 10:15',
    comment: 'Интересуется подключением тарифа «Премиум» с интеграцией кассы.',
  },
  {
    id: 'lead-8391-b02',
    client_name: 'Камила Токтогулова',
    phone: '+996 700 303 404',
    store: 'Азия Молл — Мода',
    amount: 38000,
    status: 'Обработан',
    consultant: 'Азамат Касымов',
    created_at: '18.09.2026 11:20',
    comment: 'Первичный созвон проведен, отправлена презентация в WhatsApp.',
  },
  {
    id: 'lead-7284-c03',
    client_name: 'Нурлан Касымов',
    phone: '+996 772 505 606',
    store: 'Дордой Моторс — Павильон 4',
    amount: 15000,
    status: 'Назначен',
    consultant: 'Эльдар Жумабеков',
    created_at: '18.09.2026 12:45',
    comment: 'Назначена встреча на торговой точке для подписания договора.',
  },
  {
    id: 'lead-6173-d04',
    client_name: 'Айпери Садыкова',
    phone: '+996 550 707 808',
    store: 'Бишкек Парк — Kids Fashion',
    amount: 45000,
    status: 'Подписан',
    consultant: 'Азамат Касымов',
    created_at: '17.09.2026 14:10',
    comment: 'Договор подписан, продавец успешно привязан к аккаунту.',
  },
  {
    id: 'lead-5062-e05',
    client_name: 'Бакыт Муратов',
    phone: '+996 705 909 010',
    store: 'Орто-Сай — Электроника+',
    amount: 12000,
    status: 'Отмена',
    consultant: 'Эльдар Жумабеков',
    created_at: '17.09.2026 16:30',
    comment: 'Отказ по причине закрытия торговой точки.',
  },
  {
    id: 'lead-4951-f06',
    client_name: 'Динара Осмонова',
    phone: '+996 551 112 233',
    store: 'ГУМ Чынар — Beauty Shop',
    amount: 29000,
    status: 'Открыт',
    consultant: 'Азамат Касымов',
    created_at: '17.09.2026 17:05',
    comment: 'Входящая заявка с таргетированной рекламы Instagram.',
  },
  {
    id: 'lead-3840-g07',
    client_name: 'Руслан Бакиров',
    phone: '+996 770 445 566',
    store: 'Дордой — Ряд 12, Место 88',
    amount: 19500,
    status: 'Обработан',
    consultant: 'Эльдар Жумабеков',
    created_at: '16.09.2026 09:40',
    comment: 'Запросил коммерческое предложение на 3 кассовых аппарата.',
  },
  {
    id: 'lead-2739-h08',
    client_name: 'Чолпон Асанова',
    phone: '+996 500 778 899',
    store: 'Vefa Center — Home Decor',
    amount: 52000,
    status: 'Подписан',
    consultant: 'Азамат Касымов',
    created_at: '16.09.2026 11:15',
    comment: 'Оплата получена в полном объеме, статус связи подтвержден.',
  },
  {
    id: 'lead-1628-i09',
    client_name: 'Улан Мамытов',
    phone: '+996 708 001 122',
    store: 'Аламедин Базар — ОптТорг',
    amount: 16500,
    status: 'Назначен',
    consultant: 'Эльдар Жумабеков',
    created_at: '16.09.2026 13:50',
    comment: 'Перенос встречи по инициативе клиента на 20 сентября.',
  },
  {
    id: 'lead-0517-j10',
    client_name: 'Гульнара Темирова',
    phone: '+996 558 334 455',
    store: 'Таш-Рабат — Cafe Lounge',
    amount: 31000,
    status: 'Открыт',
    consultant: 'Азамат Касымов',
    created_at: '15.09.2026 15:25',
    comment: 'Требуется настройка системы лояльности и чеков.',
  },
  {
    id: 'lead-9406-k11',
    client_name: 'Азат Султанов',
    phone: '+996 779 667 788',
    store: 'Мадина — Ткани & Фурнитура',
    amount: 42000,
    status: 'Обработан',
    consultant: 'Эльдар Жумабеков',
    created_at: '15.09.2026 16:40',
    comment: 'Обсуждение индивидуального процента подключения.',
  },
  {
    id: 'lead-8395-l12',
    client_name: 'Светлана Ким',
    phone: '+996 502 990 011',
    store: 'Beta Stores 2 — Косметика',
    amount: 27500,
    status: 'Подписан',
    consultant: 'Азамат Касымов',
    created_at: '14.09.2026 10:00',
    comment: 'Успешная интеграция с базой 1С.',
  },
  {
    id: 'lead-7284-m13',
    client_name: 'Марат Джумаев',
    phone: '+996 703 223 344',
    store: 'Кудайберген — Автозапчасти 15',
    amount: 18000,
    status: 'Отмена',
    consultant: 'Эльдар Жумабеков',
    created_at: '14.09.2026 12:15',
    comment: 'Выбрали решение от локального банка.',
  },
  {
    id: 'lead-6173-n14',
    client_name: 'Асель Бейшенова',
    phone: '+996 554 556 677',
    store: 'Азия Молл — Ювелирный салон',
    amount: 65000,
    status: 'Назначен',
    consultant: 'Азамат Касымов',
    created_at: '14.09.2026 14:35',
    comment: 'Крупный клиент, согласован выезд старшего менеджера.',
  },
  {
    id: 'lead-5062-o15',
    client_name: 'Эркин Таштемиров',
    phone: '+996 776 889 900',
    store: 'Дордой — Проход 5, Место 19',
    amount: 21000,
    status: 'Обработан',
    consultant: 'Эльдар Жумабеков',
    created_at: '13.09.2026 16:50',
    comment: 'Консультация по тарифам SotkaCRM проведена успешно.',
  },
  {
    id: 'lead-4951-p16',
    client_name: 'Наргиза Сабирова',
    phone: '+996 507 123 789',
    store: 'ЦУМ — Ювелирный ряд 3',
    amount: 48000,
    status: 'Открыт',
    consultant: 'Азамат Касымов',
    created_at: '13.09.2026 17:30',
    comment: 'Новый лид с сайта, ожидает звонка в WhatsApp.',
  },
  {
    id: 'lead-3840-q17',
    client_name: 'Ильгиз Торобеков',
    phone: '+996 709 456 123',
    store: 'Ала-Арча — Flowers Studio',
    amount: 14000,
    status: 'Подписан',
    consultant: 'Эльдар Жумабеков',
    created_at: '12.09.2026 11:20',
    comment: 'Подключен тариф Старт, назначен консультант сопровождения.',
  },
  {
    id: 'lead-2739-r18',
    client_name: 'Зарина Каримова',
    phone: '+996 559 789 456',
    store: 'Дордой Плаза — Оптика',
    amount: 34000,
    status: 'Назначен',
    consultant: 'Азамат Касымов',
    created_at: '12.09.2026 14:00',
    comment: 'Согласование времени установки торгового оборудования.',
  },
  {
    id: 'lead-1628-s19',
    client_name: 'Тариэль Сапаров',
    phone: '+996 773 321 654',
    store: 'Берекет Гранд — Посуда центр',
    amount: 23500,
    status: 'Обработан',
    consultant: 'Эльдар Жумабеков',
    created_at: '11.09.2026 15:45',
    comment: 'Отправлен типовой договор оферты.',
  },
  {
    id: 'lead-0517-t20',
    client_name: 'Алина Мукашева',
    phone: '+996 505 654 987',
    store: 'Бишкек Сити — Детский мир',
    amount: 39000,
    status: 'Подписан',
    consultant: 'Азамат Касымов',
    created_at: '11.09.2026 17:10',
    comment: 'Сделка закрыта, продавец верифицирован.',
  },
  {
    id: 'lead-9406-u21',
    client_name: 'Кубат Орозбаев',
    phone: '+996 701 987 321',
    store: 'Кудайберген — Контейнер 112',
    amount: 17000,
    status: 'Открыт',
    consultant: 'Эльдар Жумабеков',
    created_at: '10.09.2026 09:30',
    comment: 'Уточнение возможности работы с фискальным чеком.',
  },
  {
    id: 'lead-8395-v22',
    client_name: 'Эльвира Сыдыкова',
    phone: '+996 557 234 567',
    store: 'Vefa — Сумки & Аксессуары',
    amount: 28000,
    status: 'Назначен',
    consultant: 'Азамат Касымов',
    created_at: '10.09.2026 11:40',
    comment: 'Встреча в магазине запланирована на пятницу.',
  },
  {
    id: 'lead-7284-w23',
    client_name: 'Адилет Бектурсунов',
    phone: '+996 778 876 543',
    store: 'Ош Базар — Бытовая химия',
    amount: 13500,
    status: 'Отмена',
    consultant: 'Эльдар Жумабеков',
    created_at: '09.09.2026 13:10',
    comment: 'Не устроила стоимость ежемесячного тарифа.',
  },
  {
    id: 'lead-6173-x24',
    client_name: 'Жылдыз Чоробекова',
    phone: '+996 509 345 678',
    store: 'ГУМ — Книжный клуб',
    amount: 22000,
    status: 'Обработан',
    consultant: 'Азамат Касымов',
    created_at: '09.09.2026 15:55',
    comment: 'Заинтересованы в модуле аналитики продаж.',
  },
  {
    id: 'lead-5062-y25',
    client_name: 'Мирлан Жусупов',
    phone: '+996 704 678 901',
    store: 'Дордой — Восток, Ряд 7',
    amount: 55000,
    status: 'Подписан',
    consultant: 'Эльдар Жумабеков',
    created_at: '08.09.2026 16:30',
    comment: 'Подключена сеть из двух торговых павильонов.',
  },
];

export default function DemoJournalPage() {
  const { showToast } = useToast();
  const [leads, setLeads] = React.useState<DemoLead[]>(INITIAL_DEMO_LEADS);

  // Состояние модального окна EntityModal
  const [modalState, setModalState] = React.useState<{
    isOpen: boolean;
    mode: 'view' | 'edit' | 'create';
    selectedLead: DemoLead | null;
  }>({
    isOpen: false,
    mode: 'view',
    selectedLead: null,
  });

  // Конфигурация колонок для DataJournal
  const columns: ColumnDef<DemoLead>[] = [
    {
      key: 'id',
      label: 'ID записи',
      width: 130,
      minWidth: 100,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="font-mono text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          {row.id}
        </span>
      ),
    },
    {
      key: 'client_name',
      label: 'Клиент',
      width: 180,
      minWidth: 140,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          {row.client_name}
        </span>
      ),
    },
    {
      key: 'phone',
      label: 'Телефон',
      type: 'phone',
      width: 160,
      minWidth: 130,
      sortable: true,
      filterable: true,
    },
    {
      key: 'store',
      label: 'Торговая точка',
      width: 180,
      minWidth: 140,
      sortable: true,
      filterable: true,
    },
    {
      key: 'amount',
      label: 'Сумма сделки',
      type: 'currency',
      width: 140,
      minWidth: 120,
      sortable: true,
      filterable: true,
    },
    {
      key: 'status',
      label: 'Статус воронки',
      type: 'status',
      width: 150,
      minWidth: 130,
      sortable: true,
      filterable: true,
      statusOptions: PIPELINE_STATUS_OPTIONS,
    },
    {
      key: 'consultant',
      label: 'Консультант',
      width: 160,
      minWidth: 130,
      sortable: true,
      filterable: true,
    },
    {
      key: 'created_at',
      label: 'Дата создания',
      width: 150,
      minWidth: 120,
      sortable: true,
      filterable: true,
    },
  ];

  // Конфигурация полей для формы EntityModal
  const entityFields: EntityFieldConfig<DemoLead>[] = [
    {
      name: 'id',
      label: 'Системный ID (UUID)',
      immutable: true,
      isSystem: true,
    },
    {
      name: 'created_at',
      label: 'Дата создания',
      immutable: true,
      isSystem: true,
    },
    {
      name: 'client_name',
      label: 'Имя клиента',
      required: true,
      placeholder: 'ФИО клиента',
    },
    {
      name: 'phone',
      label: 'Телефон',
      type: 'phone',
      required: true,
      placeholder: '+996 555 000 000',
    },
    {
      name: 'store',
      label: 'Название торговой точки',
      required: true,
      placeholder: 'Магазин, бутик или ТЦ',
    },
    {
      name: 'amount',
      label: 'Сумма сделки (сом)',
      type: 'currency',
      required: true,
      placeholder: '0',
    },
    {
      name: 'status',
      label: 'Статус воронки',
      type: 'status',
      required: true,
    },
    {
      name: 'consultant',
      label: 'Ответственный консультант',
      type: 'select',
      required: true,
      options: [
        { value: 'Эльдар Жумабеков', label: 'Эльдар Жумабеков' },
        { value: 'Азамат Касымов', label: 'Азамат Касымов' },
        { value: 'Айбек Исмаилов', label: 'Айбек Исмаилов' },
      ],
    },
    {
      name: 'comment',
      label: 'Примечание к сделке',
      type: 'textarea',
      placeholder: 'Детали договоренностей или комментарии...',
    },
  ];

  // Обработчики действий реестра
  const handleRowClick = (lead: DemoLead) => {
    setModalState({
      isOpen: true,
      mode: 'view',
      selectedLead: lead,
    });
  };

  const handleCreateClick = () => {
    setModalState({
      isOpen: true,
      mode: 'create',
      selectedLead: null,
    });
  };

  const handleStatusChangeInJournal = (lead: DemoLead, newStatus: string) => {
    setLeads((prev) =>
      prev.map((item) =>
        item.id === lead.id ? { ...item, status: newStatus as any } : item
      )
    );
  };

  // Обработчики формы EntityModal
  const handleSaveLead = (updated: DemoLead) => {
    setLeads((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    setModalState((prev) => ({ ...prev, selectedLead: updated }));
  };

  const handleCreateLead = (newLeadData: Partial<DemoLead>) => {
    const newId = `lead-${Math.floor(1000 + Math.random() * 9000)}-${Math.random()
      .toString(36)
      .substring(2, 5)}`;
    const now = new Date();
    const formattedDate = `${now.getDate().toString().padStart(2, '0')}.${(
      now.getMonth() + 1
    )
      .toString()
      .padStart(2, '0')}.${now.getFullYear()} ${now
      .getHours()
      .toString()
      .padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const leadToInsert: DemoLead = {
      id: newId,
      client_name: newLeadData.client_name || 'Новый клиент',
      phone: newLeadData.phone || '+996 000 000 000',
      store: newLeadData.store || 'Не указано',
      amount: Number(newLeadData.amount) || 0,
      status: (newLeadData.status as any) || 'Открыт',
      consultant: newLeadData.consultant || 'Эльдар Жумабеков',
      created_at: formattedDate,
      comment: newLeadData.comment || '',
    };

    setLeads((prev) => [leadToInsert, ...prev]);
  };

  const handleStatusChangeInModal = async (newStatus: string) => {
    if (!modalState.selectedLead) return;
    const updated = { ...modalState.selectedLead, status: newStatus as any };
    handleSaveLead(updated);
  };

  const handleLinkSeller = (lead: DemoLead) => {
    showToast(`Инициирована привязка продавца для «${lead.client_name}»`, 'info');
  };

  return (
    <AppLayout userRole="admin" userName="Демо Инженер">
      <div className="space-y-6">
        {/* Информационный баннер стенда */}
        <div className="p-5 rounded-3xl backdrop-blur-xl bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-emerald-500/10 border border-white/20 dark:border-zinc-800/40 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center shadow-md">
              <Layers className="w-6 h-6" strokeWidth={1.75} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  Тестовый полигон DataJournal & EntityModal
                </h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold border border-emerald-500/30">
                  <Sparkles className="w-3 h-3" strokeWidth={2} />
                  Этап 3
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl">
                Интерактивная проверка полиморфного реестра (Таблица / Карточки, drag-to-resize ширин, перестановка колонок, фильтры) и единой гибридной модальной формы (View $\rightarrow$ Edit $\rightarrow$ Create, click-to-copy, QuickActionBar).
              </p>
            </div>
          </div>
        </div>

        {/* Полиморфный реестр DataJournal */}
        <DataJournal<DemoLead>
          data={leads}
          columns={columns}
          keyField="id"
          storageKey="demo_leads"
          title="Реестр лидов (Демо)"
          subtitle="Интерактивная выборка синтетических записей CRM"
          searchPlaceholder="Быстрый поиск по клиенту, телефону или точке..."
          onRowClick={handleRowClick}
          onStatusChange={handleStatusChangeInJournal}
          onCreateClick={handleCreateClick}
        />

        {/* Единая гибридная форма сущности EntityModal */}
        <EntityModal<DemoLead>
          isOpen={modalState.isOpen}
          onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
          initialMode={modalState.mode}
          title={modalState.selectedLead?.client_name}
          data={modalState.selectedLead}
          fields={entityFields}
          keyField="id"
          phoneField="phone"
          statusField="status"
          statusOptions={PIPELINE_STATUS_OPTIONS}
          onSave={handleSaveLead}
          onCreate={handleCreateLead}
          onStatusChange={handleStatusChangeInModal}
          onLinkSeller={handleLinkSeller}
        />
      </div>
    </AppLayout>
  );
}
