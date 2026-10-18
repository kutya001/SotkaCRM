'use client';

import * as React from 'react';
import { Link2, Search, Store, Phone, Loader2, Check, UserCheck, ArrowRight } from 'lucide-react';
import { Modal, ModalCallout } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api/client';
import { formatPhoneDisplay } from '@/lib/utils/phone';
import { getAvailableLeadsForSellerLinking, type SellerItem } from '@/app/sellers/actions';
import { ConnectionStaffModal, type StaffSelection } from '@/components/connections/ConnectionStaffModal';
import type { ConnectionEmployeeOption } from '@/app/connections/actions';

interface LeadOption {
  lead_id: string;
  client_name: string;
  phone: string;
  country_code?: string | null;
  status: string;
  assigned_to: string | null;
  assigned_user?: { user_id: string; full_name: string; color?: string } | null;
  created_at: string;
}

interface LinkSellerLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  seller: SellerItem | null;
  onSuccess: () => void;
  /** Сотрудники для выбора участников и сопровождающих нового подключения */
  employees?: ConnectionEmployeeOption[];
  currentUserId?: string;
  canConfirm?: boolean;
}

/**
 * Привязка лида со стороны продавца (046). Свободный продавец: после выбора лида открывается окно
 * сотрудников подключения (основной — ответственный за лид, иначе текущий сотрудник). Подключенный
 * продавец: лид привязывается к существующему подключению, ответственным становится его консультант.
 */
