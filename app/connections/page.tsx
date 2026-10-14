'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { CollapsibleStats } from '@/components/ui/CollapsibleStats';
import { DataJournal, type ColumnDef, type StatusOption, type DataJournalTab } from '@/components/ui/DataJournal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, useConfirm } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select, Textarea } from '@/components/ui/Field';
import { formatDateTime, formatMonth, currentMonthISO } from '@/lib/utils/format';
import { formatPhoneDisplay, telHref, waHref } from '@/lib/utils/phone';
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
  Coins,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Trash2,
  Receipt,
  Check,
  Hourglass,
  XCircle,
  ShieldCheck,
} from 'lucide-react';
import { useUser } from '@/components/auth/AuthProvider';
import type { ClientLifecycleStatus, ConnectionConfirmationStatus, UserRole } from '@/types/database.types';

/** Подтверждение подключения администратором (миграция 037) */
const CONFIRMATION_STATUS_OPTIONS: StatusOption[] = [
  {
    value: 'pending',
    label: 'Ожидает подтверждения',
    colorClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    dotColor: 'bg-amber-500',
  },
  {
    value: 'confirmed',
    label: 'Подтверждено',
    colorClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    dotColor: 'bg-emerald-500',
  },
  {
    value: 'rejected',
    label: 'Отклонено',
    colorClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
    dotColor: 'bg-rose-500',
  },
];

