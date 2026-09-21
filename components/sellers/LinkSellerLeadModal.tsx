'use client';

import * as React from 'react';
import { X, Link2, Search, UserCheck, Clock, Loader2, Store, Phone, Check } from 'lucide-react';
import { getAvailableLeadsForSellerLinking, linkSellerToLeadAction, type SellerItem } from '@/app/sellers/actions';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { useToast } from '@/components/ui/Toast';

interface LinkSellerLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  seller: SellerItem | null;
  onSuccess: () => void;
}

interface LeadOption {
  lead_id: string;
  client_name: string;
  phone: string;
  status: string;
  assigned_to: string | null;
  assigned_user?: {
    user_id: string;
    full_name: string;
    color?: string;
  } | null;
  created_at: string;
}

export function LinkSellerLeadModal({
  isOpen,
  onClose,
  seller,
  onSuccess,
}: LinkSellerLeadModalProps) {
  const { showToast } = useToast();
  const [leads, setLeads] = React.useState<LeadOption[]>([]);
  const [search, setSearch] = React.useState('');
  const [filterOnlySigned, setFilterOnlySigned] = React.useState(true);
  const [isLoadingLeads, setIsLoadingLeads] = React.useState(true);
  const [selectedLeadId, setSelectedLeadId] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const fetchLeads = React.useCallback(async (onlySigned: boolean) => {
    setIsLoadingLeads(true);
    setSelectedLeadId(null);
    try {
      const res = await getAvailableLeadsForSellerLinking(onlySigned);
      if (res.error) {
        showToast(res.error, 'error');
      } else {
        setLeads(res.leads);
      }
    } catch {
      showToast('Ошибка при загрузке лидов', 'error');
    } finally {
      setIsLoadingLeads(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    if (isOpen && seller) {
      setSearch('');
      fetchLeads(filterOnlySigned);
    }
  }, [isOpen, seller, filterOnlySigned, fetchLeads]);

  if (!isOpen || !seller) return null;

  const filteredLeads = leads.filter(
    (l) =>
      l.client_name.toLowerCase().includes(search.toLowerCase()) ||
      l.phone.includes(search.trim())
  );

  const selectedLead = leads.find((l) => l.lead_id === selectedLeadId);

  const handleLink = async () => {
    if (!selectedLeadId) {
      showToast('Выберите лид из списка', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await linkSellerToLeadAction(seller.seller_phone, selectedLeadId);
      if (res.success) {
        showToast(
          `Продавец успешно связан с лидом! Начислено вознаграждение: +${res.connectionFeeAmount || 0} сом`,
          'success'
        );
        onSuccess();
        onClose();
      } else {
        showToast(res.error || 'Ошибка при связывании', 'error');
      }
    } catch {
      showToast('Сбой сервера при выполнении связывания', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка модального окна */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Link2 className="w-5 h-5" strokeWidth={2} />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Связать продавца с лидом
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Автоматическое назначение куратора и расчет выплаты
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500 transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        {/* Карточка продавца */}
        <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center justify-between text-xs">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              <Store className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
              <span className="truncate">{seller.store || seller.seller_name}</span>
            </div>
            <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 font-mono">
              <Phone className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
              <span>+{seller.seller_phone}</span>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 whitespace-nowrap">
            {seller.plan_name || 'Базовый тариф'}
          </span>
        </div>

        {/* Фильтр: Только Подписан vs Все свободные */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/60 dark:border-zinc-700/60 text-xs">
          <button
            type="button"
            onClick={() => setFilterOnlySigned(true)}
            className={`flex-1 py-1.5 px-3 rounded-xl font-semibold transition-all ${
              filterOnlySigned
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            Только «Подписан»
          </button>
          <button
            type="button"
            onClick={() => setFilterOnlySigned(false)}
            className={`flex-1 py-1.5 px-3 rounded-xl font-semibold transition-all ${
              !filterOnlySigned
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            Все свободные лиды
          </button>
        </div>

        {/* Поиск лида */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск лида по имени или телефону..."
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/60 dark:border-zinc-700/60 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Список свободных лидов */}
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {isLoadingLeads ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              <span>Загрузка доступных лидов...</span>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-400">
              {search.trim()
                ? 'Лиды по вашему запросу не найдены'
                : filterOnlySigned
                ? 'Нет свободных лидов со статусом «Подписан»'
                : 'Нет доступных свободных лидов в воронке'}
            </div>
          ) : (
            filteredLeads.map((lead) => {
              const isSelected = selectedLeadId === lead.lead_id;
              return (
                <div
                  key={lead.lead_id}
                  onClick={() => setSelectedLeadId(lead.lead_id)}
                  className={`p-3 rounded-2xl border text-xs cursor-pointer transition-all flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-blue-500/10 border-blue-500/50 shadow-sm ring-1 ring-blue-500/30'
                      : 'bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200/60 dark:border-zinc-700/60 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-zinc-900 dark:text-zinc-100 truncate">
                        {lead.client_name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                          lead.status === 'Подписан'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            : 'bg-zinc-200/60 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                        }`}
                      >
                        {lead.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                      <span>+{lead.phone}</span>
                      <span>•</span>
                      {lead.assigned_user ? (
                        <EmployeeBadge
                          name={lead.assigned_user.full_name}
                          color={lead.assigned_user.color}
                          size="sm"
                        />
                      ) : (
                        <span className="text-[10px] text-zinc-400 italic">Не назначен</span>
                      )}
                    </div>
                  </div>

                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white'
                        : 'border border-zinc-300 dark:border-zinc-600'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Подсказка при выборе */}
        {selectedLead && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
            <p className="font-semibold">Что произойдет при привязке:</p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              Куратор продавца станет: <strong>{selectedLead.assigned_user?.full_name || 'Текущий администратор'}</strong>.
              Лид перейдет в статус «Подписан». В модуле подключений рассчитается выплата.
            </p>
          </div>
        )}

        {/* Кнопки действий */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!selectedLeadId || isSubmitting}
            onClick={handleLink}
            className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Привязка...</span>
              </>
            ) : (
              <>
                <UserCheck className="w-3.5 h-3.5" />
                <span>Связать с продавцом</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
