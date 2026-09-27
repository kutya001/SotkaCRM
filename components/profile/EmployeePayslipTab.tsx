'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/client';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import {
  Calendar,
  CreditCard,
  TrendingUp,
  TrendingDown,
  Banknote,
  CheckCircle2,
  Clock,
  ArrowRight,
  Store,
  RotateCcw,
  Loader2,
  FileSpreadsheet,
  AlertCircle,
} from 'lucide-react';

interface EmployeePayslipTabProps {
  employeeId: string;
  isAdmin?: boolean;
}

interface PayrollSheetData {
  employee: {
    user_id: string;
    full_name: string;
    role: string;
    login: string;
    color?: string;
  } | null;
  employee_id: string;
  month: string;
  opening_balance: number;
  total_accrued: number;
  total_deductions: number;
  total_paid: number;
  closing_balance: number;
  accruals: any[];
  deductions: any[];
  payouts: any[];
}

export const EmployeePayslipTab: React.FC<EmployeePayslipTabProps> = ({
  employeeId,
  isAdmin = false,
}) => {
  const { showToast } = useToast();
  const currentMonthStr = new Date().toISOString().substring(0, 7);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [data, setData] = useState<PayrollSheetData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchPayrollSheet = useCallback(async () => {
    if (!employeeId) return;
    setIsLoading(true);
    try {
      const res = await api.profile.getPayrollSheet({
        employeeId,
        month: selectedMonth,
        bypassCache: true,
      });
      setData(res as unknown as PayrollSheetData);
    } catch (err: any) {
      console.error('Failed to load payroll sheet:', err);
      showToast(err.message || 'Ошибка загрузки расчетного листка', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [employeeId, selectedMonth, showToast]);

  useEffect(() => {
    fetchPayrollSheet();
  }, [fetchPayrollSheet]);

  const handlePrevMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month - 2, 1);
    setSelectedMonth(date.toISOString().substring(0, 7));
  };

  const handleNextMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month, 1);
    setSelectedMonth(date.toISOString().substring(0, 7));
  };

  return (
    <div className="space-y-6">
      {/* 1. Верхняя плавающая панель управления периодом */}
      <div className="p-4 sm:p-5 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-purple-500/10 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5" strokeWidth={1.75} />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100">
              Расчётный листок куратора
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Непрерывный сальдовый расчет начислений и выплат
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="h-9 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold transition-colors"
          >
            ← Пред.
          </button>

          <div className="relative">
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 px-3 pl-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-mono font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <Calendar className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2.5 pointer-events-none" />
          </div>

          <button
            type="button"
            onClick={handleNextMonth}
            className="h-9 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold transition-colors"
          >
            След. →
          </button>

          <button
            type="button"
            onClick={() => setSelectedMonth(currentMonthStr)}
            className="h-9 px-3 rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-semibold transition-colors border border-purple-200/50 dark:border-purple-800/50"
          >
            Текущий
          </button>

          <button
            type="button"
            onClick={fetchPayrollSheet}
            disabled={isLoading}
            className="h-9 w-9 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 flex items-center justify-center transition-colors"
            title="Обновить"
          >
            <RotateCcw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3 text-zinc-400">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          <span className="text-xs">Формирование расчетного листка...</span>
        </div>
      ) : !data ? (
        <div className="p-8 text-center text-xs text-zinc-400 bg-white/50 dark:bg-zinc-900/50 rounded-3xl border border-zinc-200 dark:border-zinc-800">
          Данные за выбранный период не найдены
        </div>
      ) : (
        <>
          {/* 2. Пять карточек сальдового потока (Continuous Balance) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* 1. Начальное сальдо */}
            <div className="p-4 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-zinc-500 text-xs mb-2">
                <span className="font-medium">Сальдо на начало:</span>
                <Clock className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <span className="text-lg font-mono font-bold text-zinc-900 dark:text-zinc-100">
                  {Number(data.opening_balance).toLocaleString('ru-RU')}
                </span>
                <span className="text-xs text-zinc-400 font-mono ml-1">сом</span>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 block">
                Долга компании на 1-е число
              </span>
            </div>

            {/* 2. Начислено (+) */}
            <div className="p-4 rounded-3xl backdrop-blur-xl bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400 text-xs mb-2">
                <span className="font-semibold">+ Начислено:</span>
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <span className="text-lg font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  +{Number(data.total_accrued).toLocaleString('ru-RU')}
                </span>
                <span className="text-xs text-emerald-600/70 font-mono ml-1">сом</span>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 block">
                {data.accruals.length} операций комиссий
              </span>
            </div>

            {/* 3. Удержано (-) */}
            <div className="p-4 rounded-3xl backdrop-blur-xl bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/20 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-rose-700 dark:text-rose-400 text-xs mb-2">
                <span className="font-semibold">- Удержано:</span>
                <TrendingDown className="w-4 h-4" />
              </div>
              <div>
                <span className="text-lg font-mono font-bold text-rose-600 dark:text-rose-400">
                  -{Number(data.total_deductions).toLocaleString('ru-RU')}
                </span>
                <span className="text-xs text-rose-600/70 font-mono ml-1">сом</span>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 block">
                {data.deductions.length} штрафов / удержаний
              </span>
            </div>

            {/* 4. Выплачено (-) */}
            <div className="p-4 rounded-3xl backdrop-blur-xl bg-purple-500/5 dark:bg-purple-500/10 border border-purple-500/20 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-purple-700 dark:text-purple-400 text-xs mb-2">
                <span className="font-semibold">- Выплачено:</span>
                <Banknote className="w-4 h-4" />
              </div>
              <div>
                <span className="text-lg font-mono font-bold text-purple-600 dark:text-purple-400">
                  -{Number(data.total_paid).toLocaleString('ru-RU')}
                </span>
                <span className="text-xs text-purple-600/70 font-mono ml-1">сом</span>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 block">
                {data.payouts.length} фактов перечислений
              </span>
            </div>

            {/* 5. Конечное сальдо (=) */}
            <div className={`p-4 rounded-3xl backdrop-blur-xl border shadow-sm flex flex-col justify-between ${
              data.closing_balance > 0
                ? 'bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/30'
                : 'bg-zinc-100/80 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700'
            }`}>
              <div className="flex items-center justify-between text-xs mb-2 font-semibold">
                <span className={data.closing_balance > 0 ? 'text-amber-800 dark:text-amber-300' : 'text-zinc-700 dark:text-zinc-300'}>
                  = Сальдо на конец:
                </span>
                <CheckCircle2 className={`w-4 h-4 ${data.closing_balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400'}`} />
              </div>
              <div>
                <span className={`text-lg font-mono font-bold ${data.closing_balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
                  {Number(data.closing_balance).toLocaleString('ru-RU')}
                </span>
                <span className="text-xs font-mono ml-1 text-zinc-400">сом</span>
              </div>
              <span className="text-[10px] text-zinc-500 mt-1 block">
                {data.closing_balance > 0 ? 'К выплате куратору' : 'Расчеты закрыты'}
              </span>
            </div>
          </div>

          {/* 3. Три детализированные таблицы */}
          <div className="space-y-6">
            {/* Таблица 1: Начисления */}
            <div className="p-6 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      1. Начисления комиссий куратора
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Подключения и ежемесячное сопровождение за {data.month}
                    </p>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  Итого: +{Number(data.total_accrued).toLocaleString('ru-RU')} сом
                </span>
              </div>

              {data.accruals.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                  В этом месяце начислений не зафиксировано
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200/60 dark:border-zinc-800 text-zinc-400 font-medium">
                        <th className="py-2.5 px-3">Магазин / Клиент</th>
                        <th className="py-2.5 px-3">Телефон</th>
                        <th className="py-2.5 px-3">Тип</th>
                        <th className="py-2.5 px-3">Статус выплаты</th>
                        <th className="py-2.5 px-3">Примечание</th>
                        <th className="py-2.5 px-3 text-right">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                      {data.accruals.map((a: any) => (
                        <tr key={a.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors">
                          <td className="py-2.5 px-3 font-medium text-zinc-900 dark:text-zinc-100">
                            <div>{a.seller_name}</div>
                            <div className="text-[10px] text-zinc-400">{a.store}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                            +{a.seller_phone}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                              a.accrual_type === 'connection'
                                ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20'
                                : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                            }`}>
                              {a.accrual_type === 'connection' ? 'Подключение' : 'Сопровождение'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            {a.is_paid ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3" />
                                Оплачено
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                <Clock className="w-3 h-3" />
                                Не оплачено
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-400 text-[11px] italic">
                            {a.notes || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            +{Number(a.amount).toLocaleString('ru-RU')} сом
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Таблица 2: Удержания */}
            <div className="p-6 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                    <TrendingDown className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      2. Удержания и штрафы
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Вычеты из баланса куратора за {data.month}
                    </p>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold text-rose-600 dark:text-rose-400">
                  Итого: -{Number(data.total_deductions).toLocaleString('ru-RU')} сом
                </span>
              </div>

              {data.deductions.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                  Удержаний в расчетном месяце нет
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200/60 dark:border-zinc-800 text-zinc-400 font-medium">
                        <th className="py-2.5 px-3">Дата проводки</th>
                        <th className="py-2.5 px-3">Основание / Примечание</th>
                        <th className="py-2.5 px-3">Инструмент</th>
                        <th className="py-2.5 px-3 text-right">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                      {data.deductions.map((d: any) => (
                        <tr key={d.payout_id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                            <FormattedDate date={d.payout_date} type="date" />
                          </td>
                          <td className="py-2.5 px-3 font-medium text-zinc-800 dark:text-zinc-200">
                            {d.description || 'Удержание'}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-500">
                            {d.payment_method || 'Внутренний вычет'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                            -{Number(d.amount).toLocaleString('ru-RU')} сом
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Таблица 3: Выплаты */}
            <div className="p-6 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <Banknote className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      3. Фактические выплаты
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Перечисления средств на счета куратора за {data.month}
                    </p>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
                  Итого: -{Number(data.total_paid).toLocaleString('ru-RU')} сом
                </span>
              </div>

              {data.payouts.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                  Выплат в расчетном месяце пока не проводилось
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200/60 dark:border-zinc-800 text-zinc-400 font-medium">
                        <th className="py-2.5 px-3">Дата выплаты</th>
                        <th className="py-2.5 px-3">Платежный инструмент</th>
                        <th className="py-2.5 px-3">Назначение платежа</th>
                        <th className="py-2.5 px-3 text-right">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                      {data.payouts.map((p: any) => {
                        const m = (p.payment_method || '').toLowerCase();
                        let badgeColor = 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300';
                        let label = p.payment_method;
                        if (m.includes('kaspi')) {
                          badgeColor = 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20';
                          label = 'Kaspi Pay';
                        } else if (m.includes('halyk')) {
                          badgeColor = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20';
                          label = 'Halyk Bank';
                        } else if (m.includes('oney') || m.includes('деньги')) {
                          badgeColor = 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
                          label = 'O!Dengi';
                        } else if (m.includes('cash') || m.includes('наличные')) {
                          badgeColor = 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20';
                          label = 'Наличные';
                        } else if (m.includes('card') || m.includes('карт')) {
                          badgeColor = 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20';
                          label = 'Перевод на карту';
                        }

                        return (
                          <tr key={p.payout_id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors">
                            <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                              <FormattedDate date={p.payout_date} type="date" />
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold ${badgeColor}`}>
                                <CreditCard className="w-3 h-3" />
                                <span>{label}</span>
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-medium text-zinc-800 dark:text-zinc-200">
                              {p.description || 'Выплата зарплаты'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-600 dark:text-purple-400">
                              -{Number(p.amount).toLocaleString('ru-RU')} сом
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
