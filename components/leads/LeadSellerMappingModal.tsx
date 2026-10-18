'use client';

import * as React from 'react';
import { useUser } from '@/components/auth/AuthProvider';
import { Search, Store, Check, AlertCircle, Loader2, ArrowRight, UserCheck, Link2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { Modal, ModalCallout } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatPhoneDisplay } from '@/lib/utils/phone';
import { api } from '@/lib/api/client';
import { getAvailableSellersForMapping, type AvailableSellerItem } from '@/app/leads/mapping-actions';
import { ConnectionStaffModal, type StaffSelection } from '@/components/connections/ConnectionStaffModal';
import type { ConnectionEmployeeOption } from '@/app/connections/actions';
import type { LeadItem } from '@/app/leads/actions';

interface LeadSellerMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: LeadItem | null;
  onSuccess: () => void;
  currentUserId?: string;
  /** Сотрудники для выбора участников и сопровождающих нового подключения */
  employees?: ConnectionEmployeeOption[];
}

/**
 * Привязка лида к продавцу (046). Свободный продавец: после выбора открывается окно сотрудников
 * подключения (как «Подключить…» в продавцах) — основной участник: ответственный за лид (администратор
 * может выбрать другого). Подключенный продавец: лид привязывается к существующему подключению,
 * ответственным становится консультант подключения.
 */
