'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef, type StatusOption, type DataJournalTab } from '@/components/ui/DataJournal';
import { EntityModal, type EntityFieldConfig } from '@/components/ui/EntityModal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, useConfirm } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { formatPhoneDisplay, telHref, waHref } from '@/lib/utils/phone';
import { api } from '@/lib/api/client';
import {
  getSellersStats,
  getManagersList,
  deleteSellerPermanently,
  type SellerItem,
  type SellersStats,
} from './actions';
import {
  Store,
  Phone,
  MessageCircle,
  UserCheck,
  ShieldAlert,
  Wallet,
  CheckCircle2,
  Clock,
  Building2,
  Users2,
  RefreshCw,
  Loader2,
  RotateCcw,
  Plus,
  Trash2,
  Users,
  UserMinus,
  Receipt,
  UserPlus,
  Hourglass,
  XCircle,
} from 'lucide-react';
import { SellerTransactionsTab } from '@/components/sellers/SellerTransactionsTab';
import { createClient } from '@/lib/supabase/client';
import dynamic from 'next/dynamic';
import { useUser } from '@/components/auth/AuthProvider';
import type { UserRole } from '@/types/database.types';
import { EmployeeBadge, EmployeeColorDot } from '@/components/ui/EmployeeBadge';
import { CuratorSelectDropdown } from '@/components/sellers/CuratorSelectDropdown';

const LinkSellerLeadModal = dynamic(
  () => import('@/components/sellers/LinkSellerLeadModal').then((m) => m.LinkSellerLeadModal),
  { ssr: false }
);

const SELLER_MODERATION_OPTIONS: StatusOption[] = [
  {
    value: 'approved',
    label: 'Одобрен',
    colorClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    dotColor: 'bg-emerald-500',
  },
  {
    value: 'pending',
    label: 'На модерации',
    colorClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    dotColor: 'bg-amber-500',
  },
  {
    value: 'rejected',
    label: 'Отклонен',
    colorClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
    dotColor: 'bg-rose-500',
  },
  {
    value: 'blocked',
    label: 'Заблокирован',
    colorClass: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
    dotColor: 'bg-zinc-500',
  },
];

/** Бейдж статуса подтверждения подключения администратором (миграция 037) */
function ConnectionConfirmationBadge({
  status,
  reason,
  size = 'sm',
}: {
  status?: string | null;
  reason?: string | null;
  size?: 'xs' | 'sm';
}) {
  if (status === 'pending') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 ${
          size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
        }`}
        title="Подключение ожидает подтверждения администратора"
      >
        <Hourglass className="w-3 h-3" strokeWidth={2} />
        Ожидает подтверждения
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 ${
          size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
        }`}
        title={reason ? `Причина: ${reason}` : 'Подключение отклонено администратором'}
      >
        <XCircle className="w-3 h-3" strokeWidth={2} />
        Отклонено
      </span>
    );
  }
  return null;
}