function ConfirmationBadge({ status, className = '' }: { status?: string | null; className?: string }) {
  const opt = CONFIRMATION_STATUS_OPTIONS.find((o) => o.value === (status || 'confirmed')) || CONFIRMATION_STATUS_OPTIONS[1];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${opt.colorClass} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${opt.dotColor || 'bg-current'}`} />
      <span>{opt.label}</span>
    </span>
  );
}

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
  const confirm = useConfirm();
  const user = useUser();
  // Права назначенной роли
  const canEdit = user.can('connections.edit');
  const canConfirm = user.can('connections.confirm');
  const canAccrue = user.can('connections.accrue');
  const canEditAccruals = user.can('connections.accruals_edit');
  const canDelete = user.can('connections.delete');
  const canBulk = user.can('connections.bulk');

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

  // Вкладки подтверждения подключений (037): all | pending | confirmed | rejected
  const [confirmationTab, setConfirmationTab] = React.useState<string>('all');
  const [pendingCount, setPendingCount] = React.useState(0);

  // Диалог отклонения подключения с причиной (Admin Only)
  const [rejectDialog, setRejectDialog] = React.useState<{ connection: ConnectionItem | null; reason: string }>({
    connection: null,
    reason: '',
  });
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);

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

  // Редактирование срока сопровождения (Admin Only)
  const [editMaintenanceMonthsTotal, setEditMaintenanceMonthsTotal] = React.useState<number>(2);
  const [isUpdatingMaintenanceMonths, setIsUpdatingMaintenanceMonths] = React.useState(false);

  // Удаление подключения (Admin Only)
  const [connectionToDelete, setConnectionToDelete] = React.useState<ConnectionItem | null>(null);
  const [isDeletingConnection, setIsDeletingConnection] = React.useState(false);

  const handleDeleteConnection = async (conn: ConnectionItem) => {
    if (!canDelete) {
      showToast('Удаление подключений не предусмотрено вашей ролью', 'error');
      return;
    }
    setIsDeletingConnection(true);
    try {
      await api.connections.delete(conn.connection_id);
      showToast(
        `Подключение ${conn.seller_name} удалено. Консультант продавца сброшен`,
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

  // Массовые действия для администратора (Bulk Operations)
  const [selectedConnectionIds, setSelectedConnectionIds] = React.useState<string[]>([]);
  const [isBatchLoading, setIsBatchLoading] = React.useState(false);

  const [bulkMaintenanceModal, setBulkMaintenanceModal] = React.useState<{
    isOpen: boolean;
    months: number;
  }>({
    isOpen: false,
    months: 2,
  });

  const [bulkAccrueModal, setBulkAccrueModal] = React.useState<{
    isOpen: boolean;
    mode: 'connection_only' | 'maintenance_only';
    month: string;
  }>({
    isOpen: false,
    mode: 'maintenance_only',
    month: currentMonthISO(),
  });
  const closeBulkAccrueModal = () =>
    setBulkAccrueModal({ isOpen: false, mode: 'maintenance_only', month: currentMonthISO() });

  const handleBulkConfirmSelected = async (clearSelection: () => void) => {
    if (selectedConnectionIds.length === 0) return;
    const ok = await confirm({
      title: 'Подтвердить выбранные подключения?',
      subtitle: `Выбрано подключений: ${selectedConnectionIds.length}`,
      description:
        'Подтверждаются только подключения в статусе «Ожидает подтверждения»; остальные будут пропущены. После подтверждения консультанту начисляется бонус за подключение.',
      tone: 'success',
      icon: ShieldCheck,
      confirmLabel: 'Подтвердить',
    });
    if (!ok) return;
    setIsBatchLoading(true);
    try {
      const res = await api.connections.batch({ action: 'confirm_selected', connection_ids: selectedConnectionIds });
      showToast(res.message || `Подтверждено подключений: ${res.confirmed_count ?? 0}`, 'success');
      clearSelection();
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка массового подтверждения', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  const handleBulkUpdateMaintenanceMonths = async (clearSelection: () => void) => {
    if (selectedConnectionIds.length === 0) return;
    setIsBatchLoading(true);
    try {
      const res = await api.connections.batch({
        action: 'update_maintenance_months',
        connection_ids: selectedConnectionIds,
        payload: {
          months_total: bulkMaintenanceModal.months,
          maintenance_months_total: bulkMaintenanceModal.months,
        },
      });
      showToast(
        `Срок сопровождения обновлен (${bulkMaintenanceModal.months} мес.) для ${res.updated_count || selectedConnectionIds.length} подключений`,
        'success'
      );
      setBulkMaintenanceModal({ isOpen: false, months: 2 });
      clearSelection();
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка массового обновления срока', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  const handleBulkAccrueSelected = async (clearSelection: () => void) => {
    if (selectedConnectionIds.length === 0) return;
    setIsBatchLoading(true);
    try {
      const res = await api.connections.batch({
        action: 'accrue_selected',
        connection_ids: selectedConnectionIds,
        payload: {
          mode: bulkAccrueModal.mode,
          settlement_month: bulkAccrueModal.month,
        },
      });
      showToast(
        `Начисления выполнены: ${res.connection_bonuses_created ?? res.connection_accruals_created ?? 0} за подкл., ${res.maintenance_bonuses_created ?? res.maintenance_accruals_created ?? 0} за сопр.`,
        'success'
      );
      if (Number(res.maintenance_skipped_same_month) > 0) {
        showToast(
          `Сопровождение не начислено по ${res.maintenance_skipped_same_month} подкл.: оно начисляется только со следующего месяца после подключения`,
          'info'
        );
      }
      closeBulkAccrueModal();
      clearSelection();
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка начисления выбранным', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  // Загрузка данных: весь реестр за выбранный месяц/статус клиента постранично.
  // Вкладки подтверждения — клиентский фильтр, без повторных запросов.
  const fetchData = React.useCallback(async (month?: string, status?: string) => {
    setIsLoading(true);
    try {
      const monthFilter = month !== undefined ? month : selectedMonth;
      const statusFilter = status !== undefined ? status : selectedStatus;
      const PAGE_SIZE = 100;
      const baseParams = {
        pageSize: PAGE_SIZE,
        accrualMonth: monthFilter !== 'all' ? monthFilter : undefined,
        clientStatus: statusFilter !== 'all' ? statusFilter : undefined,
        bypassCache: true,
      };

      const [res, statsRes, monthsRes, plansRes] = await Promise.all([
        api.connections.getAll({ page: 1, ...baseParams }),
        getConnectionsStats(),
        getAccrualMonthsList(),
        getActivePlansList(),
      ]);

      const items = [...(res.items || [])];
      const total = res.total || items.length;
      for (let page = 2; items.length < total && page <= 50; page++) {
        const next = await api.connections.getAll({ page, ...baseParams });
        if (!next.items || next.items.length === 0) break;
        items.push(...next.items);
      }

      setConnections(items);
      setTotalCount(total);
      setPendingCount(Number(res.pending_count) || 0);
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

  // Клиентский фильтр по вкладке подтверждения
  const visibleConnections = React.useMemo(
    () => (confirmationTab === 'all' ? connections : connections.filter((c) => c.confirmation_status === confirmationTab)),
    [connections, confirmationTab]
  );

  // Вкладка — чистый клиентский фильтр: данные не перезапрашиваются
  const handleConfirmationTabChange = (tabId: string) => {
    setConfirmationTab(tabId);
  };

  // Подтверждение подключения администратором (бонус начисляется триггером БД)
  const handleConfirmConnection = React.useCallback(
    async (conn: ConnectionItem) => {
      const ok = await confirm({
        title: 'Подтвердить подключение?',
        subtitle: `${conn.seller_name} (${formatPhoneDisplay(conn.seller_phone)}) → ${conn.manager_user?.full_name || 'консультант'}`,
        description: `Консультанту будет начислен бонус за подключение: +${Number(
          conn.tariff_connection_fee || conn.connection_fee || conn.connection_fee_amount || 0
        ).toLocaleString('ru-RU')} сом.`,
        tone: 'success',
        icon: ShieldCheck,
        confirmLabel: 'Подтвердить',
      });
      if (!ok) return;
      setConfirmingId(conn.connection_id);
      try {
        const res = await api.connections.setConfirmation(conn.connection_id, 'confirm');
        showToast(res.message || 'Подключение подтверждено', 'success');
        setSelectedConnection((prev) =>
          prev?.connection_id === conn.connection_id
            ? { ...prev, confirmation_status: 'confirmed', confirmed_at: new Date().toISOString(), rejection_reason: null }
            : prev
        );
        fetchData();
      } catch (err: any) {
        showToast(err.message || 'Не удалось подтвердить подключение', 'error');
      } finally {
        setConfirmingId(null);
      }
    },
    [confirm, showToast, fetchData]
  );

  const handleRejectConnection = async () => {
    const conn = rejectDialog.connection;
    const reason = rejectDialog.reason.trim();
    if (!conn || reason.length < 3) {
      showToast('Укажите причину отклонения (не менее 3 символов)', 'error');
      return;
    }
    try {
      const res = await api.connections.setConfirmation(conn.connection_id, 'reject', reason);
      showToast(res.message || 'Подключение отклонено, консультант у продавца снят', 'info');
      setRejectDialog({ connection: null, reason: '' });
      setSelectedConnection((prev) =>
        prev?.connection_id === conn.connection_id
          ? { ...prev, confirmation_status: 'rejected', rejection_reason: reason, confirmed_at: new Date().toISOString() }
          : prev
      );
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось отклонить подключение', 'error');
    }
  };

  const confirmationTabs: DataJournalTab[] = React.useMemo(
    () => [
      { id: 'all', label: 'Все', icon: Link2, count: connections.length },
      {
        id: 'pending',
        label: 'Ожидают подтверждения',
        icon: Hourglass,
        count: Math.max(pendingCount, connections.filter((c) => c.confirmation_status === 'pending').length),
      },
      { id: 'confirmed', label: 'Подтверждены', icon: ShieldCheck, count: connections.filter((c) => c.confirmation_status === 'confirmed').length },
      { id: 'rejected', label: 'Отклонены', icon: XCircle, count: connections.filter((c) => c.confirmation_status === 'rejected').length },
    ],
    [pendingCount, connections]
  );

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
    setEditMaintenanceMonthsTotal(Number(connection.maintenance_months_total || connection.maintenance_months_limit || 2));
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

  // Сохранение срока сопровождения (строго admin)
  const handleSaveMaintenanceMonths = async () => {
    if (!selectedConnection) return;
    setIsUpdatingMaintenanceMonths(true);
    try {
      await api.connections.update(selectedConnection.connection_id, {
        maintenance_months_total: editMaintenanceMonthsTotal,
        maintenance_months_limit: editMaintenanceMonthsTotal,
      });
      showToast('Срок сопровождения успешно обновлен', 'success');
      setSelectedConnection((prev) =>
        prev
          ? {
              ...prev,
              maintenance_months_total: editMaintenanceMonthsTotal,
              maintenance_months_limit: editMaintenanceMonthsTotal,
            }
          : null
      );
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка обновления срока сопровождения', 'error');
    } finally {
      setIsUpdatingMaintenanceMonths(false);
    }
  };

  // Динамический пересчет цены тарифа и ставки консультанта при смене даты или тарифа
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
  if (currentUserRole === 'smm' || !user.can('connections.menu')) {
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
        phoneAccessor: (row) => formatPhoneDisplay(row.seller_phone),
        renderCell: (row) => {
          return (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">
                {formatPhoneDisplay(row.seller_phone)}
              </span>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <a
                  href={waHref(row.seller_phone)}
                  target="_blank"
                  rel="noreferrer"
                  title="Написать в WhatsApp"
                  className="w-6 h-6 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                </a>
                <a
                  href={telHref(row.seller_phone)}
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
        key: 'confirmation_status',
        label: 'Подтверждение',
        type: 'status',
        statusOptions: CONFIRMATION_STATUS_OPTIONS,
        width: 190,
        minWidth: 170,
        sortable: true,
        filterable: true,
        groupable: true,
        renderCell: (row) => (
          <div className="flex flex-col gap-0.5">
            <ConfirmationBadge status={row.confirmation_status} />
            {row.confirmation_status === 'rejected' && row.rejection_reason && (
              <span className="text-[10px] text-zinc-400 truncate max-w-[170px]" title={row.rejection_reason}>
                {row.rejection_reason}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'assigned_at',
        label: 'Дата привязки',
        type: 'datetime',
        width: 170,
        minWidth: 150,
        sortable: true,
        filterable: true,
        renderCell: (row) => (
          <span className="text-zinc-500 dark:text-zinc-400 font-mono text-[11px]">
            <FormattedDate date={row.assigned_at} type="dateTime" />
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
        renderCell: (row) => {
          const amt = Number(row.bonus_connection ?? row.connection_bonus_accrued ?? 0);
          if (amt <= 0) {
            return (
              <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                0 сом
              </span>
            );
          }
          return (
            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
              +{amt.toLocaleString('ru-RU')} сом
            </span>
          );
        },
      },
      {
        key: 'accrual_month',
        label: 'Период',
        type: 'month',
        width: 110,
        minWidth: 95,
        sortable: true,
        filterable: true,
        renderCell: (row) => (
          <span className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
            {formatMonth(row.accrual_month)}
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
          const amt = Number(row.bonus_maintenance ?? row.maintenance_bonus_accrued ?? 0);
          if (amt <= 0) {
            return (
              <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                0 сом
              </span>
            );
          }
          return (
            <span className="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
              +{amt.toLocaleString('ru-RU')} сом
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
        renderCell: (row) => {
          const total = Number(row.total_bonuses ?? row.total_bonus ?? 0);
          if (total <= 0) {
            return (
              <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                0 сом
              </span>
            );
          }
          return (
            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
              +{total.toLocaleString('ru-RU')} сом
            </span>
          );
        },
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
              {formatMonth(m)}
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

      {canAccrue && (
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
      if (!canConfirm && !canDelete) return null;
      const isPending = row.confirmation_status === 'pending' && canConfirm;
      return (
        <div className="flex flex-col gap-0.5">
          {isPending && (
            <>
              <button
                type="button"
                disabled={confirmingId === row.connection_id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleConfirmConnection(row);
                }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 flex items-center gap-2.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-500" strokeWidth={1.75} />
                <span>Подтвердить подключение</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setRejectDialog({ connection: row, reason: '' });
                }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <XCircle className="w-4 h-4 text-amber-500" strokeWidth={1.75} />
                <span>Отклонить…</span>
              </button>
            </>
          )}
          {canDelete && (
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
          )}
        </div>
      );
    },
    [canConfirm, canDelete, confirmingId, handleConfirmConnection]
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
        <CollapsibleStats storageKey="connections">
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
        </CollapsibleStats>

        {/* ЯРУС 3: Универсальный реестр DataJournal */}
        <DataJournal<ConnectionItem>
          data={visibleConnections}
          columns={columns}
          keyField="connection_id"
          storageKey="connections_journal"
          searchPlaceholder="Поиск по продавцу, магазину или телефону..."
          onRowClick={handleRowClick}
          totalCount={visibleConnections.length}
          externalSearchQuery={searchQuery}
          tabs={confirmationTabs}
          activeTab={confirmationTab}
          onTabChange={handleConfirmationTabChange}
          customActions={connectionActions}
          customRowActions={renderCustomRowActions}
          enableSelection={canBulk}
          selectedIds={selectedConnectionIds}
          onSelectionChange={setSelectedConnectionIds}
          renderBulkActions={(ids, clearSelection) => (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isBatchLoading}
                onClick={() => handleBulkConfirmSelected(clearSelection)}
                className="h-8 px-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs font-semibold border border-emerald-500/30 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Подтвердить подключения, ожидающие подтверждения"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Подтвердить ({ids.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setBulkMaintenanceModal({ isOpen: true, months: 2 })}
                className="h-8 px-2.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-xs font-semibold border border-purple-500/30 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Срок сопр. ({ids.length})</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setBulkAccrueModal({
                    isOpen: true,
                    mode: 'maintenance_only',
                    month: currentMonthISO(),
                  })
                }
                className="h-8 px-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs font-semibold border border-emerald-500/30 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Coins className="w-3.5 h-3.5" />
                <span>Начислить ({ids.length})</span>
              </button>
            </div>
          )}
        />

        {/* 4. Модальное окно деталей закрепления и смены статуса */}
        {selectedConnection && (
          <Modal
            open
            onClose={() => setSelectedConnection(null)}
            title={selectedConnection.seller_name}
            subtitle={`${selectedConnection.store || 'Без магазина'} • ${formatPhoneDisplay(selectedConnection.seller_phone)}`}
            icon={Link2}
            tone="info"
            size="lg"
            footerClassName="justify-between"
            footer={
              <>
                {canDelete ? (
                  <Button
                    variant="dangerSoft"
                    onClick={() => setConnectionToDelete(selectedConnection)}
                    leftIcon={<Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />}
                  >
                    Удалить
                  </Button>
                ) : (
                  <span />
                )}
                <Button variant="outline" onClick={() => setSelectedConnection(null)}>
                  Закрыть
                </Button>
              </>
            }
          >
            <div className="space-y-5">
              {/* Подтверждение администратором (037) */}
              <div
                className={`p-3.5 rounded-2xl border space-y-2 text-xs ${
                  selectedConnection.confirmation_status === 'pending'
                    ? 'bg-amber-500/5 border-amber-500/30'
                    : selectedConnection.confirmation_status === 'rejected'
                    ? 'bg-rose-500/5 border-rose-500/30'
                    : 'bg-emerald-500/5 border-emerald-500/20'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ConfirmationBadge status={selectedConnection.confirmation_status} />
                  {canConfirm && selectedConnection.confirmation_status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="success"
                        size="sm"
                        loading={confirmingId === selectedConnection.connection_id}
                        onClick={() => handleConfirmConnection(selectedConnection)}
                        leftIcon={<ShieldCheck className="w-3.5 h-3.5" strokeWidth={2} />}
                      >
                        Подтвердить
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRejectDialog({ connection: selectedConnection, reason: '' })}
                        leftIcon={<XCircle className="w-3.5 h-3.5" strokeWidth={2} />}
                      >
                        Отклонить…
                      </Button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span>
                    Запросил: <b className="text-zinc-700 dark:text-zinc-200">{selectedConnection.assigned_user?.full_name || 'Система'}</b>
                    {' · '}
                    {formatDateTime(selectedConnection.assigned_at)}
                  </span>
                  {selectedConnection.confirmation_status !== 'pending' && (
                    <span>
                      {selectedConnection.confirmation_status === 'rejected' ? 'Отклонил' : 'Подтвердил'}:{' '}
                      <b className="text-zinc-700 dark:text-zinc-200">{selectedConnection.confirmed_user?.full_name || '—'}</b>
                      {selectedConnection.confirmed_at ? ` · ${formatDateTime(selectedConnection.confirmed_at)}` : ''}
                    </span>
                  )}
                  {selectedConnection.confirmation_status === 'pending' && (
                    <span className="text-amber-700 dark:text-amber-300">
                      Бонус за подключение начислится после подтверждения администратором
                    </span>
                  )}
                  {selectedConnection.confirmation_status === 'rejected' && selectedConnection.rejection_reason && (
                    <span className="sm:col-span-2 text-rose-700 dark:text-rose-300">
                      Причина: {selectedConnection.rejection_reason}
                    </span>
                  )}
                </div>
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
                    {canEdit && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                        Редактирование
                      </span>
                    )}
                  </div>
                  {canEdit ? (
                    <div className="space-y-1 pt-0.5">
                      <Input
                        type="date"
                        size="sm"
                        mono
                        value={editAssignedDate}
                        onChange={(e) => handleDateOrPlanChange(e.target.value, editPlanId)}
                      />
                      <span className="text-[10px] text-zinc-400 block font-mono">
                        Период: {formatMonth(editAssignedDate ? editAssignedDate.substring(0, 7) : selectedConnection.accrual_month)}
                      </span>
                    </div>
                  ) : (
                    <>
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100 font-mono">
                        <FormattedDate date={selectedConnection.assigned_at} type="dateTime" />
                      </p>
                      <span className="text-[10px] text-zinc-400 block font-mono">
                        Период: {formatMonth(selectedConnection.accrual_month)}
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

                {canEdit ? (
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
                        <Select
                          size="sm"
                          value={editPlanId}
                          onChange={(e) => handleDateOrPlanChange(editAssignedDate, e.target.value)}
                        >
                          <option value="">Без тарифа</option>
                          {activePlans.map((p) => (
                            <option key={p.plan_id} value={p.plan_id}>
                              {p.plan_name} ({p.price.toLocaleString('ru-RU')} с)
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                          Стоимость тарифа (сом)
                        </label>
                        <Input
                          type="number"
                          size="sm"
                          mono
                          step="0.01"
                          min="0"
                          value={editPlanPrice || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setEditPlanPrice(val);
                            setPreviewBonus(Math.round(((val * previewRatePercent) / 100) * 100) / 100);
                          }}
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
                      <Button
                        variant="success"
                        size="sm"
                        onClick={handleSaveConnectionRetroactive}
                        loading={isUpdatingTariff}
                        disabled={
                          isRecalculating ||
                          (editPlanId === (selectedConnection.plan_id || '') &&
                            editPlanPrice === Number(selectedConnection.plan_price) &&
                            editAssignedDate === selectedConnection.assigned_at.substring(0, 10))
                        }
                      >
                        {isUpdatingTariff ? 'Сохранение...' : 'Сохранить (задним числом)'}
                      </Button>
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
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-600 dark:text-zinc-400">Плановый бонус подключения:</span>
                      <span className="font-mono text-zinc-700 dark:text-zinc-300">
                        {Number(selectedConnection.tariff_connection_fee || selectedConnection.connection_fee || selectedConnection.connection_fee_amount || 0).toLocaleString('ru-RU')} сом
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-600 dark:text-zinc-400">Плановый бонус сопровождения:</span>
                      <span className="font-mono text-zinc-700 dark:text-zinc-300">
                        {Number(selectedConnection.tariff_maintenance_fee_monthly || selectedConnection.maintenance_fee_monthly || 0).toLocaleString('ru-RU')} сом/мес.
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm pt-1 border-t border-emerald-500/20 font-bold">
                      <span className="text-emerald-700 dark:text-emerald-300">Фактически начислено:</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 text-base">
                        +{Number(selectedConnection.total_bonuses ?? selectedConnection.total_bonus ?? 0).toLocaleString('ru-RU')} сом
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Сопровождение и статус жизненного цикла (FSM) */}
              <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/60 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Статус жизненного цикла (FSM):
                  </label>
                  <span className="text-[10px] text-zinc-400 italic">
                    Автоматический переход (FSM)
                  </span>
                </div>

                <div className="flex items-center justify-between">
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
                  <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                    Прогресс: <span className="font-bold text-purple-600 dark:text-purple-400">{selectedConnection.maintenance_months_accrued || 0}</span> из {selectedConnection.maintenance_months_total || selectedConnection.maintenance_months_limit || 2} мес.
                  </div>
                </div>

                {canEdit ? (
                  <div className="pt-2 border-t border-zinc-200/40 dark:border-zinc-700/40 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 block">
                        Срок сопровождения (месяцев):
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        По умолчанию 2 мес. Задайте срок (1, 3, 4 и т.д.)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        size="sm"
                        mono
                        min="1"
                        max="24"
                        value={editMaintenanceMonthsTotal}
                        onChange={(e) => setEditMaintenanceMonthsTotal(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 text-center font-bold"
                      />
                      <Button
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                        onClick={handleSaveMaintenanceMonths}
                        loading={isUpdatingMaintenanceMonths}
                        disabled={editMaintenanceMonthsTotal === (selectedConnection.maintenance_months_total || selectedConnection.maintenance_months_limit || 2)}
                        leftIcon={<Check className="w-3 h-3" />}
                      >
                        Сохранить
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Проводки начислений ЗП */}
              <div className="pt-2 border-t border-zinc-200/50 dark:border-zinc-700/50">
                <ConnectionAccrualsSection
                  connectionId={selectedConnection.connection_id}
                  isAdmin={canEditAccruals}
                  onUpdated={fetchData}
                />
              </div>
            </div>
          </Modal>
        )}

        {/* 5. Модальное окно пакетного начисления бонусов (Admin Only) */}
        <AccrueBonusesModal
          isOpen={isAccrueBonusesModalOpen}
          onClose={() => setIsAccrueBonusesModalOpen(false)}
          onSuccess={fetchData}
          months={accrualMonths}
        />

        {/* 6. Диалог подтверждения удаления подключения (Admin Only) */}
        <ConfirmDialog
          open={connectionToDelete !== null}
          onClose={() => !isDeletingConnection && setConnectionToDelete(null)}
          onConfirm={() => (connectionToDelete ? handleDeleteConnection(connectionToDelete) : undefined)}
          title="Удалить подключение?"
          subtitle={
            connectionToDelete
              ? `${connectionToDelete.seller_name} (${formatPhoneDisplay(connectionToDelete.seller_phone)})`
              : undefined
          }
          tone="danger"
          icon={Trash2}
          confirmLabel="Удалить подключение"
          level={2}
          description={
            <div className="space-y-1.5">
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
                <span>Внимание: действие необратимо</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Будут удалены все начисления консультанта по этому клиенту, а назначенный консультант в карточке продавца будет автоматически сброшен.
              </p>
            </div>
          }
        />

        {/* 6.1. Диалог отклонения подключения с причиной (Admin Only) */}
        <ConfirmDialog
          open={rejectDialog.connection !== null}
          onClose={() => setRejectDialog({ connection: null, reason: '' })}
          onConfirm={handleRejectConnection}
          title="Отклонить подключение?"
          subtitle={
            rejectDialog.connection
              ? `${rejectDialog.connection.seller_name} (${formatPhoneDisplay(rejectDialog.connection.seller_phone)}) → ${
                  rejectDialog.connection.manager_user?.full_name || 'консультант'
                }`
              : undefined
          }
          tone="warning"
          icon={XCircle}
          confirmLabel="Отклонить"
          confirmDisabled={rejectDialog.reason.trim().length < 3}
          level={2}
          description="Консультант у продавца будет снят, привязанный лид вернется в статус «Назначен». Консультант получит уведомление с причиной."
        >
          <FormField label="Причина отклонения" required hint="Не менее 3 символов">
            <Textarea
              value={rejectDialog.reason}
              onChange={(e) => setRejectDialog((prev) => ({ ...prev, reason: e.target.value }))}
              rows={3}
              autoFocus
              maxLength={500}
              placeholder="Например: продавец уже ведется другим сотрудником, дубликат, не наш клиент..."
            />
          </FormField>
        </ConfirmDialog>

        {/* 7. Диалог массового изменения срока сопровождения */}
        <Modal
          open={bulkMaintenanceModal.isOpen}
          onClose={() => !isBatchLoading && setBulkMaintenanceModal({ isOpen: false, months: 2 })}
          title="Изменить срок сопровождения"
          subtitle={`Выбрано подключений: ${selectedConnectionIds.length}`}
          icon={Clock}
          tone="purple"
          size="md"
          busy={isBatchLoading}
          footer={
            <>
              <Button variant="outline" disabled={isBatchLoading} onClick={() => setBulkMaintenanceModal({ isOpen: false, months: 2 })}>
                Отмена
              </Button>
              <Button
                className="bg-purple-600 hover:bg-purple-700 text-white"
                loading={isBatchLoading}
                onClick={() => handleBulkUpdateMaintenanceMonths(() => setSelectedConnectionIds([]))}
                leftIcon={<Check className="w-3.5 h-3.5" strokeWidth={1.75} />}
              >
                Применить срок
              </Button>
            </>
          }
        >
          <FormField label="Общий срок сопровождения (месяцев)" hint="Значение будет установлено для всех выбранных клиентов.">
            <Input
              type="number"
              min={1}
              max={24}
              mono
              value={bulkMaintenanceModal.months}
              onChange={(e) =>
                setBulkMaintenanceModal((prev) => ({
                  ...prev,
                  months: Math.max(1, parseInt(e.target.value) || 1),
                }))
              }
            />
          </FormField>
        </Modal>

        {/* 8. Диалог массового начисления бонусов выбранным */}
        <Modal
          open={bulkAccrueModal.isOpen}
          onClose={() => !isBatchLoading && closeBulkAccrueModal()}
          title="Начислить бонусы выбранным"
          subtitle={`Выбрано клиентов: ${selectedConnectionIds.length}`}
          icon={Coins}
          tone="success"
          size="md"
          busy={isBatchLoading}
          footer={
            <>
              <Button variant="outline" disabled={isBatchLoading} onClick={closeBulkAccrueModal}>
                Отмена
              </Button>
              <Button
                variant="success"
                loading={isBatchLoading}
                onClick={() => handleBulkAccrueSelected(() => setSelectedConnectionIds([]))}
                leftIcon={<Coins className="w-3.5 h-3.5" strokeWidth={1.75} />}
              >
                Запустить начисление
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <FormField label="Тип начисления" hint="Начисляются только подтвержденные администратором подключения.">
              <Select
                value={bulkAccrueModal.mode}
                onChange={(e) =>
                  setBulkAccrueModal((prev) => ({
                    ...prev,
                    mode: e.target.value as 'connection_only' | 'maintenance_only',
                  }))
                }
              >
                <option value="maintenance_only">Сопровождение за расчетный месяц</option>
                <option value="connection_only">Проверить бонусы за подключение (доначислить пропущенные)</option>
              </Select>
            </FormField>
            <FormField label="Расчетный месяц">
              <Input
                type="month"
                mono
                value={bulkAccrueModal.month}
                onChange={(e) => setBulkAccrueModal((prev) => ({ ...prev, month: e.target.value }))}
              />
            </FormField>
          </div>
        </Modal>
      </div>
    </AppLayout>
  );
}
