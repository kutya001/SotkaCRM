'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef, type DataJournalTab, PIPELINE_STATUS_OPTIONS } from '@/components/ui/DataJournal';
import dynamic from 'next/dynamic';
import { EntityModal, type EntityFieldConfig } from '@/components/ui/EntityModal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { ConfirmDialog, useConfirm } from '@/components/ui/ConfirmDialog';
import { FormField, Textarea } from '@/components/ui/Field';
import { formatDateTime } from '@/lib/utils/format';
import { formatPhoneDisplay } from '@/lib/utils/phone';
import {
  allowedLeadTransitions,
  canChangeLeadStatus,
  canEditLeadFields,
  canEditLeadComment,
  isCancelStatus,
} from '@/lib/leads/status-rules';

const SalesScriptsSheet = dynamic(
  () => import('@/components/leads/SalesScriptsSheet').then((m) => m.SalesScriptsSheet),
  { ssr: false }
);

const LeadSellerMappingModal = dynamic(
  () => import('@/components/leads/LeadSellerMappingModal').then((m) => m.LeadSellerMappingModal),
  { ssr: false }
);
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api/client';
import {
  getConsultantsList,
  getLeadsStats,
  type LeadItem,
} from './actions';
import {
  BookOpen,
  Plus,
  Phone,
  MessageCircle,
  Ban,
  UserCheck,
  Instagram,
  Sparkles,
  Layers,
  RotateCcw,
  Link2,
  Store,
  Trash2,
  ShieldAlert,
  Inbox,
  CheckCircle2,
  BadgeCheck,
  XCircle,
  LayoutList,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/components/auth/AuthProvider';
import type { LeadStatus, UserRole } from '@/types/database.types';
import { EmployeeBadge, EmployeeColorDot } from '@/components/ui/EmployeeBadge';

function LeadsContent() {
  const router = useRouter();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const user = useUser();

  const [leads, setLeads] = React.useState<LeadItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>(user.role);
  // Права назначенной роли и актор для единых правил статусов
  const perms = user.permissions;
  const canCreateLeads = user.can('leads.create');
  const canAssignLeads = user.can('leads.assign');
  const canDeleteLeads = user.can('leads.delete');
  const canBulkLeads = user.can('leads.bulk');
  const canLinkSeller = user.can('leads.link_seller');
  const canUnlinkSeller = user.can('leads.unlink_seller');
  const canOpenScripts = user.can('leads.scripts');
  const canEditFullLead = user.can('leads.edit');
  const canViewAllLeads = user.canViewAll('leads');
  const [userName, setUserName] = React.useState(user.userName);
  const [userLogin, setUserLogin] = React.useState(user.userLogin);

  // Статистика воронки
  const [stats, setStats] = React.useState({
    total: 0,
    open: 0,
    processed: 0,
    assigned: 0,
    signed: 0,
    cancelled: 0,
  });

  // Список консультантов для назначения
  const [consultants, setConsultants] = React.useState<
    { user_id: string; full_name: string; role: string; login: string; color?: string }[]
  >([]);

  // Состояние шторки скриптов продаж
  const [isScriptsOpen, setIsScriptsOpen] = React.useState(false);

  // Единый поиск и фильтры верхней панели
  const [searchQuery, setSearchQuery] = React.useState('');
  const [filterStatus, setFilterStatus] = React.useState<string>('all');
  const [filterConsultant, setFilterConsultant] = React.useState<string>('all');

  // Состояние модального окна EntityModal
  const [modalState, setModalState] = React.useState<{
    isOpen: boolean;
    mode: 'view' | 'edit' | 'create';
    selectedLead: LeadItem | null;
  }>({
    isOpen: false,
    mode: 'view',
    selectedLead: null,
  });

  // Диалог отмены лида (одного или нескольких) с обязательной причиной
  const [cancelDialog, setCancelDialog] = React.useState<{
    isOpen: boolean;
    leadIds: string[];
    clientName: string;
    reason: string;
    onDone?: () => void;
  }>({
    isOpen: false,
    leadIds: [],
    clientName: '',
    reason: '',
  });
  const closeCancelDialog = () => setCancelDialog({ isOpen: false, leadIds: [], clientName: '', reason: '' });

  // Состояние модального окна связывания «Лид -> Продавец»
  const [currentUserId, setCurrentUserId] = React.useState<string>('');
  const [mappingModal, setMappingModal] = React.useState<{
    isOpen: boolean;
    lead: LeadItem | null;
  }>({
    isOpen: false,
    lead: null,
  });

  // Диалог безвозвратного удаления лида (Admin Only)
  const [leadToDelete, setLeadToDelete] = React.useState<LeadItem | null>(null);
  const [isDeletingLead, setIsDeletingLead] = React.useState(false);

  const handleConfirmDeleteLead = async () => {
    if (!leadToDelete) return;
    if (!canDeleteLeads) {
      showToast('Удаление лидов не предусмотрено вашей ролью', 'error');
      return;
    }

    setIsDeletingLead(true);
    try {
      await api.leads.delete(leadToDelete.lead_id);
      showToast('Лид безвозвратно удален из базы', 'success');
      setLeads((prev) => prev.filter((l) => l.lead_id !== leadToDelete.lead_id));
      setLeadToDelete(null);
      if (modalState.selectedLead?.lead_id === leadToDelete.lead_id) {
        setModalState({ isOpen: false, mode: 'view', selectedLead: null });
      }
      getLeadsStats().then(setStats);
    } catch (err: any) {
      showToast(err.message || 'Ошибка удаления лида', 'error');
    } finally {
      setIsDeletingLead(false);
    }
  };

  // Диалог подтверждения отвязки продавца от лида
  const [leadToUnlink, setLeadToUnlink] = React.useState<LeadItem | null>(null);
  const [isUnlinkingSeller, setIsUnlinkingSeller] = React.useState(false);

  const handleConfirmUnlinkSeller = async () => {
    if (!leadToUnlink) return;
    setIsUnlinkingSeller(true);
    try {
      await api.leads.unlinkSeller(leadToUnlink.lead_id);
      showToast('Продавец успешно отвязан. Лид переведен в статус «Назначен»', 'success');
      setLeadToUnlink(null);
      setModalState({ isOpen: false, mode: 'view', selectedLead: null });
      await fetchInitialData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка при отвязке продавца', 'error');
    } finally {
      setIsUnlinkingSeller(false);
    }
  };

  // Загрузка начальных данных и профиля
  const fetchInitialData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [leadsRes, statsRes, consultantsRes] = await Promise.all([
        api.leads.getAll({ page: 1, limit: 100 }),
        getLeadsStats(),
        getConsultantsList(),
      ]);

      // Весь реестр загружается постранично: вкладки и фильтры работают на клиенте
      const items = [...(leadsRes.items || [])];
      const total = leadsRes.total || items.length;
      for (let page = 2; items.length < total && page <= 50; page++) {
        const next = await api.leads.getAll({ page, limit: 100 });
        if (!next.items || next.items.length === 0) break;
        items.push(...next.items);
      }

      setLeads(items);
      setTotalCount(total);
      setStats(statsRes);
      setConsultants(consultantsRes);
    } catch (err) {
      console.error(err);
      showToast('Ошибка при загрузке лидов', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const leadActor = React.useMemo(() => ({ userId: currentUserId, permissions: perms }), [currentUserId, perms]);

  React.useEffect(() => {
    if (user.profile) {
      setCurrentUserId(user.profile.user_id);
      setCurrentUserRole(user.role);
      setUserName(user.userName);
      setUserLogin(user.userLogin);
    }
  }, [user]);

  React.useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Автоматический расчет ответственного консультанта по умолчанию
  const defaultConsultantId = React.useMemo(() => {
    if (!canAssignLeads) {
      return currentUserId;
    }
    const currentInList = consultants.find((c) => c.user_id === currentUserId);
    if (currentInList) {
      return currentInList.user_id;
    }
    return consultants[0]?.user_id || '';
  }, [canAssignLeads, currentUserId, consultants]);

  // Автоматическое открытие формы создания при переходе по ?action=create (кнопка FAB)
  React.useEffect(() => {
    if (searchParams.get('action') === 'create') {
      if (!canCreateLeads) return;
      setModalState({
        isOpen: true,
        mode: 'create',
        selectedLead: {
          assigned_to: defaultConsultantId,
          status: 'Открыт',
        } as any,
      });
    }
  }, [searchParams, defaultConsultantId, canCreateLeads]);

  // Конфигурация колонок DataJournal (мемоизирована для стабилизации виртуализатора)
  const columns: ColumnDef<LeadItem>[] = React.useMemo(
    () => [
      {
        key: 'lead_id',
        label: 'ID лида',
        width: 120,
        minWidth: 100,
        sortable: true,
        filterable: true,
        renderCell: (row) => (
          <span className="font-mono text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            {row.lead_id.substring(0, 8)}...
          </span>
        ),
      },
      {
        key: 'client_name',
        label: 'Клиент / Торговая точка',
        width: 200,
        minWidth: 150,
        sortable: true,
        filterable: true,
        renderCell: (row) => (
          <div className="space-y-0.5">
            <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {row.client_name}
            </p>
            {row.instagram && (
              <p className="text-[11px] text-zinc-400 flex items-center gap-1 truncate">
                <Instagram className="w-3 h-3 text-pink-500 flex-shrink-0" strokeWidth={1.75} />
                <span>{row.instagram}</span>
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'phone',
        label: 'Телефон',
        type: 'phone',
        width: 160,
        minWidth: 130,
        sortable: true,
        filterable: true,
        phoneAccessor: (row) => formatPhoneDisplay(row.phone, row.country_code),
        renderCell: (row) => (
          <span className="font-mono text-zinc-800 dark:text-zinc-200">
            {formatPhoneDisplay(row.phone, row.country_code)}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'Статус воронки',
        type: 'status',
        width: 150,
        minWidth: 130,
        sortable: true,
        filterable: true,
        groupable: true,
        statusOptions: PIPELINE_STATUS_OPTIONS,
      },
      {
        key: 'assigned_to',
        label: 'Ответственный',
        width: 190,
        minWidth: 160,
        sortable: true,
        filterable: true,
        groupable: true,
        filterType: 'select',
        filterOptions: [
          { value: '', label: '— Не назначен —' },
          ...consultants.map((c) => ({ value: c.user_id, label: c.full_name })),
        ],
        renderCell: (row) => {
          if (canAssignLeads) {
            const isUnassigned = !row.assigned_to;
            const currentConsultant = consultants.find((c) => c.user_id === row.assigned_to);
            return (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <EmployeeColorDot
                  color={currentConsultant?.color || (isUnassigned ? '#9CA3AF' : undefined)}
                  size="sm"
                />
                <select
                  value={row.assigned_to || ''}
                  onChange={async (e) => {
                    const newConsultantId = e.target.value || null;
                    try {
                      await api.leads.updateAssigned(row.lead_id, newConsultantId);
                      showToast(newConsultantId ? 'Консультант назначен' : 'Назначение отменено', 'success');
                      fetchInitialData();
                    } catch (err: any) {
                      showToast(err.message || 'Ошибка при назначении консультанта', 'error');
                    }
                  }}
                  className={`h-7 px-2 text-xs font-semibold rounded-lg shadow-sm focus:outline-none cursor-pointer transition-all ${
                    isUnassigned
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 hover:bg-amber-500/25 ring-1 ring-amber-500/20'
                      : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 focus:ring-1 focus:ring-blue-500'
                  }`}
                >
                  <option value="">— Не назначен —</option>
                  {consultants.map((c) => (
                    <option key={c.user_id} value={c.user_id}>
                      ● {c.full_name}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          if (!row.assigned_user) {
            return (
              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800/60 px-2 py-0.5 rounded-md">
                — Не назначен —
              </span>
            );
          }
          return (
            <EmployeeBadge
              name={row.assigned_user.full_name}
              color={row.assigned_user.color}
              size="sm"
            />
          );
        },
      },
      {
        key: 'created_at',
        label: 'Поступил',
        type: 'datetime',
        width: 170,
        minWidth: 150,
        sortable: true,
        filterable: true,
        renderCell: (row) => (
          <span className="text-zinc-500 dark:text-zinc-400 font-mono text-[11px]">
            <FormattedDate date={row.created_at} type="dateTime" />
          </span>
        ),
      },
      {
        key: 'comment',
        label: 'Заметки',
        width: 220,
        minWidth: 160,
        sortable: false,
        filterable: true,
        renderCell: (row) => (
          <span className="text-zinc-500 dark:text-zinc-400 truncate max-w-xs block">
            {row.comment || '—'}
          </span>
        ),
      },
    ],
    [canAssignLeads, consultants, fetchInitialData, showToast]
  );

  // Конфигурация полей EntityModal (мемоизирована для предотвращения сброса формы при ререндере)
  const entityFields: EntityFieldConfig<LeadItem>[] = React.useMemo(
    () => [
      {
        name: 'lead_id',
        label: 'ID заявки (UUID)',
        immutable: true,
        isSystem: true,
      },
      {
        name: 'created_at',
        label: 'Дата поступления',
        type: 'datetime',
        immutable: true,
        isSystem: true,
      },
      {
        name: 'client_name',
        label: 'Имя клиента или название точки',
        required: true,
        immutable: !canEditFullLead,
        placeholder: 'Например: Айбек (Магазин Береке)',
      },
      {
        name: 'phone',
        label: 'Номер телефона',
        type: 'phone',
        required: true,
        immutable: !canEditFullLead,
      },
      {
        name: 'instagram',
        label: 'Instagram аккаунт',
        immutable: !canEditFullLead,
        placeholder: '@username или ссылка',
      },
      {
        name: 'status',
        label: 'Этап воронки',
        type: 'status',
        // Новый лид всегда «Открыт»; смена — только из панели быстрых действий по правилам ролей
        isSystem: true,
      },
      {
        name: 'assigned_to',
        label: 'Ответственный консультант',
        type: 'select',
        disabled: !canAssignLeads,
        immutable: !canAssignLeads,
        isSystem: !canAssignLeads && !canViewAllLeads && currentUserRole === 'smm',
        defaultValue: !canAssignLeads && currentUserRole === 'consultant' ? currentUserId : '',
        helperText: canAssignLeads
          ? 'Назначение из «Открыт»/«Обработан» переводит лид в «Назначен»'
          : currentUserRole === 'consultant'
          ? 'Лид закреплен за вами'
          : 'Консультанта назначает сотрудник с правом назначения',
        options: [
          { value: '', label: '— Не назначен —' },
          ...consultants.map((c) => ({
            value: c.user_id,
            label: `● ${c.full_name} (${c.role === 'admin' ? 'Администратор' : 'Консультант'})`,
          })),
        ],
        // В карточке — имя и цвет сотрудника вместо идентификатора
        renderCustomView: (_val, lead) =>
          lead.assigned_user ? (
            <EmployeeBadge name={lead.assigned_user.full_name} color={lead.assigned_user.color} size="sm" />
          ) : (
            <span className="text-zinc-400">— Не назначен —</span>
          ),
      },
      {
        name: 'comment',
        label: 'Комментарий и история контакта',
        type: 'textarea',
        placeholder: 'Заметки по клиенту, детали разговора, пожелания...',
      },
      {
        name: 'cancel_reason',
        label: 'Причина отмены',
        type: 'textarea',
        immutable: true,
        isSystem: true,
        hidden: (lead) => !isCancelStatus(lead.status),
        renderCustomView: (val) => <span className="whitespace-pre-wrap text-rose-700 dark:text-rose-300">{val || '—'}</span>,
      },
      {
        name: 'cancelled_at',
        label: 'Дата отмены',
        type: 'datetime',
        immutable: true,
        isSystem: true,
        hidden: (lead) => !isCancelStatus(lead.status),
      },
    ],
    [consultants, currentUserRole, currentUserId, canAssignLeads, canEditFullLead, canViewAllLeads]
  );

  // Права на редактирование полей текущего лида в EntityModal (единые правила по правам роли)
  const canEditCurrentLead = React.useMemo(
    () =>
      Boolean(modalState.selectedLead) &&
      (canEditLeadFields(leadActor, modalState.selectedLead as LeadItem) ||
        canEditLeadComment(leadActor, modalState.selectedLead as LeadItem)),
    [leadActor, modalState.selectedLead]
  );

  // Статусы, в которые текущий пользователь может перевести открытый в карточке лид
  const allowedStatusesForModal = React.useMemo(
    () =>
      modalState.selectedLead && modalState.mode !== 'create'
        ? allowedLeadTransitions(leadActor, modalState.selectedLead)
        : [],
    [leadActor, modalState.selectedLead, modalState.mode]
  );

  // Варианты статуса для строки/карточки реестра: только разрешенные переходы (иначе — бейдж)
  const getLeadStatusOptions = React.useCallback(
    (row: LeadItem) => {
      const allowed = allowedLeadTransitions(leadActor, row);
      if (allowed.length === 0) return null;
      return PIPELINE_STATUS_OPTIONS.filter((o) => o.value === row.status || allowed.includes(o.value as LeadStatus));
    },
    [leadActor]
  );

  // Обработчики строк DataJournal
  const handleRowClick = (lead: LeadItem) => {
    setModalState({
      isOpen: true,
      mode: 'view',
      selectedLead: lead,
    });
  };

  const handleCreateClick = () => {
    if (!canCreateLeads) {
      showToast('Создание лидов не предусмотрено вашей ролью', 'error');
      return;
    }
    setModalState({
      isOpen: true,
      mode: 'create',
      selectedLead: {
        assigned_to: null,
        status: 'Открыт',
      } as any,
    });
  };

  // Массовые действия для администратора
  const [selectedLeadIds, setSelectedLeadIds] = React.useState<string[]>([]);
  const [isBatchLoading, setIsBatchLoading] = React.useState(false);

  const handleBatchStatus = async (status: LeadStatus, clearSelection: () => void) => {
    if (selectedLeadIds.length === 0) return;

    // Массовая отмена — только с причиной
    if (isCancelStatus(status)) {
      setCancelDialog({
        isOpen: true,
        leadIds: [...selectedLeadIds],
        clientName: `Выбрано лидов: ${selectedLeadIds.length}`,
        reason: '',
        onDone: clearSelection,
      });
      return;
    }

    setIsBatchLoading(true);
    try {
      await api.leads.batch({
        lead_ids: selectedLeadIds,
        action: 'change_status',
        status,
      });
      showToast(`Статус обновлен для ${selectedLeadIds.length} лидов`, 'success');
      clearSelection();
      await fetchInitialData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка массового изменения статуса', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  const handleBatchAssign = async (assignedTo: string | null, clearSelection: () => void) => {
    if (selectedLeadIds.length === 0) return;
    setIsBatchLoading(true);
    try {
      await api.leads.batch({
        lead_ids: selectedLeadIds,
        action: 'change_assigned',
        assigned_to: assignedTo,
      });
      showToast(`Консультант назначен для ${selectedLeadIds.length} лидов`, 'success');
      clearSelection();
      await fetchInitialData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка массового назначения', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  const handleBatchDelete = async (clearSelection: () => void) => {
    if (selectedLeadIds.length === 0) return;
    const ok = await confirm({
      title: 'Удалить выбранные лиды навсегда?',
      subtitle: `Выбрано лидов: ${selectedLeadIds.length}`,
      description: 'Записи будут физически удалены из базы без возможности восстановления.',
      tone: 'danger',
      icon: Trash2,
      confirmLabel: 'Удалить навсегда',
    });
    if (!ok) return;
    setIsBatchLoading(true);
    try {
      const res = await api.leads.batch({
        lead_ids: selectedLeadIds,
        action: 'delete',
      });
      showToast(`Удалено лидов: ${(res as any)?.affected_count ?? selectedLeadIds.length}`, 'success');
      clearSelection();
      await fetchInitialData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка массового удаления', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  /**
   * Смена статуса из реестра/карточки по единым правилам ролей.
   * Возвращает false, если смена не выполнена (запрет или открыт диалог причины отмены).
   */
  const changeLeadStatus = React.useCallback(
    async (lead: LeadItem, newStatus: string): Promise<boolean> => {
      const check = canChangeLeadStatus(leadActor, lead, newStatus);
      if (!check.ok) {
        showToast(check.reason, 'error');
        return false;
      }

      if (isCancelStatus(newStatus)) {
        setCancelDialog({ isOpen: true, leadIds: [lead.lead_id], clientName: lead.client_name, reason: '' });
        return false;
      }

      const res = await api.leads.updateStatus(lead.lead_id, newStatus);
      setLeads((prev) =>
        prev.map((item) =>
          item.lead_id === lead.lead_id
            ? { ...item, status: newStatus as LeadStatus, cancel_reason: null, cancelled_at: null, ...(res || {}) }
            : item
        )
      );
      setModalState((prev) =>
        prev.selectedLead?.lead_id === lead.lead_id
          ? { ...prev, selectedLead: { ...prev.selectedLead, status: newStatus as LeadStatus, cancel_reason: null, cancelled_at: null } }
          : prev
      );
      getLeadsStats().then(setStats);
      return true;
    },
    [leadActor, showToast]
  );

  const handleStatusChangeInJournal = React.useCallback(
    (lead: LeadItem, newStatus: string) => changeLeadStatus(lead, newStatus),
    [changeLeadStatus]
  );

  // Обработчики формы EntityModal (статус через форму не меняется — только панель быстрых действий)
  const handleSaveLead = async (updated: LeadItem) => {
    try {
      await api.leads.update(updated.lead_id, {
        client_name: updated.client_name,
        phone: updated.phone,
        country_code: updated.country_code,
        instagram: updated.instagram,
        comment: updated.comment,
        ...(canAssignLeads ? { assigned_to: updated.assigned_to || null } : {}),
      });
      await fetchInitialData();
    } catch (err: any) {
      throw new Error(err.message || 'Ошибка при сохранении лида');
    }
  };

  const handleCreateLead = async (newLeadData: Partial<LeadItem>) => {
    if (!newLeadData.client_name || !newLeadData.phone) {
      throw new Error('Заполните имя клиента и номер телефона');
    }

    // Без права назначения лид либо закрепляется за собой (консультант), либо остается свободным
    const assignedConsultant = canAssignLeads
      ? newLeadData.assigned_to || null
      : currentUserRole === 'consultant'
      ? currentUserId
      : null;

    try {
      await api.leads.create({
        client_name: newLeadData.client_name,
        phone: newLeadData.phone,
        country_code: newLeadData.country_code || '996',
        instagram: newLeadData.instagram || undefined,
        comment: newLeadData.comment || undefined,
        assigned_to: assignedConsultant,
      });
      await fetchInitialData();
    } catch (err: any) {
      throw new Error(err.message || 'Ошибка создания лида');
    }
  };

  const handleStatusChangeInModal = async (newStatus: string) => {
    if (!modalState.selectedLead) return false;
    try {
      return await changeLeadStatus(modalState.selectedLead, newStatus);
    } catch (err: any) {
      throw new Error(err.message || 'Ошибка при смене статуса');
    }
  };

  const handleConfirmCancelLead = async () => {
    const reason = cancelDialog.reason.trim();
    if (cancelDialog.leadIds.length === 0 || reason.length < 3) {
      showToast('Укажите причину отмены (не менее 3 символов)', 'error');
      return;
    }

    try {
      if (cancelDialog.leadIds.length === 1) {
        await api.leads.updateStatus(cancelDialog.leadIds[0], 'Отмена', reason);
        showToast('Лид переведен в статус «Отмена»', 'info');
      } else {
        await api.leads.batch({
          lead_ids: cancelDialog.leadIds,
          action: 'change_status',
          status: 'Отмена',
          cancel_reason: reason,
        });
        showToast(`Отменено лидов: ${cancelDialog.leadIds.length}`, 'info');
      }
      cancelDialog.onDone?.();
      closeCancelDialog();
      setModalState((prev) =>
        prev.selectedLead && cancelDialog.leadIds.includes(prev.selectedLead.lead_id)
          ? { ...prev, isOpen: false }
          : prev
      );
      await fetchInitialData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка при отмене сделки', 'error');
    }
  };

  const handleLinkSeller = (lead: LeadItem) => {
    if (lead.seller_phone) {
      showToast(`Лид уже привязан к продавцу ${formatPhoneDisplay(lead.seller_phone)}`, 'info');
      return;
    }
    if (!canLinkSeller) {
      showToast('Привязка продавцов не предусмотрена вашей ролью', 'error');
      return;
    }
    setMappingModal({
      isOpen: true,
      lead,
    });
  };

  // Расчет количества активных фильтров
  const activeFilterCount =
    (filterStatus !== 'all' ? 1 : 0) + (filterConsultant !== 'all' ? 1 : 0);

  // Содержимое всплывающего окна фильтров TopHeader
  const filterContent = (
    <div className="space-y-3.5">
      <div>
        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Статус воронки
        </label>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          <option value="all">Все статусы воронки</option>
          <option value="Открыт">● Открыт</option>
          <option value="Обработан">● Обработан</option>
          <option value="Назначен">● Назначен</option>
          <option value="Подписан">● Подписан</option>
          <option value="Отмена">● Отмена</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-1.5">
          Ответственный консультант
        </label>
        <select
          value={filterConsultant}
          onChange={(e) => setFilterConsultant(e.target.value)}
          className="w-full h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
        >
          <option value="all">Все консультанты</option>
          <option value="unassigned">— Без консультанта —</option>
          {consultants.map((c) => (
            <option key={c.user_id} value={c.user_id}>
              ● {c.full_name}
            </option>
          ))}
        </select>
      </div>

      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setFilterStatus('all');
            setFilterConsultant('all');
          }}
          className="w-full h-9 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Сбросить фильтры</span>
        </button>
      )}
    </div>
  );

  // Фильтрация лидов по статусу и консультанту
  const filteredLeads = React.useMemo(() => {
    return leads.filter((lead) => {
      if (filterStatus !== 'all' && lead.status !== filterStatus) return false;
      if (filterConsultant !== 'all') {
        if (filterConsultant === 'unassigned' && lead.assigned_to) return false;
        if (filterConsultant !== 'unassigned' && lead.assigned_to !== filterConsultant) return false;
      }
      return true;
    });
  }, [leads, filterStatus, filterConsultant]);

  // Контекстные действия тулбара реестра Лидов (ЯРУС 3)
  const leadActions = (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
      {/* Кнопка открытия базы скриптов */}
      {canOpenScripts && (
      <button
        type="button"
        onClick={() => setIsScriptsOpen(true)}
        className="h-9 md:h-11 w-9 md:w-auto p-0 md:px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center md:gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive flex-shrink-0"
        title="Скрипты продаж"
        aria-label="Скрипты продаж"
      >
        <BookOpen className="w-4 h-4 text-purple-500 flex-shrink-0" strokeWidth={1.75} />
        <span className="hidden md:inline">Скрипты продаж</span>
      </button>
      )}
    </div>
  );

  // Быстрые действия в строках таблицы и карточках DataJournal
  const renderCustomRowActions = React.useCallback(
    (row: LeadItem) => {
      const actions: React.ReactNode[] = [];

      if (canLinkSeller) {
        if (!row.seller_phone && row.status !== 'Отмена') {
          actions.push(
            <button
              key="link"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleLinkSeller(row);
              }}
              className="p-1.5 rounded-lg text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 bg-purple-500/10 border border-purple-500/20 transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
              title="Быстро связать с продавцом платформы"
            >
              <Link2 className="w-3.5 h-3.5" strokeWidth={2} />
              <span className="hidden xl:inline text-[11px] font-semibold">Связать</span>
            </button>
          );
        } else if (row.seller_phone) {
          actions.push(
            <span
              key="linked"
              className="p-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono flex items-center gap-1"
              title={`Привязан к продавцу ${formatPhoneDisplay(row.seller_phone)}`}
            >
              <Store className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span className="hidden xl:inline font-semibold">Связан</span>
            </span>
          );
        }
      }

      if (canDeleteLeads) {
        actions.push(
          <button
            key="delete"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLeadToDelete(row);
            }}
            className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center gap-2.5 transition-colors cursor-pointer"
            title="Удалить навсегда"
          >
            <Trash2 className="w-4 h-4 text-rose-500" strokeWidth={1.75} />
            <span>Удалить навсегда</span>
          </button>
        );
      }

      if (actions.length === 0) return null;
      return <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">{actions}</div>;
    },
    [canLinkSeller, canDeleteLeads, handleLinkSeller]
  );

  const isAnyModalOpen =
    modalState.isOpen || mappingModal.isOpen || isScriptsOpen || cancelDialog.isOpen || leadToDelete !== null;

  // Вкладки воронки продаж для DataJournal
  const leadTabs: DataJournalTab[] = React.useMemo(() => {
    if (!canViewAllLeads && currentUserRole === 'consultant') {
      return [
        { id: 'all', label: 'Все в работе', count: stats.total, icon: LayoutList },
        { id: 'Назначен', label: 'Назначен', count: stats.assigned, icon: UserCheck },
        { id: 'Подписан', label: 'Подписан', count: stats.signed, icon: BadgeCheck },
        { id: 'Отмена', label: 'Отмена', count: stats.cancelled, icon: XCircle },
      ];
    }
    return [
      { id: 'all', label: 'Все', count: stats.total, icon: LayoutList },
      { id: 'Открыт', label: 'Открыт', count: stats.open, icon: Inbox },
      { id: 'Обработан', label: 'Обработан', count: stats.processed, icon: CheckCircle2 },
      { id: 'Назначен', label: 'Назначен', count: stats.assigned, icon: UserCheck },
      { id: 'Подписан', label: 'Подписан', count: stats.signed, icon: BadgeCheck },
      { id: 'Отмена', label: 'Отмена', count: stats.cancelled, icon: XCircle },
    ];
  }, [currentUserRole, canViewAllLeads, stats]);

  return (
    <AppLayout
      userRole={currentUserRole}
      userName={userName}
      userLogin={userLogin}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Быстрый поиск по телефону, имени или заметке..."
      filterCount={activeFilterCount}
      filterContent={filterContent}
      onCreateClick={canCreateLeads ? handleCreateClick : undefined}
      createTooltip="Добавить лид"
      hideFab={isAnyModalOpen}
    >
      <div className="space-y-4">
        {/* Реестр заявок DataJournal с интегрированными табами воронки */}
        <DataJournal<LeadItem>
          data={filteredLeads}
          columns={columns}
          keyField="lead_id"
          storageKey="leads_live"
          externalSearchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          tabs={leadTabs}
          activeTab={filterStatus}
          onTabChange={setFilterStatus}
          enableSelection={canBulkLeads}
          selectedIds={selectedLeadIds}
          onSelectionChange={setSelectedLeadIds}
          renderBulkActions={(ids, clearSelection) => (
            <div className="flex items-center gap-2">
              <select
                disabled={isBatchLoading}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleBatchStatus(e.target.value as LeadStatus, clearSelection);
                    e.target.value = '';
                  }
                }}
                className="h-8 px-2.5 rounded-xl bg-white/10 border border-white/20 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer"
              >
                <option value="" disabled className="text-zinc-900 bg-white">Сменить статус...</option>
                <option value="Открыт" className="text-zinc-900 bg-white">Открыт</option>
                <option value="Обработан" className="text-zinc-900 bg-white">Обработан</option>
                <option value="Назначен" className="text-zinc-900 bg-white">Назначен</option>
                <option value="Подписан" className="text-zinc-900 bg-white">Подписан</option>
                <option value="Отмена" className="text-zinc-900 bg-white">Отмена</option>
              </select>

              <select
                disabled={isBatchLoading}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value !== '') {
                    const val = e.target.value === 'null' ? null : e.target.value;
                    handleBatchAssign(val, clearSelection);
                    e.target.value = '';
                  }
                }}
                className="h-8 px-2.5 rounded-xl bg-white/10 border border-white/20 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer max-w-[150px] truncate"
              >
                <option value="" disabled className="text-zinc-900 bg-white">Назначить...</option>
                <option value="null" className="text-zinc-900 bg-white">Без консультанта</option>
                {consultants.map((c) => (
                  <option key={c.user_id} value={c.user_id} className="text-zinc-900 bg-white">
                    {c.full_name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={isBatchLoading}
                onClick={() => handleBatchDelete(clearSelection)}
                className="h-8 px-2.5 rounded-xl bg-rose-500/30 hover:bg-rose-500/40 text-rose-300 text-xs font-semibold border border-rose-500/40 transition-colors flex items-center gap-1"
                title="Удалить выбранные лиды навсегда"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Удалить</span>
              </button>
            </div>
          )}
          customActions={leadActions}
          customRowActions={renderCustomRowActions}
          onRowClick={handleRowClick}
          onStatusChange={handleStatusChangeInJournal}
          getStatusOptions={getLeadStatusOptions}
          totalCount={filteredLeads.length}
        />

        {/* 4. Единая гибридная форма сущности EntityModal */}
        {/* 4. Модальное окно редактирования лида */}
        {modalState.isOpen && (
          <EntityModal<LeadItem>
            isOpen={modalState.isOpen}
            onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
            initialMode={modalState.mode}
            title={modalState.selectedLead?.client_name || 'Новый лид'}
            data={modalState.selectedLead}
            fields={entityFields}
            keyField="lead_id"
            phoneField="phone"
            statusField="status"
            statusOptions={PIPELINE_STATUS_OPTIONS}
            allowedStatusValues={allowedStatusesForModal}
            onSave={canEditCurrentLead ? handleSaveLead : undefined}
            onCreate={canCreateLeads ? handleCreateLead : undefined}
            onStatusChange={allowedStatusesForModal.length > 0 ? handleStatusChangeInModal : undefined}
            onLinkSeller={canLinkSeller ? handleLinkSeller : undefined}
            onDelete={canDeleteLeads ? (lead) => setLeadToDelete(lead) : undefined}
            createSubmitLabel="Сохранить запись"
            linkedBanner={
              modalState.selectedLead?.seller_phone
                ? {
                    title: `Привязанный продавец: ${formatPhoneDisplay(modalState.selectedLead.seller_phone)}`,
                    description: `Связан ${
                      modalState.selectedLead.linked_at
                        ? formatDateTime(modalState.selectedLead.linked_at)
                        : 'в системе'
                    }`,
                    navigateLabel: 'К продавцу',
                    onNavigate: () => {
                      router.push(
                        `/sellers?search=${encodeURIComponent(
                          modalState.selectedLead?.seller_phone || ''
                        )}`
                      );
                    },
                    unlinkLabel: canUnlinkSeller ? 'Отвязать продавца' : undefined,
                    onUnlink: canUnlinkSeller ? () => setLeadToUnlink(modalState.selectedLead) : undefined,
                  }
                : undefined
            }
          />
        )}

        {/* 5. Шторка базы знаний скриптов продаж */}
        {isScriptsOpen && (
          <SalesScriptsSheet
            isOpen={isScriptsOpen}
            onClose={() => setIsScriptsOpen(false)}
          />
        )}

        {/* 6. Диалог отмены сделки с обязательной причиной (один лид или массово) */}
        <ConfirmDialog
          open={cancelDialog.isOpen}
          onClose={closeCancelDialog}
          onConfirm={handleConfirmCancelLead}
          title={cancelDialog.leadIds.length > 1 ? 'Отмена сделок' : 'Отмена сделки'}
          subtitle={cancelDialog.clientName}
          tone="danger"
          icon={Ban}
          confirmLabel="Подтвердить отмену"
          cancelLabel="Назад"
          confirmDisabled={cancelDialog.reason.trim().length < 3}
          level={2}
          description={
            user.can('leads.rollback')
              ? 'Вернуть лид из статуса «Отмена» может сотрудник с правом отката статуса.'
              : 'После отмены вернуть лид в работу сможет только сотрудник с правом отката статуса.'
          }
        >
          <FormField label="Причина отмены" required hint="Не менее 3 символов. Причина сохраняется в карточке лида.">
            <Textarea
              value={cancelDialog.reason}
              onChange={(e) => setCancelDialog((prev) => ({ ...prev, reason: e.target.value }))}
              rows={3}
              autoFocus
              maxLength={500}
              placeholder="Например: высокая цена, закрылся бизнес, выбрал другое решение..."
            />
          </FormField>
        </ConfirmDialog>

        {/* 7. Модальное окно ручного связывания Лид -> Продавец */}
        {mappingModal.isOpen && (
          <LeadSellerMappingModal
            isOpen={mappingModal.isOpen}
            onClose={() => setMappingModal({ isOpen: false, lead: null })}
            lead={mappingModal.lead}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            consultants={consultants}
            onSuccess={async () => {
              setModalState((prev) => ({ ...prev, isOpen: false }));
              await fetchInitialData();
            }}
          />
        )}

        {/* 8. Диалог подтверждения безвозвратного удаления лида (Admin Only) */}
        <ConfirmDialog
          open={leadToDelete !== null}
          onClose={() => !isDeletingLead && setLeadToDelete(null)}
          onConfirm={handleConfirmDeleteLead}
          title="Удалить лид навсегда?"
          subtitle={
            leadToDelete
              ? `${leadToDelete.client_name} (${leadToDelete.phone ? formatPhoneDisplay(leadToDelete.phone, leadToDelete.country_code) : 'без телефона'})`
              : undefined
          }
          tone="danger"
          icon={Trash2}
          confirmLabel="Удалить навсегда"
          level={2}
          description={
            <div className="space-y-1.5">
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
                <span>Внимание: действие необратимо</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Запись будет физически удалена из базы без возможности восстановления.
              </p>
            </div>
          }
        />

        {/* 9. Диалог подтверждения отвязки продавца от лида */}
        <ConfirmDialog
          open={leadToUnlink !== null}
          onClose={() => !isUnlinkingSeller && setLeadToUnlink(null)}
          onConfirm={handleConfirmUnlinkSeller}
          title="Отвязать продавца от лида?"
          subtitle={
            leadToUnlink
              ? `${leadToUnlink.client_name} (Продавец: ${formatPhoneDisplay(leadToUnlink.seller_phone)})`
              : undefined
          }
          tone="warning"
          icon={RotateCcw}
          confirmLabel="Подтвердить отвязку"
          level={2}
          description={
            <>
              При отвязке лид вернется в статус <b>«Назначен»</b>, привязка к продавцу будет разорвана, а у продавца будет сброшен назначенный консультант.
            </>
          }
        />
      </div>
    </AppLayout>
  );
}

export default function LeadsPage() {
  return (
    <React.Suspense fallback={null}>
      <LeadsContent />
    </React.Suspense>
  );
}

