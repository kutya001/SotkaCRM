'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef, type StatusOption } from '@/components/ui/DataJournal';
import { EntityModal, type EntityFieldConfig } from '@/components/ui/EntityModal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import {
  getSellers,
  getSellersStats,
  getManagersList,
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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/components/auth/AuthProvider';
import type { UserRole } from '@/types/database.types';

const SELLER_MODERATION_OPTIONS: StatusOption[] = [
  {
    value: 'approved',
    label: 'Одобрен',
    colorClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  },
  {
    value: 'pending',
    label: 'На модерации',
    colorClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
  {
    value: 'rejected',
    label: 'Отклонен',
    colorClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  },
  {
    value: 'blocked',
    label: 'Заблокирован',
    colorClass: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
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
    { user_id: string; full_name: string; role: string; login: string }[]
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

  // Поиск и Фильтры (ЯРУС 1)
  const [searchQuery, setSearchQuery] = React.useState('');
  const [filterModeration, setFilterModeration] = React.useState<string>('all');
  const [filterActive, setFilterActive] = React.useState<string>('all');
  const [filterManager, setFilterManager] = React.useState<string>('all');

  // Загрузка начальных данных
  const fetchSellersData = React.useCallback(
    async (page = 1, search = '') => {
      setIsLoading(true);
      try {
        const [sellersRes, statsRes, managersRes] = await Promise.all([
          getSellers({
            page,
            pageSize: 100,
            search,
            moderation: filterModeration,
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
        setIsLoading(false);
      }
    },
    [filterModeration, filterActive, filterManager, router, showToast]
  );

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



  // Конфигурация колонок DataJournal
  const columns: ColumnDef<SellerItem>[] = [
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
              {row.seller_name || 'Без имени'}
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              {row.store || 'Магазин не указан'}
            </div>
          </div>
        </div>
      ),
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
          +{row.seller_phone}
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
      statusOptions: SELLER_MODERATION_OPTIONS,
    },
    {
      key: 'is_active',
      label: 'Статус',
      width: 110,
      minWidth: 90,
      sortable: true,
      filterable: true,
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
      width: 160,
      minWidth: 130,
      sortable: true,
      filterable: true,
      renderCell: (row: SellerItem) => {
        if (!row.manager_user) {
          return (
            <span className="text-[11px] text-zinc-400 italic">Не назначен</span>
          );
        }
        return (
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[10px] font-bold flex items-center justify-center">
              {row.manager_user.full_name.charAt(0)}
            </span>
            <span className="text-xs text-zinc-800 dark:text-zinc-200 truncate">
              {row.manager_user.full_name}
            </span>
          </div>
        );
      },
    },
  ];

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
      renderCustomView: (val: any, data: SellerItem) => (
        <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
          {data?.manager_user?.full_name || 'Не назначен'}
        </span>
      ),
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
          <option value="approved">Одобрен</option>
          <option value="pending">На модерации</option>
          <option value="rejected">Отклонен</option>
          <option value="blocked">Заблокирован</option>
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
          <option value="true">Только активные</option>
          <option value="false">Только неактивные</option>
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
          <option value="all">Все кураторы</option>
          <option value="unassigned">Без куратора</option>
          {managers.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
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
            customActions={sellerActions}
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
      </div>
    </AppLayout>
  );
}
