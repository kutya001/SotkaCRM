'use client';

import * as React from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef } from '@/components/ui/DataJournal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api/client';
import {
  getPayoutsStats,
  getEmployeesList,
  getPayoutMonthsList,
  type PayoutItem,
  type PayoutsStats,
} from './actions';
import {
  Banknote,
  Plus,
  Calendar,
  RotateCcw,
  Layers,
  X,
  TrendingDown,
  TrendingUp,
  Receipt,
  FileSpreadsheet,
  Smartphone,
  Wallet,
  Landmark,
  Building2,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { useUser } from '@/components/auth/AuthProvider';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { PayrollSheetModal } from '@/components/payouts/PayrollSheetModal';
import {
  SALARY_OPERATION_TYPE_LABELS,
  type SalaryOperationType,
  type SalaryOperationSign,
} from '@/lib/validations';
import type { UserRole } from '@/types/database.types';

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
    totalAccrued: 0,
    totalPaid: 0,
    totalAdvances: 0,
    totalDeductions: 0,
    transactionsCount: 0,
  });

  // Поиск и Фильтры
  const [searchQuery, setSearchQuery] = React.useState('');
  const [accrualMonths, setAccrualMonths] = React.useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = React.useState<string>('all');
  const [selectedCategory, setSelectedCategory] = React.useState<string>('all');
  const [selectedTab, setSelectedTab] = React.useState<'all' | 'accruals' | 'deductions' | 'payouts'>('all');

  // Список сотрудников
  const [employees, setEmployees] = React.useState<
    { user_id: string; full_name: string; role: string; login: string; color?: string }[]
  >([]);

  // Состояние модальных окон
  const [isPayrollSheetOpen, setIsPayrollSheetOpen] = React.useState(false);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [selectedPayout, setSelectedPayout] = React.useState<PayoutItem | null>(null);

  // Удаление операции (Admin Only)
  const [payoutToDelete, setPayoutToDelete] = React.useState<PayoutItem | null>(null);
  const [isDeletingPayout, setIsDeletingPayout] = React.useState(false);

  const handleDeletePayout = async (payout: PayoutItem) => {
    if (currentUserRole !== 'admin') {
      showToast('Удаление операций по ЗП разрешено только администраторам', 'error');
      return;
    }
    setIsDeletingPayout(true);
    try {
      await api.payouts.delete(payout.payout_id);
      showToast(
        `Операция сотрудника ${payout.recipient?.full_name || ''} удалена`,
        'success'
      );
      setPayoutToDelete(null);
      if (selectedPayout?.payout_id === payout.payout_id) {
        setSelectedPayout(null);
      }
      fetchData(selectedMonth, selectedCategory);
    } catch (err: any) {
      showToast(err.message || 'Не удалось удалить операцию', 'error');
    } finally {
      setIsDeletingPayout(false);
    }
  };

  const currentMonthStr = new Date().toISOString().substring(0, 7);
  const todayStr = new Date().toISOString().substring(0, 10);

  // Состояние формы создания операции (Admin)
  const [formData, setFormData] = React.useState<{
    user_id: string;
    operation_type: SalaryOperationType;
    amount: number;
    actual_date: string;
    settlement_month: string;
    payment_method: string;
    note: string;
  }>({
    user_id: '',
    operation_type: 'salary_base',
    amount: 0,
    actual_date: todayStr,
    settlement_month: currentMonthStr,
    payment_method: 'mbank',
    note: '',
  });

  const [payrollPreview, setPayrollPreview] = React.useState<{
    opening_balance: number;
    total_accrued: number;
    total_deductions: number;
    total_paid: number;
    closing_balance: number;
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);

  // Загрузка данных журнала
  const fetchData = React.useCallback(async (month?: string, cat?: string, tab?: 'all' | 'accruals' | 'deductions' | 'payouts') => {
    setIsLoading(true);
    try {
      const monthFilter = month !== undefined ? month : selectedMonth;
      const catFilter = cat !== undefined ? cat : selectedCategory;
      const tabFilter = tab !== undefined ? tab : selectedTab;

      const [res, statsRes, monthsRes, employeesRes] = await Promise.all([
        api.payouts.getAll({
          page: 1,
          pageSize: 50,
          accrualMonth: monthFilter !== 'all' ? monthFilter : undefined,
          category: catFilter !== 'all' ? catFilter : undefined,
          tab: tabFilter !== 'all' ? tabFilter : undefined,
        }),
        getPayoutsStats(monthFilter !== 'all' ? monthFilter : undefined),
        getPayoutMonthsList(),
        getEmployeesList(),
      ]);

      setPayouts(res.items || []);
      setTotalCount(res.total || 0);
      setStats(statsRes);
      setAccrualMonths(monthsRes);
      setEmployees(employeesRes);
    } catch (err: any) {
      console.error('Failed to load salary operations:', err);
      showToast(err.message || 'Ошибка при загрузке реестра операций по ЗП', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, selectedCategory, selectedTab, showToast]);

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
    fetchData(val, selectedCategory, selectedTab);
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedCategory(val);
    fetchData(selectedMonth, val, selectedTab);
  };

  const handleTabChange = (tab: 'all' | 'accruals' | 'deductions' | 'payouts') => {
    setSelectedTab(tab);
    fetchData(selectedMonth, selectedCategory, tab);
  };

  // Автоматическая загрузка расчетного листка при выборе сотрудника в форме создания
  React.useEffect(() => {
    if (!isCreateOpen || !formData.user_id) {
      setPayrollPreview(null);
      return;
    }

    setIsLoadingPreview(true);
    api.payouts
      .getPayrollSheet({ employeeId: formData.user_id, month: formData.settlement_month })
      .then((sheet) => {
        setPayrollPreview({
          opening_balance: Number(sheet.opening_balance) || 0,
          total_accrued: Number(sheet.total_accrued) || 0,
          total_deductions: Number(sheet.total_deductions) || 0,
          total_paid: Number(sheet.total_paid) || 0,
          closing_balance: Number(sheet.closing_balance) || 0,
        });
      })
      .catch((err) => console.error('Failed to load payroll preview:', err))
      .finally(() => setIsLoadingPreview(false));
  }, [isCreateOpen, formData.user_id, formData.settlement_month]);

  // Обработка отправки формы создания
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.user_id) {
      showToast('Выберите сотрудника', 'error');
      return;
    }
    if (formData.amount <= 0) {
      showToast('Сумма операции должна быть больше нуля', 'error');
      return;
    }

    const isAccrual = ['salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance'].includes(
      formData.operation_type
    );
    const sign: SalaryOperationSign = isAccrual ? '+' : '-';

    setIsSubmitting(true);
    try {
      await api.payouts.create({
        user_id: formData.user_id,
        employee_id: formData.user_id,
        operation_sign: sign,
        operation_type: formData.operation_type,
        amount: Number(formData.amount),
        actual_date: formData.actual_date,
        settlement_month: formData.settlement_month,
        payment_method:
          formData.operation_type === 'payout' || formData.operation_type === 'advance'
            ? formData.payment_method
            : null,
        note: formData.note.trim() || undefined,
      });

      showToast('Операция по ЗП успешно проведена', 'success');
      setIsCreateOpen(false);
      setFormData({
        user_id: '',
        operation_type: 'salary_base',
        amount: 0,
        actual_date: todayStr,
        settlement_month: currentMonthStr,
        payment_method: 'mbank',
        note: '',
      });
      setPayrollPreview(null);
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка при проведении операции по ЗП', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Колонки реестра DataJournal
  const columns: ColumnDef<PayoutItem>[] = React.useMemo(
    () => [
      {
        key: 'payout_id',
        label: 'ID',
        width: 100,
        minWidth: 80,
        sortable: true,
        renderCell: (row) => (
          <span className="font-mono text-[11px] text-zinc-500 font-medium">
            #{row.payout_id.slice(0, 8)}
          </span>
        ),
      },
      {
        key: 'recipient',
        label: 'Сотрудник',
        width: 220,
        minWidth: 180,
        sortable: true,
        filterable: true,
        renderCell: (row) => (
          <div className="flex items-center gap-2">
            <EmployeeBadge
              name={row.recipient?.full_name || 'Неизвестный'}
              color={row.recipient?.color}
              size="sm"
            />
            <span className="text-[10px] text-zinc-400 font-mono">
              @{row.recipient?.login || 'user'}
            </span>
          </div>
        ),
      },
      {
        key: 'operation_sign',
        label: 'Знак',
        width: 80,
        minWidth: 70,
        sortable: true,
        renderCell: (row) => {
          const isPlus = row.operation_sign === '+';
          return (
            <span
              className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                isPlus
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
              }`}
            >
              {row.operation_sign}
            </span>
          );
        },
      },
      {
        key: 'operation_type',
        label: 'Вид операции',
        width: 210,
        minWidth: 175,
        sortable: true,
        filterable: true,
        renderCell: (row) => {
          const label = SALARY_OPERATION_TYPE_LABELS[row.operation_type] || row.operation_type;
          let colorClass = 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700';

          if (row.operation_type === 'accrual_connection') {
            colorClass = 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20';
          } else if (row.operation_type === 'accrual_maintenance') {
            colorClass = 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20';
          } else if (row.operation_type === 'salary_base') {
            colorClass = 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20';
          } else if (row.operation_type === 'bonus_other') {
            colorClass = 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20';
          } else if (row.operation_type === 'deduction') {
            colorClass = 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20';
          } else if (row.operation_type === 'fine') {
            colorClass = 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20';
          } else if (row.operation_type === 'advance') {
            colorClass = 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20';
          } else if (row.operation_type === 'payout') {
            colorClass = 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20';
          }

          return (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-semibold border ${colorClass}`}>
              {label}
            </span>
          );
        },
      },
      {
        key: 'amount',
        label: 'Сумма',
        width: 140,
        minWidth: 120,
        sortable: true,
        filterable: true,
        renderCell: (row) => {
          const isPlus = row.operation_sign === '+';
          return (
            <span
              className={`font-mono text-xs font-bold ${
                isPlus
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {isPlus ? '+' : '-'}
              {Number(row.amount).toLocaleString('ru-RU')} сом
            </span>
          );
        },
      },
      {
        key: 'actual_date',
        label: 'Дата операции',
        width: 130,
        minWidth: 110,
        sortable: true,
        filterable: true,
        renderCell: (row) => (
          <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
            <FormattedDate date={row.actual_date} type="date" />
          </span>
        ),
      },
      {
        key: 'settlement_month',
        label: 'Месяц начисления',
        width: 140,
        minWidth: 120,
        sortable: true,
        filterable: true,
        renderCell: (row) => (
          <span className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
            {row.settlement_month}
          </span>
        ),
      },
      {
        key: 'payment_method',
        label: 'Кошелек',
        width: 140,
        minWidth: 120,
        sortable: true,
        filterable: true,
        renderCell: (row) => {
          if (!row.payment_method && row.operation_type !== 'payout') {
            return <span className="text-[11px] text-zinc-400">—</span>;
          }
          const method = (row.payment_method || '').toLowerCase();
          let badgeColor = 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200/50 dark:border-zinc-700/50';
          let label = row.payment_method || '—';
          let IconComponent = Wallet;

          if (method === 'mbank') {
            badgeColor = 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
            label = 'МБанк';
            IconComponent = Smartphone;
          } else if (method === 'odengi' || method === 'oney') {
            badgeColor = 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
            label = 'О!Деньги';
            IconComponent = Wallet;
          } else if (method === 'bakai') {
            badgeColor = 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
            label = 'Бакай Банк';
            IconComponent = Landmark;
          } else if (method === 'abank') {
            badgeColor = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
            label = 'АБанк';
            IconComponent = Building2;
          } else if (method === 'cash') {
            badgeColor = 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20';
            label = 'Наличка';
            IconComponent = Banknote;
          }

          return (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold border ${badgeColor}`}>
              <IconComponent className="w-3 h-3 shrink-0" strokeWidth={1.75} />
              <span>{label}</span>
            </span>
          );
        },
      },
      {
        key: 'note',
        label: 'Основание / Источник',
        width: 260,
        minWidth: 190,
        sortable: false,
        filterable: true,
        renderCell: (row) => (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200 truncate block" title={row.note || ''}>
              {row.note || '—'}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {row.connection_id && (
                <Link
                  href={`/connections?search=${encodeURIComponent(row.connection_id)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-semibold text-[10px] transition-colors cursor-pointer"
                  title="Перейти к сделке (Подключение)"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  <span>{row.source_name || row.store || row.seller_name || 'Подключение'}</span>
                </Link>
              )}
              {row.seller_phone && (
                <Link
                  href={`/sellers?search=${encodeURIComponent(row.seller_phone)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-mono text-[10px] text-zinc-400 hover:text-blue-500 transition-colors"
                  title="Перейти к продавцу"
                >
                  +{row.seller_phone}
                </Link>
              )}
            </div>
          </div>
        ),
      },
    ],
    []
  );

  const activeFilterCount =
    (selectedMonth !== 'all' ? 1 : 0) + (selectedCategory !== 'all' ? 1 : 0);

  // Фильтры TopHeader
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
          <option value="all">Все периоды</option>
          {accrualMonths.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Вид операции
        </label>
        <select
          value={selectedCategory}
          onChange={handleCategoryChange}
          className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          <option value="all">Все виды операций</option>
          <option value="accrual_connection">Бонус за подключение</option>
          <option value="accrual_maintenance">Бонус за сопровождение</option>
          <option value="salary_base">Оклад</option>
          <option value="bonus_other">Прочая надбавка</option>
          <option value="payout">Выплата ЗП</option>
          <option value="advance">Аванс</option>
          <option value="deduction">Удержание</option>
          <option value="fine">Штраф</option>
        </select>
      </div>
    </div>
  );

  // Контекстные действия тулбара реестра
  const payoutActions = (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
      <button
        type="button"
        onClick={() => setIsPayrollSheetOpen(true)}
        className="h-9 md:h-11 px-3 md:px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
        title="Открыть расчётный лист"
      >
        <FileSpreadsheet className="w-4 h-4" strokeWidth={1.75} />
        <span className="hidden sm:inline">Расчётный лист</span>
      </button>

      <button
        type="button"
        onClick={() => fetchData()}
        className="h-9 md:h-11 w-9 md:w-auto p-0 md:px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center md:gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive flex-shrink-0 cursor-pointer"
        title="Обновить журнал"
      >
        <RotateCcw className={`w-4 h-4 text-blue-500 flex-shrink-0 ${isLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
        <span className="hidden md:inline">Обновить</span>
      </button>
    </div>
  );

  const renderCustomRowActions = React.useCallback(
    (row: PayoutItem) => {
      if (currentUserRole !== 'admin') return null;
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPayoutToDelete(row);
          }}
          className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center gap-2.5 transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4 text-rose-500" strokeWidth={1.75} />
          <span>Удалить операцию</span>
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
      searchPlaceholder="Поиск по сотруднику, виду операции или примечанию..."
      filterCount={activeFilterCount}
      filterContent={filterContent}
      onCreateClick={currentUserRole === 'admin' ? () => setIsCreateOpen(true) : undefined}
      createTooltip="Оформить операцию по ЗП"
    >
      <div className="space-y-4">
        {/* KPI сводка операций по ЗП */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
            <span className="text-[10px] sm:text-[11px] text-zinc-400 font-medium flex items-center gap-1 truncate">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" strokeWidth={1.75} />
              <span className="truncate">Начислено (+)</span>
            </span>
            <p className="text-sm sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono truncate">
              +{stats.totalAccrued.toLocaleString('ru-RU')} сом
            </p>
          </div>

          <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
            <span className="text-[10px] sm:text-[11px] text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1 truncate">
              <Wallet className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
              <span className="truncate">Выплачено (-)</span>
            </span>
            <p className="text-sm sm:text-xl font-bold text-blue-700 dark:text-blue-300 font-mono truncate">
              -{stats.totalPaid.toLocaleString('ru-RU')} сом
            </p>
          </div>

          <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-rose-500/10 dark:bg-rose-500/5 border border-rose-500/20 shadow-sm space-y-1">
            <span className="text-[10px] sm:text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1 truncate">
              <TrendingDown className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
              <span className="truncate">Удержания (-)</span>
            </span>
            <p className="text-sm sm:text-xl font-bold text-rose-700 dark:text-rose-300 font-mono truncate">
              -{stats.totalDeductions.toLocaleString('ru-RU')} сом
            </p>
          </div>

          <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
            <span className="text-[10px] sm:text-[11px] text-zinc-400 font-medium flex items-center gap-1 truncate">
              <Receipt className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" strokeWidth={1.75} />
              <span className="truncate">Операций в реестре</span>
            </span>
            <p className="text-sm sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono truncate">
              {stats.transactionsCount}
            </p>
          </div>
        </div>

        {/* Табы реестра операций по ЗП */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm overflow-x-auto">
          <button
            type="button"
            onClick={() => handleTabChange('all')}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              selectedTab === 'all'
                ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/60'
            }`}
          >
            <span>Все операции</span>
            <span
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium ${
                selectedTab === 'all'
                  ? 'bg-white/20 dark:bg-zinc-900/20 text-white dark:text-zinc-900'
                  : 'bg-zinc-200/60 dark:bg-zinc-800 text-zinc-500'
              }`}
            >
              {stats.transactionsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('accruals')}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              selectedTab === 'accruals'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>Начисления (+)</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('deductions')}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              selectedTab === 'deductions'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>Удержания и авансы (-)</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('payouts')}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              selectedTab === 'payouts'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-500/10'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>Выплаты (-)</span>
          </button>
        </div>

        {/* Универсальный реестр DataJournal */}
        <DataJournal<PayoutItem>
          data={payouts}
          columns={columns}
          keyField="payout_id"
          storageKey="salary_operations_journal"
          searchPlaceholder="Поиск по сотруднику, виду операции или примечанию..."
          onRowClick={(row) => setSelectedPayout(row)}
          totalCount={totalCount}
          externalSearchQuery={searchQuery}
          customActions={payoutActions}
          customRowActions={renderCustomRowActions}
        />

        {/* Модальное окно просмотра деталей операции */}
        {selectedPayout && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <Receipt className="w-5 h-5" strokeWidth={2} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      {selectedPayout.recipient?.full_name}
                    </h3>
                    <p className="text-xs text-zinc-400">
                      @{selectedPayout.recipient?.login} • #{selectedPayout.payout_id.slice(0, 8)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPayout(null)}
                  className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500 transition-colors"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-2.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Вид операции:</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {SALARY_OPERATION_TYPE_LABELS[selectedPayout.operation_type] || selectedPayout.operation_type}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Сумма:</span>
                  <span
                    className={`font-mono font-bold text-sm ${
                      selectedPayout.operation_sign === '+'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {selectedPayout.operation_sign}
                    {Number(selectedPayout.amount).toLocaleString('ru-RU')} сом
                  </span>
                </div>
                {selectedPayout.payment_method && (
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400">Кошелек:</span>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 uppercase">
                      {selectedPayout.payment_method}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Расчетный месяц:</span>
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">
                    {selectedPayout.settlement_month}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Дата операции:</span>
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">
                    <FormattedDate date={selectedPayout.actual_date} type="date" />
                  </span>
                </div>
                {selectedPayout.connection_id && (
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400">Сделка (Подключение):</span>
                    <Link
                      href={`/connections?search=${encodeURIComponent(selectedPayout.connection_id)}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-semibold text-xs transition-colors cursor-pointer"
                      title="Перейти к сделке"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>{selectedPayout.source_name || selectedPayout.store || selectedPayout.seller_name || 'Открыть сделку'}</span>
                    </Link>
                  </div>
                )}
                {selectedPayout.seller_phone && (
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400">Продавец:</span>
                    <Link
                      href={`/sellers?search=${encodeURIComponent(selectedPayout.seller_phone)}`}
                      className="font-mono text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                      title="Открыть карточку продавца"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>+{selectedPayout.seller_phone}</span>
                    </Link>
                  </div>
                )}
                {selectedPayout.note && (
                  <div className="pt-2 border-t border-zinc-200/50 dark:border-zinc-700/50">
                    <span className="text-zinc-400 block mb-1">Примечание:</span>
                    <p className="text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-800 p-2.5 rounded-xl border border-zinc-200/60 dark:border-zinc-700/60">
                      {selectedPayout.note}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                {currentUserRole === 'admin' ? (
                  <button
                    type="button"
                    onClick={() => setPayoutToDelete(selectedPayout)}
                    className="h-9 px-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    <span>Удалить</span>
                  </button>
                ) : <div />}
                <button
                  type="button"
                  onClick={() => setSelectedPayout(null)}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Модальное окно создания операции (Admin Only) */}
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
                      Новая операция по ЗП
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Регистрация начисления, удержания или выплаты сотруднику
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500 transition-colors"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {/* Выбор сотрудника */}
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Сотрудник *
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

                {/* Балансовая сводка выбранного сотрудника */}
                {formData.user_id && (
                  <div className="p-3.5 rounded-2xl bg-gradient-to-br from-zinc-50 to-zinc-100/70 dark:from-zinc-800/60 dark:to-zinc-800/30 border border-zinc-200/80 dark:border-zinc-700/60 space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                      <div className="flex items-center gap-1.5">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-500" strokeWidth={1.75} />
                        <span>Текущий расчетный лист ({formData.settlement_month})</span>
                      </div>
                      {isLoadingPreview && (
                        <span className="text-[11px] text-zinc-400 font-normal">Загрузка сальдо...</span>
                      )}
                    </div>
                    {payrollPreview ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                        <div className="p-2 rounded-xl bg-white/70 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-700/50">
                          <span className="text-zinc-500 dark:text-zinc-400 block text-[10px]">Вх. сальдо</span>
                          <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200">
                            {payrollPreview.opening_balance.toLocaleString('ru-RU')} с
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-white/70 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-700/50">
                          <span className="text-zinc-500 dark:text-zinc-400 block text-[10px]">Начислено</span>
                          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            +{payrollPreview.total_accrued.toLocaleString('ru-RU')} с
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-white/70 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-700/50">
                          <span className="text-zinc-500 dark:text-zinc-400 block text-[10px]">Удерж./Выпл.</span>
                          <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                            -{(payrollPreview.total_deductions + payrollPreview.total_paid).toLocaleString('ru-RU')} с
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                          <span className="text-emerald-700 dark:text-emerald-300 block text-[10px] font-semibold">К выплате</span>
                          <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                            {payrollPreview.closing_balance.toLocaleString('ru-RU')} с
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Вид операции */}
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Вид операции *
                  </label>
                  <select
                    value={formData.operation_type}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        operation_type: e.target.value as SalaryOperationType,
                      }))
                    }
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="salary_base">Оклад (+ Начисление)</option>
                    <option value="bonus_other">Прочая надбавка / Премия (+ Начисление)</option>
                    <option value="payout">Выплата ЗП (- Выплата)</option>
                    <option value="advance">Аванс (- Выплата)</option>
                    <option value="deduction">Удержание (- Удержание)</option>
                    <option value="fine">Штраф (- Удержание)</option>
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

                  {/* Расчетный месяц */}
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Расчетный месяц *
                    </label>
                    <input
                      type="text"
                      pattern="^\d{4}-\d{2}$"
                      required
                      value={formData.settlement_month}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, settlement_month: e.target.value }))
                      }
                      placeholder="2026-09"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Дата операции */}
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Дата операции *
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.actual_date}
                      onChange={(e) => setFormData((p) => ({ ...p, actual_date: e.target.value }))}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>

                  {/* Кошелек (только если выплата или аванс) */}
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Кошелек {formData.operation_type === 'payout' || formData.operation_type === 'advance' ? '*' : '(не требуется)'}
                    </label>
                    <select
                      value={formData.payment_method}
                      onChange={(e) => setFormData((p) => ({ ...p, payment_method: e.target.value }))}
                      disabled={formData.operation_type !== 'payout' && formData.operation_type !== 'advance'}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                    >
                      <option value="mbank">МБанк</option>
                      <option value="odengi">О!Деньги</option>
                      <option value="bakai">Бакай Банк</option>
                      <option value="abank">АБанк (Айыл Банк)</option>
                      <option value="cash">Наличка</option>
                    </select>
                  </div>
                </div>

                {/* Примечание */}
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Примечание
                  </label>
                  <textarea
                    rows={2}
                    value={formData.note}
                    onChange={(e) => setFormData((p) => ({ ...p, note: e.target.value }))}
                    placeholder="Например: Премия за перевыполнение плана..."
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
                  {isSubmitting ? 'Проведение...' : 'Подтвердить операцию'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Модальное окно «Расчётный лист» */}
        <PayrollSheetModal
          isOpen={isPayrollSheetOpen}
          onClose={() => setIsPayrollSheetOpen(false)}
          currentUserRole={currentUserRole}
          currentUserId={user.profile?.user_id || ''}
          employees={employees}
          months={accrualMonths}
        />

        {/* Диалог подтверждения удаления операции (Admin Only) */}
        {payoutToDelete && (
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
                    Удалить операцию по ЗП?
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {payoutToDelete.recipient?.full_name} • {payoutToDelete.operation_sign}{Number(payoutToDelete.amount).toLocaleString('ru-RU')} сом
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 space-y-1.5">
                <p className="text-[11px] leading-relaxed">
                  Запись будет безвозвратно удалена из регистра операций по ЗП. Если операция была привязана к начислениям подключений, они будут разблокированы.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isDeletingPayout}
                  onClick={() => setPayoutToDelete(null)}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={isDeletingPayout}
                  onClick={() => handleDeletePayout(payoutToDelete)}
                  className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {isDeletingPayout ? (
                    <span>Удаление...</span>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                      <span>Удалить операцию</span>
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
