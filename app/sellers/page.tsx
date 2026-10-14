'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  DataJournal,
  JournalMenuItem,
  type ColumnDef,
  type StatusOption,
  type DataJournalTab,
} from '@/components/ui/DataJournal';
import { EntityModal, type EntityFieldConfig } from '@/components/ui/EntityModal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, useConfirm } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { formatPhoneDisplay } from '@/lib/utils/phone';
import { formatDateTime } from '@/lib/utils/format';
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
  UserCheck,
  ShieldAlert,
  Wallet,
  CheckCircle2,
  Building2,
  RefreshCw,
  Loader2,
  RotateCcw,
  Link2,
  Trash2,
  Users,
  UserMinus,
  Receipt,
  UserPlus,
  Hourglass,
  XCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
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
  // Права назначенной роли
  const canAssign = user.can('sellers.assign');
  const canTake = user.can('sellers.take');
  const canLinkLead = user.can('sellers.link_lead');
  const canUnlinkLead = user.can('sellers.unlink_lead');
  const canDeleteSeller = user.can('sellers.delete');
  const canBulk = user.can('sellers.bulk');
  const canSync = user.can('sellers.sync');
  const canViewAllSellers = user.canViewAll('sellers');

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

  // Список консультантов для фильтрации и назначения
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
    user.canViewAll('sellers') ? 'all' : 'my'
  );
  const [filterActive, setFilterActive] = React.useState<string>('all');
  const [filterManager, setFilterManager] = React.useState<string>('all');
  const [hasAvailableLeads, setHasAvailableLeads] = React.useState<boolean>(false);

  const formatPhone = (p?: string | null) => formatPhoneDisplay(p);

  // Массовые действия для администратора
  const [selectedSellerIds, setSelectedSellerIds] = React.useState<string[]>([]);
  const [isBatchLoading, setIsBatchLoading] = React.useState(false);

  // Загрузка данных: весь доступный реестр постранично за один раз.
  // Вкладки и фильтры (консультант, активность, поиск) работают на клиенте без повторных запросов.
  // bypassCache — принудительное обновление из тулбара (мимо SWR-кэша клиента API)
  const fetchSellersData = React.useCallback(
    async (_page = 1, _search = '', silent = false, bypassCache = false) => {
      if (!silent) {
        setIsLoading(true);
      }
      try {
        const PAGE_SIZE = 200;
        const firstPage = api.sellers.getAll({
          page: 1,
          pageSize: PAGE_SIZE,
          moderation: 'all',
          isActive: 'all',
          managerId: 'all',
          bypassCache,
        });
        const [sellersRes, leadsCheckRes, statsRes, managersRes] = await Promise.all([
          firstPage,
          api.sellers.checkAvailableLeads({ bypassCache }).catch(() => ({ has_available_leads: false, available_count: 0 })),
          getSellersStats(),
          getManagersList(),
        ]);

        const items: SellerItem[] = [...(sellersRes.items || [])];
        const total = sellersRes.total || items.length;
        for (let page = 2; items.length < total && page <= 50; page++) {
          const next = await api.sellers.getAll({ page, pageSize: PAGE_SIZE, moderation: 'all', isActive: 'all', managerId: 'all', bypassCache });
          if (!next.items || next.items.length === 0) break;
          items.push(...next.items);
        }

        setSellers(items);
        setTotalCount(total);
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
    [router, showToast]
  );

  // Клиентская фильтрация: вкладка (все / мои / без консультанта), консультант и активность
  // По умолчанию в реестре только продавцы, прошедшие модерацию; остальные («другие организации»:
  // на модерации, отклонённые, заблокированные) показываются отдельной кнопкой
  const [showOthers, setShowOthers] = React.useState(false);
  const baseSellers = React.useMemo(
    () => sellers.filter((s) => (showOthers ? s.moderation !== 'approved' : s.moderation === 'approved')),
    [sellers, showOthers]
  );
  const othersCount = React.useMemo(() => sellers.filter((s) => s.moderation !== 'approved').length, [sellers]);

  const visibleSellers = React.useMemo(() => {
    return baseSellers.filter((s) => {
      if (curatorTab === 'my' && s.manager_id !== currentUserId) return false;
      if (curatorTab === 'unassigned' && s.manager_id) return false;
      if (filterActive !== 'all' && String(Boolean(s.is_active)) !== filterActive) return false;
      if (filterManager === 'my' && s.manager_id !== currentUserId) return false;
      if (filterManager === 'unassigned' && s.manager_id) return false;
      if (filterManager !== 'all' && filterManager !== 'my' && filterManager !== 'unassigned' && s.manager_id !== filterManager) return false;
      return true;
    });
  }, [baseSellers, curatorTab, currentUserId, filterActive, filterManager]);

  // Итоги транзакций Sotka HQ: дозаполняются в фоне для продавцов без итогов или с устаревшими (> 24 ч)
  const hqRefreshRef = React.useRef<Promise<void> | null>(null);
  const refreshHqTotals = React.useCallback(
    async (force = false) => {
      if (hqRefreshRef.current) return hqRefreshRef.current;
      const run = (async () => {
        try {
          const res = await api.sellers.refreshHqTotals(force ? { stale_hours: 1 } : {});
          if (res.refreshed > 0) await fetchSellersData(1, '', true);
        } catch (err: any) {
          console.warn('[sellers] Итоги транзакций Sotka HQ не обновлены:', err?.message);
        } finally {
          hqRefreshRef.current = null;
        }
      })();
      hqRefreshRef.current = run;
      return run;
    },
    [fetchSellersData]
  );
  const hqAutoRequestedRef = React.useRef(false);
  React.useEffect(() => {
    if (hqAutoRequestedRef.current || sellers.length === 0 || !user.can('sellers.transactions')) return;
    const staleBefore = Date.now() - 24 * 3_600_000;
    const needsRefresh = sellers.some(
      (s) => s.organization_id && !s.is_deleted_from_source && (!s.hq_tx_synced_at || new Date(s.hq_tx_synced_at).getTime() < staleBefore)
    );
    if (!needsRefresh) return;
    hqAutoRequestedRef.current = true;
    void refreshHqTotals();
  }, [sellers, user, refreshHqTotals]);

  // Синхронизация реестра с Sotka HQ API (только из модуля «Продавцы»)
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [lastSyncedAt, setLastSyncedAt] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('crm_last_sotka_sync');
      if (saved) setLastSyncedAt(saved);
    } catch {}
  }, []);

  // Стандартная кнопка «Обновить список» тулбара DataJournal: тихое обновление (реестр не размонтируется)
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const handleRefresh = React.useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await fetchSellersData(1, '', true, true);
      if (user.can('sellers.transactions')) await refreshHqTotals(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, fetchSellersData, user, refreshHqTotals]);

  const handleSyncApi = React.useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const data = await api.sellers.syncSotka();
      const syncedAtIso = new Date().toISOString();
      setLastSyncedAt(syncedAtIso);
      try {
        localStorage.setItem('crm_last_sotka_sync', syncedAtIso);
      } catch {}
      showToast(`Синхронизация завершена: ${data.synced_count} продавцов (всего ${data.total_available})`, 'success');
      await fetchSellersData(1, '', true);
    } catch (err: any) {
      showToast(err.message || 'Сбой при обращении к API Sotka', 'error');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, showToast, fetchSellersData]);

  const handleBatchManager = async (managerId: string | null, clearSelection: () => void) => {
    if (selectedSellerIds.length === 0) return;
    setIsBatchLoading(true);
    try {
      await api.sellers.batch({
        seller_ids: selectedSellerIds,
        action: 'change_manager',
        manager_id: managerId,
      });
      showToast(`Консультант назначен для ${selectedSellerIds.length} продавцов`, 'success');
      clearSelection();
      await fetchSellersData(1, searchQuery, true);
    } catch (err: any) {
      showToast(err.message || 'Ошибка массового назначения консультанта', 'error');
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

  // Вкладки по консультантам для DataJournal
  const sellerTabs: DataJournalTab[] = React.useMemo(() => {
    return [
      { id: 'all', label: 'Все', icon: Users, count: baseSellers.length },
      { id: 'my', label: 'Мои продавцы', icon: UserCheck, count: baseSellers.filter((s) => s.manager_id === currentUserId).length },
      { id: 'unassigned', label: 'Без консультанта', icon: UserMinus, count: baseSellers.filter((s) => !s.manager_id).length },
    ];
  }, [baseSellers, currentUserId]);

  // Вкладка — чистый клиентский фильтр: данные не перезапрашиваются
  const handleTabChange = (tabId: string) => {
    setCuratorTab(tabId);
  };

  React.useEffect(() => {
    if (user.profile) {
      if (!user.can('sellers.menu')) {
        showToast('Доступ к реестру продавцов не предусмотрен вашей ролью', 'error');
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
      showToast('Консультант назначен. Связь в подключениях синхронизирована', 'success');
      await fetchSellersData(1, searchQuery, true);
    } catch (err: any) {
      setSellers(previousSellers);
      showToast(err.message || 'Ошибка при назначении консультанта', 'error');
    }
  };

  // Консультант берет свободного одобренного продавца себе (подключение ждет подтверждения администратора)
  const canTakeSeller = React.useCallback(
    (seller: SellerItem) =>
      canTake &&
      !canAssign &&
      !seller.manager_id &&
      seller.moderation === 'approved' &&
      !seller.is_deleted_from_source,
    [canTake, canAssign]
  );

  const [takingPhone, setTakingPhone] = React.useState<string | null>(null);

  const handleTakeSelf = React.useCallback(
    async (seller: SellerItem) => {
      if (!canTakeSeller(seller)) return;
      const ok = await confirm({
        title: 'Взять продавца себе?',
        subtitle: `${seller.seller_name || seller.store} (${formatPhoneDisplay(seller.seller_phone)})`,
        description:
          'Вы станете консультантом продавца. Бонус за подключение будет начислен после подтверждения администратором.',
        tone: 'info',
        icon: UserPlus,
        confirmLabel: 'Взять себе',
      });
      if (!ok) return;

      setTakingPhone(seller.seller_phone);
      const previousSellers = sellers;
      const me = managers.find((m) => m.user_id === currentUserId);
      // Оптимистичное обновление: консультант — текущий консультант, подключение ожидает подтверждения
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

  /**
   * Консультант продавца для не-администратора: бейдж и статус подтверждения.
   * В ячейке реестра — только отображение («Взять себе» — в контекстном меню строки);
   * кнопка «Взять себе» остается только в карточке продавца (allowTake).
   */
  const renderCuratorReadOnly = React.useCallback(
    (seller: SellerItem, size: 'xs' | 'sm' = 'sm', allowTake = false) => {
      if (canTakeSeller(seller)) {
        if (allowTake) {
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
              title="Стать консультантом этого продавца (подтверждает администратор)"
            >
              Взять себе
            </Button>
          );
        }
        return (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-md"
            title="Свободный продавец: «Взять себе» — в меню строки (ПКМ / «⋯»)"
          >
            {takingPhone === seller.seller_phone ? 'Закрепляем…' : 'Свободен'}
          </span>
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
        cardTitle: true,
        textValue: (row: SellerItem) => row.seller_name || row.store || 'Без имени',
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
        key: 'hq_topups_total',
        label: 'Пополнения / Списания HQ',
        width: 175,
        minWidth: 150,
        sortable: true,
        filterable: false,
        textValue: (row: SellerItem) =>
          row.hq_tx_synced_at ? `+${Number(row.hq_topups_total) || 0} / -${Number(row.hq_charges_total) || 0}` : '',
        renderCell: (row: SellerItem) => {
          if (!row.hq_tx_synced_at) {
            return <span className="text-[11px] text-zinc-400 italic">нет данных</span>;
          }
          const topups = Number(row.hq_topups_total) || 0;
          const charges = Number(row.hq_charges_total) || 0;
          return (
            <div
              className="flex flex-col gap-0.5 font-mono text-[11px] leading-tight"
              title={`Транзакции Sotka HQ на ${formatDateTime(row.hq_tx_synced_at)}`}
            >
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <ArrowDownToLine className="w-3 h-3" strokeWidth={2} />
                +{topups.toLocaleString('ru-RU')}
              </span>
              <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
                <ArrowUpFromLine className="w-3 h-3" strokeWidth={2} />
                −{charges.toLocaleString('ru-RU')}
              </span>
            </div>
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
        label: 'Консультант',
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
          if (canAssign) {
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

          // Привязка лида — в контекстном меню строки (ПКМ / «⋯»); ячейка — только отображение
          if (!row.manager_id && hasAvailableLeads && canLinkLead) {
            return (
              <span
                className="text-[11px] text-blue-600 dark:text-blue-400 italic"
                title="Привязать свободный лид можно из меню строки (ПКМ / «⋯»)"
              >
                Можно связать с лидом
              </span>
            );
          }

          return (
            <span className="text-[11px] text-zinc-400 italic">
              {row.manager_id ? 'Консультант назначен' : '—'}
            </span>
          );
        },
      },
    ],
    [canAssign, canLinkLead, managers, handleAssignManager, hasAvailableLeads, renderCuratorReadOnly]
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
      label: 'Ответственный консультант',
      type: 'text',
      immutable: true,
      renderCustomView: (_val: any, data: SellerItem) => {
        if (canAssign) {
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
        return renderCuratorReadOnly(data, 'sm', true);
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
          Консультант
        </label>
        <select
          value={filterManager}
          onChange={(e) => setFilterManager(e.target.value)}
          className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          {!canViewAllSellers ? (
            <>
              <option value="all">Все доступные</option>
              <option value="my">● Мои продавцы</option>
              <option value="unassigned">— Свободные (без консультанта) —</option>
            </>
          ) : (
            <>
              <option value="all">Все консультанты</option>
              <option value="unassigned">— Без консультанта —</option>
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
            setCuratorTab(canViewAllSellers ? 'all' : 'my');
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

  // Контекстные действия тулбара реестра продавцов (ЯРУС 3); «Обновить» — стандартная кнопка DataJournal
  const sellerActions = (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
      {canSync && (
        <button
          type="button"
          onClick={handleSyncApi}
          disabled={isSyncing}
          className={`h-9 md:h-11 w-9 md:w-auto p-0 md:px-3.5 rounded-xl text-xs font-semibold flex items-center justify-center md:gap-2 transition-all active:scale-95 shadow-sm border island-interactive flex-shrink-0 ${
            isSyncing
              ? 'bg-blue-500/10 text-blue-600 border-blue-500/30 cursor-wait'
              : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 border-transparent'
          }`}
          title={lastSyncedAt ? `Синхронизация API Sotka HQ. Последняя: ${formatDateTime(lastSyncedAt)}` : 'Запустить синхронизацию с платформой Sotka HQ'}
          aria-label="Синхронизация API"
        >
          <RefreshCw className={`w-4 h-4 flex-shrink-0 ${isSyncing ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          <span className="hidden md:inline">{isSyncing ? 'Синхронизация...' : 'Синхронизация API'}</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => setShowOthers((v) => !v)}
        aria-pressed={showOthers}
        className={`h-9 md:h-11 px-2.5 md:px-3.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 md:gap-2 transition-all active:scale-95 shadow-sm border island-interactive flex-shrink-0 ${
          showOthers
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300'
            : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border-zinc-200/50 dark:border-zinc-700/50'
        }`}
        title={showOthers ? 'Вернуться к продавцам, прошедшим модерацию' : 'Показать другие организации (не прошли модерацию, отклонены, заблокированы)'}
        aria-label={showOthers ? 'Прошедшие модерацию' : 'Другие организации'}
      >
        <Building2 className={`w-4 h-4 flex-shrink-0 ${showOthers ? 'text-amber-500' : 'text-zinc-500'}`} strokeWidth={1.75} />
        <span className="hidden md:inline">{showOthers ? 'Прошедшие модерацию' : 'Другие организации'}</span>
        <span
          className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
            showOthers ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
          }`}
        >
          {showOthers ? sellers.length - othersCount : othersCount}
        </span>
      </button>
    </div>
  );

  // Действия строки: только в контекстном меню DataJournal (ПКМ / «⋯» / карточка)
  const renderCustomRowActions = React.useCallback(
    (row: SellerItem) => {
      const canTakeRow = canTakeSeller(row);
      const canLink = hasAvailableLeads && canLinkLead && !row.linked_lead && !row.manager_id;

      if (!canTakeRow && !canLink && !canDeleteSeller) {
        return null;
      }

      return (
        <>
          {canTakeRow && (
            <JournalMenuItem
              icon={UserPlus}
              label={takingPhone === row.seller_phone ? 'Закрепляем…' : 'Взять себе'}
              tone="info"
              disabled={takingPhone === row.seller_phone}
              title="Стать консультантом этого продавца (подтверждает администратор)"
              onClick={() => handleTakeSelf(row)}
            />
          )}
          {canLink && (
            <JournalMenuItem
              icon={Link2}
              label="Связать с лидом"
              tone="info"
              title="Привязать свободный лид"
              onClick={() => setLinkLeadModal({ isOpen: true, seller: row })}
            />
          )}
          {canDeleteSeller && (
            <JournalMenuItem
              icon={Trash2}
              label={row.is_deleted_from_source ? 'Удалить навсегда (в HQ удален)' : 'Удалить навсегда'}
              tone="danger"
              title="Удалить продавца из базы SotkaCRM навсегда"
              onClick={() => setSellerToDelete(row)}
            />
          )}
        </>
      );
    },
    [canTakeSeller, hasAvailableLeads, canLinkLead, canDeleteSeller, takingPhone, handleTakeSelf]
  );

  // Статистика модуля: показывается над тулбаром DataJournal и сворачивается его кнопкой
  const sellersStats = (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
      {/* Всего продавцов */}
      <div className="p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl island-glass border border-white/20 dark:border-zinc-800/40 flex items-center gap-2.5 sm:gap-3">
        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
          <Store className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">Всего продавцов</div>
          <div className="text-base sm:text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100">{stats.total}</div>
        </div>
      </div>

      {/* Активных */}
      <div className="p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl island-glass border border-white/20 dark:border-zinc-800/40 flex items-center gap-2.5 sm:gap-3">
        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">Активные</div>
          <div className="text-base sm:text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">{stats.active}</div>
        </div>
      </div>

      {/* Без консультанта */}
      <div className="p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl island-glass border border-white/20 dark:border-zinc-800/40 flex items-center gap-2.5 sm:gap-3">
        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
          <UserMinus className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">Без консультанта</div>
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
          <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">С консультантом</div>
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
          <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">Общий баланс</div>
          <div className="text-sm sm:text-base lg:text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100 truncate">
            {stats.totalBalance.toLocaleString('ru-RU')} KGS
          </div>
        </div>
      </div>
    </div>
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
        {/* УНИВЕРСАЛЬНЫЙ РЕЕСТР DATAJOURNAL (ЯРУС 3) */}
        {isLoading ? (
          <div className="p-12 text-center rounded-3xl island-glass border border-white/20 dark:border-zinc-800/40 space-y-3">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-zinc-400" strokeWidth={1.75} />
            <p className="text-xs text-zinc-500">Загрузка базы продавцов...</p>
          </div>
        ) : (
          <DataJournal
            data={visibleSellers}
            columns={columns}
            keyField="seller_phone"
            storageKey="sotka_sellers_journal"
            searchPlaceholder="Поиск по имени, телефону или магазину..."
            emptyMessage={showOthers ? 'Продавцов, не прошедших модерацию, нет' : 'Продавцы не найдены. Выполните синхронизацию с Sotka API.'}
            totalCount={visibleSellers.length}
            externalSearchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            tabs={sellerTabs}
            activeTab={curatorTab}
            onTabChange={handleTabChange}
            enableSelection={canBulk}
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
                  <option value="" disabled className="text-zinc-900 bg-white">Назначить консультанта...</option>
                  <option value="null" className="text-zinc-900 bg-white">Без консультанта</option>
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
                  className="h-8 px-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-semibold border border-rose-500/30 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Удалить выбранных продавцов"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                  <span>Удалить ({ids.length})</span>
                </button>
              </div>
            )}
            stats={sellersStats}
            onRefresh={handleRefresh}
            refreshing={isRefreshing}
            customActions={sellerActions}
            customRowActions={renderCustomRowActions}
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
                    unlinkLabel: canUnlinkLead ? 'Отвязать лид' : undefined,
                    onUnlink: canUnlinkLead ? () => setSellerToUnlink(modalState.selectedSeller) : undefined,
                  }
                : undefined
            }
            onDelete={
              canDeleteSeller && modalState.selectedSeller?.is_deleted_from_source
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
              При отвязке связанный лид вернется в статус <b>«Назначен»</b>, а у данного продавца будет сброшен назначенный консультант.
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
