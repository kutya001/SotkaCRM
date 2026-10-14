'use client';

import * as React from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { CollapsibleStats } from '@/components/ui/CollapsibleStats';
import { DataJournal, type ColumnDef } from '@/components/ui/DataJournal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { formatMonth } from '@/lib/utils/format';
import { formatPhoneDisplay } from '@/lib/utils/phone';
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
  Pencil,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select, Textarea } from '@/components/ui/Field';
import { useUser } from '@/components/auth/AuthProvider';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { PayrollSheetModal } from '@/components/payouts/PayrollSheetModal';
import { MonthInput, isValidSettlementMonth } from '@/components/ui/MonthInput';
import {
  classifySalaryOperation,
  signOfKind,
  OPERATION_TYPES_BY_KIND,
} from '@/lib/payroll/classify';
import {
  SALARY_OPERATION_TYPE_LABELS,
  type SalaryOperationType,
  type SalaryOperationSign,
} from '@/lib/validations';
import type { UserRole } from '@/types/database.types';

const CREATE_FORM_ID = 'payout-create-form';
const BULK_EDIT_FORM_ID = 'payout-bulk-edit-form';

/** Поле массового изменения: применяется только если отмечено */
function BulkField({
  label,
  hint,
  checked,
  onToggle,
  children,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <FormField
      hint={hint}
      label={
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onToggle(e.target.checked)}
            className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
          />
          <span>{label}</span>
        </label>
      }
    >
      {children}
    </FormField>
  );
}

/** Сумма в сомах: разделители тысяч, до 2 знаков после запятой */
function formatSom(value: number): string {
  return `${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом`;
}

