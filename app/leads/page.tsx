'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  DataJournal,
  JournalMenuItem,
  type ColumnDef,
  type DataJournalTab,
  type RowTone,
  PIPELINE_STATUS_OPTIONS,
} from '@/components/ui/DataJournal';
import type { KanbanColumn, KanbanConfig } from '@/components/ui/KanbanBoard';
import dynamic from 'next/dynamic';
import { EntityModal, type EntityFieldConfig } from '@/components/ui/EntityModal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { ConfirmDialog, useConfirm } from '@/components/ui/ConfirmDialog';
import { ModalCallout } from '@/components/ui/Modal';
import { FormField, Textarea } from '@/components/ui/Field';
import { LeadNextStep } from '@/components/leads/LeadNextStep';
import { LeadScheduleDialog, type LeadScheduleState, type ScheduleStatus } from '@/components/leads/LeadScheduleDialog';
import { CancelReasonPicker } from '@/components/leads/CancelReasonPicker';
import { PhoneDuplicateNotice, hasDuplicates, usePhoneDuplicates } from '@/components/leads/PhoneDuplicateNotice';
import { countPhoneKeys, leadPhoneKey } from '@/lib/leads/duplicates';
import { buildCancelReason } from '@/lib/leads/cancel-reasons';
import { EMPTY_LEAD_STATUS_COUNTS, isLeadDueToday as isDueToday, type LeadStatusCounts } from '@/lib/leads/stats';
import { formatDateTime } from '@/lib/utils/format';
import { formatPhoneDisplay } from '@/lib/utils/phone';
import {
  LEAD_STATUSES,
  LINK_ONLY_STATUS,
  allowedLeadTransitions,
  canAssignLead,
  canChangeLeadStatus,
  canEditLeadFields,
  isCancelStatus,
  reassignBlockReason,
  canRescheduleLead,
  statusDateField,
} from '@/lib/leads/status-rules';

/** Колонка канбана «Не назначен» (раскладка по ответственным) */
const UNASSIGNED_COLUMN = '__unassigned__';

const SalesScriptsSheet = dynamic(
  () => import('@/components/leads/SalesScriptsSheet').then((m) => m.SalesScriptsSheet),
  { ssr: false }
);

const WhatsAppScriptModal = dynamic(
  () => import('@/components/leads/WhatsAppScriptModal').then((m) => m.WhatsAppScriptModal),
  { ssr: false }
);

const LeadCommentsModal = dynamic(
  () => import('@/components/leads/LeadCommentsModal').then((m) => m.LeadCommentsModal),
  { ssr: false }
);

