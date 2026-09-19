'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef, type StatusOption } from '@/components/ui/DataJournal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import {
  getConnections,
  getConnectionsStats,
  updateConnectionClientStatus,
  getAccrualMonthsList,
  type ConnectionItem,
  type ConnectionsStats,
} from './actions';
import {
  generateMonthlyMaintenanceAccruals,
  type MaintenanceAccrualResult,
} from './maintenance-actions';
import {
  Link2,
  Phone,
  MessageCircle,
  Calendar,
  ShieldAlert,
  RotateCcw,
  Store,
  Layers,
  X,
  Banknote,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { ClientLifecycleStatus, UserRole } from '@/types/database.types';

const CLIENT_STATUS_OPTIONS: StatusOption[] = [
  {
    value: 'новый',
    label: 'Новый',
    colorClass: 'bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  {
    value: 'подключен',
    label: 'Подключен',
    colorClass: 'bg-cyan-500/10 dark:bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
  },
  {
    value: 'сопровождение',
    label: 'Сопровождение',
    colorClass: 'bg-purple-500/10 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20',
  },
  {
    value: 'готов',
    label: 'Готов (Выплачен)',
    colorClass: 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  {
    value: 'отменен',
    label: 'Отменен',
    colorClass: 'bg-rose-500/10 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20',
  },
];

export default function ConnectionsPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [connections, setConnections] = React.useState<ConnectionItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>('consultant');
  const [userName, setUserName] = React.useState('Сотрудник CRM');
  const [userLogin, setUserLogin] = React.useState('user');

  // Статистика
  const [stats, setStats] = React.useState<ConnectionsStats>({
    total: 0,
    newThisMonth: 0,
    inMaintenance: 0,
    totalBonusAmount: 0,
  });

  // Поиск и Фильтры (ЯРУС 1)
  const [searchQuery, setSearchQuery] = React.useState('');
  const [accrualMonths, setAccrualMonths] = React.useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = React.useState<string>('all');
  const [selectedStatus, setSelectedStatus] = React.useState<string>('all');

  // Модальное окно просмотра / смены статуса
  const [selectedConnection, setSelectedConnection] = React.useState<ConnectionItem | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = React.useState(false);
  const [statusToUpdate, setStatusToUpdate] = React.useState<ClientLifecycleStatus>('новый');

  // Модальное окно биллинга сопровождения
  const [isBillingModalOpen, setIsBillingModalOpen] = React.useState(false);
  const [isBillingLoading, setIsBillingLoading] = React.useState(false);
  const [billingMonth, setBillingMonth] = React.useState(new Date().toISOString().substring(0, 7));
  const [billingResult, setBillingResult] = React.useState<MaintenanceAccrualResult | null>(null);

  // Загрузка данных
  const fetchData = React.useCallback(async (month?: string, status?: string) => {
    setIsLoading(true);
    try {
      const monthFilter = month !== undefined ? month : selectedMonth;
      const statusFilter = status !== undefined ? status : selectedStatus;

      const [res, statsRes, monthsRes] = await Promise.all([
        getConnections({
          page: 1,
          pageSize: 100,
          accrualMonth: monthFilter !== 'all' ? monthFilter : undefined,
          clientStatus: statusFilter !== 'all' ? statusFilter : undefined,
        }),
        getConnectionsStats(),
        getAccrualMonthsList(),
      ]);

      if (res.currentUserRole === 'smm') {
        setCurrentUserRole('smm');
        setIsLoading(false);
        return;
      }

      setConnections(res.connections);
      setTotalCount(res.totalCount);
      setStats(statsRes);
      setAccrualMonths(monthsRes);

      if (res.currentUserRole) {
        setCurrentUserRole(res.currentUserRole);
      }
    } catch (err) {
      console.error('Failed to load connections:', err);
      showToast('Ошибка при загрузке реестра подключений', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, selectedStatus, showToast]);

  // Проверка сессии при старте
  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('full_name, role, login')
          .eq('auth_id', user.id)
          .single();

        if (profile) {
          setUserName(profile.full_name);
          setUserLogin(profile.login || 'user');
          setCurrentUserRole(profile.role as UserRole);
        }
      }
    });

    fetchData();
  }, [fetchData]);

  // Обработчик изменения месяца
  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedMonth(val);
    fetchData(val, selectedStatus);
  };

  // Обработчик изменения статуса
  const handleStatusFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedStatus(val);
    fetchData(selectedMonth, val);
  };

  // Открытие модального окна для просмотра
  const handleRowClick = (connection: ConnectionItem) => {
    setSelectedConnection(connection);
    setStatusToUpdate(connection.client_status);
  };

  // Сохранение нового статуса сопровождения (строго admin)
  const handleSaveStatus = async () => {
    if (!selectedConnection) return;
    setIsUpdatingStatus(true);
    try {
      const res = await updateConnectionClientStatus(
        selectedConnection.connection_id,
        statusToUpdate
      );

      if (res.success) {
        showToast('Статус клиента успешно обновлен', 'success');
        setSelectedConnection((prev) =>
          prev ? { ...prev, client_status: statusToUpdate } : null
        );
        fetchData();
      } else {
        showToast(res.error || 'Ошибка при обновлении статуса', 'error');
      }
    } catch {
      showToast('Не удалось обновить статус', 'error');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Запуск ежемесячного биллинга сопровождения
  const handleRunMaintenanceBilling = async () => {
    setIsBillingLoading(true);
    try {
      const result = await generateMonthlyMaintenanceAccruals(billingMonth);
      setBillingResult(result);
      if (result.success) {
        showToast(
          `Биллинг завершен: начислено ${result.count} клиентам на сумму ${result.totalAmount} сом`,
          'success'
        );
        fetchData();
      } else {
        showToast(result.error || 'Ошибка при проведении биллинга', 'error');
      }
    } catch {
      showToast('Сбой при проведении начислений', 'error');
    } finally {
      setIsBillingLoading(false);
    }
  };

  // Если пользователь SMM — доступ закрыт
  if (currentUserRole === 'smm') {
    return (
      <AppLayout userRole="smm" userName={userName} userLogin={userLogin}>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
          <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 mb-4">
            <ShieldAlert className="w-8 h-8" strokeWidth={1.75} />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            Доступ к разделу ограничен
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 max-w-md">
            Реестр подключений и начислений комиссий доступен исключительно продавцам-консультантам и администраторам системы.
          </p>
          <button
            onClick={() => router.push('/leads')}
            className="mt-6 h-10 px-5 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shadow-md transition-all active:scale-95"
          >
            Вернуться к лидам
          </button>
        </div>
      </AppLayout>
    );
  }

  // Конфигурация колонок DataJournal
  const columns: ColumnDef<ConnectionItem>[] = [
    {
      key: 'seller_name',
      label: 'Продавец / Магазин',
      width: 220,
      minWidth: 180,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <div className="flex flex-col">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs truncate">
            {row.seller_name}
          </span>
          <div className="flex items-center gap-1 text-[11px] text-zinc-400 mt-0.5">
            <Store className="w-3 h-3 flex-shrink-0" strokeWidth={1.5} />
            <span className="truncate">{row.store || 'Без магазина'}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'seller_phone',
      label: 'Телефон',
      width: 170,
      minWidth: 150,
      sortable: true,
      filterable: true,
      type: 'phone',
      phoneAccessor: (row) => row.seller_phone,
      renderCell: (row) => {
        const cleanPhone = row.seller_phone.replace(/\D/g, '');
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">
              +{row.seller_phone}
            </span>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <a
                href={`https://wa.me/${cleanPhone}`}
                target="_blank"
                rel="noreferrer"
                title="Написать в WhatsApp"
                className="w-6 h-6 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
              </a>
              <a
                href={`tel:+${cleanPhone}`}
                title="Позвонить"
                className="w-6 h-6 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 flex items-center justify-center transition-colors"
              >
                <Phone className="w-3.5 h-3.5" strokeWidth={1.75} />
              </a>
            </div>
          </div>
        );
      },
    },
    {
      key: 'manager_user',
      label: 'Консультант',
      width: 180,
      minWidth: 150,
      sortable: true,
      filterable: true,
      renderCell: (row) => {
        if (!row.manager_user) {
          return (
            <span className="text-[11px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800/60 px-2 py-0.5 rounded-md">
              Не назначен
            </span>
          );
        }
        return (
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 text-[10px] font-bold flex items-center justify-center">
              {row.manager_user.full_name.charAt(0)}
            </div>
            <span className="text-xs font-medium truncate">
              {row.manager_user.full_name}
            </span>
          </div>
        );
      },
    },
    {
      key: 'assigned_at',
      label: 'Дата привязки',
      width: 140,
      minWidth: 120,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="text-zinc-500 dark:text-zinc-400 font-mono text-[11px]">
          <FormattedDate date={row.assigned_at} type="date" />
        </span>
      ),
    },
    {
      key: 'plan_price',
      label: 'Тариф',
      width: 110,
      minWidth: 90,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
          {Number(row.plan_price).toLocaleString('ru-RU')} сом
        </span>
      ),
    },
    {
      key: 'connection_fee_percent',
      label: 'Ставка',
      width: 90,
      minWidth: 80,
      sortable: true,
      filterable: false,
      renderCell: (row) => (
        <span className="font-mono text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          {row.connection_fee_percent}%
        </span>
      ),
    },
    {
      key: 'connection_fee_amount',
      label: 'Бонус подключения',
      width: 160,
      minWidth: 140,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
          +{Number(row.connection_fee_amount).toLocaleString('ru-RU')} сом
        </span>
      ),
    },
    {
      key: 'accrual_month',
      label: 'Период',
      width: 110,
      minWidth: 95,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
          {row.accrual_month}
        </span>
      ),
    },
    {
      key: 'client_status',
      label: 'Статус клиента',
      width: 150,
      minWidth: 130,
      sortable: true,
      filterable: true,
      type: 'status',
      statusOptions: CLIENT_STATUS_OPTIONS,
    },
  ];

  // Расчет количества активных фильтров (ЯРУС 1)
  const activeFilterCount =
    (selectedMonth !== 'all' ? 1 : 0) + (selectedStatus !== 'all' ? 1 : 0);

  // Содержимое всплывающего окна фильтров TopHeader / MobileHeader
  const filterContent = (
    <div className="space-y-3.5">
      <div>
        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Расчетный месяц
        </label>
        <select
          value={selectedMonth}
          onChange={handleMonthChange}
          className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          <option value="all">Все месяцы</option>
          {accrualMonths.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Статус клиента
        </label>
        <select
          value={selectedStatus}
          onChange={handleStatusFilterChange}
          className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          <option value="all">Все статусы</option>
          <option value="новый">Новый</option>
          <option value="подключен">Подключен</option>
          <option value="сопровождение">Сопровождение</option>
          <option value="готов">Готов (Выплачен)</option>
          <option value="отменен">Отменен</option>
        </select>
      </div>

      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setSelectedMonth('all');
            setSelectedStatus('all');
            fetchData('all', 'all');
          }}
          className="w-full h-9 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Сбросить фильтры</span>
        </button>
      )}
    </div>
  );

  // Контекстные действия тулбара реестра подключений (ЯРУС 3)
  const connectionActions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => fetchData()}
        className="min-w-[44px] min-h-[44px] h-11 px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive"
        title="Обновить реестр"
        aria-label="Обновить реестр"
      >
        <RotateCcw className={`w-4 h-4 text-blue-500 flex-shrink-0 ${isLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
        <span className="hidden sm:inline">Обновить</span>
      </button>

      {currentUserRole === 'admin' && (
        <button
          type="button"
          onClick={() => {
            setBillingResult(null);
            setIsBillingModalOpen(true);
          }}
          className="min-h-[44px] h-11 px-3.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold flex items-center gap-2 shadow-md transition-all active:scale-95 island-interactive"
          title="Биллинг сопровождения"
          aria-label="Биллинг сопровождения"
        >
          <Banknote className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
          <span className="hidden sm:inline">Биллинг сопровождения</span>
        </button>
      )}
    </div>
  );

  return (
    <AppLayout
      userRole={currentUserRole}
      userName={userName}
      userLogin={userLogin}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Поиск по продавцу, магазину или телефону..."
      filterCount={activeFilterCount}
      filterContent={filterContent}
    >
      <div className="space-y-4">
        {/* ЯРУС 2: KPI карточки (Десктоп: 1 ряд, Мобильный: горизонтальный snap-скролл) */}
        <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 overflow-x-auto sm:overflow-x-visible snap-x sm:snap-none pb-2 sm:pb-0 scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0">
          <div className="min-w-[150px] sm:min-w-0 flex-1 flex-shrink-0 snap-start p-3 sm:p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Всего подключений</span>
            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{stats.total}</p>
          </div>
          <div className="min-w-[150px] sm:min-w-0 flex-1 flex-shrink-0 snap-start p-3 sm:p-4 rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">Новые за месяц</span>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{stats.newThisMonth}</p>
          </div>
          <div className="min-w-[150px] sm:min-w-0 flex-1 flex-shrink-0 snap-start p-3 sm:p-4 rounded-2xl backdrop-blur-xl bg-purple-500/10 dark:bg-purple-500/5 border border-purple-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold">В сопровождении</span>
            <p className="text-xl font-bold text-purple-700 dark:text-purple-300">{stats.inMaintenance}</p>
          </div>
          <div className="min-w-[170px] sm:min-w-0 flex-1 flex-shrink-0 snap-start p-3 sm:p-4 rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Бонусы к начислению</span>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              +{stats.totalBonusAmount.toLocaleString('ru-RU')} сом
            </p>
          </div>
        </div>

        {/* ЯРУС 3: Универсальный реестр DataJournal */}
        <DataJournal<ConnectionItem>
          data={connections}
          columns={columns}
          keyField="connection_id"
          storageKey="connections_journal"
          searchPlaceholder="Поиск по продавцу, магазину или телефону..."
          onRowClick={handleRowClick}
          totalCount={totalCount}
          externalSearchQuery={searchQuery}
          customActions={connectionActions}
        />

        {/* 4. Модальное окно деталей закрепления и смены статуса (Glassmorphism) */}
        {selectedConnection && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-lg p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Шапка модалки */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
                    <Link2 className="w-5 h-5" strokeWidth={2} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      {selectedConnection.seller_name}
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {selectedConnection.store || 'Без магазина'} • +{selectedConnection.seller_phone}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedConnection(null)}
                  className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500 transition-colors"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              {/* Сетка параметров */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-1">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
                    Консультант
                  </span>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {selectedConnection.manager_user?.full_name || 'Не назначен'}
                  </p>
                  <span className="text-[10px] text-zinc-400 block">
                    Привязал: {selectedConnection.assigned_user?.full_name || 'Система'}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-1">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
                    Дата привязки
                  </span>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100 font-mono">
                    <FormattedDate date={selectedConnection.assigned_at} type="date" />
                  </p>
                  <span className="text-[10px] text-zinc-400 block font-mono">
                    Период: {selectedConnection.accrual_month}
                  </span>
                </div>
              </div>

              {/* Финансовые начисления */}
              <div className="p-4 rounded-2xl bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-600 dark:text-zinc-400">Тариф продавца:</span>
                  <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                    {Number(selectedConnection.plan_price).toLocaleString('ru-RU')} сом
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-600 dark:text-zinc-400">Ставка бонуса за подключение:</span>
                  <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                    {selectedConnection.connection_fee_percent}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm pt-1 border-t border-emerald-500/20 font-bold">
                  <span className="text-emerald-700 dark:text-emerald-300">Начисленный бонус:</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 text-base">
                    +{Number(selectedConnection.connection_fee_amount).toLocaleString('ru-RU')} сом
                  </span>
                </div>
              </div>

              {/* Сопровождение и статус жизненного цикла */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Статус жизненного цикла:
                  </label>
                  <span className="text-[11px] text-zinc-400">
                    Сопровождение: {selectedConnection.maintenance_months_accrued} из {selectedConnection.maintenance_months_limit} мес.
                  </span>
                </div>

                {currentUserRole === 'admin' ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={statusToUpdate}
                      onChange={(e) => setStatusToUpdate(e.target.value as ClientLifecycleStatus)}
                      className="flex-1 px-3 py-2 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="новый">Новый</option>
                      <option value="подключен">Подключен</option>
                      <option value="сопровождение">Сопровождение</option>
                      <option value="готов">Готов (Выплачен)</option>
                      <option value="отменен">Отменен</option>
                    </select>
                    <button
                      onClick={handleSaveStatus}
                      disabled={isUpdatingStatus || statusToUpdate === selectedConnection.client_status}
                      className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isUpdatingStatus ? 'Сохранение...' : 'Обновить'}
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-600 dark:text-zinc-300 flex items-center justify-between">
                    <span>Текущий статус:</span>
                    <span className="font-semibold capitalize">{selectedConnection.client_status}</span>
                  </div>
                )}
              </div>

              {/* Кнопка закрытия */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedConnection(null)}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 5. Модальное окно биллинга сопровождения (Admin Only) */}
        {isBillingModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-600 dark:text-purple-400">
                    <Banknote className="w-5 h-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      Биллинг сопровождения
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Ежемесячное начисление комиссий консультантам
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsBillingModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed bg-zinc-50 dark:bg-zinc-800/60 p-3 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                  Система проанализирует клиентов в статусах «Подключен» и «Сопровождение» с неисчерпанным лимитом (до 3 месяцев), рассчитает бонус 10% (или по индивидуальной ставке) и зафиксирует строки в таблице <code className="font-mono text-purple-600 dark:text-purple-400 font-semibold">client_maintenance</code>.
                </p>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Расчетный месяц начисления (YYYY-MM):
                  </label>
                  <input
                    type="text"
                    pattern="^\d{4}-\d{2}$"
                    value={billingMonth}
                    onChange={(e) => setBillingMonth(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                {billingResult && (
                  <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                      <span>Биллинг успешно проведен!</span>
                    </div>
                    <p className="text-[11px]">
                      Обработано: <strong>{billingResult.count}</strong> начислений на сумму{' '}
                      <strong>{billingResult.totalAmount} сом</strong> (пропущено повторов/лимитов: {billingResult.skippedCount}).
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsBillingModalOpen(false)}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Закрыть
                </button>
                <button
                  type="button"
                  onClick={handleRunMaintenanceBilling}
                  disabled={isBillingLoading}
                  className="h-9 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {isBillingLoading ? 'Начисление...' : 'Запустить биллинг'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
