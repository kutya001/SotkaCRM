'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui/Toast';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, Input } from '@/components/ui/Field';
import { formatMonth } from '@/lib/utils/format';
import {
  Banknote,
  CheckCircle2,
  Clock,
  Trash2,
  Edit2,
  Check,
  Loader2,
} from 'lucide-react';

export interface RealPostingItem {
  id: string;
  connection_id: string;
  seller_phone?: string;
  employee_id: string;
  operation_type: string;
  operation_sign?: '+' | '-';
  settlement_month: string;
  actual_date: string;
  amount: number;
  note?: string;
  status?: string;
  is_paid?: boolean;
  created_at?: string;
  users?: {
    user_id: string;
    full_name: string;
    role: string;
  } | null;
}

interface ConnectionAccrualsSectionProps {
  connectionId: string;
  isAdmin: boolean;
  onUpdated?: () => void;
}

export const ConnectionAccrualsSection: React.FC<ConnectionAccrualsSectionProps> = ({
  connectionId,
  isAdmin,
  onUpdated,
}) => {
  const { showToast } = useToast();
  const confirmDialog = useConfirm();
  const [postings, setPostings] = useState<RealPostingItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [editingPosting, setEditingPosting] = useState<RealPostingItem | null>(null);

  // Form state for editing
  const [editActualDate, setEditActualDate] = useState<string>('');
  const [editSettlementMonth, setEditSettlementMonth] = useState<string>('');
  const [editAmount, setEditAmount] = useState<string>('');
  const [editNote, setEditNote] = useState<string>('');

  const fetchPostings = async () => {
    setIsLoading(true);
    try {
      const res = await api.connections.getAccruals(connectionId);
      setPostings(res.accruals || []);
    } catch (err: any) {
      console.error('Error fetching connection accruals:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (connectionId) {
      fetchPostings();
    }
  }, [connectionId]);

  const openEditModal = (item: RealPostingItem) => {
    setEditingPosting(item);
    setEditActualDate(item.actual_date || new Date().toISOString().slice(0, 10));
    setEditSettlementMonth(item.settlement_month || new Date().toISOString().slice(0, 7));
    setEditAmount(String(item.amount || ''));
    setEditNote(item.note || '');
  };

  const closeEditModal = () => {
    setEditingPosting(null);
  };

  const handleSavePosting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPosting) return;

    const numAmount = parseFloat(editAmount);
    if (isNaN(numAmount) || numAmount < 0) {
      showToast('Укажите корректную сумму', 'error');
      return;
    }

    if (!editSettlementMonth || !/^\d{4}-\d{2}$/.test(editSettlementMonth)) {
      showToast('Месяц начисления должен быть в формате ГГГГ-ММ', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await api.payouts.update(editingPosting.id, {
        actual_date: editActualDate,
        settlement_month: editSettlementMonth,
        amount: numAmount,
        note: editNote,
        comment: editNote,
      });

      showToast('Проводка начисления успешно обновлена', 'success');
      closeEditModal();
      await fetchPostings();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      showToast(err.message || 'Ошибка сохранения проводки', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePosting = async (id: string) => {
    const ok = await confirmDialog({
      title: 'Удалить проводку начисления?',
      description: 'Проводка будет удалена из регистра операций по ЗП. Действие необратимо.',
      tone: 'danger',
      icon: Trash2,
      confirmLabel: 'Удалить',
    });
    if (!ok) return;
    try {
      await api.payouts.delete(id);
      showToast('Проводка удалена', 'success');
      await fetchPostings();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      // Fallback try deleting via connections endpoint
      try {
        await api.connections.deleteAccrual(connectionId, id);
        showToast('Проводка удалена', 'success');
        await fetchPostings();
        if (onUpdated) onUpdated();
      } catch (err2: any) {
        showToast(err.message || err2.message || 'Не удалось удалить проводку', 'error');
      }
    }
  };

  const getOperationBadge = (opType: string) => {
    switch (opType) {
      case 'accrual_connection':
      case 'connection':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
            Подключение
          </span>
        );
      case 'accrual_maintenance':
      case 'maintenance':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            Сопровождение
          </span>
        );
      case 'advance':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            Аванс
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20">
            {opType}
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 flex items-center justify-center gap-2 text-zinc-400 text-xs">
        <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
        <span>Загрузка реальных проводок...</span>
      </div>
    );
  }

  const totalAmount = postings.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  return (
    <div className="space-y-3">
      {/* Шапка блока реальных проводок */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
            <Banknote className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
              Реальные проводки начислений
            </h4>
            <p className="text-[10px] text-zinc-400">
              Фактические записи из регистра операций по ЗП
            </p>
          </div>
        </div>
        <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
          Итого начислено: <span className="text-emerald-600 dark:text-emerald-400 font-bold">+{totalAmount.toLocaleString('ru-RU')}</span> сом
        </div>
      </div>

      {postings.length === 0 ? (
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-700/60 text-center text-xs text-zinc-400">
          Фактические проводки по данному подключению пока отсутствуют
        </div>
      ) : (
        <div className="space-y-2">
          {postings.map((item) => (
            <div
              key={item.id}
              className="p-3 rounded-2xl bg-zinc-50/80 dark:bg-zinc-800/60 border border-zinc-200/70 dark:border-zinc-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-all shadow-2xs hover:border-zinc-300 dark:hover:border-zinc-600"
            >
              {/* Левая часть карточки: бейдж типа, месяц, дата, примечание */}
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {getOperationBadge(item.operation_type)}
                <span className="font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                  {item.settlement_month ? formatMonth(item.settlement_month) : '—'}
                </span>
                <span className="text-[11px] text-zinc-400 font-mono">
                  {item.actual_date ? (
                    <FormattedDate date={item.actual_date} type="dateOnly" />
                  ) : (
                    '—'
                  )}
                </span>
                {item.users?.full_name && (
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[120px]" title={item.users.full_name}>
                    • {item.users.full_name}
                  </span>
                )}
                {item.note && (
                  <span
                    className="text-[11px] text-zinc-400 dark:text-zinc-500 italic truncate max-w-[150px]"
                    title={item.note}
                  >
                    ({item.note})
                  </span>
                )}
              </div>

              {/* Правая часть карточки: сумма жирным зеленым, статус и кнопки действий */}
              <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-zinc-200/40 dark:border-zinc-700/40">
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                  +{Number(item.amount).toLocaleString('ru-RU')} сом
                </span>

                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                    item.is_paid || item.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  {item.is_paid || item.status === 'completed' ? 'Выплачено' : 'К выплате'}
                </span>

                {isAdmin && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditModal(item)}
                      title="Редактировать проводку"
                      className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePosting(item.id)}
                      title="Удалить проводку"
                      className="p-1 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Модальное окно редактирования проводки (для admin) — вложенное поверх карточки подключения */}
      <Modal
        open={editingPosting !== null}
        onClose={() => !isSaving && closeEditModal()}
        title="Редактирование проводки начисления"
        subtitle={editingPosting ? `${editingPosting.operation_type} · ${formatMonth(editingPosting.settlement_month)}` : undefined}
        icon={Edit2}
        tone="purple"
        size="md"
        level={2}
        busy={isSaving}
        formId="connection-accrual-edit-form"
        onSubmit={handleSavePosting}
        footer={
          <>
            <Button variant="outline" onClick={closeEditModal} disabled={isSaving}>
              Отмена
            </Button>
            <Button
              type="submit"
              form="connection-accrual-edit-form"
              className="bg-purple-600 hover:bg-purple-700 text-white"
              loading={isSaving}
              leftIcon={<Check className="w-3.5 h-3.5" />}
            >
              Сохранить изменения
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="Дата проводки" required>
            <Input type="date" value={editActualDate} onChange={(e) => setEditActualDate(e.target.value)} required mono />
          </FormField>
          <FormField label="Расчетный месяц" required>
            <Input type="month" value={editSettlementMonth} onChange={(e) => setEditSettlementMonth(e.target.value)} required mono />
          </FormField>
          <FormField label="Сумма начисления (сом)" required>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              required
              mono
            />
          </FormField>
          <FormField label="Примечание / Комментарий">
            <Input
              type="text"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Например: Бонус за подключение ТТ"
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
};

