'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef, type StatusOption, type DataJournalTab } from '@/components/ui/DataJournal';
import { EntityModal, type EntityFieldConfig } from '@/components/ui/EntityModal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import {
  getSellers,
  getSellersStats,
  getManagersList,
  assignSellerManager,
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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import dynamic from 'next/dynamic';
import { useUser } from '@/components/auth/AuthProvider';
import type { UserRole } from '@/types/database.types';
import { EmployeeBadge, EmployeeColorDot } from '@/components/ui/EmployeeBadge';

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

export default function SellersPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const user = useUser();

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

  // Поиск и Фильтры (ЯРУС 1)
  const [searchQuery, setSearchQuery] = React.useState('');
  const [filterModeration, setFilterModeration] = React.useState<string>('all');
  const [filterActive, setFilterActive] = React.useState<string>('all');
  const [filterManager, setFilterManager] = React.useState<string>('all');

  const formatPhone = (p?: string | null) => {
    if (!p) return '—';
    const trimmed = p.trim();
    return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  };

  // Загрузка начальных данных
  const fetchSellersData = React.useCallback(
    async (page = 1, search = '', silent = false, moderationOverride?: string) => {
      if (!silent) {
        setIsLoading(true);
      }
      try {
        const [sellersRes, statsRes, managersRes] = await Promise.all([
          getSellers({
            page,
            pageSize: 50,
            search,
            moderation: moderationOverride !== undefined ? moderationOverride : filterModeration,
            isActive: filterActive,
            managerId: filterManager,
          }),
          getSellersStats(),
          getManagersList(),
        ]);

        if (sellersRes.error) {
          if (sellersRes.currentUserRole === 'smm') {
            showToast('Доступ к базе продавцов закрыт для SMM-специалистов', 'error');
            router.push('/leads');
            return;
          }
          showToast(sellersRes.error, 'error');
        }

        setSellers(sellersRes.sellers);
        setTotalCount(sellersRes.totalCount);
        setStats(statsRes);
        setManagers(managersRes);

        if (sellersRes.currentUserRole) {
          setCurrentUserRole(sellersRes.currentUserRole);
        }
      } catch (err) {
        console.error(err);
        showToast('Ошибка при загрузке базы продавцов', 'error');
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [filterModeration, filterActive, filterManager, router, showToast]
  );

  // Вкладки статуса модерации для DataJournal
  const sellerTabs: DataJournalTab[] = React.useMemo(() => [
    { id: 'all', label: 'Все продавцы', count: stats.total },
    { id: 'pending', label: 'На модерации', count: stats.pendingModeration },
    { id: 'approved', label: 'Одобрен', count: stats.active },
    { id: 'rejected', label: 'Отклонен' },
    { id: 'blocked', label: 'Заблокирован' },
  ], [stats]);

  const handleTabChange = (tabId: string) => {
    setFilterModeration(tabId);
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
      const res = await assignSellerManager(sellerPhone, managerId);
      if (res.success) {
        showToast('Куратор назначен. Связь в подключениях синхронизирована', 'success');
        await fetchSellersData(1, searchQuery, true);
      } else {
        setSellers(previousSellers);
        showToast(res.error || 'Ошибка назначения куратора', 'error');
      }
    } catch {
      setSellers(previousSellers);
      showToast('Ошибка при назначении куратора', 'error');
    }
  };

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
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-medium text-xs flex-shrink-0">
              <Store className="w-3.5 h-3.5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {row.seller_name || 'Не указано'}
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
        type: 'status',
        width: 140,
        minWidth: 120,
        sortable: true,
        filterable: true,
        groupable: true,
        statusOptions: SELLER_MODERATION_OPTIONS,
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
            const isUnassigned = !row.manager_id;
            const currentMgr = managers.find((m) => m.user_id === row.manager_id);
            return (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <EmployeeColorDot
                  color={currentMgr?.color || (isUnassigned ? '#9CA3AF' : undefined)}
                  size="sm"
                />
                <select
                  value={row.manager_id || ''}
                  onChange={async (e) => {
                    const val = e.target.value || null;
                    await handleAssignManager(row.seller_phone, val);
                  }}
                  className={`h-7 px-2 text-xs font-semibold rounded-lg shadow-sm focus:outline-none cursor-pointer transition-all ${
                    isUnassigned
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 hover:bg-amber-500/25 ring-1 ring-amber-500/20'
                      : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 focus:ring-1 focus:ring-blue-500'
                  }`}
                >
                  <option value="">— Не назначен —</option>
                  {managers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      ● {m.full_name}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          if (!row.manager_user) {
            return (
              <span className="text-[11px] text-zinc-400 italic">— Не назначен —</span>
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

          if (currentUserRole === 'admin' || currentUserRole === 'consultant') {
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

          return <span className="text-[11px] text-zinc-400 italic">—</span>;
        },
      },
    ],
    [currentUserRole, managers, handleAssignManager]
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
            <div className="flex items-center gap-2">
              <select
                value={data?.manager_id || ''}
                onChange={async (e) => {
                  const val = e.target.value || null;
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
                          },
                        }
                      : prev
                  );
                }}
                className="w-full h-10 px-3 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Не назначен</option>
                {managers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name} ({m.role === 'admin' ? 'Админ' : 'Консультант'})
                  </option>
                ))}
              </select>
            </div>
          );
        }
        return (
          <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
            {data?.manager_user?.full_name || 'Не назначен'}
          </span>
        );
      },
    },
  ];

  // Расчет количества активных фильтров (ЯРУС 1)
  const activeFilterCount =
    (filterModeration !== 'all' ? 1 : 0) +
    (filterActive !== 'all' ? 1 : 0) +
    (filterManager !== 'all' ? 1 : 0);

  // Содержимое всплывающего окна фильтров TopHeader / MobileHeader
  const filterContent = (
    <div className="space-y-3.5">
      <div>
        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Модерация
        </label>
        <select
          value={filterModeration}
          onChange={(e) => setFilterModeration(e.target.value)}
          className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          <option value="all">Любая модерация</option>
          <option value="approved">● Одобрен</option>
          <option value="pending">● На модерации</option>
          <option value="rejected">● Отклонен</option>
          <option value="blocked">● Заблокирован</option>
        </select>
      </div>

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
            setFilterModeration('all');
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
      className="min-h-[44px] h-11 px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive"
      title="Обновить базу продавцов"
      aria-label="Обновить базу продавцов"
    >
      <RefreshCw className="w-4 h-4 text-blue-500 flex-shrink-0" strokeWidth={1.75} />
      <span className="hidden sm:inline">Обновить</span>
    </button>
  );

  // Кастомный рендеринг карточки продавца для мобильных устройств (Card View)
  const renderSellerCard = (seller: SellerItem) => {
    const bal = Number(seller.balance) || 0;
    const currentMgr = managers.find((m) => m.user_id === seller.manager_id);
    const isUnassignedMgr = !seller.manager_id;
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
                <h4 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                  {seller.seller_name || 'Без имени'}
                </h4>
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
                  href={`tel:+${cleanPhone}`}
                  className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 transition-colors"
                  title="Позвонить"
                >
                  <Phone className="w-3.5 h-3.5" strokeWidth={1.75} />
                </a>
                <a
                  href={`https://wa.me/${cleanPhone}`}
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
              <div className="flex items-center gap-1.5 flex-1 max-w-[210px] justify-end">
                <EmployeeColorDot
                  color={currentMgr?.color || (isUnassignedMgr ? '#9CA3AF' : undefined)}
                  size="xs"
                />
                <select
                  value={seller.manager_id || ''}
                  onChange={async (e) => {
                    const val = e.target.value || null;
                    await handleAssignManager(seller.seller_phone, val);
                  }}
                  className={`h-7 w-full px-2 text-[11px] font-semibold rounded-lg shadow-sm focus:outline-none cursor-pointer transition-all ${
                    isUnassignedMgr
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                      : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  <option value="">— Не назначен —</option>
                  {managers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      ● {m.full_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                {seller.manager_user ? (
                  <EmployeeBadge
                    name={seller.manager_user.full_name}
                    color={seller.manager_user.color}
                    size="xs"
                  />
                ) : (
                  <span className="text-[11px] text-zinc-400 italic">— Не назначен —</span>
                )}
              </div>
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
            ) : (currentUserRole === 'admin' || currentUserRole === 'consultant') ? (
              <button
                type="button"
                onClick={() => setLinkLeadModal({ isOpen: true, seller })}
                className="h-7 px-2.5 text-[11px] font-semibold rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 transition-all flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>Связать с лидом</span>
              </button>
            ) : (
              <span className="text-[11px] text-zinc-400 italic">Прямое подключение</span>
            )}
          </div>
        </div>
      </div>
    );
  };

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

          {/* На модерации */}
          <div className="p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl island-glass border border-white/20 dark:border-zinc-800/40 flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                На модерации
              </div>
              <div className="text-base sm:text-lg font-bold font-mono text-amber-600 dark:text-amber-400">
                {stats.pendingModeration}
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
            activeTab={filterModeration}
            onTabChange={handleTabChange}
            customActions={sellerActions}
            renderCard={renderSellerCard}
            onRowClick={(seller) =>
              setModalState({
                isOpen: true,
                mode: 'view',
                selectedSeller: seller,
              })
            }
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
      </div>
    </AppLayout>
  );
}
