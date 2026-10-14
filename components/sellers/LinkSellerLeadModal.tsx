'use client';

import * as React from 'react';
import { Link2, Search, UserCheck, Loader2, Store, Phone, Check } from 'lucide-react';
import { getAvailableLeadsForSellerLinking, type SellerItem } from '@/app/sellers/actions';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api/client';
import { formatPhoneDisplay } from '@/lib/utils/phone';

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
  country_code?: string | null;
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

  const filteredLeads = leads.filter(
    (l) =>
      l.client_name.toLowerCase().includes(search.toLowerCase()) ||
      l.phone.includes(search.trim())
  );

  const selectedLead = leads.find((l) => l.lead_id === selectedLeadId);

  const handleLink = async () => {
    if (!seller) return;
    if (!selectedLeadId) {
      showToast('Выберите лид из списка', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.sellers.linkLead(seller.seller_phone, selectedLeadId);
      if (res.confirmation_status === 'pending') {
        showToast(
          `Продавец связан с лидом. Бонус +${res.connection_fee_amount || 0} сом будет начислен после подтверждения администратором`,
          'info'
        );
      } else {
        showToast(
          `Продавец успешно связан с лидом! Начислено вознаграждение: +${res.connection_fee_amount || 0} сом`,
          'success'
        );
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Ошибка при связывании', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!seller) return null;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Связать продавца с лидом"
      subtitle="Назначение консультанта и расчет выплаты (подтверждает администратор)"
      icon={Link2}
      tone="info"
      size="lg"
      busy={isSubmitting}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Отмена
          </Button>
          <Button
            variant="info"
            disabled={!selectedLeadId}
            loading={isSubmitting}
            onClick={handleLink}
            leftIcon={<UserCheck className="w-3.5 h-3.5" />}
          >
            Связать с продавцом
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Карточка продавца */}
        <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center justify-between text-xs">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              <Store className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
              <span className="truncate">{seller.store || seller.seller_name}</span>
            </div>
            <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 font-mono">
              <Phone className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
              <span>{formatPhoneDisplay(seller.seller_phone)}</span>
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
                      <span>{formatPhoneDisplay(lead.phone, lead.country_code)}</span>
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
              Консультант продавца станет: <strong>{selectedLead.assigned_user?.full_name || 'Текущий администратор'}</strong>.
              Лид перейдет в статус «Подписан». В модуле подключений рассчитается выплата.
            </p>
          </div>
        )}

      </div>
    </Modal>
  );
}
