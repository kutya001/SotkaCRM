'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui/Toast';
import { FormattedDate } from '@/components/ui/FormattedDate';
import {
  Banknote,
  CheckCircle2,
  Clock,
  Trash2,
  Edit2,
  Check,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';

interface AccrualItem {
  id: string;
  connection_id: string;
  seller_phone: string;
  employee_id: string;
  accrual_type: 'connection' | 'maintenance';
  settlement_month: string;
  amount: number;
  is_paid: boolean;
  payout_id?: string | null;
  paid_at?: string | null;
  notes?: string | null;
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
  const [accruals, setAccruals] = useState<AccrualItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);

  const fetchAccruals = async () => {
    setIsLoading(true);
    try {
      const res = await api.connections.getAccruals(connectionId);
      setAccruals(res.accruals || []);
    } catch (err: any) {
      console.error('Error fetching connection accruals:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (connectionId) {
      fetchAccruals();
    }
  }, [connectionId]);

  const handleTogglePaid = async (accrual: AccrualItem) => {
    if (!isAdmin) return;
    setIsActionLoading(accrual.id);
    try {
      const nextPaid = !accrual.is_paid;
      await api.connections.updateAccrual(connectionId, accrual.id, {
        is_paid: nextPaid,
      });
      showToast(
        nextPaid ? 'Начисление отмечено как выплаченное' : 'Отметка об оплате снята',
        'success'
      );
      await fetchAccruals();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      showToast(err.message || 'Ошибка обновления статуса оплаты', 'error');
    } finally {
      setIsActionLoading(null);
    }
  };

  const handleSaveEdit = async (accrualId: string) => {
    const num = parseFloat(editAmount);
    if (isNaN(num) || num < 0) {
      showToast('Укажите корректную сумму', 'error');
      return;
    }
    setIsActionLoading(accrualId);
    try {
      await api.connections.updateAccrual(connectionId, accrualId, {
        amount: num,
      });
      showToast('Сумма начисления обновлена', 'success');
      setEditingId(null);
      await fetchAccruals();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      showToast(err.message || 'Ошибка сохранения суммы', 'error');
    } finally {
      setIsActionLoading(null);
    }
  };

  const handleDelete = async (accrualId: string) => {
    if (!confirm('Вы уверены, что хотите удалить это начисление?')) return;
    setIsActionLoading(accrualId);
    try {
      await api.connections.deleteAccrual(connectionId, accrualId);
      showToast('Начисление удалено', 'success');
      await fetchAccruals();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      showToast(err.message || 'Не удалось удалить начисление', 'error');
    } finally {
      setIsActionLoading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 flex items-center justify-center gap-2 text-zinc-400 text-xs">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Загрузка начислений...</span>
      </div>
    );
  }

  const totalAccrued = accruals.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const totalPaid = accruals.filter((a) => a.is_paid).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Banknote className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
            График начислений куратору
          </h4>
        </div>
        <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
          Выплачено: <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{totalPaid.toLocaleString('ru-RU')}</span> / {totalAccrued.toLocaleString('ru-RU')} сом
        </div>
      </div>

      {accruals.length === 0 ? (
        <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 text-center text-xs text-zinc-400">
          Начисления пока не сформированы
        </div>
      ) : (
        <div className="space-y-2">
          {accruals.map((acc) => {
            const isEditing = editingId === acc.id;
            const isActionBusy = isActionLoading === acc.id;

            return (
              <div
                key={acc.id}
                className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/80 flex flex-col gap-2 transition-all"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                        acc.accrual_type === 'connection'
                          ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20'
                          : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                      }`}
                    >
                      {acc.accrual_type === 'connection' ? 'Подключение' : 'Сопровождение'}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-300 font-semibold">
                      {acc.settlement_month}
                    </span>
                  </div>

                  {/* Статус оплаты */}
                  <div className="flex items-center gap-1.5">
                    {acc.is_paid ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        Выплачено
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        <Clock className="w-3 h-3" />
                        К выплате
                      </span>
                    )}
                  </div>
                </div>

                {/* Строка суммы и действий */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-zinc-200/40 dark:border-zinc-700/40">
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="w-24 h-7 px-2 text-xs font-mono rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(acc.id)}
                          disabled={isActionBusy}
                          className="p-1 rounded-md bg-emerald-500 text-white hover:bg-emerald-600"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded-md bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100 text-sm">
                        {Number(acc.amount).toLocaleString('ru-RU')} сом
                      </span>
                    )}

                    {acc.notes && (
                      <span className="text-[11px] text-zinc-400 italic">
                        ({acc.notes})
                      </span>
                    )}
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      {/* Кнопка переключения статуса оплаты */}
                      <button
                        type="button"
                        onClick={() => handleTogglePaid(acc)}
                        disabled={isActionBusy}
                        title={acc.is_paid ? 'Снять отметку об оплате' : 'Отметить как выплаченное'}
                        className={`h-6 px-2 rounded-lg text-[10px] font-medium transition-colors cursor-pointer ${
                          acc.is_paid
                            ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs'
                        }`}
                      >
                        {isActionBusy ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : acc.is_paid ? (
                          'Снять отметку'
                        ) : (
                          'Выплатить'
                        )}
                      </button>

                      {/* Кнопка редактирования суммы */}
                      {!isEditing && !acc.is_paid && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(acc.id);
                            setEditAmount(String(acc.amount));
                          }}
                          title="Изменить сумму"
                          className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Кнопка удаления (только для неоплаченных) */}
                      {!acc.is_paid && (
                        <button
                          type="button"
                          onClick={() => handleDelete(acc.id)}
                          disabled={isActionBusy}
                          title="Удалить начисление"
                          className="p-1 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
