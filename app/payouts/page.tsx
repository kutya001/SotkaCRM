'use client';

import * as React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef, type StatusOption } from '@/components/ui/DataJournal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import {
  getPayouts,
  getPayoutsStats,
  createPayout,
  getEmployeesList,
  getPayoutMonthsList,
  type PayoutItem,
  type PayoutsStats,
  type CreatePayoutInput,
} from './actions';
import {
  Banknote,
  Plus,
  Calendar,
  RotateCcw,
  Layers,
  CreditCard,
  UserCheck,
  X,
  TrendingDown,
  TrendingUp,
  Receipt,
  FileSpreadsheet,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/components/auth/AuthProvider';
import type { PayoutCategoryType, UserRole } from '@/types/database.types';

const CATEGORY_STATUS_OPTIONS: StatusOption[] = [
  {
    value: 'выплата зп',
    label: 'Выплата ЗП',
    colorClass: 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  {
    value: 'аванс',
    label: 'Аванс',
    colorClass: 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  {
    value: 'бонус',
    label: 'Бонус',
    colorClass: 'bg-purple-500/10 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20',
  },
  {
    value: 'прочие начисления',
    label: 'Прочие начисления',
    colorClass: 'bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  {
    value: 'удержание',
    label: 'Удержание',
    colorClass: 'bg-rose-500/10 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20',
  },
];

export default function PayoutsPage() {
  const { showToast } = useToast();
  const user = useUser();

  const [payouts, setPayouts] = React.useState<PayoutItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>(user.role);
  const [userName, setUserName] = React.useState(user.userName);
  const [userLogin, setUserLogin] = React.useState(user.userLogin);

  // Статистика
  const [stats, setStats] = React.useState<PayoutsStats>({
    totalPaid: 0,
    totalAdvances: 0,
    totalDeductions: 0,
    transactionsCount: 0,
  });

  // Поиск и Фильтры (ЯРУС 1)
  const [searchQuery, setSearchQuery] = React.useState('');
  const [accrualMonths, setAccrualMonths] = React.useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = React.useState<string>('all');
  const [selectedCategory, setSelectedCategory] = React.useState<string>('all');

  // Список сотрудников для создания выплаты
  const [employees, setEmployees] = React.useState<
    { user_id: string; full_name: string; role: string; login: string }[]
  >([]);

  // Состояние диалога создания выплаты
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [selectedPayout, setSelectedPayout] = React.useState<PayoutItem | null>(null);

  const currentMonthStr = new Date().toISOString().substring(0, 7);
  const todayStr = new Date().toISOString().substring(0, 10);

  const [formData, setFormData] = React.useState<CreatePayoutInput>({
    user_id: '',
    accrual_month: currentMonthStr,
    payout_date: todayStr,
    amount: 0,
    payout_category: 'выплата зп',
    payment_method: 'Mbank',
    comment: '',
  });

  // Загрузка данных
  const fetchData = React.useCallback(async (month?: string, cat?: string) => {
    setIsLoading(true);
    try {
      const monthFilter = month !== undefined ? month : selectedMonth;
      const catFilter = cat !== undefined ? cat : selectedCategory;

      const [res, statsRes, monthsRes, employeesRes] = await Promise.all([
        getPayouts({
          page: 1,
          pageSize: 100,
          accrualMonth: monthFilter !== 'all' ? monthFilter : undefined,
          category: catFilter !== 'all' ? catFilter : undefined,
        }),
        getPayoutsStats(monthFilter !== 'all' ? monthFilter : undefined),
        getPayoutMonthsList(),
        getEmployeesList(),
      ]);

      setPayouts(res.payouts);
      setTotalCount(res.totalCount);
      setStats(statsRes);
      setAccrualMonths(monthsRes);
      setEmployees(employeesRes);

      if (res.currentUserRole) {
        setCurrentUserRole(res.currentUserRole);
      }
    } catch (err) {
      console.error('Failed to load payouts:', err);
      showToast('Ошибка при загрузке реестра выплат', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, selectedCategory, showToast]);

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

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedMonth(val);
    fetchData(val, selectedCategory);
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedCategory(val);
    fetchData(selectedMonth, val);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.user_id) {
      showToast('Выберите сотрудника-получателя', 'error');
      return;
    }
    if (!formData.amount || formData.amount <= 0) {
      showToast('Укажите корректную сумму', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await createPayout(formData);
      if (res.success) {
        showToast('Выплата успешно зарегистрирована', 'success');
        setIsCreateOpen(false);
        setFormData({
          user_id: '',
          accrual_month: currentMonthStr,
          payout_date: todayStr,
          amount: 0,
          payout_category: 'выплата зп',
          payment_method: 'Mbank',
          comment: '',
        });
        fetchData();
      } else {
        showToast(res.error || 'Ошибка при сохранении выплаты', 'error');
      }
    } catch {
      showToast('Сбой при проведении выплаты', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Колонки DataJournal
  const columns: ColumnDef<PayoutItem>[] = [
    {
      key: 'recipient',
      label: 'Сотрудник',
      width: 220,
      minWidth: 180,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-bold flex items-center justify-center flex-shrink-0">
            {row.recipient?.full_name?.charAt(0) || 'U'}
          </div>
          <div className="flex flex-col truncate">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs truncate">
              {row.recipient?.full_name || 'Неизвестный'}
            </span>
            <span className="text-[10px] text-zinc-400 capitalize">
              {row.recipient?.role || 'Сотрудник'} • @{row.recipient?.login || 'user'}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'payout_category',
      label: 'Категория',
      width: 160,
      minWidth: 140,
      sortable: true,
      filterable: true,
      type: 'status',
      statusOptions: CATEGORY_STATUS_OPTIONS,
    },
    {
      key: 'amount',
      label: 'Сумма',
      width: 140,
      minWidth: 120,
      sortable: true,
      filterable: true,
      renderCell: (row) => {
        const isDeduction = row.payout_category === 'удержание';
        return (
          <span
            className={`font-mono text-xs font-bold ${
              isDeduction
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {isDeduction ? '-' : '+'}
            {Number(row.amount).toLocaleString('ru-RU')} сом
          </span>
        );
      },
    },
    {
      key: 'payment_method',
      label: 'Метод оплаты',
      width: 140,
      minWidth: 120,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
          <CreditCard className="w-3 h-3 text-zinc-400" strokeWidth={1.5} />
          <span>{row.payment_method}</span>
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
      key: 'payout_date',
      label: 'Дата выплаты',
      width: 130,
      minWidth: 110,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          <FormattedDate date={row.payout_date} type="date" />
        </span>
      ),
    },
    {
      key: 'comment',
      label: 'Примечание',
      width: 200,
      minWidth: 150,
      sortable: false,
      filterable: true,
      renderCell: (row) => (
        <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-xs block">
          {row.comment || '—'}
        </span>
      ),
    },
  ];

  // Расчет количества активных фильтров (ЯРУС 1)
  const activeFilterCount =
    (selectedMonth !== 'all' ? 1 : 0) + (selectedCategory !== 'all' ? 1 : 0);

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
          Категория
        </label>
        <select
          value={selectedCategory}
          onChange={handleCategoryChange}
          className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          <option value="all">Все категории</option>
          <option value="выплата зп">Выплата ЗП</option>
          <option value="аванс">Аванс</option>
          <option value="бонус">Бонус</option>
          <option value="прочие начисления">Прочие</option>
          <option value="удержание">Удержание</option>
        </select>
      </div>

      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setSelectedMonth('all');
            setSelectedCategory('all');
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

  // Контекстные действия тулбара реестра выплат (ЯРУС 3)
  const payoutActions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => fetchData()}
        className="min-w-[44px] min-h-[44px] h-11 px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive"
        title="Обновить журнал"
        aria-label="Обновить журнал"
      >
        <RotateCcw className={`w-4 h-4 text-blue-500 flex-shrink-0 ${isLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
        <span className="hidden sm:inline">Обновить</span>
      </button>

      </div>
  );

  return (
    <AppLayout
      userRole={currentUserRole}
      userName={userName}
      userLogin={userLogin}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Поиск по сотруднику, назначению или комментарию..."
      filterCount={activeFilterCount}
      filterContent={filterContent}
      onCreateClick={currentUserRole === 'admin' ? () => setIsCreateOpen(true) : undefined}
      createTooltip="Оформить выплату"
    >
      <div className="space-y-4">
        {/* ЯРУС 2: KPI сводка (Десктоп: 1 ряд, Мобильный: горизонтальный snap-скролл) */}
        <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 overflow-x-auto sm:overflow-x-visible snap-x sm:snap-none pb-2 sm:pb-0 scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0">
          <div className="min-w-[150px] sm:min-w-0 flex-1 flex-shrink-0 snap-start p-3 sm:p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" strokeWidth={1.75} />
              Общий фонд выплат
            </span>
            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {stats.totalPaid.toLocaleString('ru-RU')} сом
            </p>
          </div>
          <div className="min-w-[150px] sm:min-w-0 flex-1 flex-shrink-0 snap-start p-3 sm:p-4 rounded-2xl backdrop-blur-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
              <Receipt className="w-3.5 h-3.5" strokeWidth={1.75} />
              Выданные авансы
            </span>
            <p className="text-xl font-bold text-amber-700 dark:text-amber-300 font-mono">
              {stats.totalAdvances.toLocaleString('ru-RU')} сом
            </p>
          </div>
          <div className="min-w-[150px] sm:min-w-0 flex-1 flex-shrink-0 snap-start p-3 sm:p-4 rounded-2xl backdrop-blur-xl bg-rose-500/10 dark:bg-rose-500/5 border border-rose-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
              <TrendingDown className="w-3.5 h-3.5" strokeWidth={1.75} />
              Удержания
            </span>
            <p className="text-xl font-bold text-rose-700 dark:text-rose-300 font-mono">
              {stats.totalDeductions.toLocaleString('ru-RU')} сом
            </p>
          </div>
          <div className="min-w-[150px] sm:min-w-0 flex-1 flex-shrink-0 snap-start p-3 sm:p-4 rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1">
              <FileSpreadsheet className="w-3.5 h-3.5" strokeWidth={1.75} />
              Всего транзакций
            </span>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-300 font-mono">
              {stats.transactionsCount}
            </p>
          </div>
        </div>

        {/* ЯРУС 3: Универсальный реестр DataJournal */}
        <DataJournal<PayoutItem>
          data={payouts}
          columns={columns}
          keyField="payout_id"
          storageKey="payouts_journal"
          searchPlaceholder="Поиск по сотруднику, назначению или комментарию..."
          onRowClick={(row) => setSelectedPayout(row)}
          totalCount={totalCount}
          externalSearchQuery={searchQuery}
          customActions={payoutActions}
        />

        {/* 4. Модальное окно просмотра деталей проводки */}
        {selectedPayout && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <Banknote className="w-5 h-5" strokeWidth={2} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      {selectedPayout.recipient?.full_name}
                    </h3>
                    <p className="text-xs text-zinc-400 capitalize">
                      {selectedPayout.recipient?.role} • @{selectedPayout.recipient?.login}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedPayout(null)}
                  className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Категория:</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 capitalize">
                    {selectedPayout.payout_category}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Сумма:</span>
                  <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                    {selectedPayout.amount.toLocaleString('ru-RU')} сом
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Способ перевода:</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {selectedPayout.payment_method}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Расчетный месяц:</span>
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">
                    {selectedPayout.accrual_month}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Дата выдачи:</span>
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">
                    <FormattedDate date={selectedPayout.payout_date} type="date" />
                  </span>
                </div>
                <div className="flex justify-between border-t border-zinc-200/50 dark:border-zinc-700/50 pt-2">
                  <span className="text-zinc-400">Провел операцию:</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {selectedPayout.creator?.full_name || 'Администратор'}
                  </span>
                </div>
                {selectedPayout.comment && (
                  <div className="pt-2 border-t border-zinc-200/50 dark:border-zinc-700/50">
                    <span className="text-zinc-400 block mb-1">Примечание:</span>
                    <p className="text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-800 p-2.5 rounded-xl border border-zinc-200/60 dark:border-zinc-700/60">
                      {selectedPayout.comment}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedPayout(null)}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 5. Модальное окно создания выплаты (только admin) */}
        {isCreateOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <form
              onSubmit={handleCreateSubmit}
              className="w-full max-w-lg p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <Plus className="w-5 h-5" strokeWidth={2.5} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      Оформление выплаты
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Фиксация перечисления средств сотруднику в расчетный период
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {/* Выбор сотрудника */}
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Сотрудник-получатель *
                  </label>
                  <select
                    value={formData.user_id}
                    onChange={(e) => setFormData((p) => ({ ...p, user_id: e.target.value }))}
                    required
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">— Выберите сотрудника —</option>
                    {employees.map((emp) => (
                      <option key={emp.user_id} value={emp.user_id}>
                        {emp.full_name} ({emp.role} • @{emp.login})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Сумма */}
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Сумма (сом) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      value={formData.amount || ''}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, amount: parseFloat(e.target.value) || 0 }))
                      }
                      placeholder="5000"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>

                  {/* Категория */}
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Категория *
                    </label>
                    <select
                      value={formData.payout_category}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          payout_category: e.target.value as PayoutCategoryType,
                        }))
                      }
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="выплата зп">Выплата ЗП</option>
                      <option value="аванс">Аванс</option>
                      <option value="бонус">Бонус</option>
                      <option value="прочие начисления">Прочие начисления</option>
                      <option value="удержание">Удержание</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Способ перевода */}
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Инструмент расчета *
                    </label>
                    <select
                      value={formData.payment_method}
                      onChange={(e) => setFormData((p) => ({ ...p, payment_method: e.target.value }))}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="Mbank">Mbank</option>
                      <option value="О!Деньги">О!Деньги</option>
                      <option value="Наличные">Наличные</option>
                      <option value="Перевод на карту">Перевод на карту</option>
                    </select>
                  </div>

                  {/* Расчетный месяц */}
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Расчетный месяц (YYYY-MM) *
                    </label>
                    <input
                      type="text"
                      pattern="^\d{4}-\d{2}$"
                      required
                      value={formData.accrual_month}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, accrual_month: e.target.value }))
                      }
                      placeholder="2026-09"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                </div>

                {/* Дата фактической выплаты */}
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Дата проводки *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.payout_date}
                    onChange={(e) => setFormData((p) => ({ ...p, payout_date: e.target.value }))}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>

                {/* Комментарий */}
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Служебная заметка / Обоснование
                  </label>
                  <textarea
                    rows={2}
                    value={formData.comment}
                    onChange={(e) => setFormData((p) => ({ ...p, comment: e.target.value }))}
                    placeholder="Например: Бонус за перевыполнение KPI..."
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {isSubmitting ? 'Проведение...' : 'Подтвердить выплату'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
