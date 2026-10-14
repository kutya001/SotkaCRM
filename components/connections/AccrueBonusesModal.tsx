'use client';

import * as React from 'react';
import { Coins, CheckCircle2, Link2, Clock, Check } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui/Toast';
import { Modal, ModalCallout } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, Select } from '@/components/ui/Field';
import { currentMonthISO, formatMonth } from '@/lib/utils/format';

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
  const currentMonthStr = currentMonthISO();

  const [selectedMonth, setSelectedMonth] = React.useState<string>(
    months[0] || currentMonthStr
  );
  // Бонус за подключение начисляется автоматически при подключении (миграция 035),
  // поэтому процедура по умолчанию — сопровождение
  const [accrualType, setAccrualType] = React.useState<'all' | 'connection' | 'maintenance'>('maintenance');
  const [isLoading, setIsLoading] = React.useState(false);
  const [result, setResult] = React.useState<{
    connection_bonuses_created: number;
    maintenance_bonuses_created: number;
    total_created: number;
    message: string;
    notice?: string;
  } | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setResult(null);
      if (months.length > 0 && !months.includes(selectedMonth)) {
        setSelectedMonth(months[0]);
      }
    }
  }, [isOpen, months, selectedMonth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setResult(null);
    try {
      const res = await api.connections.accrueAll(selectedMonth, accrualType);
      setResult(res);
      const toastMsg =
        accrualType === 'connection'
          ? `Начислено бонусов за подключение: +${res.connection_bonuses_created}`
          : accrualType === 'maintenance'
          ? `Начислено бонусов за сопровождение: +${res.maintenance_bonuses_created}`
          : `Начисление выполнено: подключений +${res.connection_bonuses_created}, сопровождений +${res.maintenance_bonuses_created}`;
      showToast(toastMsg, 'success');
      if (res.notice) showToast(res.notice, 'info');
      onSuccess();
    } catch (err: any) {
      showToast(err.message || 'Ошибка начисления бонусов', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Начисление за сопровождение"
      subtitle="Запускается администратором за расчетный месяц"
      icon={Coins}
      tone="success"
      size="lg"
      busy={isLoading}
      formId="accrue-bonuses-form"
      onSubmit={handleSubmit}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Отмена
          </Button>
          <Button type="submit" form="accrue-bonuses-form" variant="success" loading={isLoading} leftIcon={<Coins className="w-4 h-4" />}>
            Начислить
          </Button>
        </>
      }
    >
        <div className="space-y-4">
          {/* Варианты начислений */}
          <div>
            <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-2">
              Процедура
            </label>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => setAccrualType('maintenance')}
                className={`w-full p-2.5 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                  accrualType === 'maintenance'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100 shadow-sm'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/70'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    accrualType === 'maintenance'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                  }`}
                >
                  <Clock className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Сопровождение за месяц</span>
                    {accrualType === 'maintenance' && (
                      <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                        <Check className="w-2.5 h-2.5" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                    Ежемесячный бонус консультантам за выбранный расчетный месяц — со следующего месяца после подключения
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAccrualType('connection')}
                className={`w-full p-2.5 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                  accrualType === 'connection'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100 shadow-sm'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/70'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    accrualType === 'connection'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                  }`}
                >
                  <Link2 className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Проверить бонусы за подключение</span>
                    {accrualType === 'connection' && (
                      <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                        <Check className="w-2.5 h-2.5" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                    Бонус за подключение начисляется автоматически в момент подключения. Эта проверка доначисляет его подключениям, у которых начисления нет (созданы до автоначисления или без консультанта)
                  </p>
                </div>
              </button>
            </div>
          </div>

          <FormField
            label="Расчетный период"
            hint={
              accrualType === 'connection'
                ? 'Система проверит все подтвержденные подключения с консультантом и доначислит бонус за подключение там, где его нет.'
                : 'Система начислит ежемесячный бонус сопровождения за указанный период (при соблюдении лимита месяцев). В месяце начисления за подключение сопровождение не начисляется.'
            }
          >
            <Select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} size="lg">
              {months.length > 0 ? (
                months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonth(m)}
                  </option>
                ))
              ) : (
                <option value={currentMonthStr}>{formatMonth(currentMonthStr)}</option>
              )}
            </Select>
          </FormField>

          {result && (
            <ModalCallout tone="success" className="space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>Начисление успешно завершено!</span>
              </div>
              <p className="text-[11px]">
                За подключение: +{result.connection_bonuses_created} | За сопровождение: +{result.maintenance_bonuses_created}
              </p>
              {result.notice && <p className="text-[11px] text-amber-700 dark:text-amber-400">{result.notice}</p>}
            </ModalCallout>
          )}
        </div>
    </Modal>
  );
}