export function LinkSellerLeadModal({
  isOpen,
  onClose,
  seller,
  onSuccess,
  employees = [],
  currentUserId = '',
  canConfirm = false,
}: LinkSellerLeadModalProps) {
  const { showToast } = useToast();
  const [leads, setLeads] = React.useState<LeadOption[]>([]);
  const [search, setSearch] = React.useState('');
  const [isLoadingLeads, setIsLoadingLeads] = React.useState(true);
  const [selectedLeadId, setSelectedLeadId] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [staffOpen, setStaffOpen] = React.useState(false);

  const hasConnection = Boolean(seller?.connection?.connection_id) && seller?.connection?.confirmation_status !== 'rejected';

  const fetchLeads = React.useCallback(async () => {
    setIsLoadingLeads(true);
    setSelectedLeadId(null);
    try {
      const res = await getAvailableLeadsForSellerLinking(false);
      if (res.error) showToast(res.error, 'error');
      else setLeads(res.leads);
    } catch {
      showToast('Ошибка при загрузке лидов', 'error');
    } finally {
      setIsLoadingLeads(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    if (isOpen && seller) {
      setSearch('');
      setStaffOpen(false);
      fetchLeads();
    }
  }, [isOpen, seller, fetchLeads]);

  const filteredLeads = leads.filter(
    (l) => l.client_name.toLowerCase().includes(search.toLowerCase()) || l.phone.includes(search.trim())
  );
  const selectedLead = leads.find((l) => l.lead_id === selectedLeadId);
  // Основной участник нового подключения: ответственный за лид, иначе текущий сотрудник
  const primaryUserId = selectedLead?.assigned_to || currentUserId;
  const primaryName =
    selectedLead?.assigned_user?.full_name || employees.find((e) => e.user_id === primaryUserId)?.full_name || '';

  const finish = (res: any) => {
    const fee = Number(res?.connection_fee_amount) || 0;
    if (res?.mode === 'attached') {
      showToast('Лид привязан к подключению продавца: ответственным стал консультант подключения', 'success');
    } else if (res?.confirmation_status === 'pending') {
      showToast(`Продавец связан с лидом. Подключение ожидает подтверждения администратора${fee > 0 ? `, бонус ${fee.toLocaleString('ru-RU')} сом` : ''}`, 'info');
    } else {
      showToast(`Продавец успешно связан с лидом!${fee > 0 ? ` Начислено ${fee.toLocaleString('ru-RU')} сом` : ''}`, 'success');
    }
    onSuccess();
    onClose();
  };

  const handleContinue = async () => {
    if (!seller || !selectedLeadId) {
      showToast('Выберите лид из списка', 'error');
      return;
    }
    if (!hasConnection) {
      setStaffOpen(true);
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await api.sellers.linkLead(seller.seller_phone, selectedLeadId);
      finish(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка при связывании', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStaffSubmit = async (selection: StaffSelection) => {
    if (!seller || !selectedLeadId) return;
    const chosen = selection.participants && selection.participants.length > 0 ? selection.participants : [primaryUserId];
    const participants = [primaryUserId, ...chosen.filter((id) => id !== primaryUserId)];
    setIsSubmitting(true);
    try {
      const res = await api.sellers.linkLead(seller.seller_phone, selectedLeadId, { participants, maintenance: selection.maintenance });
      setStaffOpen(false);
      finish(res);
    } catch (err: any) {
      showToast(err.message || 'Ошибка при связывании', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!seller) return null;

  return (
    <>
      <Modal
        open={isOpen && !staffOpen}
        onClose={onClose}
        title="Связать продавца с лидом"
        subtitle={hasConnection ? 'Лид привяжется к существующему подключению продавца' : 'Подключение продавца: участники и сопровождение'}
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
              onClick={handleContinue}
              leftIcon={<UserCheck className="w-3.5 h-3.5" />}
              rightIcon={hasConnection ? undefined : <ArrowRight className="w-3.5 h-3.5" />}
            >
              {hasConnection ? 'Привязать к подключению' : 'Далее: сотрудники подключения'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
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

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {isLoadingLeads ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                <span>Загрузка доступных лидов...</span>
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400">
                {search.trim() ? 'Лиды по вашему запросу не найдены' : 'Нет свободных лидов для привязки'}
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
                        <span className="font-bold text-zinc-900 dark:text-zinc-100 truncate">{lead.client_name}</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-zinc-200/60 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                          {lead.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                        <span>{formatPhoneDisplay(lead.phone, lead.country_code)}</span>
                        <span>•</span>
                        {lead.assigned_user ? (
                          <EmployeeBadge name={lead.assigned_user.full_name} color={lead.assigned_user.color} size="sm" />
                        ) : (
                          <span className="text-[10px] text-zinc-400 italic">Не назначен</span>
                        )}
                      </div>
                    </div>
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                        isSelected ? 'bg-blue-600 text-white' : 'border border-zinc-300 dark:border-zinc-600'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {selectedLead && hasConnection && (
            <ModalCallout tone="warning">
              Продавец уже подключен{seller.manager_user?.full_name ? ` (консультант: ${seller.manager_user.full_name})` : ''}.
              Лид привяжется к этому подключению, ответственным за лид станет консультант подключения; состав участников
              и начисления не меняются.
            </ModalCallout>
          )}
          {selectedLead && !hasConnection && (
            <ModalCallout tone="info">
              Далее — участники и сопровождающие нового подключения. Основной участник: {primaryName || 'вы'}.
              {canConfirm ? ' Подключение будет подтверждено сразу.' : ' Подключение попадет на подтверждение администратору.'}
            </ModalCallout>
          )}
        </div>
      </Modal>

      <ConnectionStaffModal
        open={isOpen && staffOpen}
        onClose={() => !isSubmitting && setStaffOpen(false)}
        mode="create"
        connections={[]}
        employees={employees}
        canEdit
        canConfirm={canConfirm}
        currentUserId={currentUserId}
        lockedUserIds={primaryUserId ? [primaryUserId] : []}
        title="Подключение продавца по лиду"
        subtitle={`${seller.seller_name || seller.store} · ${formatPhoneDisplay(seller.seller_phone)}`}
        submitLabel="Привязать лид и подключить"
        busy={isSubmitting}
        onSubmit={handleStaffSubmit}
      />
    </>
  );
}
