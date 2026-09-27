'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef, type StatusOption } from '@/components/ui/DataJournal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api/client';
import {
  getConnectionsStats,
  getAccrualMonthsList,
  getActivePlansList,
  updateConnectionTariffAndPrice,
  getPlanPriceHistory,
  getPlanPriceAndRateOnDate,
  updateConnectionRetroactive,
  type ConnectionItem,
  type ConnectionsStats,
} from './actions';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { AccrueBonusesModal } from '@/components/connections/AccrueBonusesModal';
import { ConnectionAccrualsSection } from '@/components/connections/ConnectionAccrualsSection';
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
  Coins,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Trash2,
  Receipt,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/components/auth/AuthProvider';
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
    value: 'приостановлен',
    label: 'Приостановлен',
    colorClass: 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  {
    value: 'расторгнут',
    label: 'Расторгнут',
    colorClass: 'bg-zinc-500/10 dark:bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/20',
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
  const user = useUser();

  const [connections, setConnections] = React.useState<ConnectionItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>(user.role);
  const [userName, setUserName] = React.useState(user.userName);
  const [userLogin, setUserLogin] = React.useState(user.userLogin);

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

  // Тарифы для редактирования администратором
  const [activePlans, setActivePlans] = React.useState<{ plan_id: string; plan_name: string; price: number }[]>([]);
  const [editPlanId, setEditPlanId] = React.useState<string>('');
  const [editPlanPrice, setEditPlanPrice] = React.useState<number>(0);
  const [isUpdatingTariff, setIsUpdatingTariff] = React.useState(false);

  // Редактирование задним числом и динамический пересчет
  const [editAssignedDate, setEditAssignedDate] = React.useState<string>('');
  const [planPricesHistory, setPlanPricesHistory] = React.useState<
    { price_id: string; plan_id: string; price: number; effective_from: string; created_at: string }[]
  >([]);
  const [showPlanPriceHistory, setShowPlanPriceHistory] = React.useState(false);
  const [isRecalculating, setIsRecalculating] = React.useState(false);
  const [previewRatePercent, setPreviewRatePercent] = React.useState<number>(50);
  const [previewBonus, setPreviewBonus] = React.useState<number>(0);

  // Модальное окно пакетных начислений (Admin Only)
  const [isAccrueBonusesModalOpen, setIsAccrueBonusesModalOpen] = React.useState(false);

  // Удаление подключения (Admin Only)
  const [connectionToDelete, setConnectionToDelete] = React.useState<ConnectionItem | null>(null);
  const [isDeletingConnection, setIsDeletingConnection] = React.useState(false);

  const handleDeleteConnection = async (conn: ConnectionItem) => {
    if (currentUserRole !== 'admin') {
      showToast('Удаление подключений разрешено только администраторам', 'error');
      return;
    }
    setIsDeletingConnection(true);
    try {
      await api.connections.delete(conn.connection_id);
      showToast(
        `Подключение ${conn.seller_name} удалено. Куратор продавца сброшен`,
        'success'
      );
      setConnectionToDelete(null);
      if (selectedConnection?.connection_id === conn.connection_id) {
        setSelectedConnection(null);
      }
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось удалить подключение', 'error');
    } finally {
      setIsDeletingConnection(false);
    }
  };

  // Загрузка данных
  const fetchData = React.useCallback(async (month?: string, status?: string) => {
    setIsLoading(true);
    try {
      const monthFilter = month !== undefined ? month : selectedMonth;
      const statusFilter = status !== undefined ? status : selectedStatus;

      const [res, statsRes, monthsRes, plansRes] = await Promise.all([
        api.connections.getAll({
          page: 1,
          pageSize: 50,
          accrualMonth: monthFilter !== 'all' ? monthFilter : undefined,
          clientStatus: statusFilter !== 'all' ? statusFilter : undefined,
        }),
        getConnectionsStats(),
        getAccrualMonthsList(),
        getActivePlansList(),
      ]);

      setConnections(res.items || []);
      setTotalCount(res.total || 0);
      setStats(statsRes);
      setAccrualMonths(monthsRes);
      setActivePlans(plansRes);
    } catch (err: any) {
      console.error('Failed to load connections:', err);
      if (err.status === 403 || err.message?.includes('SMM')) {
        setCurrentUserRole('smm');
        setIsLoading(false);
        return;
      }
      showToast(err.message || 'Ошибка при загрузке реестра подключений', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, selectedStatus, showToast]);

  React.useEffect(() => {
    if (user.profile) {
      setUserName(user.userName);
      setUserLogin(user.userLogin);
      setCurrentUserRole(user.role);
    }
  }, [user]);

  React.useEffect(() => {
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
  const handleRowClick = async (connection: ConnectionItem) => {
    setSelectedConnection(connection);
    setStatusToUpdate(connection.client_status);
    setEditPlanId(connection.plan_id || '');
    setEditPlanPrice(Number(connection.plan_price) || 0);
    const initialDate = connection.assigned_at
      ? connection.assigned_at.substring(0, 10)
      : new Date().toISOString().substring(0, 10);
    setEditAssignedDate(initialDate);
    setPreviewRatePercent(Number(connection.connection_fee_percent) || 50);
    setPreviewBonus(Number(connection.connection_fee_amount) || 0);
    setShowPlanPriceHistory(false);
    setPlanPricesHistory([]);

    if (connection.plan_id) {
      try {
        const prices = await getPlanPriceHistory(connection.plan_id);
        setPlanPricesHistory(prices);
      } catch (e) {
        console.error(e);
      }
    }
  };

  // Динамический пересчет цены тарифа и ставки куратора при смене даты или тарифа
  const handleDateOrPlanChange = async (newDate: string, newPlanId: string) => {
    setEditAssignedDate(newDate);
    setEditPlanId(newPlanId);

    if (newPlanId) {
      getPlanPriceHistory(newPlanId).then(setPlanPricesHistory).catch(console.error);
    } else {
      setPlanPricesHistory([]);
    }

    if (!selectedConnection) return;
    setIsRecalculating(true);
    try {
      const res = await getPlanPriceAndRateOnDate({
        plan_id: newPlanId,
        manager_id: selectedConnection.manager_id,
        date: newDate,
      });
      setEditPlanPrice(res.price);
      setPreviewRatePercent(res.connection_fee_percent);
      setPreviewBonus(res.connection_fee_amount);
    } catch (err) {
      console.error('Ошибка пересчета цены на дату:', err);
    } finally {
      setIsRecalculating(false);
    }
  };

  // Сохранение подключения задним числом с полным пересчетом (строго admin)
  const handleSaveConnectionRetroactive = async () => {
    if (!selectedConnection) return;
    setIsUpdatingTariff(true);
    try {
      const res = await updateConnectionRetroactive({
        connection_id: selectedConnection.connection_id,
        assigned_at: editAssignedDate,
        plan_id: editPlanId || null,
        plan_price: editPlanPrice,
      });

      if (res.success) {
        showToast(
          `Подключение успешно обновлено. Месяц: ${res.accrual_month}, Бонус: +${res.recalculatedBonus?.toLocaleString('ru-RU')} сом`,
          'success'
        );
        setSelectedConnection((prev) =>
          prev
            ? {
                ...prev,
                assigned_at: `${editAssignedDate}T12:00:00.000Z`,
                accrual_month: res.accrual_month || prev.accrual_month,
                plan_id: editPlanId || null,
                plan_price: res.plan_price ?? editPlanPrice,
                connection_fee_percent: res.connection_fee_percent ?? prev.connection_fee_percent,
                connection_fee_amount: res.recalculatedBonus ?? prev.connection_fee_amount,
              }
            : null
        );
        fetchData();
      } else {
        showToast(res.error || 'Ошибка при сохранении подключения', 'error');
      }
    } catch {
      showToast('Не удалось обновить подключение', 'error');
    } finally {
      setIsUpdatingTariff(false);
    }
  };

  // Сохранение нового статуса сопровождения (строго admin)
  const handleSaveStatus = async () => {
    if (!selectedConnection) return;
    setIsUpdatingStatus(true);
    try {
      await api.connections.update(selectedConnection.connection_id, {
        client_status: statusToUpdate,
      });

      showToast('Статус клиента успешно обновлен', 'success');
      setSelectedConnection((prev) =>
        prev ? { ...prev, client_status: statusToUpdate } : null
      );
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось обновить статус', 'error');
    } finally {
      setIsUpdatingStatus(false);
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

  // Конфигурация колонок DataJournal (мемоизирована для стабилизации виртуализатора)
  const columns: ColumnDef<ConnectionItem>[] = React.useMemo(
    () => [
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
            <EmployeeBadge
              name={row.manager_user.full_name}
              color={row.manager_user.color}
              size="sm"
            />
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
        key: 'maintenance_months_accrued',
        label: 'Срок сопровождения',
        width: 165,
        minWidth: 145,
        sortable: true,
        filterable: false,
        renderCell: (row) => {
          const total = row.maintenance_months_total || 2;
          const current = row.maintenance_months_accrued || 0;
          const isCompleted = current >= total;
          return (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                isCompleted
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : current > 0
                  ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700'
              }`}
            >
              <Clock className="w-3 h-3" />
              {current} из {total} мес.
            </span>
          );
        },
      },
      {
        key: 'maintenance_fee_monthly',
        label: 'Бонус сопровождения',
        width: 170,
        minWidth: 150,
        sortable: true,
        filterable: false,
        renderCell: (row) => {
          const fee = row.maintenance_fee_monthly || Math.round((Number(row.plan_price) || 0) * 0.1);
          return (
            <span className="font-mono text-xs font-semibold text-purple-600 dark:text-purple-400">
              +{Number(fee).toLocaleString('ru-RU')} сом/мес
            </span>
          );
        },
      },
      {
        key: 'total_bonus',
        label: 'Итого бонусы',
        width: 140,
        minWidth: 120,
        sortable: true,
        filterable: false,
        renderCell: (row) => (
          <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
            +{Number(row.total_bonus ?? row.connection_fee_amount).toLocaleString('ru-RU')} сом
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
        renderCell: (row) => {
          const opt =
            CLIENT_STATUS_OPTIONS.find((o) => o.value === row.client_status) ||
            CLIENT_STATUS_OPTIONS[0];
          return (
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold border ${opt.colorClass}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              <span>{opt.label}</span>
            </span>
          );
        },
      },
    ],
    []
  );

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
    <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
      <button
        type="button"
        onClick={() => fetchData()}
        className="h-9 md:h-11 w-9 md:w-auto p-0 md:px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center md:gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive flex-shrink-0"
        title="Обновить реестр"
        aria-label="Обновить реестр"
      >
        <RotateCcw className={`w-4 h-4 text-blue-500 flex-shrink-0 ${isLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
        <span className="hidden md:inline">Обновить</span>
      </button>

      {currentUserRole === 'admin' && (
        <button
          type="button"
          onClick={() => setIsAccrueBonusesModalOpen(true)}
          className="h-9 md:h-11 w-9 md:w-auto p-0 md:px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center md:gap-2 shadow-md transition-all active:scale-95 island-interactive flex-shrink-0"
          title="Начисления"
          aria-label="Начисления"
        >
          <Coins className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
          <span className="hidden md:inline">Начисления</span>
        </button>
      )}
    </div>
  );

  const renderCustomRowActions = React.useCallback(
    (row: ConnectionItem) => {
      if (currentUserRole !== 'admin') return null;
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setConnectionToDelete(row);
          }}
          className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center gap-2.5 transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4 text-rose-500" strokeWidth={1.75} />
          <span>Удалить подключение</span>
        </button>
      );
    },
    [currentUserRole]
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
        {/* ЯРУС 2: KPI карточки (Адаптивная сетка: 2x2 на мобильных, 4 в ряд на десктопе) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
            <span className="text-[10px] sm:text-[11px] text-zinc-400 font-medium truncate block">Всего подключений</span>
            <p className="text-base sm:text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">{stats.total}</p>
          </div>
          <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
            <span className="text-[10px] sm:text-[11px] text-blue-600 dark:text-blue-400 font-semibold truncate block">Новые за месяц</span>
            <p className="text-base sm:text-xl font-bold font-mono text-blue-700 dark:text-blue-300">{stats.newThisMonth}</p>
          </div>
          <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-purple-500/10 dark:bg-purple-500/5 border border-purple-500/20 shadow-sm space-y-1">
            <span className="text-[10px] sm:text-[11px] text-purple-600 dark:text-purple-400 font-semibold truncate block">В сопровождении</span>
            <p className="text-base sm:text-xl font-bold font-mono text-purple-700 dark:text-purple-300">{stats.inMaintenance}</p>
          </div>
          <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1">
            <span className="text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold truncate block">Бонусы к начислению</span>
            <p className="text-base sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono truncate">
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
          customRowActions={renderCustomRowActions}
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
                  <div className="pt-0.5">
                    {selectedConnection.manager_user ? (
                      <EmployeeBadge
                        name={selectedConnection.manager_user.full_name}
                        color={selectedConnection.manager_user.color}
                        size="sm"
                      />
                    ) : (
                      <span className="text-xs text-zinc-400 font-medium">Не назначен</span>
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-400 block pt-0.5">
                    Привязал: {selectedConnection.assigned_user?.full_name || 'Система'}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
                      Дата подключения
                    </span>
                    {currentUserRole === 'admin' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                        Admin
                      </span>
                    )}
                  </div>
                  {currentUserRole === 'admin' ? (
                    <div className="space-y-1 pt-0.5">
                      <input
                        type="date"
                        value={editAssignedDate}
                        onChange={(e) => handleDateOrPlanChange(e.target.value, editPlanId)}
                        className="w-full px-2 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <span className="text-[10px] text-zinc-400 block font-mono">
                        Период: {editAssignedDate ? editAssignedDate.substring(0, 7) : selectedConnection.accrual_month}
                      </span>
                    </div>
                  ) : (
                    <>
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100 font-mono">
                        <FormattedDate date={selectedConnection.assigned_at} type="date" />
                      </p>
                      <span className="text-[10px] text-zinc-400 block font-mono">
                        Период: {selectedConnection.accrual_month}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Финансовые начисления */}
              <div className="p-4 rounded-2xl bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    Тариф и расчет комиссии
                  </span>
                  <span className="font-mono text-[11px] text-zinc-400">
                    Ставка: {previewRatePercent}%
                  </span>
                </div>

                {currentUserRole === 'admin' ? (
                  <div className="space-y-2.5 pt-1 border-t border-emerald-500/20 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                            Вид тарифа
                          </label>
                          {editPlanId && (
                            <button
                              type="button"
                              onClick={() => setShowPlanPriceHistory(!showPlanPriceHistory)}
                              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                            >
                              <span>История цен</span>
                              {showPlanPriceHistory ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                        <select
                          value={editPlanId}
                          onChange={(e) => handleDateOrPlanChange(editAssignedDate, e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          <option value="">Без тарифа</option>
                          {activePlans.map((p) => (
                            <option key={p.plan_id} value={p.plan_id}>
                              {p.plan_name} ({p.price.toLocaleString('ru-RU')} с)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                          Стоимость тарифа (сом)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editPlanPrice || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setEditPlanPrice(val);
                            setPreviewBonus(Math.round(((val * previewRatePercent) / 100) * 100) / 100);
                          }}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Выпадающая таблица действий тарифа по датам */}
                    {showPlanPriceHistory && editPlanId && (
                      <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 space-y-1.5 text-xs animate-in fade-in duration-150">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                          <span>Действие тарифа по датам:</span>
                          <span className="text-[10px] text-zinc-400">Кликните, чтобы применить</span>
                        </div>
                        {planPricesHistory.length === 0 ? (
                          <div className="p-2 text-center text-[11px] text-zinc-400">
                            Периоды цен не зафиксированы
                          </div>
                        ) : (
                          <div className="space-y-1 max-h-36 overflow-y-auto">
                            {planPricesHistory.map((pp) => (
                              <button
                                key={pp.price_id}
                                type="button"
                                onClick={() => {
                                  setEditPlanPrice(pp.price);
                                  setPreviewBonus(Math.round(((pp.price * previewRatePercent) / 100) * 100) / 100);
                                }}
                                className="w-full px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-between text-left transition-colors font-mono text-xs"
                              >
                                <span className="text-zinc-600 dark:text-zinc-400">
                                  с {pp.effective_from}:
                                </span>
                                <span className="font-bold text-zinc-900 dark:text-zinc-100">
                                  {pp.price.toLocaleString('ru-RU')} сом
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-emerald-500/20">
                      <div>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block">
                          Бонус ({previewRatePercent}%):
                        </span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                          +{previewBonus.toLocaleString('ru-RU')} сом
                        </span>
                        {isRecalculating && (
                          <span className="text-[10px] text-zinc-400 italic block">Пересчет...</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveConnectionRetroactive}
                        disabled={
                          isUpdatingTariff ||
                          isRecalculating ||
                          (editPlanId === (selectedConnection.plan_id || '') &&
                            editPlanPrice === Number(selectedConnection.plan_price) &&
                            editAssignedDate === selectedConnection.assigned_at.substring(0, 10))
                        }
                        className="h-8 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isUpdatingTariff ? 'Сохранение...' : 'Сохранить (задним числом)'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              {/* Сопровождение и статус жизненного цикла (FSM) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Статус жизненного цикла (FSM):
                  </label>
                  <span className="text-[11px] text-zinc-400">
                    Сопровождение: {selectedConnection.maintenance_months_accrued} из {selectedConnection.maintenance_months_limit} мес.
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const opt =
                        CLIENT_STATUS_OPTIONS.find((o) => o.value === selectedConnection.client_status) ||
                        CLIENT_STATUS_OPTIONS[0];
                      return (
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold border ${opt.colorClass}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          <span>{opt.label}</span>
                        </span>
                      );
                    })()}
                  </div>
                  <span className="text-[10px] text-zinc-400 italic">
                    Автоматический переход (FSM)
                  </span>
                </div>
              </div>

              {/* История начислений ЗП */}
              <div className="pt-2 border-t border-zinc-200/50 dark:border-zinc-700/50 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-blue-500" strokeWidth={1.75} />
                    <span>История начислений ЗП</span>
                  </span>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-zinc-400">Бонусы:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                      +{Number(selectedConnection.total_bonus ?? selectedConnection.connection_fee_amount).toLocaleString('ru-RU')} с
                    </span>
                    <span className="text-zinc-400">Выплачено:</span>
                    <span className="text-blue-600 dark:text-blue-400 font-bold">
                      {Number(selectedConnection.total_paid ?? 0).toLocaleString('ru-RU')} с
                    </span>
                  </div>
                </div>
                <ConnectionAccrualsSection
                  connectionId={selectedConnection.connection_id}
                  isAdmin={currentUserRole === 'admin'}
                  onUpdated={fetchData}
                />
              </div>

              {/* Кнопка закрытия и удаления */}
              <div className="flex items-center justify-between pt-2">
                {currentUserRole === 'admin' ? (
                  <button
                    type="button"
                    onClick={() => setConnectionToDelete(selectedConnection)}
                    className="h-9 px-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    <span>Удалить</span>
                  </button>
                ) : <div />}
                <button
                  type="button"
                  onClick={() => setSelectedConnection(null)}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 5. Модальное окно пакетного начисления бонусов (Admin Only) */}
        <AccrueBonusesModal
          isOpen={isAccrueBonusesModalOpen}
          onClose={() => setIsAccrueBonusesModalOpen(false)}
          onSuccess={fetchData}
          months={accrualMonths}
        />

        {/* 6. Диалог подтверждения удаления подключения (Admin Only) */}
        {connectionToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                  <Trash2 className="w-5 h-5" strokeWidth={1.75} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    Удалить подключение?
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {connectionToDelete.seller_name} (+{connectionToDelete.seller_phone})
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-300 space-y-1.5">
                <div className="font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
                  <span>Внимание: действие необратимо</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Будут удалены все начисления куратора по этому клиенту, а назначенный куратор в карточке продавца будет автоматически сброшен.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isDeletingConnection}
                  onClick={() => setConnectionToDelete(null)}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={isDeletingConnection}
                  onClick={() => handleDeleteConnection(connectionToDelete)}
                  className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {isDeletingConnection ? (
                    <span>Удаление...</span>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                      <span>Удалить подключение</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
