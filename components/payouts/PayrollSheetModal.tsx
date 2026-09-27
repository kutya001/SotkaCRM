'use client';

import * as React from 'react';
import {
  FileSpreadsheet,
  X,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Wallet,
  Calendar,
  Layers,
  Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { SALARY_OPERATION_TYPE_LABELS, type SalaryOperationType } from '@/lib/validations';
import type { UserRole } from '@/types/database.types';

interface PayrollSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserRole: UserRole;
  currentUserId: string;
  employees: Array<{
    user_id: string;
    full_name: string;
    role: string;
    login: string;
    color?: string;
  }>;
  months: string[];
}

export interface PayrollOperationRow {
  payout_id?: string;
  id?: string;
  actual_date?: string;
  payout_date?: string;
  created_at?: string;
  settlement_month?: string;
  accrual_month?: string;
  operation_type?: string;
  operation_sign?: '+' | '-';
  amount: number;
  note?: string;
  comment?: string;
  description?: string;
  payment_method?: string | null;
}

export function PayrollSheetModal({
  isOpen,
  onClose,
  currentUserRole,
  currentUserId,
  employees,
  months,
}: PayrollSheetModalProps) {
  const currentMonthStr = new Date().toISOString().substring(0, 7);
  const isPrivileged = currentUserRole === 'admin' || currentUserRole === 'supervisor';

  const [selectedUserId, setSelectedUserId] = React.useState<string>(
    isPrivileged ? (employees[0]?.user_id || currentUserId) : currentUserId
  );
  const [selectedMonth, setSelectedMonth] = React.useState<string>(
    months[0] || currentMonthStr
  );
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] = React.useState<'accruals' | 'deductions' | 'payouts'>('accruals');

  const [sheet, setSheet] = React.useState<{
    opening_balance: number;
    total_accrued: number;
    total_deductions: number;
    total_paid: number;
    closing_balance: number;
    accruals: PayrollOperationRow[];
    deductions_and_advances: PayrollOperationRow[];
    payouts: PayrollOperationRow[];
  } | null>(null);

  React.useEffect(() => {
    if (!isPrivileged) {
      setSelectedUserId(currentUserId);
    } else if (!selectedUserId && employees.length > 0) {
      setSelectedUserId(employees[0].user_id);
    }
  }, [isPrivileged, currentUserId, employees, selectedUserId]);

  const loadPayrollSheet = React.useCallback(async (empId: string, month: string) => {
    if (!empId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.payouts.getPayrollSheet({ employeeId: empId, month });
      const rawOps: PayrollOperationRow[] = data.operations || [];

      // Безопасное формирование трех массивов детальных операций
      const accruals =
        data.accruals && data.accruals.length > 0
          ? data.accruals
          : rawOps.filter(
              (o) =>
                o.operation_sign === '+' ||
                ['salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance'].includes(
                  o.operation_type || ''
                )
            );

      const deductionsAndAdvances =
        data.deductions_and_advances && data.deductions_and_advances.length > 0
          ? data.deductions_and_advances
          : rawOps.filter((o) =>
              ['advance', 'deduction', 'fine'].includes(o.operation_type || '')
            );

      const payouts =
        data.payouts && data.payouts.length > 0
          ? data.payouts
          : rawOps.filter((o) => o.operation_type === 'payout' || !o.operation_type);

      setSheet({
        opening_balance: Number(data.opening_balance) || 0,
        total_accrued: Number(data.total_accrued) || 0,
        total_deductions: Number(data.total_deductions) || 0,
        total_paid: Number(data.total_paid) || 0,
        closing_balance: Number(data.closing_balance) || 0,
        accruals,
        deductions_and_advances: deductionsAndAdvances,
        payouts,
      });
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить расчетный лист');
      setSheet(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (isOpen && selectedUserId) {
      loadPayrollSheet(selectedUserId, selectedMonth);
    }
  }, [isOpen, selectedUserId, selectedMonth, loadPayrollSheet]);

  if (!isOpen) return null;

  const currentEmp = employees.find((e) => e.user_id === selectedUserId);

  const renderOperationsTable = (rows: PayrollOperationRow[], typeSign: '+' | '-') => {
    if (rows.length === 0) {
      return (
        <div className="py-8 text-center text-xs text-zinc-400">
          За выбранный месяц операции этого типа отсутствуют
        </div>
      );
    }

    return (
      <div className="overflow-x-auto rounded-xl border border-zinc-200/70 dark:border-zinc-800">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-100/75 dark:bg-zinc-800/60 border-b border-zinc-200/70 dark:border-zinc-800 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
              <th className="py-2.5 px-3">Дата</th>
              <th className="py-2.5 px-3">Месяц</th>
              <th className="py-2.5 px-3">Вид операции</th>
              <th className="py-2.5 px-3 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {rows.map((row, idx) => {
              const dateVal =
                row.actual_date || row.payout_date || row.created_at?.slice(0, 10) || '—';
              const monthVal = row.settlement_month || row.accrual_month || selectedMonth;
              const opType = (row.operation_type as SalaryOperationType) || 'payout';
              const label = SALARY_OPERATION_TYPE_LABELS[opType] || opType;

              return (
                <tr
                  key={row.payout_id || row.id || idx}
                  className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40 transition-colors"
                >
                  <td className="py-2 px-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                    {dateVal}
                  </td>
                  <td className="py-2 px-3 font-mono text-[11px] text-zinc-500">
                    {monthVal}
                  </td>
                  <td className="py-2 px-3">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {label}
                    </span>
                    {(row.note || row.comment) && (
                      <span className="block text-[10px] text-zinc-400 truncate max-w-[200px]">
                        {row.note || row.comment}
                      </span>
                    )}
                  </td>
                  <td
                    className={`py-2 px-3 text-right font-mono font-bold ${
                      typeSign === '+'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : opType === 'payout'
                        ? 'text-sky-600 dark:text-sky-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {typeSign}
                    {Number(row.amount || 0).toLocaleString('ru-RU')} сом
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl my-auto p-5 sm:p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка модального окна */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 flex-shrink-0">
              <FileSpreadsheet className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Расчётный лист
              </h3>
              <p className="text-xs text-zinc-400">
                Сводный финансовый баланс и операции за расчетный период
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        {/* Селекторы: Сотрудник и Месяц */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* Выбор сотрудника */}
          <div>
            <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">
              Сотрудник
            </label>
            {isPrivileged ? (
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                {employees.map((emp) => (
                  <option key={emp.user_id} value={emp.user_id}>
                    {emp.full_name} ({emp.role})
                  </option>
                ))}
              </select>
            ) : (
              <div className="h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center">
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {currentEmp?.full_name || 'Вы'}
                </span>
              </div>
            )}
          </div>

          {/* Выбор месяца */}
          <div>
            <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 block mb-1">
              Расчетный месяц
            </label>
            <div className="relative">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full h-10 px-3 pl-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                {months.length > 0 ? (
                  months.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))
                ) : (
                  <option value={currentMonthStr}>{currentMonthStr}</option>
                )}
              </select>
              <Calendar className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Тело расчетного листка */}
        {isLoading ? (
          <div className="py-12 text-center space-y-2">
            <RotateCcw className="w-5 h-5 animate-spin mx-auto text-zinc-400" />
            <p className="text-xs text-zinc-400">Формирование расчетного листа...</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs">
            {error}
          </div>
        ) : sheet ? (
          <div className="space-y-4">
            {/* СТРОКА 1: Входящий остаток (Сальдо на начало) */}
            <div className="px-4 py-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/70 dark:border-zinc-700/60 flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-600 dark:text-zinc-400">
                Входящий остаток (Сальдо на начало):
              </span>
              <span className="font-mono font-bold text-sm text-zinc-900 dark:text-zinc-100">
                {sheet.opening_balance.toLocaleString('ru-RU')} сом
              </span>
            </div>

            {/* СТРОКА 2: Сетка 3 колонки (Начислено | Удержано, штрафы, авансы | Выплачено) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Колонка 1: Начислено (+) */}
              <div className="p-3 rounded-2xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 space-y-1">
                <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Начислено (+)</span>
                </span>
                <p className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400">
                  +{sheet.total_accrued.toLocaleString('ru-RU')} сом
                </p>
              </div>

              {/* Колонка 2: Удержано, штрафы, авансы (-) */}
              <div className="p-3 rounded-2xl bg-rose-500/10 dark:bg-rose-500/5 border border-rose-500/20 space-y-1">
                <span className="text-[11px] font-medium text-rose-700 dark:text-rose-400 flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>Удержано / Авансы (-)</span>
                </span>
                <p className="font-mono text-base font-bold text-rose-600 dark:text-rose-400">
                  -{sheet.total_deductions.toLocaleString('ru-RU')} сом
                </p>
              </div>

              {/* Колонка 3: Выплачено (-) */}
              <div className="p-3 rounded-2xl bg-sky-500/10 dark:bg-sky-500/5 border border-sky-500/20 space-y-1">
                <span className="text-[11px] font-medium text-sky-700 dark:text-sky-400 flex items-center gap-1">
                  <Wallet className="w-3.5 h-3.5" />
                  <span>Выплачено (-)</span>
                </span>
                <p className="font-mono text-base font-bold text-sky-600 dark:text-sky-400">
                  -{sheet.total_paid.toLocaleString('ru-RU')} сом
                </p>
              </div>
            </div>

            {/* СТРОКА 3: Исходящий остаток (Сальдо на конец / К выплате) */}
            <div
              className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs transition-colors ${
                sheet.closing_balance >= 0
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-950 dark:text-rose-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <span className="font-bold text-sm">
                  Исходящий остаток (К выплате):
                </span>
              </div>
              <span className="font-mono text-lg font-extrabold tracking-tight">
                {sheet.closing_balance.toLocaleString('ru-RU')} сом
              </span>
            </div>

            {/* ДЕТАЛИЗАЦИЯ ОПЕРАЦИЙ: Табы и 4-колоночные таблицы */}
            <div className="pt-2 space-y-2.5">
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/60 text-xs w-full sm:w-fit">
                <button
                  type="button"
                  onClick={() => setActiveDetailTab('accruals')}
                  className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    activeDetailTab === 'accruals'
                      ? 'bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  Начисления ({sheet.accruals.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDetailTab('deductions')}
                  className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    activeDetailTab === 'deductions'
                      ? 'bg-white dark:bg-zinc-900 text-rose-600 dark:text-rose-400 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  Удержания / Авансы ({sheet.deductions_and_advances.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDetailTab('payouts')}
                  className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    activeDetailTab === 'payouts'
                      ? 'bg-white dark:bg-zinc-900 text-sky-600 dark:text-sky-400 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  Выплаты ({sheet.payouts.length})
                </button>
              </div>

              {/* Отображение выбранной таблицы */}
              <div className="max-h-60 overflow-y-auto pr-1">
                {activeDetailTab === 'accruals' &&
                  renderOperationsTable(sheet.accruals, '+')}
                {activeDetailTab === 'deductions' &&
                  renderOperationsTable(sheet.deductions_and_advances, '-')}
                {activeDetailTab === 'payouts' &&
                  renderOperationsTable(sheet.payouts, '-')}
              </div>
            </div>
          </div>
        ) : null}

        {/* Кнопка закрытия */}
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shadow-sm transition-all cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