export default function PayoutsPage() {
  const { showToast } = useToast();
  const user = useUser();

  const [payouts, setPayouts] = React.useState<PayoutItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const currentUserRole: UserRole = user.role;
  const userName = user.userName;
  const userLogin = user.userLogin;
  // Права назначенной роли
  const canCreatePayout = user.can('payouts.create');
  const canEditPayout = user.can('payouts.edit');
  const canDeletePayout = user.can('payouts.delete');
  const canBulkPayouts = user.can('payouts.bulk');
  const isAdmin = canEditPayout || canDeletePayout;
  const isPrivileged = user.canViewAll('payouts');

  // Статистика
  const [stats, setStats] = React.useState<PayoutsStats>({
    openingBalance: 0,
    totalAccrued: 0,
    totalDeductions: 0,
    totalPaid: 0,
    totalAdvances: 0,
    closingBalance: 0,
    transactionsCount: 0,
    accrualsCount: 0,
    deductionsCount: 0,
    payoutsCount: 0,
  });

  // Поиск и Фильтры
  const [searchQuery, setSearchQuery] = React.useState('');
  const [accrualMonths, setAccrualMonths] = React.useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = React.useState<string>('all');
  const [selectedCategory, setSelectedCategory] = React.useState<string>('all');
  const [selectedEmployee, setSelectedEmployee] = React.useState<string>('all');
  const [selectedTab, setSelectedTab] = React.useState<'all' | 'accruals' | 'deductions' | 'payouts'>('all');

  // Массовое редактирование (admin)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [bulkEditIds, setBulkEditIds] = React.useState<string[] | null>(null);
  const [bulkDeleteIds, setBulkDeleteIds] = React.useState<string[] | null>(null);
  const [isBulkSubmitting, setIsBulkSubmitting] = React.useState(false);
  const [bulkForm, setBulkForm] = React.useState({
    changeMonth: false,
    settlement_month: '',
    changeDate: false,
    actual_date: '',
    changeType: false,
    operation_type: 'payout' as SalaryOperationType,
    changeMethod: false,
    payment_method: 'mbank',
    changeNote: false,
    note: '',
  });

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
    if (!canDeletePayout) {
      showToast('Удаление операций по ЗП не предусмотрено вашей ролью', 'error');
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
      fetchData();
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
    total_advances: number;
    closing_balance: number;
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);

  // Загрузка данных журнала. Фильтры читаются из состояния; ответы устаревших запросов
  // (пользователь успел сменить фильтр) отбрасываются по номеру запроса
  const requestSeqRef = React.useRef(0);
  const fetchData = React.useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setIsLoading(true);
    try {
      const monthFilter = selectedMonth !== 'all' ? selectedMonth : undefined;
      const employeeFilter = selectedEmployee !== 'all' ? selectedEmployee : undefined;

      const [res, statsRes, monthsRes, employeesRes] = await Promise.all([
        api.payouts.getAll({
          page: 1,
          pageSize: 500,
          accrualMonth: monthFilter,
          category: selectedCategory !== 'all' ? selectedCategory : undefined,
          userId: employeeFilter,
          bypassCache: true,
        }),
        getPayoutsStats(monthFilter, employeeFilter),
        getPayoutMonthsList(),
        getEmployeesList(),
      ]);

      if (seq !== requestSeqRef.current) return;
      setPayouts(res.items || []);
      setTotalCount(res.total || 0);
      setStats(statsRes);
      setAccrualMonths(monthsRes);
      setEmployees(employeesRes);
    } catch (err: any) {
      if (seq !== requestSeqRef.current) return;
      console.error('Failed to load salary operations:', err);
      showToast(err.message || 'Ошибка при загрузке реестра операций по ЗП', 'error');
    } finally {
      if (seq === requestSeqRef.current) setIsLoading(false);
    }
  }, [selectedMonth, selectedCategory, selectedEmployee, showToast]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Вкладка вида операции — клиентский фильтр уже загруженного списка (без повторного запроса)
  const visiblePayouts = React.useMemo(() => {
    if (selectedTab === 'all') return payouts;
    const kind = selectedTab === 'accruals' ? 'accrual' : selectedTab === 'deductions' ? 'deduction' : 'payout';
    return payouts.filter((p) => classifySalaryOperation(p) === kind);
  }, [payouts, selectedTab]);

  // При смене фильтров и вкладки выбор строк сбрасывается: выбранные операции могли исчезнуть из списка
  React.useEffect(() => {
    setSelectedIds([]);
  }, [selectedMonth, selectedCategory, selectedTab, selectedEmployee]);

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMonth(e.target.value);
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCategory(e.target.value);
  };

  const handleTabChange = (tab: 'all' | 'accruals' | 'deductions' | 'payouts') => {
    setSelectedTab(tab);
  };

  // Автоматическая загрузка расчетного листка при выборе сотрудника в форме создания
  React.useEffect(() => {
    if (!isCreateOpen || !formData.user_id) {
      setPayrollPreview(null);
      return;
    }

    // Месяц вводится по маске: не запрашиваем лист, пока значение неполное (например, '2026-0')
    if (!isValidSettlementMonth(formData.settlement_month || '')) {
      return;
    }

    let cancelled = false;
    setIsLoadingPreview(true);
    api.payouts
      .getPayrollSheet({ employeeId: formData.user_id, month: formData.settlement_month, bypassCache: true })
      .then((sheet) => {
        if (cancelled) return;
        setPayrollPreview({
          opening_balance: Number(sheet.opening_balance) || 0,
          total_accrued: Number(sheet.total_accrued) || 0,
          total_deductions: Number(sheet.total_deductions) || 0,
          total_paid: Number(sheet.total_paid) || 0,
          total_advances: Number(sheet.total_advances) || 0,
          closing_balance: Number(sheet.closing_balance) || 0,
        });
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to load payroll preview:', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
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
    if (!isValidSettlementMonth(formData.settlement_month)) {
      showToast('Укажите расчетный месяц в формате ГГГГ-ММ', 'error');
      return;
    }

    const kind = classifySalaryOperation({ operation_type: formData.operation_type });
    const sign: SalaryOperationSign = signOfKind(kind);

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
        payment_method: kind === 'payout' ? formData.payment_method : null,
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

  // Массовое изменение: форма открывается для выбранных строк (или одной операции из карточки)
  const openBulkEdit = (ids: string[]) => {
    const first = payouts.find((p) => ids.includes(p.payout_id));
    setBulkForm({
      changeMonth: false,
      settlement_month: first?.settlement_month || currentMonthStr,
      changeDate: false,
      actual_date: first?.actual_date?.slice(0, 10) || todayStr,
      changeType: false,
      operation_type: (first?.operation_type as SalaryOperationType) || 'payout',
      changeMethod: false,
      payment_method: first?.payment_method || 'mbank',
      changeNote: false,
      note: ids.length === 1 ? first?.note || '' : '',
    });
    setBulkEditIds(ids);
  };

  const handleBulkEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkEditIds || bulkEditIds.length === 0) return;

    const changes: {
      settlement_month?: string;
      actual_date?: string;
      payment_method?: string;
      operation_type?: string;
      note?: string | null;
    } = {};
    if (bulkForm.changeMonth) {
      if (!isValidSettlementMonth(bulkForm.settlement_month)) {
        showToast('Укажите расчетный месяц в формате ГГГГ-ММ', 'error');
        return;
      }
      changes.settlement_month = bulkForm.settlement_month;
    }
    if (bulkForm.changeDate) changes.actual_date = bulkForm.actual_date;
    if (bulkForm.changeType) changes.operation_type = bulkForm.operation_type;
    if (bulkForm.changeMethod) changes.payment_method = bulkForm.payment_method;
    if (bulkForm.changeNote) changes.note = bulkForm.note.trim() || null;

    if (Object.keys(changes).length === 0) {
      showToast('Отметьте поля, которые нужно изменить', 'error');
      return;
    }

    setIsBulkSubmitting(true);
    try {
      const res = await api.payouts.batch({ action: 'update', ids: bulkEditIds, changes });
      showToast(`Изменено операций: ${res.updated ?? bulkEditIds.length}`, 'success');
      setBulkEditIds(null);
      setSelectedIds([]);
      if (selectedPayout && bulkEditIds.includes(selectedPayout.payout_id)) setSelectedPayout(null);
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось изменить операции', 'error');
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!bulkDeleteIds || bulkDeleteIds.length === 0) return;
    setIsBulkSubmitting(true);
    try {
      const res = await api.payouts.batch({ action: 'delete', ids: bulkDeleteIds });
      showToast(`Удалено операций: ${res.deleted ?? bulkDeleteIds.length}`, 'success');
      setBulkDeleteIds(null);
      setSelectedIds([]);
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось удалить операции', 'error');
    } finally {
      setIsBulkSubmitting(false);
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
        technical: true,
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
        cardTitle: true,
        textValue: (row) => row.recipient?.full_name || 'Неизвестный',
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
            <FormattedDate date={row.actual_date} type="dateOnly" />
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
            {formatMonth(row.settlement_month)}
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
                  {formatPhoneDisplay(row.seller_phone)}
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
    (selectedMonth !== 'all' ? 1 : 0) +
    (selectedCategory !== 'all' ? 1 : 0) +
    (selectedEmployee !== 'all' ? 1 : 0);

  const filterSelectClass =
    'w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none';

  // Фильтры TopHeader
  const filterContent = (
    <div className="space-y-3.5">
      <div>
        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Расчетный месяц
        </label>
        <select value={selectedMonth} onChange={handleMonthChange} className={filterSelectClass}>
          <option value="all">Все периоды</option>
          {accrualMonths.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {isPrivileged && (
        <div>
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
            Сотрудник
          </label>
          <select
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            className={filterSelectClass}
          >
            <option value="all">Все сотрудники</option>
            {employees.map((emp) => (
              <option key={emp.user_id} value={emp.user_id}>
                {emp.full_name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Детализация вида операции
        </label>
        <select value={selectedCategory} onChange={handleCategoryChange} className={filterSelectClass}>
          <option value="all">Все виды операций</option>
          <optgroup label="Начисления (+)">
            {OPERATION_TYPES_BY_KIND.accrual.map((t) => (
              <option key={t} value={t}>{SALARY_OPERATION_TYPE_LABELS[t]}</option>
            ))}
          </optgroup>
          <optgroup label="Удержания (−)">
            {OPERATION_TYPES_BY_KIND.deduction.map((t) => (
              <option key={t} value={t}>{SALARY_OPERATION_TYPE_LABELS[t]}</option>
            ))}
          </optgroup>
          <optgroup label="Выплаты (−)">
            {OPERATION_TYPES_BY_KIND.payout.map((t) => (
              <option key={t} value={t}>{SALARY_OPERATION_TYPE_LABELS[t]}</option>
            ))}
          </optgroup>
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
      if (!canDeletePayout) return null;
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
    [canDeletePayout]
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
      onCreateClick={canCreatePayout ? () => setIsCreateOpen(true) : undefined}
      createTooltip="Оформить операцию по ЗП"
    >
      <div className="space-y-4">
        {/* Сводка: остаток на начало → начислено / удержано / выплачено → остаток на конец */}
        <CollapsibleStats storageKey="payouts">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3">
            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
              <span className="text-[10px] sm:text-[11px] text-zinc-400 font-medium flex items-center gap-1 truncate">
                <Layers className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" strokeWidth={1.75} />
                <span className="truncate">Остаток на начало</span>
              </span>
              <p className={`text-sm sm:text-xl font-bold font-mono truncate ${stats.openingBalance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
                {formatSom(stats.openingBalance)}
              </p>
              <p className="text-[10px] text-zinc-400 truncate">
                {selectedMonth !== 'all' ? `на 01.${selectedMonth.slice(5, 7)}.${selectedMonth.slice(0, 4)}` : 'период не выбран'}
              </p>
            </div>

            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1">
              <span className="text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 truncate">
                <TrendingUp className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
                <span className="truncate">Начислено (+)</span>
              </span>
              <p className="text-sm sm:text-xl font-bold text-emerald-700 dark:text-emerald-300 font-mono truncate">
                +{formatSom(stats.totalAccrued)}
              </p>
              <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 truncate">
                операций: {stats.accrualsCount}
              </p>
            </div>

            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 shadow-sm space-y-1">
              <span className="text-[10px] sm:text-[11px] text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-1 truncate">
                <TrendingDown className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
                <span className="truncate">Удержано (−)</span>
              </span>
              <p className="text-sm sm:text-xl font-bold text-amber-700 dark:text-amber-300 font-mono truncate">
                −{formatSom(stats.totalDeductions)}
              </p>
              <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70 truncate">
                операций: {stats.deductionsCount}
              </p>
            </div>

            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
              <span className="text-[10px] sm:text-[11px] text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1 truncate">
                <Wallet className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
                <span className="truncate">Выплачено (−)</span>
              </span>
              <p className="text-sm sm:text-xl font-bold text-blue-700 dark:text-blue-300 font-mono truncate">
                −{formatSom(stats.totalPaid)}
              </p>
              <p className="text-[10px] text-blue-600/70 dark:text-blue-400/70 truncate">
                в т.ч. аванс: {formatSom(stats.totalAdvances)}
              </p>
            </div>

            <div className={`col-span-2 lg:col-span-1 p-2.5 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-xl shadow-sm space-y-1 border ${stats.closingBalance < 0 ? 'bg-rose-500/10 border-rose-500/30' : 'bg-white/75 dark:bg-zinc-900/75 border-emerald-500/30'}`}>
              <span className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 font-semibold flex items-center gap-1 truncate">
                <Receipt className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
                <span className="truncate">Остаток на конец</span>
              </span>
              <p className={`text-sm sm:text-xl font-bold font-mono truncate ${stats.closingBalance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
                {formatSom(stats.closingBalance)}
              </p>
              <p className={`text-[10px] truncate ${stats.closingBalance < 0 ? 'text-rose-500' : 'text-zinc-400'}`}>
                {stats.closingBalance < 0 ? 'переплата сотрудникам' : 'к выплате сотрудникам'}
              </p>
            </div>
          </div>
        </CollapsibleStats>

        <p className="text-[11px] text-zinc-400 px-1 -mt-1">
          Остаток на конец = остаток на начало + начислено − удержано − выплачено
          {selectedEmployee !== 'all'
            ? ` • ${employees.find((e) => e.user_id === selectedEmployee)?.full_name || 'сотрудник'}`
            : isPrivileged
              ? ' • все сотрудники'
              : ''}
        </p>

        {/* Табы реестра: три вида операций */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm overflow-x-auto">
          {(
            [
              { id: 'all', label: 'Все операции', count: stats.transactionsCount, active: 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900', hover: 'hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/60', Icon: null },
              { id: 'accruals', label: 'Начисления (+)', count: stats.accrualsCount, active: 'bg-emerald-600 text-white', hover: 'hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10', Icon: TrendingUp },
              { id: 'deductions', label: 'Удержания (−)', count: stats.deductionsCount, active: 'bg-amber-600 text-white', hover: 'hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10', Icon: TrendingDown },
              { id: 'payouts', label: 'Выплаты (−) • ЗП и аванс', count: stats.payoutsCount, active: 'bg-sky-600 text-white', hover: 'hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-500/10', Icon: Wallet },
            ] as const
          ).map((tab) => {
            const isActive = selectedTab === tab.id;
            const Icon = tab.Icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                  isActive ? `${tab.active} shadow-sm` : `text-zinc-600 dark:text-zinc-400 ${tab.hover}`
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />}
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium ${
                    isActive ? 'bg-white/20 dark:bg-zinc-900/20' : 'bg-zinc-200/60 dark:bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Универсальный реестр DataJournal */}
        <DataJournal<PayoutItem>
          data={visiblePayouts}
          columns={columns}
          keyField="payout_id"
          storageKey="salary_operations_journal"
          searchPlaceholder="Поиск по сотруднику, виду операции или примечанию..."
          onRowClick={(row) => setSelectedPayout(row)}
          totalCount={totalCount}
          externalSearchQuery={searchQuery}
          customActions={payoutActions}
          customRowActions={renderCustomRowActions}
          enableSelection={canBulkPayouts}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          renderBulkActions={(ids) => (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openBulkEdit(ids)}
                className="h-8 px-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Изменить</span>
              </button>
              <button
                type="button"
                onClick={() => setBulkDeleteIds(ids)}
                className="h-8 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-xs font-semibold text-rose-200 flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Удалить</span>
              </button>
            </div>
          )}
        />

        {/* Модальное окно просмотра деталей операции */}
        {selectedPayout && (
          <Modal
            open
            onClose={() => setSelectedPayout(null)}
            title={selectedPayout.recipient?.full_name || 'Операция по ЗП'}
            subtitle={`@${selectedPayout.recipient?.login || '—'} • #${selectedPayout.payout_id.slice(0, 8)}`}
            icon={Receipt}
            tone="success"
            size="md"
            footerClassName="justify-between"
            footer={
              <>
                {isAdmin ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => openBulkEdit([selectedPayout.payout_id])}
                      leftIcon={<Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />}
                    >
                      Изменить
                    </Button>
                    <Button
                      variant="dangerSoft"
                      onClick={() => setPayoutToDelete(selectedPayout)}
                      leftIcon={<Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />}
                    >
                      Удалить
                    </Button>
                  </div>
                ) : (
                  <span />
                )}
                <Button variant="outline" onClick={() => setSelectedPayout(null)}>
                  Закрыть
                </Button>
              </>
            }
          >
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
                    {formatMonth(selectedPayout.settlement_month)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Дата операции:</span>
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">
                    <FormattedDate date={selectedPayout.actual_date} type="dateOnly" />
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
                      <span>{formatPhoneDisplay(selectedPayout.seller_phone)}</span>
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
          </Modal>
        )}

        {/* Модальное окно создания операции (Admin Only) */}
        <Modal
          open={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="Новая операция по ЗП"
          subtitle="Регистрация начисления, удержания или выплаты сотруднику"
          icon={Plus}
          tone="success"
          size="lg"
          busy={isSubmitting}
          formId={CREATE_FORM_ID}
          onSubmit={handleCreateSubmit}
          footer={
            <>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isSubmitting}>
                Отмена
              </Button>
              <Button type="submit" form={CREATE_FORM_ID} variant="success" loading={isSubmitting}>
                {isSubmitting ? 'Проведение...' : 'Подтвердить операцию'}
              </Button>
            </>
          }
        >
              <div className="space-y-4">
                {/* Выбор сотрудника */}
                <FormField label="Сотрудник" required htmlFor="payout-create-user">
                  <Select
                    id="payout-create-user"
                    value={formData.user_id}
                    onChange={(e) => setFormData((p) => ({ ...p, user_id: e.target.value }))}
                    required
                  >
                    <option value="">— Выберите сотрудника —</option>
                    {employees.map((emp) => (
                      <option key={emp.user_id} value={emp.user_id}>
                        {emp.full_name} ({emp.role} • @{emp.login})
                      </option>
                    ))}
                  </Select>
                </FormField>

                {/* Балансовая сводка выбранного сотрудника */}
                {formData.user_id && (
                  <div className="p-3.5 rounded-2xl bg-gradient-to-br from-zinc-50 to-zinc-100/70 dark:from-zinc-800/60 dark:to-zinc-800/30 border border-zinc-200/80 dark:border-zinc-700/60 space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                      <div className="flex items-center gap-1.5">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-500" strokeWidth={1.75} />
                        <span>Текущий расчетный лист ({formatMonth(formData.settlement_month)})</span>
                      </div>
                      {isLoadingPreview && (
                        <span className="text-[11px] text-zinc-400 font-normal">Загрузка сальдо...</span>
                      )}
                    </div>
                    {payrollPreview ? (
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                        <div className="p-2 rounded-xl bg-white/70 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-700/50">
                          <span className="text-zinc-500 dark:text-zinc-400 block text-[10px]">На начало</span>
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
                          <span className="text-zinc-500 dark:text-zinc-400 block text-[10px]">Удержано</span>
                          <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                            −{payrollPreview.total_deductions.toLocaleString('ru-RU')} с
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-white/70 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-700/50" title={`В т.ч. аванс: ${payrollPreview.total_advances.toLocaleString('ru-RU')} с`}>
                          <span className="text-zinc-500 dark:text-zinc-400 block text-[10px]">Выплачено</span>
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                            −{payrollPreview.total_paid.toLocaleString('ru-RU')} с
                          </span>
                        </div>
                        <div className={`col-span-2 sm:col-span-1 p-2 rounded-xl border ${payrollPreview.closing_balance < 0 ? 'bg-rose-500/10 border-rose-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                          <span className={`block text-[10px] font-semibold ${payrollPreview.closing_balance < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                            {payrollPreview.closing_balance < 0 ? 'Переплата' : 'К выплате'}
                          </span>
                          <span className={`font-mono font-bold ${payrollPreview.closing_balance < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                            {payrollPreview.closing_balance.toLocaleString('ru-RU')} с
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Вид операции */}
                <FormField label="Вид операции" required htmlFor="payout-create-type">
                  <Select
                    id="payout-create-type"
                    value={formData.operation_type}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        operation_type: e.target.value as SalaryOperationType,
                      }))
                    }
                  >
                    <optgroup label="Начисление (+)">
                      <option value="salary_base">Оклад</option>
                      <option value="bonus_other">Прочая надбавка / Премия</option>
                    </optgroup>
                    <optgroup label="Удержание (−)">
                      <option value="deduction">Удержание</option>
                      <option value="fine">Штраф</option>
                    </optgroup>
                    <optgroup label="Выплата (−)">
                      <option value="payout">Выплата ЗП</option>
                      <option value="advance">Аванс</option>
                    </optgroup>
                  </Select>
                </FormField>

                <div className="grid grid-cols-2 gap-3">
                  {/* Сумма */}
                  <FormField label="Сумма (сом)" required htmlFor="payout-create-amount">
                    <Input
                      id="payout-create-amount"
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      value={formData.amount || ''}
                      onChange={(e) => setFormData((p) => ({ ...p, amount: parseFloat(e.target.value) || 0 }))}
                      placeholder="5000"
                      mono
                    />
                  </FormField>

                  {/* Расчетный месяц */}
                  <FormField label="Расчетный месяц" required>
                    <MonthInput
                      required
                      value={formData.settlement_month}
                      onChange={(value) => setFormData((p) => ({ ...p, settlement_month: value }))}
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Дата операции */}
                  <FormField label="Дата операции" required htmlFor="payout-create-date">
                    <Input
                      id="payout-create-date"
                      type="date"
                      required
                      value={formData.actual_date}
                      onChange={(e) => setFormData((p) => ({ ...p, actual_date: e.target.value }))}
                      mono
                    />
                  </FormField>

                  {/* Кошелек (только если выплата или аванс) */}
                  <FormField
                    label="Кошелек"
                    required={OPERATION_TYPES_BY_KIND.payout.includes(formData.operation_type)}
                    hint={OPERATION_TYPES_BY_KIND.payout.includes(formData.operation_type) ? undefined : 'Не требуется для этого вида операции'}
                    htmlFor="payout-create-method"
                  >
                    <Select
                      id="payout-create-method"
                      value={formData.payment_method}
                      onChange={(e) => setFormData((p) => ({ ...p, payment_method: e.target.value }))}
                      disabled={!OPERATION_TYPES_BY_KIND.payout.includes(formData.operation_type)}
                    >
                      <option value="mbank">МБанк</option>
                      <option value="odengi">О!Деньги</option>
                      <option value="bakai">Бакай Банк</option>
                      <option value="abank">АБанк (Айыл Банк)</option>
                      <option value="cash">Наличка</option>
                    </Select>
                  </FormField>
                </div>

                {/* Примечание */}
                <FormField label="Примечание" htmlFor="payout-create-note">
                  <Textarea
                    id="payout-create-note"
                    rows={2}
                    value={formData.note}
                    onChange={(e) => setFormData((p) => ({ ...p, note: e.target.value }))}
                    placeholder="Например: Премия за перевыполнение плана..."
                  />
                </FormField>
              </div>
        </Modal>

        {/* Массовое изменение операций (Admin Only) */}
        <Modal
          open={bulkEditIds !== null}
          onClose={() => setBulkEditIds(null)}
          title={
            bulkEditIds && bulkEditIds.length === 1
              ? 'Изменение операции'
              : `Массовое изменение: ${bulkEditIds?.length ?? 0} операций`
          }
          subtitle="Отметьте поля, которые нужно изменить"
          icon={Pencil}
          tone="info"
          size="lg"
          busy={isBulkSubmitting}
          formId={BULK_EDIT_FORM_ID}
          onSubmit={handleBulkEditSubmit}
          footer={
            <>
              <Button variant="outline" onClick={() => setBulkEditIds(null)} disabled={isBulkSubmitting}>
                Отмена
              </Button>
              <Button type="submit" form={BULK_EDIT_FORM_ID} variant="info" loading={isBulkSubmitting}>
                {isBulkSubmitting ? 'Сохранение...' : 'Применить'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <BulkField
              label="Расчетный месяц"
              checked={bulkForm.changeMonth}
              onToggle={(v) => setBulkForm((f) => ({ ...f, changeMonth: v }))}
            >
              <MonthInput
                disabled={!bulkForm.changeMonth}
                value={bulkForm.settlement_month}
                onChange={(value) => setBulkForm((f) => ({ ...f, settlement_month: value }))}
              />
            </BulkField>

            <BulkField
              label="Дата операции"
              checked={bulkForm.changeDate}
              onToggle={(v) => setBulkForm((f) => ({ ...f, changeDate: v }))}
            >
              <Input
                type="date"
                mono
                disabled={!bulkForm.changeDate}
                value={bulkForm.actual_date}
                onChange={(e) => setBulkForm((f) => ({ ...f, actual_date: e.target.value }))}
              />
            </BulkField>

            <BulkField
              label="Вид операции"
              hint="Бонусы по подключениям и сопровождению меняются только в модуле «Подключения»"
              checked={bulkForm.changeType}
              onToggle={(v) => setBulkForm((f) => ({ ...f, changeType: v }))}
            >
              <Select
                disabled={!bulkForm.changeType}
                value={bulkForm.operation_type}
                onChange={(e) => setBulkForm((f) => ({ ...f, operation_type: e.target.value as SalaryOperationType }))}
              >
                <optgroup label="Начисление (+)">
                  <option value="salary_base">Оклад</option>
                  <option value="bonus_other">Прочая надбавка / Премия</option>
                </optgroup>
                <optgroup label="Удержание (−)">
                  <option value="deduction">Удержание</option>
                  <option value="fine">Штраф</option>
                </optgroup>
                <optgroup label="Выплата (−)">
                  <option value="payout">Выплата ЗП</option>
                  <option value="advance">Аванс</option>
                </optgroup>
              </Select>
            </BulkField>

            <BulkField
              label="Кошелек"
              hint="Применяется только к выплатам и авансам"
              checked={bulkForm.changeMethod}
              onToggle={(v) => setBulkForm((f) => ({ ...f, changeMethod: v }))}
            >
              <Select
                disabled={!bulkForm.changeMethod}
                value={bulkForm.payment_method}
                onChange={(e) => setBulkForm((f) => ({ ...f, payment_method: e.target.value }))}
              >
                <option value="mbank">МБанк</option>
                <option value="odengi">О!Деньги</option>
                <option value="bakai">Бакай Банк</option>
                <option value="abank">АБанк (Айыл Банк)</option>
                <option value="cash">Наличка</option>
              </Select>
            </BulkField>

            <BulkField
              label="Примечание"
              checked={bulkForm.changeNote}
              onToggle={(v) => setBulkForm((f) => ({ ...f, changeNote: v }))}
            >
              <Textarea
                rows={2}
                disabled={!bulkForm.changeNote}
                value={bulkForm.note}
                onChange={(e) => setBulkForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Пусто — очистить примечание"
              />
            </BulkField>
          </div>
        </Modal>

        {/* Подтверждение массового удаления (Admin Only) */}
        <ConfirmDialog
          open={bulkDeleteIds !== null}
          onClose={() => !isBulkSubmitting && setBulkDeleteIds(null)}
          onConfirm={handleBulkDelete}
          title={`Удалить ${bulkDeleteIds?.length ?? 0} операций по ЗП?`}
          subtitle="Итоги и остатки сотрудников будут пересчитаны"
          tone="danger"
          icon={Trash2}
          confirmLabel="Удалить"
          level={2}
          description="Записи будут безвозвратно удалены. Начисления подключений, закрытые этими выплатами, снова станут неоплаченными."
        />

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
        <ConfirmDialog
          open={payoutToDelete !== null}
          onClose={() => !isDeletingPayout && setPayoutToDelete(null)}
          onConfirm={() => (payoutToDelete ? handleDeletePayout(payoutToDelete) : undefined)}
          title="Удалить операцию по ЗП?"
          subtitle={
            payoutToDelete
              ? `${payoutToDelete.recipient?.full_name || ''} • ${payoutToDelete.operation_sign}${Number(payoutToDelete.amount).toLocaleString('ru-RU')} сом`
              : undefined
          }
          tone="danger"
          icon={Trash2}
          confirmLabel="Удалить операцию"
          level={2}
          description="Запись будет безвозвратно удалена из регистра операций по ЗП. Если операция была привязана к начислениям подключений, они будут разблокированы."
        />
      </div>
    </AppLayout>
  );
}
