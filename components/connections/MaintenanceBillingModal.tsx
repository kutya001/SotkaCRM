'use client';

import React, { useState } from 'react';
import { Calendar, Play, CheckCircle2, AlertCircle, X, Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui/Toast';

interface MaintenanceBillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const MaintenanceBillingModal: React.FC<MaintenanceBillingModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { showToast } = useToast();
  const currentMonthStr = new Date().toISOString().substring(0, 7);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [result, setResult] = useState<{
    success: boolean;
    billing_month: string;
    generated_accruals: number;
    message: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleRunBilling = async () => {
    setIsLoading(true);
    setResult(null);
    try {
      const res = await api.connections.runBilling(selectedMonth);
      setResult(res);
      showToast(
        res.message || `Биллинг успешно проведен: сформировано ${res.generated_accruals} начислений`,
        'success'
      );
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      showToast(err.message || 'Ошибка проведения биллинга сопровождения', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Кнопка закрытия */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <X className="w-5 h-5" strokeWidth={1.75} />
        </button>

        {/* Заголовок */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <RefreshCw className="w-5 h-5" strokeWidth={1.75} />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              Биллинг сопровождения
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Ежемесячное начисление комиссий кураторам
            </p>
          </div>
        </div>

        {/* Описание регламента */}
        <div className="p-3.5 rounded-xl bg-purple-500/5 dark:bg-purple-500/10 border border-purple-500/15 mb-5 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
          Процедура начисляет бонусы кураторам за сопровождение магазинов (в пределах 2 месяцев сопровождения) по всем активным подключениям. Месяцы рассчитываются автоматически.
        </div>

        {/* Выбор расчетного месяца */}
        <div className="space-y-2 mb-6">
          <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Расчетный месяц биллинга:
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full h-10 px-3 pl-9 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-mono font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <Calendar className="w-4 h-4 text-zinc-400 absolute left-3 top-3 pointer-events-none" />
            </div>
            <button
              type="button"
              onClick={() => setSelectedMonth(currentMonthStr)}
              className="h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-xs font-medium transition-colors"
            >
              Текущий
            </button>
          </div>
        </div>

        {/* Результат если уже выполнен */}
        {result && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs mb-5 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">{result.message}</span>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5 block font-mono">
                Период: {result.billing_month} | Создано: {result.generated_accruals}
              </span>
            </div>
          </div>
        )}

        {/* Кнопки действий */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="h-10 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Закрыть
          </button>
          <button
            type="button"
            onClick={handleRunBilling}
            disabled={isLoading || !selectedMonth}
            className="h-10 px-5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-md shadow-purple-600/20 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Биллинг...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Запустить начисления</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
