'use client';

import React, { useState } from 'react';
import { Play, CheckCircle2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui/Toast';
import { Modal, ModalCallout } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, Input } from '@/components/ui/Field';
import { currentMonthISO, formatMonth } from '@/lib/utils/format';

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
  const currentMonthStr = currentMonthISO();
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [result, setResult] = useState<{
    success: boolean;
    billing_month: string;
    generated_accruals: number;
    message: string;
  } | null>(null);

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
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Биллинг сопровождения"
      subtitle="Ежемесячное начисление комиссий консультантам"
      icon={RefreshCw}
      tone="purple"
      size="md"
      busy={isLoading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Закрыть
          </Button>
          <Button
            className="bg-purple-600 hover:bg-purple-700 text-white"
            onClick={handleRunBilling}
            disabled={!selectedMonth}
            loading={isLoading}
            leftIcon={<Play className="w-4 h-4" />}
          >
            Запустить начисления
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalCallout tone="purple">
          Процедура начисляет бонусы консультантам за сопровождение магазинов (в пределах 2 месяцев сопровождения) по всем
          подтвержденным подключениям. Месяцы рассчитываются автоматически.
        </ModalCallout>

        <FormField label="Расчетный месяц биллинга" required>
          <div className="flex items-center gap-2">
            <Input type="month" mono value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="flex-1" />
            <Button variant="secondary" onClick={() => setSelectedMonth(currentMonthStr)}>
              Текущий
            </Button>
          </div>
        </FormField>

        {result && (
          <ModalCallout tone="success" className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">{result.message}</span>
              <span className="text-[11px] mt-0.5 block font-mono">
                Период: {formatMonth(result.billing_month)} | Создано: {result.generated_accruals}
              </span>
            </div>
          </ModalCallout>
        )}
      </div>
    </Modal>
  );
};