export default function SellersPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const user = useUser();
  const currentUserId = user.profile?.user_id || '';

  const [sellers, setSellers] = React.useState<SellerItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>(user.role);
  const [userName, setUserName] = React.useState(user.userName);
  const [userLogin, setUserLogin] = React.useState(user.userLogin);

  // Статистика базы продавцов
  const [stats, setStats] = React.useState<SellersStats>({
    total: 0,
    active: 0,
    pendingModeration: 0,
    totalBalance: 0,
    assigned: 0,
  });

  // Список кураторов для фильтрации и назначения
  const [managers, setManagers] = React.useState<
    { user_id: string; full_name: string; role: string; login: string; color?: string }[]
  >([]);

  // Состояние модального окна EntityModal (строго режим просмотра)
  const [modalState, setModalState] = React.useState<{
    isOpen: boolean;
    mode: 'view';
    selectedSeller: SellerItem | null;
  }>({
    isOpen: false,
    mode: 'view',
    selectedSeller: null,
  });

  // Состояние модального окна связывания с лидом
  const [linkLeadModal, setLinkLeadModal] = React.useState<{
    isOpen: boolean;
    seller: SellerItem | null;
  }>({
    isOpen: false,
    seller: null,
  });

  // Состояние активной вкладки модального окна продавца
  const [sellerModalTab, setSellerModalTab] = React.useState<string>('main');

  // Состояние диалога отвязки лида от продавца
  const [sellerToUnlink, setSellerToUnlink] = React.useState<SellerItem | null>(null);
  const [isUnlinkingLead, setIsUnlinkingLead] = React.useState(false);

  // Состояние диалога безвозвратного удаления продавца (Admin Only)
  const [sellerToDelete, setSellerToDelete] = React.useState<SellerItem | null>(null);
  const [isDeletingSeller, setIsDeletingSeller] = React.useState(false);

  const handleConfirmUnlinkLead = async () => {
    if (!sellerToUnlink) return;
    setIsUnlinkingLead(true);
    try {
      await api.sellers.unlinkLead(sellerToUnlink.seller_phone);
      showToast('Лид успешно отвязан от продавца', 'success');
      setSellerToUnlink(null);
      setModalState({ isOpen: false, mode: 'view', selectedSeller: null });
      await fetchSellersData(1, searchQuery, true);
    } catch (err: any) {
      showToast(err.message || 'Ошибка при отвязке лида', 'error');
    } finally {
      setIsUnlinkingLead(false);
    }
  };

  const handleConfirmDeleteSeller = async () => {
    if (!sellerToDelete) return;
    setIsDeletingSeller(true);
    try {
      const res = await deleteSellerPermanently(sellerToDelete.seller_phone);
      if (!res.success) {
        throw new Error(res.error || 'Ошибка при удалении');
      }
      showToast('Продавец навсегда удален из базы', 'success');
      setSellerToDelete(null);
      if (modalState.selectedSeller?.seller_phone === sellerToDelete.seller_phone) {
        setModalState({ isOpen: false, mode: 'view', selectedSeller: null });
      }
      await fetchSellersData(1, searchQuery, true);
    } catch (err: any) {
      showToast(err.message || 'Ошибка удаления продавца', 'error');
    } finally {
      setIsDeletingSeller(false);
    }
  };

  // Поиск и Фильтры (ЯРУС 1)
  const [searchQuery, setSearchQuery] = React.useState('');
  const [curatorTab, setCuratorTab] = React.useState<string>(
    user.role === 'consultant' ? 'my' : 'all'
  );
  const [filterActive, setFilterActive] = React.useState<string>('all');
  const [filterManager, setFilterManager] = React.useState<string>('all');
  const [hasAvailableLeads, setHasAvailableLeads] = React.useState<boolean>(false);

  const formatPhone = (p?: string | null) => formatPhoneDisplay(p);

  // Массовые действия для администратора
  const [selectedSellerIds, setSelectedSellerIds] = React.useState<string[]>([]);
  const [isBatchLoading, setIsBatchLoading] = React.useState(false);

  // Загрузка начальных данных
  const fetchSellersData = React.useCallback(
    async (page = 1, search = '', silent = false, tabOverride?: string) => {
      if (!silent) {
        setIsLoading(true);
      }
      try {
        const activeTab = tabOverride !== undefined ? tabOverride : curatorTab;
        let effectiveManagerId = filterManager;
        if (activeTab === 'my') {
          effectiveManagerId = 'my';
        } else if (activeTab === 'unassigned') {
          effectiveManagerId = 'unassigned';
        } else if (activeTab === 'all') {
          effectiveManagerId = filterManager !== 'all' ? filterManager : 'all';
        }

        const [sellersRes, leadsCheckRes, statsRes, managersRes] = await Promise.all([
          api.sellers.getAll({
            page,
            pageSize: 50,
            search,
            moderation: 'all',
            isActive: filterActive,
            managerId: effectiveManagerId,
          }),
          api.sellers.checkAvailableLeads().catch(() => ({ has_available_leads: false, available_count: 0 })),
          getSellersStats(),
          getManagersList(),
        ]);

        setSellers(sellersRes.items || []);
        setTotalCount(sellersRes.total || 0);
        setStats(statsRes);
        setManagers(managersRes);
        setHasAvailableLeads(Boolean(leadsCheckRes.has_available_leads));
      } catch (err: any) {
        console.error(err);
        if (err.status === 403 || err.message?.includes('SMM')) {
          showToast('Доступ к базе продавцов закрыт для SMM-специалистов', 'error');
          router.push('/leads');
          return;
        }
        showToast(err.message || 'Ошибка при загрузке базы продавцов', 'error');
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [curatorTab, filterActive, filterManager, router, showToast]
  );

  const handleBatchManager = async (managerId: string | null, clearSelection: () => void) => {
    if (selectedSellerIds.length === 0) return;
    setIsBatchLoading(true);
    try {
      await api.sellers.batch({
        seller_ids: selectedSellerIds,
        action: 'change_manager',
        manager_id: managerId,
      });
      showToast(`Куратор назначен для ${selectedSellerIds.length} продавцов`, 'success');
      clearSelection();
      await fetchSellersData(1, searchQuery, true);
    } catch (err: any) {
      showToast(err.message || 'Ошибка массового назначения куратора', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  const handleBatchDelete = async (clearSelection: () => void) => {
    if (selectedSellerIds.length === 0) return;
    const ok = await confirm({
      title: 'Удалить выбранных продавцов?',
      subtitle: `Выбрано продавцов: ${selectedSellerIds.length}`,
      description: 'Записи будут удалены из локальной базы SotkaCRM, привязанные лиды — отвязаны.',
      tone: 'danger',
      icon: Trash2,
      confirmLabel: 'Удалить',
    });
    if (!ok) return;
    setIsBatchLoading(true);
    try {
      await api.sellers.batch({
        seller_ids: selectedSellerIds,
        action: 'delete',
      });
      showToast(`Удалено ${selectedSellerIds.length} продавцов`, 'success');
      clearSelection();
      await fetchSellersData(1, searchQuery, true);
    } catch (err: any) {
      showToast(err.message || 'Ошибка массового удаления', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  // Вкладки категорий кураторства для DataJournal
  const sellerTabs: DataJournalTab[] = React.useMemo(() => {
    return [
      { id: 'all', label: 'Все', icon: Users, count: stats.total },
      { id: 'my', label: 'Мои продавцы', icon: UserCheck, count: currentUserRole === 'consultant' ? stats.assigned : undefined },
      { id: 'unassigned', label: 'Без куратора', icon: UserMinus, count: Math.max(0, stats.total - stats.assigned) },
    ];
  }, [stats, currentUserRole]);

  const handleTabChange = (tabId: string) => {
    setCuratorTab(tabId);
    fetchSellersData(1, searchQuery, false, tabId);
  };

  React.useEffect(() => {
    if (user.profile) {
      if (user.role === 'smm') {
        showToast('Доступ к реестру продавцов запрещен вашей роли', 'error');
        router.push('/leads');
        return;
      }
      setCurrentUserRole(user.role);
      setUserName(user.userName);
      setUserLogin(user.userLogin);
    }
  }, [user, router, showToast]);

  React.useEffect(() => {
    fetchSellersData();
  }, [fetchSellersData]);

  const handleAssignManager = async (sellerPhone: string, managerId: string | null) => {
    const previousSellers = [...sellers];
    const targetManager = managers.find((m) => m.user_id === managerId);

    // Оптимистичное обновление
    setSellers((prev) =>
      prev.map((s) => {
        if (s.seller_phone === sellerPhone) {
          return {
            ...s,
            manager_id: managerId,
            manager_user: targetManager
              ? {
                  user_id: targetManager.user_id,
                  full_name: targetManager.full_name,
                  role: targetManager.role,
                  login: targetManager.login,
                  color: targetManager.color,
                }
              : null,
          };
        }
        return s;
      })
    );

    try {
      await api.sellers.update(sellerPhone, { manager_id: managerId });
      showToast('Куратор назначен. Связь в подключениях синхронизирована', 'success');
      await fetchSellersData(1, searchQuery, true);
    } catch (err: any) {
      setSellers(previousSellers);
      showToast(err.message || 'Ошибка при назначении куратора', 'error');
    }
  };

  // Консультант берет свободного одобренного продавца себе (подключение ждет подтверждения администратора)
  const canTakeSeller = React.useCallback(
    (seller: SellerItem) =>
      currentUserRole === 'consultant' &&
      !seller.manager_id &&
      seller.moderation === 'approved' &&
      !seller.is_deleted_from_source,
    [currentUserRole]
  );

  const [takingPhone, setTakingPhone] = React.useState<string | null>(null);

  const handleTakeSelf = React.useCallback(
    async (seller: SellerItem) => {
      if (!canTakeSeller(seller)) return;
      const ok = await confirm({
        title: 'Взять продавца себе?',
        subtitle: `${seller.seller_name || seller.store} (${formatPhoneDisplay(seller.seller_phone)})`,
        description:
          'Вы станете куратором продавца. Бонус за подключение будет начислен после подтверждения администратором.',
        tone: 'info',
        icon: UserPlus,
        confirmLabel: 'Взять себе',
      });
      if (!ok) return;

      setTakingPhone(seller.seller_phone);
      const previousSellers = sellers;
      const me = managers.find((m) => m.user_id === currentUserId);
      // Оптимистичное обновление: куратор — текущий консультант, подключение ожидает подтверждения
      setSellers((prev) =>
        prev.map((s) =>
          s.seller_phone === seller.seller_phone
            ? {
                ...s,
                manager_id: currentUserId,
                manager_user: me
                  ? { user_id: me.user_id, full_name: me.full_name, role: me.role, login: me.login, color: me.color }
                  : { user_id: currentUserId, full_name: user.userName || 'Вы', role: 'consultant', login: user.userLogin || '' },
                connection: { connection_id: s.connection?.connection_id || '', manager_id: currentUserId, confirmation_status: 'pending' },
              }
            : s
        )
      );

      try {
        const res = await api.sellers.takeSelf(seller.seller_phone);
        showToast(res.message || 'Продавец закреплен за вами. Ожидает подтверждения администратора', 'info');
        setModalState((prev) =>
          prev.selectedSeller?.seller_phone === seller.seller_phone
            ? {
                ...prev,
                selectedSeller: {
                  ...prev.selectedSeller,
                  manager_id: currentUserId,
                  manager_user: me
                    ? { user_id: me.user_id, full_name: me.full_name, role: me.role, login: me.login, color: me.color }
                    : prev.selectedSeller.manager_user,
                  connection: { connection_id: res.connection_id || '', manager_id: currentUserId, confirmation_status: 'pending' },
                },
              }
            : prev
        );
        await fetchSellersData(1, searchQuery, true);
      } catch (err: any) {
        setSellers(previousSellers);
        showToast(err.message || 'Не удалось взять продавца', 'error');
        if (err.code === 'SELLER_ALREADY_TAKEN') await fetchSellersData(1, searchQuery, true);
      } finally {
        setTakingPhone(null);
      }
    },
    [canTakeSeller, confirm, sellers, managers, currentUserId, user.userName, user.userLogin, showToast, fetchSellersData, searchQuery]
  );

  /** Куратор продавца в ячейке/карточке для не-администратора: бейдж, статус подтверждения, «Взять себе» */
  const renderCuratorReadOnly = React.useCallback(
    (seller: SellerItem, size: 'xs' | 'sm' = 'sm') => {
      if (canTakeSeller(seller)) {
        return (
          <Button
            variant="info"
            size="xs"
            loading={takingPhone === seller.seller_phone}
            onClick={(e) => {
              e.stopPropagation();
              handleTakeSelf(seller);
            }}
            leftIcon={<UserPlus className="w-3 h-3" strokeWidth={2} />}
            title="Стать куратором этого продавца (подтверждает администратор)"
          >
            Взять себе
          </Button>
        );
      }
      if (!seller.manager_user) {
        return <span className="text-[11px] text-zinc-400 italic">— Не назначен —</span>;
      }
      return (
        <div className="flex flex-col items-start gap-1 min-w-0">
          <EmployeeBadge name={seller.manager_user.full_name} color={seller.manager_user.color} size={size} />
          <ConnectionConfirmationBadge
            status={seller.connection?.confirmation_status}
            reason={seller.connection?.rejection_reason}
            size="xs"
          />
        </div>
      );
    },
    [canTakeSeller, takingPhone, handleTakeSelf]
  );

  // Конфигурация колонок DataJournal (мемоизирована для стабилизации виртуализатора)
  const columns: ColumnDef<SellerItem>[] = React.useMemo(
    () => [
      {
        key: 'seller_name',
        label: 'Продавец',
        minWidth: 180,
        sortable: true,
        filterable: true,
        renderCell: (row: SellerItem) => (
          <div className="flex items-center gap-2.5">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-medium text-xs flex-shrink-0 ${
              row.is_deleted_from_source
                ? 'bg-rose-500/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400'
                : 'bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400'
            }`}>
              <Store className="w-3.5 h-3.5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {row.seller_name || 'Не указано'}
                </span>
                {row.is_deleted_from_source && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 flex-shrink-0">
                    Удален в HQ
                  </span>
                )}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                {row.store || 'Без названия'}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: 'linked_lead',
        label: 'Связанный лид',
        width: 170,
        minWidth: 140,
        sortable: false,
        renderCell: (row: SellerItem) => {
          if (!row.linked_lead) {
            return <span className="text-[11px] text-zinc-400">Прямое подключение</span>;
          }
          return (
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {row.linked_lead.client_name}
              </span>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                Лид: {row.linked_lead.status}
              </span>
            </div>
          );
        },
      },
      {
        key: 'store',
        label: 'Магазин',
        minWidth: 140,
        sortable: true,
        filterable: true,
        renderCell: (row: SellerItem) => (
          <span className="text-xs text-zinc-700 dark:text-zinc-300 font-medium truncate">
            {row.store || '—'}
          </span>
        ),
      },
      {
        key: 'seller_phone',
        label: 'Телефон',
        type: 'phone',
        width: 170,
        minWidth: 140,
        sortable: true,
        filterable: true,
        phoneAccessor: (row: SellerItem) => row.seller_phone,
        renderCell: (row: SellerItem) => (
          <span className="text-xs font-mono text-zinc-800 dark:text-zinc-200">
            {formatPhone(row.seller_phone)}
          </span>
        ),
      },
      {
        key: 'balance',
        label: 'Баланс',
        type: 'currency',
        width: 130,
        minWidth: 110,
        sortable: true,
        filterable: true,
        renderCell: (row: SellerItem) => {
          const bal = Number(row.balance) || 0;
          return (
            <span
              className={`text-xs font-semibold font-mono ${
                bal > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {bal.toLocaleString('ru-RU')} KGS
            </span>
          );
        },
      },
      {
        key: 'plan_name',
        label: 'Тариф',
        width: 120,
        minWidth: 100,
        sortable: true,
        filterable: true,
        groupable: true,
        renderCell: (row: SellerItem) => (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-700/60">
            {row.plan_name || 'Базовый'}
          </span>
        ),
      },
      {
        key: 'moderation',
        label: 'Модерация',
        width: 140,
        minWidth: 120,
        sortable: true,
        filterable: true,
        groupable: true,
        renderCell: (row: SellerItem) => {
          const modOpt =
            SELLER_MODERATION_OPTIONS.find((o) => o.value === row.moderation) ||
            SELLER_MODERATION_OPTIONS[0];
          return (
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${modOpt.colorClass}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${modOpt.dotColor || 'bg-current'}`}
              />
              {modOpt.label}
            </span>
          );
        },
      },
      {
        key: 'is_active',
        label: 'Статус',
        width: 110,
        minWidth: 90,
        sortable: true,
        filterable: true,
        groupable: true,
        filterType: 'select',
        filterOptions: [
          { value: 'true', label: 'Активен' },
          { value: 'false', label: 'Неактивен' },
        ],
        renderCell: (row: SellerItem) => (
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-medium ${
              row.is_active
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                : 'bg-zinc-200/60 dark:bg-zinc-800 text-zinc-500 border border-zinc-300/40 dark:border-zinc-700/40'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                row.is_active ? 'bg-emerald-500' : 'bg-zinc-400'
              }`}
            />
            {row.is_active ? 'Активен' : 'Неактивен'}
          </span>
        ),
      },
      {
        key: 'outlets_count',
        label: 'Точек / Сотр.',
        width: 120,
        minWidth: 100,
        sortable: true,
        filterable: false,
        renderCell: (row: SellerItem) => (
          <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono">
            {row.outlets_count} / {row.employees_count}
          </span>
        ),
      },
      {
        key: 'registered_at',
        label: 'Регистрация',
        width: 120,
        minWidth: 100,
        sortable: true,
        filterable: false,
        renderCell: (row: SellerItem) => (
          <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono whitespace-nowrap">
            <FormattedDate date={row.registered_at} type="dateTime" fallback="—" />
          </span>
        ),
      },
      {
        key: 'manager_id',
        label: 'Куратор',
        width: 190,
        minWidth: 160,
        sortable: true,
        filterable: true,
        groupable: true,
        filterType: 'select',
        filterOptions: [
          { value: '', label: '— Не назначен —' },
          ...managers.map((m) => ({ value: m.user_id, label: m.full_name })),
        ],
        renderCell: (row: SellerItem) => {
          if (currentUserRole === 'admin') {
            return (
              <div className="flex flex-col gap-1">
                <CuratorSelectDropdown
                  value={row.manager_id}
                  managers={managers}
                  onChange={async (val) => {
                    await handleAssignManager(row.seller_phone, val);
                  }}
                  size="sm"
                  className="w-[170px]"
                />
                <ConnectionConfirmationBadge
                  status={row.manager_id ? row.connection?.confirmation_status : null}
                  reason={row.connection?.rejection_reason}
                  size="xs"
                />
              </div>
            );
          }
          return renderCuratorReadOnly(row, 'sm');
        },
      },
      {
        key: 'linked_lead',
        label: 'Лид',
        width: 175,
        minWidth: 145,
        sortable: false,
        filterable: false,
        renderCell: (row: SellerItem) => {
          if (row.linked_lead) {
            return (
              <div className="flex items-center gap-1.5" title={`Лид: ${row.linked_lead.client_name}`}>
                <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  <UserCheck className="w-3 h-3" />
                </span>
                <div className="truncate">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate block">
                    {row.linked_lead.client_name}
                  </span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                    {row.linked_lead.status}
                  </span>
                </div>
              </div>
            );
          }

          if (!row.manager_id && hasAvailableLeads && (currentUserRole === 'admin' || currentUserRole === 'consultant')) {
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLinkLeadModal({ isOpen: true, seller: row });
                }}
                className="h-7 px-2 text-[11px] font-semibold rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 transition-all flex items-center gap-1"
                title="Привязать свободный лид"
              >
                <Plus className="w-3 h-3" />
                <span>Связать с лидом</span>
              </button>
            );
          }

          return (
            <span className="text-[11px] text-zinc-400 italic">
              {row.manager_id ? 'Куратор назначен' : '—'}
            </span>
          );
        },
      },
    ],
    [currentUserRole, managers, handleAssignManager, hasAvailableLeads, renderCuratorReadOnly]
  );

  // Конфигурация полей для EntityModal
  const modalFields: EntityFieldConfig<SellerItem>[] = [
    {
      name: 'seller_name',
      label: 'ФИО продавца',
      type: 'text',
      immutable: true,
      helperText: 'Синхронизируется из Sotka API',
    },
    {
      name: 'store',
      label: 'Название магазина',
      type: 'text',
      immutable: true,
    },
    {
      name: 'linked_lead',
      label: 'Связанный лид из воронки',
      type: 'text',
      immutable: true,
      renderCustomView: (_val: any, data: SellerItem) => {
        if (!data.linked_lead) {
          return (
            <span className="text-xs text-zinc-400">Прямое подключение (без лида)</span>
          );
        }
        return (
          <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                {data.linked_lead.client_name}
              </p>
              <p className="text-[11px] text-zinc-400 font-mono">
                ID: {data.linked_lead.lead_id.slice(0, 8)}...
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Лид: {data.linked_lead.status}
            </span>
          </div>
        );
      },
    },
    {
      name: 'seller_phone',
      label: 'Телефон',
      type: 'phone',
      immutable: true,
      helperText: 'Формат: 996XXXXXXXXX (12 цифр)',
    },
    {
      name: 'balance',
      label: 'Баланс (KGS)',
      type: 'currency',
      immutable: true,
    },
    {
      name: 'plan_name',
      label: 'Тарифный план',
      type: 'text',
      immutable: true,
    },
    {
      name: 'moderation',
      label: 'Статус модерации',
      type: 'text',
      immutable: true,
    },
    {
      name: 'is_active',
      label: 'Активность',
      type: 'text',
      immutable: true,
      renderCustomView: (val: any) => (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium ${
            val
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${val ? 'bg-emerald-500' : 'bg-zinc-400'}`}
          />
          {val ? 'Аккаунт активен' : 'Аккаунт отключен'}
        </span>
      ),
    },
    {
      name: 'outlets_count',
      label: 'Количество торговых точек',
      type: 'number',
      immutable: true,
    },
    {
      name: 'employees_count',
      label: 'Количество сотрудников',
      type: 'number',
      immutable: true,
    },
    {
      name: 'brands',
      label: 'Бренды',
      type: 'text',
      immutable: true,
      helperText: 'Список брендов продавца',
    },
    {
      name: 'registered_at',
      label: 'Дата регистрации в Sotka',
      type: 'text',
      immutable: true,
      renderCustomView: (val: any) => (
        <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400">
          <FormattedDate date={val} type="dateTime" fallback="Нет данных" />
        </span>
      ),
    },
    {
      name: 'last_activity',
      label: 'Последняя активность',
      type: 'text',
      immutable: true,
      renderCustomView: (val: any) => (
        <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400">
          <FormattedDate date={val} type="dateTime" fallback="Нет активности" />
        </span>
      ),
    },
    {
      name: 'synced_at',
      label: 'Последняя синхронизация',
      type: 'text',
      immutable: true,
      renderCustomView: (val: any) => (
        <span className="text-xs font-mono text-zinc-500">
          <FormattedDate date={val} type="dateTime" fallback="Не синхронизировался" />
        </span>
      ),
    },
    {
      name: 'manager_id',
      label: 'Ответственный куратор',
      type: 'text',
      immutable: true,
      renderCustomView: (_val: any, data: SellerItem) => {
        if (currentUserRole === 'admin') {
          return (
            <div className="w-full space-y-1.5">
              <CuratorSelectDropdown
                value={data?.manager_id}
                managers={managers}
                onChange={async (val) => {
                  await handleAssignManager(data.seller_phone, val);
                  setModalState((prev) =>
                    prev.selectedSeller
                      ? {
                          ...prev,
                          selectedSeller: {
                            ...prev.selectedSeller,
                            manager_id: val,
                            manager_user: val
                              ? managers.find((m) => m.user_id === val) || null
                              : null,
                            connection: val
                              ? { connection_id: prev.selectedSeller.connection?.connection_id || '', manager_id: val, confirmation_status: 'confirmed' }
                              : null,
                          },
                        }
                      : prev
                  );
                }}
                size="md"
                className="w-full"
              />
              <ConnectionConfirmationBadge
                status={data?.manager_id ? data?.connection?.confirmation_status : null}
                reason={data?.connection?.rejection_reason}
              />
            </div>
          );
        }
        return renderCuratorReadOnly(data, 'sm');
      },
    },
  ];

  // Расчет количества активных фильтров (ЯРУС 1)
  const activeFilterCount =
    (filterActive !== 'all' ? 1 : 0) +
    (filterManager !== 'all' ? 1 : 0);

  // Содержимое всплывающего окна фильтров TopHeader / MobileHeader
  const filterContent = (
    <div className="space-y-3.5">

      <div>
        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Активность
        </label>
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value)}
          className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          <option value="all">Все статусы активности</option>
          <option value="true">● Только активные</option>
          <option value="false">● Только неактивные</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Куратор
        </label>
        <select
          value={filterManager}
          onChange={(e) => setFilterManager(e.target.value)}
          className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          {currentUserRole === 'consultant' ? (
            <>
              <option value="all">Все доступные</option>
              <option value="my">● Мои продавцы</option>
              <option value="unassigned">— Свободные (без куратора) —</option>
            </>
          ) : (
            <>
              <option value="all">Все кураторы</option>
              <option value="unassigned">— Без куратора —</option>
              {managers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  ● {m.full_name}
                </option>
              ))}
            </>
          )}
        </select>
      </div>

      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setCuratorTab(currentUserRole === 'consultant' ? 'my' : 'all');
            setFilterActive('all');
            setFilterManager('all');
          }}
          className="w-full h-9 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Сбросить фильтры</span>
        </button>
      )}
    </div>
  );

  // Контекстные действия тулбара реестра продавцов (ЯРУС 3)
  const sellerActions = (
    <button
      type="button"
      onClick={() => fetchSellersData()}
      className="h-9 md:h-11 w-9 md:w-auto p-0 md:px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center md:gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive flex-shrink-0"
      title="Обновить базу продавцов"
      aria-label="Обновить базу продавцов"
    >
      <RefreshCw className="w-4 h-4 text-blue-500 flex-shrink-0" strokeWidth={1.75} />
      <span className="hidden md:inline">Обновить</span>
    </button>
  );

  // Кастомный рендеринг карточки продавца для мобильных устройств (Card View)
  const renderSellerCard = (seller: SellerItem) => {
    const bal = Number(seller.balance) || 0;
    const cleanPhone = seller.seller_phone.replace(/\D/g, '');
    const modOpt = SELLER_MODERATION_OPTIONS.find((o) => o.value === seller.moderation) || {
      value: seller.moderation,
      label: seller.moderation,
      colorClass: 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30',
      dotColor: 'bg-zinc-500',
    };

    return (
      <div
        key={seller.seller_phone}
        onClick={() =>
          setModalState({
            isOpen: true,
            mode: 'view',
            selectedSeller: seller,
          })
        }
        className="rounded-2xl sm:rounded-3xl island-glass border border-white/20 dark:border-zinc-800/40 p-3.5 sm:p-4 space-y-3 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition-all shadow-sm"
      >
        {/* Верхняя строка: Магазин, имя продавца и бейджи статуса */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                <Store className="w-3.5 h-3.5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate">
                  <h4 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    {seller.seller_name || 'Без имени'}
                  </h4>
                  {seller.is_deleted_from_source && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 flex-shrink-0">
                      Удален в HQ
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                  {seller.store || 'Без названия'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border flex items-center gap-1 ${modOpt.colorClass}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${modOpt.dotColor || 'bg-current'}`} />
              <span>{modOpt.label}</span>
            </span>
            <span
              className={`text-[10px] font-medium flex items-center gap-1 ${
                seller.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  seller.is_active ? 'bg-emerald-500' : 'bg-zinc-400'
                }`}
              />
              <span>{seller.is_active ? 'Активен' : 'Неактивен'}</span>
            </span>
          </div>
        </div>

        {/* Телефон и быстрые кнопки связи */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-200/50 dark:border-zinc-800/50">
          <div className="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            {formatPhone(seller.seller_phone)}
          </div>
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {cleanPhone && (
              <>
                <a
                  href={telHref(seller.seller_phone)}
                  className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 transition-colors"
                  title="Позвонить"
                >
                  <Phone className="w-3.5 h-3.5" strokeWidth={1.75} />
                </a>
                <a
                  href={waHref(seller.seller_phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition-colors"
                  title="WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                </a>
              </>
            )}
          </div>
        </div>

        {/* Характеристики: Баланс, Тариф, Точки/Сотрудники */}
        <div className="grid grid-cols-3 gap-2 py-1.5 px-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-zinc-700/50 text-center">
          <div>
            <span className="text-[10px] text-zinc-400 block">Баланс</span>
            <span
              className={`text-xs font-bold font-mono ${
                bal > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-zinc-700 dark:text-zinc-300'
              }`}
            >
              {bal.toLocaleString('ru-RU')} c
            </span>
          </div>
          <div>
            <span className="text-[10px] text-zinc-400 block">Тариф</span>
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate block">
              {seller.plan_name || 'Базовый'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-zinc-400 block">Точек/Сотр</span>
            <span className="text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300">
              {seller.outlets_count} / {seller.employees_count}
            </span>
          </div>
        </div>

        {/* Назначение куратора и Связанный лид (Мобильный режим) */}
        <div className="space-y-2 pt-1 border-t border-zinc-200/50 dark:border-zinc-800/50">
          {/* Блок Куратора */}
          <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
            <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
              Куратор:
            </span>
            {currentUserRole === 'admin' ? (
              <div className="flex flex-col items-end gap-1 flex-1 max-w-[210px]">
                <CuratorSelectDropdown
                  value={seller.manager_id}
                  managers={managers}
                  onChange={async (val) => {
                    await handleAssignManager(seller.seller_phone, val);
                  }}
                  size="sm"
                  className="w-full max-w-[190px]"
                />
                <ConnectionConfirmationBadge
                  status={seller.manager_id ? seller.connection?.confirmation_status : null}
                  reason={seller.connection?.rejection_reason}
                  size="xs"
                />
              </div>
            ) : (
              <div>{renderCuratorReadOnly(seller, 'xs')}</div>
            )}
          </div>

          {/* Блок Привязки Лида */}
          <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
            <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
              Лид:
            </span>
            {seller.linked_lead ? (
              <div className="flex items-center gap-1.5 text-right min-w-0">
                <span className="w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <UserCheck className="w-2.5 h-2.5" />
                </span>
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate block">
                    {seller.linked_lead.client_name}
                  </span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                    {seller.linked_lead.status}
                  </span>
                </div>
              </div>
            ) : (!seller.manager_id && hasAvailableLeads && (currentUserRole === 'admin' || currentUserRole === 'consultant')) ? (
              <button
                type="button"
                onClick={() => setLinkLeadModal({ isOpen: true, seller })}
                className="h-7 px-2.5 text-[11px] font-semibold rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 transition-all flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>Связать с лидом</span>
              </button>
            ) : (
              <span className="text-[11px] text-zinc-400 italic">
                {seller.manager_id ? 'Куратор назначен' : 'Прямое подключение'}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCustomRowActions = React.useCallback(
    (row: SellerItem) => {
      const canLink =
        hasAvailableLeads &&
        (currentUserRole === 'admin' || currentUserRole === 'consultant') &&
        !row.linked_lead &&
        !row.manager_id;
      const canDelete = currentUserRole === 'admin';

      if (!canLink && !canDelete) {
        return null;
      }

      return (
        <div className="space-y-1">
          {canLink && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLinkLeadModal({ isOpen: true, seller: row });
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4 text-blue-500" strokeWidth={1.75} />
              <span>Связать с лидом</span>
            </button>
          )}

          {canDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSellerToDelete(row);
              }}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-rose-500" strokeWidth={1.75} />
              <span>{row.is_deleted_from_source ? 'Удалить навсегда (в HQ удален)' : 'Удалить навсегда'}</span>
            </button>
          )}
        </div>
      );
    },
    [hasAvailableLeads, currentUserRole]
  );

  return (
    <AppLayout
      userRole={currentUserRole}
      userName={userName}
      userLogin={userLogin}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Поиск по имени, телефону или магазину..."
      filterCount={activeFilterCount}
      filterContent={filterContent}
    >
      <div className="space-y-4">
        {/* ЯРУС 2: ВЕРХНИЙ БЛОК МЕТРИК / KPI КАРТОЧКИ (Адаптивная сетка: 2x2 + баланс на мобильных, 5 в ряд на десктопе) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
          {/* Всего продавцов */}
          <div className="p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl island-glass border border-white/20 dark:border-zinc-800/40 flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
              <Store className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                Всего продавцов
              </div>
              <div className="text-base sm:text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100">
                {stats.total}
              </div>
            </div>
          </div>

          {/* Активных */}
          <div className="p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl island-glass border border-white/20 dark:border-zinc-800/40 flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                Активные
              </div>
              <div className="text-base sm:text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {stats.active}
              </div>
            </div>
          </div>

          {/* Без куратора */}
          <div className="p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl island-glass border border-white/20 dark:border-zinc-800/40 flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
              <UserMinus className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                Без куратора
              </div>
              <div className="text-base sm:text-lg font-bold font-mono text-amber-600 dark:text-amber-400">
                {Math.max(0, stats.total - stats.assigned)}
              </div>
            </div>
          </div>

          {/* Закреплено */}
          <div className="p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl island-glass border border-white/20 dark:border-zinc-800/40 flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center flex-shrink-0">
              <UserCheck className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                С куратором
              </div>
              <div className="text-base sm:text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100">
                {stats.assigned}
                <span className="text-[11px] text-zinc-400 font-normal"> / {stats.total}</span>
              </div>
            </div>
          </div>

          {/* Общий баланс */}
          <div className="col-span-2 sm:col-span-1 p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl island-glass border border-white/20 dark:border-zinc-800/40 flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                Общий баланс
              </div>
              <div className="text-sm sm:text-base lg:text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100 truncate">
                {stats.totalBalance.toLocaleString('ru-RU')} KGS
              </div>
            </div>
          </div>
        </div>

        {/* УНИВЕРСАЛЬНЫЙ РЕЕСТР DATAJOURNAL (ЯРУС 3) */}
        {isLoading ? (
          <div className="p-12 text-center rounded-3xl island-glass border border-white/20 dark:border-zinc-800/40 space-y-3">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-zinc-400" strokeWidth={1.75} />
            <p className="text-xs text-zinc-500">Загрузка базы продавцов...</p>
          </div>
        ) : (
          <DataJournal
            data={sellers}
            columns={columns}
            keyField="seller_phone"
            storageKey="sotka_sellers_journal"
            searchPlaceholder="Поиск по имени, телефону или магазину..."
            emptyMessage="Продавцы не найдены. Выполните синхронизацию с Sotka API."
            totalCount={totalCount}
            externalSearchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            tabs={sellerTabs}
            activeTab={curatorTab}
            onTabChange={handleTabChange}
            enableSelection={currentUserRole === 'admin'}
            selectedIds={selectedSellerIds}
            onSelectionChange={setSelectedSellerIds}
            renderBulkActions={(ids, clearSelection) => (
              <div className="flex items-center gap-2">
                <select
                  disabled={isBatchLoading}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value !== '') {
                      const val = e.target.value === 'null' ? null : e.target.value;
                      handleBatchManager(val, clearSelection);
                      e.target.value = '';
                    }
                  }}
                  className="h-8 px-2.5 rounded-xl bg-white/10 border border-white/20 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer max-w-[170px] truncate"
                >
                  <option value="" disabled className="text-zinc-900 bg-white">Назначить куратора...</option>
                  <option value="null" className="text-zinc-900 bg-white">Без куратора</option>
                  {managers.map((m) => (
                    <option key={m.user_id} value={m.user_id} className="text-zinc-900 bg-white">
                      {m.full_name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={isBatchLoading}
                  onClick={() => handleBatchDelete(clearSelection)}
                  className="h-8 px-2.5 rounded-xl bg-rose-500/30 hover:bg-rose-500/40 text-rose-300 text-xs font-semibold border border-rose-500/40 transition-colors flex items-center gap-1"
                  title="Удалить продавцов"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                  <span>Удалить</span>
                </button>
              </div>
            )}
            customActions={sellerActions}
            customRowActions={renderCustomRowActions}
            renderCard={renderSellerCard}
            onRowClick={(seller) => {
              setSellerModalTab('main');
              setModalState({
                isOpen: true,
                mode: 'view',
                selectedSeller: seller,
              });
            }}
          />
        )}

        {/* МОДАЛЬНОЕ ОКНО ДЕТАЛЬНОГО ПРОСМОТРА КАРТОЧКИ ПРОДАВЦА */}
        {modalState.isOpen && (
          <EntityModal
            isOpen={modalState.isOpen}
            onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
            title={modalState.selectedSeller?.seller_name || 'Карточка продавца'}
            data={modalState.selectedSeller}
            fields={modalFields}
            keyField="seller_phone"
            phoneField="seller_phone"
            initialMode="view"
            tabs={[
              { id: 'main', label: 'Основная информация', icon: Store },
              { id: 'transactions', label: 'Транзакции Sotka HQ', icon: Receipt },
            ]}
            activeTab={sellerModalTab}
            onTabChange={setSellerModalTab}
            renderTabContent={(tabId) =>
              tabId === 'transactions' && modalState.selectedSeller ? (
                <SellerTransactionsTab
                  sellerPhoneOrId={
                    modalState.selectedSeller.organization_id
                      ? String(modalState.selectedSeller.organization_id)
                      : modalState.selectedSeller.seller_phone
                  }
                />
              ) : null
            }
            linkedBanner={
              modalState.selectedSeller?.linked_lead
                ? {
                    title: `Привлечен через лид: ${modalState.selectedSeller.linked_lead.client_name}`,
                    description: `Статус воронки: ${modalState.selectedSeller.linked_lead.status}`,
                    navigateLabel: 'К лиду',
                    onNavigate: () => {
                      router.push(
                        `/leads?search=${encodeURIComponent(
                          modalState.selectedSeller?.linked_lead?.client_name || ''
                        )}`
                      );
                    },
                    unlinkLabel:
                      currentUserRole === 'admin' || currentUserRole === 'consultant'
                        ? 'Отвязать лид'
                        : undefined,
                    onUnlink:
                      currentUserRole === 'admin' || currentUserRole === 'consultant'
                        ? () => setSellerToUnlink(modalState.selectedSeller)
                        : undefined,
                  }
                : undefined
            }
            onDelete={
              currentUserRole === 'admin' && modalState.selectedSeller?.is_deleted_from_source
                ? (seller) => setSellerToDelete(seller as SellerItem)
                : undefined
            }
            deleteLabel="Удалить навсегда (удален в HQ)"
          />
        )}

        {/* МОДАЛЬНОЕ ОКНО ПРИВЯЗКИ ПРОДАВЦА К ЛИДУ */}
        {linkLeadModal.isOpen && (
          <LinkSellerLeadModal
            isOpen={linkLeadModal.isOpen}
            onClose={() => setLinkLeadModal({ isOpen: false, seller: null })}
            seller={linkLeadModal.seller}
            onSuccess={() => fetchSellersData(1, searchQuery, true)}
          />
        )}

        {/* Диалог подтверждения отвязки лида от продавца */}
        <ConfirmDialog
          open={sellerToUnlink !== null}
          onClose={() => !isUnlinkingLead && setSellerToUnlink(null)}
          onConfirm={handleConfirmUnlinkLead}
          title="Отвязать лид от продавца?"
          subtitle={
            sellerToUnlink
              ? `${sellerToUnlink.seller_name || sellerToUnlink.store} (${formatPhoneDisplay(sellerToUnlink.seller_phone)})`
              : undefined
          }
          tone="warning"
          icon={RotateCcw}
          confirmLabel="Подтвердить отвязку"
          level={2}
          description={
            <>
              При отвязке связанный лид вернется в статус <b>«Назначен»</b>, а у данного продавца будет сброшен назначенный куратор.
            </>
          }
        />

        {/* Диалог подтверждения безвозвратного удаления продавца */}
        <ConfirmDialog
          open={sellerToDelete !== null}
          onClose={() => !isDeletingSeller && setSellerToDelete(null)}
          onConfirm={handleConfirmDeleteSeller}
          title="Удалить продавца навсегда?"
          subtitle={
            sellerToDelete
              ? `${sellerToDelete.seller_name || sellerToDelete.store} (${formatPhoneDisplay(sellerToDelete.seller_phone)})`
              : undefined
          }
          tone="danger"
          icon={Trash2}
          confirmLabel="Удалить навсегда"
          level={2}
          description={
            <div className="space-y-1.5">
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
                <span>Внимание: действие необратимо</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Запись продавца будет физически удалена из локальной базы данных SotkaCRM. Все привязанные лиды будут автоматически отвязаны.
              </p>
            </div>
          }
        />
      </div>
    </AppLayout>
  );
}
