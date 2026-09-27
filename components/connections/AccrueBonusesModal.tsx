'use client';

import * as React from 'react';
import { Sparkles, Calendar, RotateCcw, CheckCircle2, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui/Toast';

interface AccrueBonusesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  months?: string[];
}

export function AccrueBonusesModal({
  isOpen,
  onClose,
  onSuccess,
  months = [],
}: AccrueBonusesModalProps) {
  const { showToast } = useToast();
  const currentMonthStr = new Date().toISOString().substring(0, 7);

  const [selectedMonth, setSelectedMonth] = React.useState<string>(
    months[0] || currentMonthStr
  );
  const [isLoading, setIsLoading] = React.useState(false);
  const [result, setResult] = React.useState<{
    connection_bonuses_created: number;
    maintenance_bonuses_created: number;
    total_created: number;
    message: string;
  } | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setResult(null);
      if (months.length > 0 && !months.includes(selectedMonth)) {
        setSelectedMonth(months[0]);
      }
    }
  }, [isOpen, months, selectedMonth]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setResult(null);
    try {
      const res = await api.connections.accrueAll(selectedMonth);
      setResult(res);
      showToast(
        `Начисление выполнено: подключений +${res.connection_bonuses_created}, сопровождений +${res.maintenance_bonuses_created}`,
        'success'
      );
      onSuccess();
    } catch (err: any) {
      showToast(err.message || 'Ошибка начисления бонусов', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка модального окна */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Sparkles className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Начислить бонусы
              </h3>
              <p className="text-xs text-zinc-400">
                Пакетное начисление бонусов за подключение и сопровождение
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

        {/* Форма запуска */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
              Расчетный период
            </label>
            <div className="relative">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full h-11 px-3 pl-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
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
              <Calendar className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            </div>
            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              Система автоматически проверит все активные подключения и создаст недостающие начисления кураторам за подключения и ежемесячное сопровождение.
            </p>
          </div>

          {result && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>Начисление успешно завершено!</span>
              </div>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                За подключение: {result.connection_bonuses_created} | За сопровождение: {result.maintenance_bonuses_created}
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="h-10 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <RotateCcw className="w-4 h-4 animate-spin" />
                  <span>Начисление...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Начислить</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
