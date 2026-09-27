'use client';

import * as React from 'react';
import {
  FileSpreadsheet,
  X,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Wallet,
  CheckCircle2,
  Calendar,
  User,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
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
  const [sheet, setSheet] = React.useState<{
    opening_balance: number;
    total_accrued: number;
    total_deductions: number;
    total_paid: number;
    closing_balance: number;
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
      setSheet({
        opening_balance: Number(data.opening_balance) || 0,
        total_accrued: Number(data.total_accrued) || 0,
        total_deductions: Number(data.total_deductions) || 0,
        total_paid: Number(data.total_paid) || 0,
        closing_balance: Number(data.closing_balance) || 0,
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка модального окна */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <FileSpreadsheet className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Расчётный лист
              </h3>
              <p className="text-xs text-zinc-400">
                Сводный финансовый баланс за расчетный период
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500 transition-colors"
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
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
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
          </div>
        </div>

        {/* Тело расчетного листка */}
        {isLoading ? (
          <div className="p-8 text-center space-y-2">
            <RotateCcw className="w-5 h-5 animate-spin mx-auto text-zinc-400" />
            <p className="text-xs text-zinc-400">Формирование расчетного листа...</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs">
            {error}
          </div>
        ) : sheet ? (
          <div className="space-y-3">
            {/* Балансовые строки */}
            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 space-y-2.5 text-xs">
              {/* Входящее сальдо */}
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">Входящее сальдо:</span>
                <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                  {sheet.opening_balance.toLocaleString('ru-RU')} KGS
                </span>
              </div>

              {/* Начислено (+) */}
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
                  <span>Начислено за период (+):</span>
                </span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  +{sheet.total_accrued.toLocaleString('ru-RU')} KGS
                </span>
              </div>

              {/* Удержано (-) */}
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5 text-rose-500" strokeWidth={2} />
                  <span>Удержано / Штрафы (-):</span>
                </span>
                <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                  -{sheet.total_deductions.toLocaleString('ru-RU')} KGS
                </span>
              </div>

              {/* Выплачено (-) */}
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5 text-amber-500" strokeWidth={2} />
                  <span>Выплачено (-):</span>
                </span>
                <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                  -{sheet.total_paid.toLocaleString('ru-RU')} KGS
                </span>
              </div>

              {/* Итоговая черта */}
              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                <span className="font-bold text-zinc-900 dark:text-zinc-100">
                  Исходящее сальдо (К выплате):
                </span>
                <span
                  className={`font-mono text-base font-extrabold ${
                    sheet.closing_balance >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {sheet.closing_balance.toLocaleString('ru-RU')} KGS
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Кнопка закрытия */}
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shadow-sm transition-all"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