export function LeadSellerMappingModal({
  isOpen,
  onClose,
  lead,
  onSuccess,
  currentUserId,
  employees = [],
}: LeadSellerMappingModalProps) {
  const { showToast } = useToast();
  const user = useUser();
  const canChooseManager = user.can('sellers.assign');
  const canConfirm = user.can('connections.confirm');

  const [searchQuery, setSearchQuery] = React.useState('');
  const [sellers, setSellers] = React.useState<AvailableSellerItem[]>([]);
  const [selectedSeller, setSelectedSeller] = React.useState<AvailableSellerItem | null>(null);
  const [selectedManagerId, setSelectedManagerId] = React.useState<string>('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [staffOpen, setStaffOpen] = React.useState(false);

  const loadAvailableSellers = React.useCallback(
    async (query = '') => {
      setIsLoading(true);
      try {
        const res = await getAvailableSellersForMapping(query);
        if (res.error) showToast(res.error, 'error');
        else setSellers(res.sellers);
      } catch {
        showToast('Не удалось загрузить доступных продавцов', 'error');
      } finally {
        setIsLoading(false);
      }
    },
    [showToast]
  );

  React.useEffect(() => {
    if (isOpen && lead) {
      setSelectedManagerId(lead.assigned_to || currentUserId || '');
      loadAvailableSellers('');
      setSelectedSeller(null);
      setSearchQuery('');
      setStaffOpen(false);
    }
  }, [isOpen, lead, currentUserId, loadAvailableSellers]);

  React.useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => loadAvailableSellers(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, loadAvailableSellers]);

  // Основной участник нового подключения: ответственный за лид (администратор может выбрать другого)
  const primaryUserId = (canChooseManager ? selectedManagerId : '') || lead?.assigned_to || currentUserId || '';
  const primaryName = employees.find((e) => e.user_id === primaryUserId)?.full_name || lead?.assigned_user?.full_name || '';

  const finish = (res: any, sellerPhone: string) => {
    if ('vibrate' in navigator) navigator.vibrate([40, 60, 40]);
    const phoneLabel = formatPhoneDisplay(sellerPhone);
    const fee = Number(res?.connection_fee_amount) || 0;
    if (res?.mode === 'attached') {
      showToast(`Лид привязан к подключению продавца ${phoneLabel}: ответственным стал консультант подключения`, 'success');
    } else if (res?.confirmation_status === 'pending') {
      showToast(`Лид привязан к продавцу ${phoneLabel}. Подключение ожидает подтверждения администратора.`, 'info');
    } else {
      showToast(`Сделка закрыта! Лид привязан к продавцу ${phoneLabel}.${fee > 0 ? ` Начислено ${fee.toLocaleString('ru-RU')} сом.` : ''}`, 'success');
    }
    onSuccess();
    onClose();
  };

  // Подключенный продавец: привязка сразу; свободный — окно сотрудников подключения
  const handleContinue = async () => {
    if (!lead || !selectedSeller) {
      showToast('Выберите продавца для связывания', 'error');
      return;
    }
    if (!selectedSeller.connection) {
      setStaffOpen(true);
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await api.leads.linkSeller(lead.lead_id, selectedSeller.seller_phone);
      finish(res, selectedSeller.seller_phone);
    } catch (err: any) {
      showToast(err.message || 'Ошибка при связывании лида', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStaffSubmit = async (selection: StaffSelection) => {
    if (!lead || !selectedSeller) return;
    const chosen = selection.participants && selection.participants.length > 0 ? selection.participants : [primaryUserId];
    const participants = [primaryUserId, ...chosen.filter((id) => id !== primaryUserId)];
    setIsSubmitting(true);
    try {
      const res = await api.leads.linkSeller(lead.lead_id, selectedSeller.seller_phone, {
        participants,
        maintenance: selection.maintenance,
      });
      setStaffOpen(false);
      finish(res, selectedSeller.seller_phone);
    } catch (err: any) {
      showToast(err.message || 'Ошибка при связывании лида', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!lead) return null;

  const sellerLabel = selectedSeller
    ? `${selectedSeller.store || selectedSeller.seller_name} · ${formatPhoneDisplay(selectedSeller.seller_phone)}`
    : undefined;

  return (
    <>
      <Modal
        open={isOpen && !staffOpen}
        onClose={onClose}
        title="Связать лид с продавцом платформы"
        subtitle={`Лид: ${lead.client_name} (${formatPhoneDisplay(lead.phone, lead.country_code)})`}
        icon={Store}
        tone="info"
        size="xl"
        level={2}
        busy={isSubmitting}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
              Отмена
            </Button>
            <Button
              onClick={handleContinue}
              disabled={!selectedSeller}
              loading={isSubmitting}
              rightIcon={<ArrowRight className="w-4 h-4" strokeWidth={1.75} />}
            >
              {selectedSeller?.connection ? 'Привязать к подключению' : 'Далее: сотрудники подключения'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {/* Основной участник нового подключения (администратор может выбрать другого) */}
          {canChooseManager && employees.length > 0 && (
            <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 space-y-1.5">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-blue-500" strokeWidth={2} />
                  <span>Консультант подключения (основной участник):</span>
                </span>
                {!lead.assigned_to && (
                  <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                    Ответственный не назначен
                  </span>
                )}
              </label>
              <select
                value={selectedManagerId}
                onChange={(e) => setSelectedManagerId(e.target.value)}
                disabled={Boolean(selectedSeller?.connection)}
                className="w-full h-9 px-3 text-xs font-medium rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
              >
                {employees.map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" strokeWidth={1.75} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по магазину, имени продавца или телефону..."
              className="w-full h-10 pl-10 pr-4 text-xs bg-zinc-100/70 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700/60 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-all"
            />
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-zinc-400 space-y-2">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-zinc-400" strokeWidth={1.75} />
                <span>Поиск продавцов...</span>
              </div>
            ) : sellers.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200/50 dark:border-zinc-800/50 text-xs text-zinc-400 space-y-1">
                <AlertCircle className="w-5 h-5 mx-auto text-zinc-400 mb-2" strokeWidth={1.75} />
                <p className="font-medium text-zinc-600 dark:text-zinc-300">Доступные продавцы не найдены</p>
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
                          isSelected ? 'bg-blue-600 text-white' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        <Store className="w-4 h-4" strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {seller.store || 'Магазин без названия'}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate">
                          {seller.seller_name} • <span className="font-mono">{formatPhoneDisplay(seller.seller_phone)}</span>
                        </div>
                        {seller.connection && (
                          <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                            <Link2 className="w-3 h-3" strokeWidth={2} />
                            Подключен{seller.connection.manager_name ? `: ${seller.connection.manager_name}` : ''}
                            {seller.connection.confirmation_status === 'pending' ? ' (ожидает подтверждения)' : ''}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0 text-right">
                      <div>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-zinc-200/60 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300/40 dark:border-zinc-700/40">
                          {seller.plan_name || 'Базовый'}
                        </span>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">{seller.plan_price.toLocaleString('ru-RU')} сом</div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-zinc-300 dark:border-zinc-700'
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

          {selectedSeller?.connection ? (
            <ModalCallout tone="warning">
              Продавец уже подключен{selectedSeller.connection.manager_name ? ` (консультант: ${selectedSeller.connection.manager_name})` : ''}.
              Лид привяжется к этому подключению, ответственным за лид станет консультант подключения; состав участников и
              начисления не меняются.
            </ModalCallout>
          ) : selectedSeller ? (
            <ModalCallout tone="info">
              Далее — участники и сопровождающие нового подключения. Основной участник: {primaryName || 'ответственный за лид'}.
              {canConfirm ? ' Подключение будет подтверждено сразу.' : ' Подключение попадет на подтверждение администратору.'}
            </ModalCallout>
          ) : null}
        </div>
      </Modal>

      {/* Сотрудники нового подключения: основной — ответственный за лид, можно добавить до двух коллег */}
      <ConnectionStaffModal
        open={isOpen && staffOpen}
        onClose={() => !isSubmitting && setStaffOpen(false)}
        mode="create"
        connections={[]}
        employees={employees}
        canEdit
        canConfirm={canConfirm}
        currentUserId={currentUserId || ''}
        lockedUserIds={primaryUserId ? [primaryUserId] : []}
        title="Подключение продавца по лиду"
        subtitle={sellerLabel}
        submitLabel="Привязать лид и подключить"
        busy={isSubmitting}
        onSubmit={handleStaffSubmit}
      />
    </>
  );
}
