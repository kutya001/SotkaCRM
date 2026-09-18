'use client';

import * as React from 'react';
import {
  X,
  Search,
  Store,
  Phone,
  Wallet,
  Coins,
  Percent,
  Check,
  AlertCircle,
  Loader2,
  Building2,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import {
  getAvailableSellersForMapping,
  getConsultantRate,
  linkLeadToSeller,
  type AvailableSellerItem,
} from '@/app/leads/mapping-actions';
import type { LeadItem } from '@/app/leads/actions';
import type { UserRole } from '@/types/database.types';

interface LeadSellerMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: LeadItem | null;
  onSuccess: () => void;
  currentUserId?: string;
  currentUserRole?: UserRole;
}

export function LeadSellerMappingModal({
  isOpen,
  onClose,
  lead,
  onSuccess,
  currentUserId,
  currentUserRole = 'consultant',
}: LeadSellerMappingModalProps) {
  const { showToast } = useToast();

  const [searchQuery, setSearchQuery] = React.useState('');
  const [sellers, setSellers] = React.useState<AvailableSellerItem[]>([]);
  const [selectedSeller, setSelectedSeller] = React.useState<AvailableSellerItem | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [consultantRate, setConsultantRate] = React.useState<number>(30);

  // Загрузка свободных продавцов
  const loadAvailableSellers = React.useCallback(async (query = '') => {
    setIsLoading(true);
    try {
      const res = await getAvailableSellersForMapping(query);
      if (res.error) {
        showToast(res.error, 'error');
      } else {
        setSellers(res.sellers);
      }
    } catch {
      showToast('Не удалось загрузить доступных продавцов', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  // Загрузка ставки консультанта
  React.useEffect(() => {
    if (isOpen && lead) {
      const targetUserId = lead.assigned_to || currentUserId;
      if (targetUserId) {
        getConsultantRate(targetUserId).then((rate) => setConsultantRate(rate));
      }
      loadAvailableSellers('');
      setSelectedSeller(null);
      setSearchQuery('');
    }
  }, [isOpen, lead, currentUserId, loadAvailableSellers]);

  // Debounced поиск при вводе
  React.useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      loadAvailableSellers(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, loadAvailableSellers]);

  if (!isOpen || !lead) return null;

  // Расчет комиссии
  const planPrice = selectedSeller?.plan_price || 2500;
  const commissionAmount = Math.round(((planPrice * consultantRate) / 100) * 100) / 100;

  const handleConfirmLink = async () => {
    if (!selectedSeller) {
      showToast('Выберите продавца для связывания', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await linkLeadToSeller({
        leadId: lead.lead_id,
        sellerPhone: selectedSeller.seller_phone,
        managerId: lead.assigned_to || currentUserId,
      });

      if (!res.success) {
        showToast(res.error || 'Ошибка при связывании лида', 'error');
        return;
      }

      if ('vibrate' in navigator) navigator.vibrate([40, 60, 40]);
      showToast(
        `Сделка закрыта! Лид привязан к продавцу +${selectedSeller.seller_phone}. Начислено ${commissionAmount.toLocaleString('ru-RU')} KGS.`,
        'success'
      );
      onSuccess();
      onClose();
    } catch {
      showToast('Произошел непредвиденный сбой при связывании', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка модального окна */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Store className="w-5 h-5 text-blue-600 dark:text-blue-400" strokeWidth={1.75} />
              <span>Связать лид с продавцом платформы</span>
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Лид: <span className="font-semibold text-zinc-800 dark:text-zinc-200">{lead.client_name}</span> (+{lead.phone})
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Строка поиска свободных продавцов */}
        <div className="relative">
          <Search
            className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по магазину, имени продавца или телефону..."
            className="w-full h-10 pl-10 pr-4 text-xs bg-zinc-100/70 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700/60 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all"
          />
        </div>

        {/* Список доступных продавцов */}
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="p-8 text-center text-xs text-zinc-400 space-y-2">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-zinc-400" strokeWidth={1.75} />
              <span>Поиск свободных продавцов...</span>
            </div>
          ) : sellers.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200/50 dark:border-zinc-800/50 text-xs text-zinc-400 space-y-1">
              <AlertCircle className="w-5 h-5 mx-auto text-zinc-400 mb-2" strokeWidth={1.75} />
              <p className="font-medium text-zinc-600 dark:text-zinc-300">Свободные продавцы не найдены</p>
              <p className="text-[11px] text-zinc-400">
                Все продавцы уже привязаны к лидам, либо база еще не синхронизирована с Sotka API.
              </p>
            </div>
          ) : (
            sellers.map((seller) => {
              const isSelected = selectedSeller?.seller_phone === seller.seller_phone;
              return (
                <div
                  key={seller.seller_phone}
                  onClick={() => setSelectedSeller(seller)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-blue-500/10 dark:bg-blue-500/15 border-blue-500/50 shadow-sm'
                      : 'bg-zinc-50/50 dark:bg-zinc-800/40 border-zinc-200/60 dark:border-zinc-800/60 hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-semibold ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      <Store className="w-4 h-4" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {seller.store || 'Магазин без названия'}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {seller.seller_name} • <span className="font-mono">+{seller.seller_phone}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 text-right">
                    <div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-zinc-200/60 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300/40 dark:border-zinc-700/40">
                        {seller.plan_name || 'Базовый'}
                      </span>
                      <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                        {seller.plan_price.toLocaleString('ru-RU')} KGS
                      </div>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-zinc-300 dark:border-zinc-700'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3" strokeWidth={2.5} />}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Блок предварительного расчета бонуса при выборе */}
        {selectedSeller && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-emerald-500/10 border border-zinc-200/80 dark:border-zinc-800/80 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">Стоимость тарифа продавца:</span>
              <span className="font-semibold font-mono text-zinc-900 dark:text-zinc-100">
                {planPrice.toLocaleString('ru-RU')} KGS
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">Ставка комиссии за подключение:</span>
              <span className="font-semibold font-mono text-zinc-900 dark:text-zinc-100">
                {consultantRate}%
              </span>
            </div>

            <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-700/60 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <Coins className="w-4 h-4" strokeWidth={1.75} />
                <span>Бонус консультанта:</span>
              </div>
              <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                +{commissionAmount.toLocaleString('ru-RU')} KGS
              </span>
            </div>
          </div>
        )}

        {/* Кнопки действий */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-200/50 dark:border-zinc-800/50">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-10 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleConfirmLink}
            disabled={!selectedSeller || isSubmitting}
            className="h-10 px-5 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold flex items-center gap-2 shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed island-interactive"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                <span>Фиксация сделки...</span>
              </>
            ) : (
              <>
                <span>Подтвердить связывание</span>
                <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