const LeadSellerMappingModal = dynamic(
  () => import('@/components/leads/LeadSellerMappingModal').then((m) => m.LeadSellerMappingModal),
  { ssr: false }
);
import { useToast } from '@/components/ui/Toast';
import type { WhatsAppTarget } from '@/components/leads/WhatsAppScriptModal';
import type { LeadCommentsTarget } from '@/components/leads/LeadCommentsModal';
import { Button } from '@/components/ui/Button';
import type { LeadCommentDto } from '@/lib/api/client';
import { api } from '@/lib/api/client';
import {
  getConsultantsList,
  getLeadsStats,
  type LeadItem,
} from './actions';
import {
  BookOpen,
  Ban,
  UserCheck,
  Instagram,
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
  Workflow,
  Users,
  UserX,
  MessageSquareText,
  PhoneOff,
  CalendarClock,
  PhoneCall,
  BellRing,
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
  const [stats, setStats] = React.useState<LeadStatusCounts>(EMPTY_LEAD_STATUS_COUNTS);
  // Миграции 050/051 применены: новые статусы и даты доступны (до них — скрыты, данные не теряются)
  const [statusSchemaReady, setStatusSchemaReady] = React.useState(true);
  const statusAvailable = React.useCallback(
    (status: string) => statusSchemaReady || !(['Нет ответа', 'Встреча', 'Перезвонить'] as string[]).includes(status),
    [statusSchemaReady]
  );

  // Список консультантов для назначения
  const [consultants, setConsultants] = React.useState<
    { user_id: string; full_name: string; role: string; login: string; color?: string }[]
  >([]);

  // Состояние шторки скриптов продаж
  const [isScriptsOpen, setIsScriptsOpen] = React.useState(false);
  // Окно WhatsApp с выбором скрипта (без права «Скрипты продаж» — прямая ссылка wa.me)
  const [waTarget, setWaTarget] = React.useState<WhatsAppTarget | null>(null);
  const openWhatsApp = React.useCallback((lead: LeadItem) => {
    setWaTarget({ phone: lead.phone, countryCode: lead.country_code, clientName: lead.client_name });
  }, []);
  // История комментариев лида и быстрое добавление
  const [commentsTarget, setCommentsTarget] = React.useState<LeadCommentsTarget | null>(null);
  // Последний комментарий, добавленный при открытой карточке: читается при отрисовке поля, не меняя данные
  // карточки (иначе форма сбросилась бы вместе с несохраненными правками)
  const latestCommentRef = React.useRef<Record<string, string>>({});
  const openComments = React.useCallback((lead: Pick<LeadItem, 'lead_id' | 'client_name'>) => {
    setCommentsTarget({ lead_id: lead.lead_id, client_name: lead.client_name });
  }, []);

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
    /** Причина из списка (051) */
    reasonCode: string;
    onDone?: () => void;
  }>({
    isOpen: false,
    leadIds: [],
    clientName: '',
    reason: '',
    reasonCode: '',
  });
  const closeCancelDialog = () => setCancelDialog({ isOpen: false, leadIds: [], clientName: '', reason: '', reasonCode: '' });
  const cancelReasonCheck = buildCancelReason(cancelDialog.reasonCode || null, cancelDialog.reason);

  // Дата встречи («Встреча») или следующего контакта («Перезвонить»): смена статуса и перенос даты
  const [scheduleDialog, setScheduleDialog] = React.useState<LeadScheduleState | null>(null);

  // Проверка дубликата номера в форме лида: предупреждение, сохранить можно
  const [phoneDraft, setPhoneDraft] = React.useState<{ phone: string; country_code: string }>({ phone: '', country_code: '' });
  const handleLeadFormChange = React.useCallback((data: Record<string, any>) => {
    const next = { phone: String(data.phone || ''), country_code: String(data.country_code || '') };
    setPhoneDraft((prev) => (prev.phone === next.phone && prev.country_code === next.country_code ? prev : next));
  }, []);
  const phoneDuplicates = usePhoneDuplicates(
    phoneDraft.phone,
    phoneDraft.country_code,
    modalState.mode === 'create' ? null : modalState.selectedLead?.lead_id,
    modalState.isOpen
  );

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

  // Загрузка начальных данных и профиля (bypassCache — принудительное обновление из тулбара)
  const fetchInitialData = React.useCallback(async (opts?: { bypassCache?: boolean }) => {
    const bypassCache = Boolean(opts?.bypassCache);
    setIsLoading(true);
    try {
      const [leadsRes, statsRes, consultantsRes] = await Promise.all([
        api.leads.getAll({ page: 1, limit: 100, bypassCache }),
        getLeadsStats(),
        getConsultantsList(),
      ]);

      // Весь реестр загружается постранично: вкладки и фильтры работают на клиенте
      const items = [...(leadsRes.items || [])];
      const total = leadsRes.total || items.length;
      for (let page = 2; items.length < total && page <= 50; page++) {
        const next = await api.leads.getAll({ page, limit: 100, bypassCache });
        if (!next.items || next.items.length === 0) break;
        items.push(...next.items);
      }

      setLeads(items);
      setStatusSchemaReady(leadsRes.status_schema_ready !== false);
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

  // Стандартная кнопка «Обновить список» тулбара DataJournal
  const handleRefresh = React.useCallback(() => fetchInitialData({ bypassCache: true }), [fetchInitialData]);

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

  // Дубли номера среди видимых лидов: янтарная подсветка строки и метка «Дубль»
  const phoneCounts = React.useMemo(() => countPhoneKeys(leads), [leads]);
  const duplicateCount = React.useCallback(
    (row: Pick<LeadItem, 'phone' | 'country_code'>) => {
      const key = leadPhoneKey(row.phone, row.country_code);
      return key ? (phoneCounts.get(key) || 0) - 1 : 0;
    },
    [phoneCounts]
  );
  const getLeadRowTone = React.useCallback(
    (row: LeadItem): RowTone | null => {
      const others = duplicateCount(row);
      return others > 0 ? { tone: 'warning', label: others === 1 ? 'Дубль номера: еще 1 лид' : `Дубль номера: еще ${others} лида` } : null;
    },
    [duplicateCount]
  );

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
        // Служебная колонка: в списке и карточках скрыта, включается в настройке колонок
        technical: true,
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
        cardTitle: true,
        renderCell: (row) => (
          <div className="space-y-0.5 min-w-0">
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
        renderCell: (row) => {
          const others = duplicateCount(row);
          return (
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate">{formatPhoneDisplay(row.phone, row.country_code)}</span>
              {others > 0 && (
                <span
                  className="flex-shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                  title={`Этот номер есть еще у ${others} ${others === 1 ? 'лида' : 'лидов'}`}
                >
                  Дубль
                </span>
              )}
            </span>
          );
        },
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
        key: 'next_step',
        label: 'Встреча / звонок',
        width: 210,
        minWidth: 170,
        sortable: false,
        renderCell: (row) => <LeadNextStep status={row.status} meeting_at={row.meeting_at} next_contact_at={row.next_contact_at} />,
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
          if (canAssignLeads && !row.seller_phone) {
            const isUnassigned = !row.assigned_to;
            const currentConsultant = consultants.find((c) => c.user_id === row.assigned_to);
            return (
              <div className="flex items-center gap-1.5 min-w-0 max-w-full" onClick={(e) => e.stopPropagation()}>
                <EmployeeColorDot
                  color={currentConsultant?.color || (isUnassigned ? '#9CA3AF' : undefined)}
                  size="sm"
                />
                <select
                  title={currentConsultant?.full_name || 'Не назначен'}
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
                  className={`h-7 px-2 min-w-0 max-w-[11rem] truncate text-xs font-semibold rounded-lg shadow-sm focus:outline-none cursor-pointer transition-all ${
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
        label: 'Последний комментарий',
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
    [canAssignLeads, consultants, fetchInitialData, showToast, duplicateCount]
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
        name: 'meeting_at',
        label: 'Встреча',
        type: 'datetime',
        immutable: true,
        isSystem: true,
        // Дата задается при переводе в «Встреча» и переносится кнопкой «Перенести встречу»
        hidden: (lead) => lead.status !== 'Встреча',
        renderCustomView: (_val, lead) => <LeadNextStep status={lead.status} meeting_at={lead.meeting_at} />,
      },
      {
        name: 'next_contact_at',
        label: 'Перезвонить',
        type: 'datetime',
        immutable: true,
        isSystem: true,
        hidden: (lead) => lead.status !== 'Перезвонить',
        renderCustomView: (_val, lead) => <LeadNextStep status={lead.status} next_contact_at={lead.next_contact_at} />,
      },
      {
        name: 'comment',
        label: modalState.mode === 'create' ? 'Комментарий' : 'Последний комментарий',
        type: 'textarea',
        placeholder: 'Заметки по клиенту, детали разговора, пожелания...',
        // После создания комментарий не правится в форме: новые добавляются в историю («Комментарий»)
        immutable: modalState.mode !== 'create',
        renderCustomView:
          modalState.mode === 'create'
            ? undefined
            : (val, lead) => (
                <div className="w-full space-y-2 py-0.5">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {latestCommentRef.current[lead.lead_id] ?? (val || '—')}
                  </p>
                  <button
                    type="button"
                    onClick={() => openComments(lead)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <MessageSquareText className="w-3.5 h-3.5" strokeWidth={1.75} />
                    История комментариев и новый комментарий
                  </button>
                </div>
              ),
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
    [consultants, currentUserRole, currentUserId, canAssignLeads, canEditFullLead, canViewAllLeads, modalState.mode, openComments]
  );

  // Права на редактирование полей текущего лида в EntityModal (единые правила по правам роли)
  // Комментарий в форме не правится (история — кнопка «Комментарий»), поэтому «Изменить» — только при
  // полном редактировании или праве назначения
  const canEditCurrentLead = React.useMemo(
    () =>
      Boolean(modalState.selectedLead) &&
      (canEditLeadFields(leadActor, modalState.selectedLead as LeadItem) || canAssignLeads),
    [leadActor, modalState.selectedLead, canAssignLeads]
  );

  // Статусы, в которые текущий пользователь может перевести открытый в карточке лид
  const allowedStatusesForModal = React.useMemo(
    () =>
      modalState.selectedLead && modalState.mode !== 'create'
        ? allowedLeadTransitions(leadActor, modalState.selectedLead).filter(statusAvailable)
        : [],
    [leadActor, modalState.selectedLead, modalState.mode, statusAvailable]
  );

  // Варианты статуса для строки/карточки реестра: только разрешенные переходы (иначе — бейдж)
  const getLeadStatusOptions = React.useCallback(
    (row: LeadItem) => {
      const allowed = allowedLeadTransitions(leadActor, row).filter(statusAvailable);
      if (allowed.length === 0) return null;
      return PIPELINE_STATUS_OPTIONS.filter((o) => o.value === row.status || allowed.includes(o.value as LeadStatus));
    },
    [leadActor, statusAvailable]
  );

  // Обработчики строк DataJournal
  const handleRowClick = (lead: LeadItem) => {
    latestCommentRef.current = {};
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
        reasonCode: '',
        onDone: clearSelection,
      });
      return;
    }

    // «Встреча» / «Перезвонить» — одна дата на все выбранные лиды
    if (statusDateField(status)) {
      setScheduleDialog({
        status: status as ScheduleStatus,
        leadIds: [...selectedLeadIds],
        clientName: `Выбрано лидов: ${selectedLeadIds.length}`,
        reschedule: false,
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
        setCancelDialog({ isOpen: true, leadIds: [lead.lead_id], clientName: lead.client_name, reason: '', reasonCode: '' });
        return false;
      }
      // Встреча и звонок — сначала дата (окно), статус меняется после подтверждения
      if (statusDateField(newStatus)) {
        setScheduleDialog({ status: newStatus as ScheduleStatus, leadIds: [lead.lead_id], clientName: lead.client_name, reschedule: false });
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
      // Только поля, которые роль может менять: иначе сервер отклоняет все сохранение (403)
      await api.leads.update(updated.lead_id, {
        ...(canEditLeadFields(leadActor, updated)
          ? {
              client_name: updated.client_name,
              phone: updated.phone,
              country_code: updated.country_code,
              instagram: updated.instagram,
            }
          : {}),
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
    if (cancelDialog.leadIds.length === 0 || !cancelReasonCheck.ok) {
      showToast(cancelReasonCheck.ok ? 'Не выбраны лиды' : cancelReasonCheck.message, 'error');
      return;
    }
    // Причина из списка и комментарий — сервер соберет текст причины сам
    const reasonFields = { cancel_reason: cancelDialog.reason.trim(), cancel_reason_code: cancelDialog.reasonCode };

    try {
      if (cancelDialog.leadIds.length === 1) {
        await api.leads.updateStatus(cancelDialog.leadIds[0], 'Отмена', reasonFields);
        showToast('Лид переведен в статус «Отмена»', 'info');
      } else {
        await api.leads.batch({
          lead_ids: cancelDialog.leadIds,
          action: 'change_status',
          status: 'Отмена',
          ...reasonFields,
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

  const handleConfirmSchedule = async (iso: string) => {
    const dialog = scheduleDialog;
    if (!dialog) return;
    const field = dialog.status === 'Встреча' ? 'meeting_at' : 'next_contact_at';
    try {
      if (dialog.leadIds.length === 1) {
        await api.leads.updateStatus(dialog.leadIds[0], dialog.status, { [field]: iso });
      } else {
        await api.leads.batch({ lead_ids: dialog.leadIds, action: 'change_status', status: dialog.status, [field]: iso });
      }
      const verb = dialog.reschedule ? 'перенесен' : dialog.status === 'Встреча' ? 'назначена' : 'запланирован';
      showToast(
        dialog.status === 'Встреча' ? `Встреча ${dialog.reschedule ? 'перенесена' : verb}` : `Звонок ${verb}`,
        'success'
      );
      dialog.onDone?.();
      setScheduleDialog(null);
      // Открытая карточка лида получает новый статус и дату
      setModalState((prev) =>
        prev.selectedLead && dialog.leadIds.includes(prev.selectedLead.lead_id)
          ? { ...prev, selectedLead: { ...prev.selectedLead, status: dialog.status as LeadStatus, [field]: iso } }
          : prev
      );
      await fetchInitialData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось сохранить дату', 'error');
    }
  };

  /** Перенос даты встречи или звонка без смены статуса */
  const openReschedule = React.useCallback(
    (lead: LeadItem) => {
      const status = lead.status as ScheduleStatus;
      const check = canRescheduleLead(leadActor, lead);
      if (!check.ok) {
        showToast(check.reason, 'error');
        return;
      }
      setScheduleDialog({
        status,
        leadIds: [lead.lead_id],
        clientName: lead.client_name,
        reschedule: true,
        initial: status === 'Встреча' ? lead.meeting_at : lead.next_contact_at,
      });
    },
    [leadActor, showToast]
  );

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
          {statusSchemaReady && <option value="today">На сегодня: встречи и звонки</option>}
          {LEAD_STATUSES.filter(statusAvailable).map((status) => (
            <option key={status} value={status}>
              ● {status}
            </option>
          ))}
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

  // Канбан: колонки по статусам воронки или по ответственным; перенос — по тем же правилам, что и в реестре
  const leadsKanban: KanbanConfig<LeadItem> = React.useMemo(() => {
    const statusColumns: KanbanColumn[] = LEAD_STATUSES.filter(statusAvailable).map((status) => {
      const opt = PIPELINE_STATUS_OPTIONS.find((o) => o.value === status);
      return { id: status, label: status, icon: opt?.icon, colorClass: opt?.colorClass, dotColor: opt?.dotColor };
    });

    // Ответственные: «Не назначен», консультанты и сотрудники, которые уже ведут лиды, но не в списке
    const assigneeColumns: KanbanColumn[] = [
      { id: UNASSIGNED_COLUMN, label: 'Не назначен', icon: UserX, colorClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' },
      ...consultants.map((c) => ({
        id: c.user_id,
        label: c.full_name,
        marker: <EmployeeColorDot color={c.color} size="sm" />,
      })),
    ];
    const known = new Set(assigneeColumns.map((c) => c.id));
    for (const lead of leads) {
      if (lead.assigned_to && !known.has(lead.assigned_to)) {
        known.add(lead.assigned_to);
        assigneeColumns.push({
          id: lead.assigned_to,
          label: lead.assigned_user?.full_name || 'Сотрудник',
          marker: <EmployeeColorDot color={lead.assigned_user?.color} size="sm" />,
        });
      }
    }

    const canMove = (row: LeadItem, groupingId: string, columnId: string): true | string => {
      if (groupingId === 'status') {
        if (row.seller_phone) return 'Лид привязан к продавцу: статус меняется только отвязкой';
        if (columnId === LINK_ONLY_STATUS) {
          if (!canLinkSeller) return 'Статус «Подписан» ставится привязкой к продавцу — у вашей роли нет такого права';
          if (row.status === 'Отмена') return 'Отмененный лид нельзя привязать к продавцу';
          return true;
        }
        const check = canChangeLeadStatus(leadActor, row, columnId);
        return check.ok ? true : check.reason;
      }
      if (!canAssignLead(leadActor)) return 'Назначение ответственного не предусмотрено вашей ролью';
      return reassignBlockReason(row) ?? true;
    };

    const onMove = async (row: LeadItem, groupingId: string, columnId: string) => {
      if (groupingId === 'status') {
        // «Подписан» — через окно привязки к продавцу; «Отмена» — через окно причины
        if (columnId === LINK_ONLY_STATUS) {
          setMappingModal({ isOpen: true, lead: row });
          return;
        }
        const changed = await changeLeadStatus(row, columnId);
        if (changed) showToast(`Статус изменен на «${columnId}»`, 'success');
        return;
      }
      const assignedTo = columnId === UNASSIGNED_COLUMN ? null : columnId;
      const res = await api.leads.updateAssigned(row.lead_id, assignedTo);
      setLeads((prev) =>
        prev.map((item) =>
          item.lead_id === row.lead_id
            ? {
                ...item,
                assigned_to: assignedTo,
                status: (res?.status as LeadStatus) || item.status,
                assigned_user: res?.assigned_user ?? null,
              }
            : item
        )
      );
      const name = assigneeColumns.find((c) => c.id === columnId)?.label;
      showToast(assignedTo ? `Ответственный: ${name}` : 'Ответственный снят', 'success');
      getLeadsStats().then(setStats);
    };

    return {
      groupings: [
        { id: 'status', label: 'По статусам', icon: Workflow, columns: statusColumns, getColumnId: (row) => row.status },
        {
          id: 'assigned',
          label: 'По ответственным',
          icon: Users,
          columns: assigneeColumns,
          getColumnId: (row) => row.assigned_to || UNASSIGNED_COLUMN,
        },
      ],
      canMove,
      onMove,
      renderCard: (row, groupingId) => {
        const name = row.client_name?.trim();
        const phone = formatPhoneDisplay(row.phone, row.country_code);
        const statusOpt = PIPELINE_STATUS_OPTIONS.find((o) => o.value === row.status);
        const StatusIcon = statusOpt?.icon;
        return (
          <div className="min-w-0 space-y-2 pr-4">
            <div className="min-w-0">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{name || phone}</div>
              {name && <div className="mt-0.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{phone}</div>}
            </div>
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="min-w-0 overflow-hidden">
                {groupingId === 'status' ? (
                  row.assigned_user ? (
                    <EmployeeBadge name={row.assigned_user.full_name} color={row.assigned_user.color} size="xs" />
                  ) : (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">Не назначен</span>
                  )
                ) : (
                  statusOpt && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusOpt.colorClass}`}>
                      {StatusIcon && <StatusIcon className="w-3 h-3" strokeWidth={2} />}
                      {statusOpt.label}
                    </span>
                  )
                )}
              </div>
              <span className="text-[10px] font-mono text-zinc-400 flex-shrink-0">
                <FormattedDate date={row.created_at} type="date" />
              </span>
            </div>
            {statusDateField(row.status) && (
              <LeadNextStep status={row.status} meeting_at={row.meeting_at} next_contact_at={row.next_contact_at} />
            )}
            {duplicateCount(row) > 0 && (
              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                Дубль номера
              </span>
            )}
            {row.seller_phone && (
              <div className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                <Store className="w-3 h-3" strokeWidth={2} />
                Продавец {formatPhoneDisplay(row.seller_phone)}
              </div>
            )}
          </div>
        );
      },
    };
  }, [consultants, leads, leadActor, canLinkSeller, changeLeadStatus, showToast, duplicateCount, statusAvailable]);

  // Фильтрация лидов по статусу и консультанту
  const filteredLeads = React.useMemo(() => {
    return leads.filter((lead) => {
      if (filterStatus === 'today') {
        if (!isDueToday(lead)) return false;
      } else if (filterStatus !== 'all' && lead.status !== filterStatus) return false;
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
        data-tour="leads-scripts"
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

  // Действия строки: только в контекстном меню DataJournal (ПКМ / «⋯» / карточка)
  const renderCustomRowActions = React.useCallback(
    (row: LeadItem) => {
      const canLinkRow = canLinkSeller && !row.seller_phone && row.status !== 'Отмена';
      const isLinked = Boolean(row.seller_phone);

      return (
        <>
          <JournalMenuItem
            icon={MessageSquareText}
            label="Комментарии"
            tone="info"
            title="История комментариев и новый комментарий"
            onClick={() => openComments(row)}
          />
          {statusDateField(row.status) && canRescheduleLead(leadActor, row).ok && (
            <JournalMenuItem
              icon={row.status === 'Встреча' ? CalendarClock : PhoneCall}
              label={row.status === 'Встреча' ? 'Перенести встречу' : 'Перенести звонок'}
              tone="warning"
              onClick={() => openReschedule(row)}
            />
          )}
          {canLinkRow && (
            <JournalMenuItem
              icon={Link2}
              label="Связать с продавцом"
              tone="purple"
              title="Быстро связать с продавцом платформы"
              onClick={() => handleLinkSeller(row)}
            />
          )}
          {isLinked && (
            <JournalMenuItem
              icon={Store}
              label={`К продавцу ${formatPhoneDisplay(row.seller_phone)}`}
              tone="success"
              title={`Привязан к продавцу ${formatPhoneDisplay(row.seller_phone)}`}
              onClick={() => router.push(`/sellers?search=${encodeURIComponent(row.seller_phone || '')}`)}
            />
          )}
          {canDeleteLeads && (
            <JournalMenuItem
              icon={Trash2}
              label="Удалить навсегда"
              tone="danger"
              title="Удалить лид навсегда"
              onClick={() => setLeadToDelete(row)}
            />
          )}
        </>
      );
    },
    [canLinkSeller, canDeleteLeads, handleLinkSeller, router, openComments, leadActor, openReschedule]
  );

  // Новый комментарий — последний комментарий лида в реестре и открытой карточке
  const handleCommentAdded = React.useCallback((leadId: string, comment: LeadCommentDto) => {
    latestCommentRef.current[leadId] = comment.body;
    setLeads((prev) => prev.map((l) => (l.lead_id === leadId ? { ...l, comment: comment.body } : l)));
  }, []);

  const isAnyModalOpen =
    modalState.isOpen ||
    mappingModal.isOpen ||
    isScriptsOpen ||
    waTarget !== null ||
    commentsTarget !== null ||
    cancelDialog.isOpen ||
    scheduleDialog !== null ||
    leadToDelete !== null;
  // Имя для подстановки {менеджер} в скрипты (заглушка профиля — не имя)
  const scriptManagerName = userName && userName !== 'Сотрудник CRM' ? userName : null;

  // Вкладки воронки продаж для DataJournal
  const leadTabs: DataJournalTab[] = React.useMemo(() => {
    // До миграций 050/051 вкладок новых статусов и «На сегодня» нет
    const ready = (tabs: DataJournalTab[]) => tabs.filter((t) => statusSchemaReady || (t.id !== 'today' && statusAvailable(t.id)));
    if (!canViewAllLeads && currentUserRole === 'consultant') {
      return ready([
        { id: 'all', label: 'Все в работе', count: stats.total, icon: LayoutList },
        { id: 'today', label: 'На сегодня', count: stats.callbackDue + stats.meetingsToday, icon: BellRing },
        { id: 'Назначен', label: 'Назначен', count: stats.assigned, icon: UserCheck },
        { id: 'Встреча', label: 'Встреча', count: stats.meeting, icon: CalendarClock },
        { id: 'Перезвонить', label: 'Перезвонить', count: stats.callback, icon: PhoneCall },
        { id: 'Нет ответа', label: 'Нет ответа', count: stats.noAnswer, icon: PhoneOff },
        { id: 'Подписан', label: 'Подписан', count: stats.signed, icon: BadgeCheck },
        { id: 'Отмена', label: 'Отмена', count: stats.cancelled, icon: XCircle },
      ]);
    }
    return ready([
      { id: 'all', label: 'Все', count: stats.total, icon: LayoutList },
      { id: 'today', label: 'На сегодня', count: stats.callbackDue + stats.meetingsToday, icon: BellRing },
      { id: 'Открыт', label: 'Открыт', count: stats.open, icon: Inbox },
      { id: 'Нет ответа', label: 'Нет ответа', count: stats.noAnswer, icon: PhoneOff },
      { id: 'Обработан', label: 'Обработан', count: stats.processed, icon: CheckCircle2 },
      { id: 'Назначен', label: 'Назначен', count: stats.assigned, icon: UserCheck },
      { id: 'Встреча', label: 'Встреча', count: stats.meeting, icon: CalendarClock },
      { id: 'Перезвонить', label: 'Перезвонить', count: stats.callback, icon: PhoneCall },
      { id: 'Подписан', label: 'Подписан', count: stats.signed, icon: BadgeCheck },
      { id: 'Отмена', label: 'Отмена', count: stats.cancelled, icon: XCircle },
    ]);
  }, [currentUserRole, canViewAllLeads, stats, statusSchemaReady, statusAvailable]);

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
        {!statusSchemaReady && user.isAdmin && (
          <ModalCallout tone="warning">
            Статусы «Нет ответа», «Встреча», «Перезвонить», даты встреч и причины отмены списком включатся после обновления базы: выполните в
            SQL Editor Supabase миграцию 050_lead_statuses_enum.sql, затем отдельным запуском 051_lead_status_dates_and_cancel_reasons.sql.
          </ModalCallout>
        )}

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
                {/* «Подписан» — только привязкой к продавцу */}
                {LEAD_STATUSES.filter((s) => s !== LINK_ONLY_STATUS && statusAvailable(s)).map((status) => (
                  <option key={status} value={status} className="text-zinc-900 bg-white">
                    {status}
                  </option>
                ))}
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
                className="h-8 px-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-semibold border border-rose-500/30 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Удалить выбранные лиды навсегда"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Удалить ({ids.length})</span>
              </button>
            </div>
          )}
          onCreateClick={canCreateLeads ? handleCreateClick : undefined}
          createTooltip="Добавить лид"
          onRefresh={handleRefresh}
          refreshing={isLoading}
          customActions={leadActions}
          customRowActions={renderCustomRowActions}
          onWhatsApp={canOpenScripts ? openWhatsApp : undefined}
          getRowTone={getLeadRowTone}
          onRowClick={handleRowClick}
          onStatusChange={handleStatusChangeInJournal}
          getStatusOptions={getLeadStatusOptions}
          totalCount={filteredLeads.length}
          kanban={leadsKanban}
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
            onWhatsApp={canOpenScripts ? openWhatsApp : undefined}
            onFormChange={handleLeadFormChange}
            fieldWarnings={{ phone: hasDuplicates(phoneDuplicates.result) }}
            renderFieldExtra={(fieldName) =>
              fieldName === 'phone' ? (
                <PhoneDuplicateNotice
                  result={phoneDuplicates.result}
                  loading={phoneDuplicates.loading}
                  onOpenLead={(leadId) => {
                    const found = leads.find((l) => l.lead_id === leadId);
                    if (found) handleRowClick(found);
                    else showToast('Лид не найден в текущем списке', 'info');
                  }}
                />
              ) : null
            }
            headerActions={(lead) => (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300"
                  leftIcon={<MessageSquareText className="w-3.5 h-3.5" strokeWidth={1.75} />}
                  onClick={() => openComments(lead)}
                  title="История комментариев и новый комментарий"
                  data-tour="lead-comment-button"
                >
                  Комментарий
                </Button>
                {statusDateField(lead.status) && canRescheduleLead(leadActor, lead).ok && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="bg-orange-500/10 hover:bg-orange-500/20 text-orange-700 dark:text-orange-300"
                    leftIcon={
                      lead.status === 'Встреча' ? (
                        <CalendarClock className="w-3.5 h-3.5" strokeWidth={1.75} />
                      ) : (
                        <PhoneCall className="w-3.5 h-3.5" strokeWidth={1.75} />
                      )
                    }
                    onClick={() => openReschedule(lead)}
                  >
                    {lead.status === 'Встреча' ? 'Перенести встречу' : 'Перенести звонок'}
                  </Button>
                )}
              </>
            )}
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
            managerName={scriptManagerName}
          />
        )}

        {/* История комментариев лида и новый комментарий */}
        {commentsTarget && (
          <LeadCommentsModal target={commentsTarget} onClose={() => setCommentsTarget(null)} onAdded={handleCommentAdded} />
        )}

        {/* WhatsApp: открыть чат без текста или с выбранным скриптом */}
        {waTarget && (
          <WhatsAppScriptModal target={waTarget} onClose={() => setWaTarget(null)} managerName={scriptManagerName} />
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
          confirmDisabled={!cancelReasonCheck.ok}
          level={2}
          description={
            user.can('leads.rollback')
              ? 'Вернуть лид из статуса «Отмена» может сотрудник с правом отката статуса.'
              : 'После отмены вернуть лид в работу сможет только сотрудник с правом отката статуса.'
          }
        >
          <CancelReasonPicker
            code={cancelDialog.reasonCode}
            comment={cancelDialog.reason}
            onChange={({ code, comment }) => setCancelDialog((prev) => ({ ...prev, reasonCode: code, reason: comment }))}
          />
        </ConfirmDialog>

        {/* 6б. Дата встречи / следующего контакта и перенос даты */}
        <LeadScheduleDialog state={scheduleDialog} onClose={() => setScheduleDialog(null)} onConfirm={handleConfirmSchedule} />

        {/* 7. Модальное окно ручного связывания Лид -> Продавец */}
        {mappingModal.isOpen && (
          <LeadSellerMappingModal
            isOpen={mappingModal.isOpen}
            onClose={() => setMappingModal({ isOpen: false, lead: null })}
            lead={mappingModal.lead}
            currentUserId={currentUserId}
            employees={consultants.map((c) => ({ user_id: c.user_id, full_name: c.full_name, login: c.login, role: c.role, color: c.color ?? null }))}
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

