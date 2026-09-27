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
  Calendar,
  FileText,
  DollarSign,
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
    if (!confirm('Вы уверены, что хотите удалить эту проводку начисления?')) return;
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
        <div className="overflow-x-auto rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200/60 dark:border-zinc-800 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-800/30">
                <th className="py-2.5 px-3">Дата</th>
                <th className="py-2.5 px-3">Месяц</th>
                <th className="py-2.5 px-3">Вид операции</th>
                <th className="py-2.5 px-3">Куратор</th>
                <th className="py-2.5 px-3 text-right">Сумма</th>
                <th className="py-2.5 px-3">Примечание</th>
                {isAdmin && <th className="py-2.5 px-3 text-center w-16">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/40 dark:divide-zinc-800/40 font-mono">
              {postings.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                >
                  <td className="py-2.5 px-3 text-zinc-700 dark:text-zinc-300 font-medium">
                    {item.actual_date ? (
                      <FormattedDate date={item.actual_date} type="date" />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400">
                    {item.settlement_month || '—'}
                  </td>
                  <td className="py-2.5 px-3 font-sans">
                    {getOperationBadge(item.operation_type)}
                  </td>
                  <td className="py-2.5 px-3 font-sans text-zinc-600 dark:text-zinc-300 truncate max-w-[130px]" title={item.users?.full_name}>
                    {item.users?.full_name || '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                    +{Number(item.amount).toLocaleString('ru-RU')} сом
                  </td>
                  <td className="py-2.5 px-3 font-sans text-zinc-400 dark:text-zinc-500 text-[11px] truncate max-w-[160px]" title={item.note}>
                    {item.note || '—'}
                  </td>
                  {isAdmin && (
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          title="Редактировать параметры проводки"
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
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Модальное окно редактирования проводки (для admin) */}
      {editingPosting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Редактирование проводки начисления
                </h3>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePosting} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  Дата проводки (actual_date)
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
                  <input
                    type="date"
                    value={editActualDate}
                    onChange={(e) => setEditActualDate(e.target.value)}
                    required
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  Расчетный месяц (settlement_month)
                </label>
                <input
                  type="month"
                  value={editSettlementMonth}
                  onChange={(e) => setEditSettlementMonth(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  Сумма начисления (сом)
                </label>
                <div className="relative">
                  <DollarSign className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    required
                    className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                  Примечание / Комментарий
                </label>
                <div className="relative">
                  <FileText className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
                  <input
                    type="text"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    placeholder="Например: Бонус за подключение ТТ"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={isSaving}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Сохранение...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Сохранить изменения</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

