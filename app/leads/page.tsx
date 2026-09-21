'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef, PIPELINE_STATUS_OPTIONS } from '@/components/ui/DataJournal';
import { EntityModal, type EntityFieldConfig } from '@/components/ui/EntityModal';
import { SalesScriptsSheet } from '@/components/leads/SalesScriptsSheet';
import { LeadSellerMappingModal } from '@/components/leads/LeadSellerMappingModal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import {
  getLeads,
  createLead,
  updateLead,
  updateLeadStatus,
  cancelLead,
  getConsultantsList,
  getLeadsStats,
  assignLeadConsultant,
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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/components/auth/AuthProvider';
import type { LeadStatus, UserRole } from '@/types/database.types';

function LeadsContent() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const user = useUser();

  const [leads, setLeads] = React.useState<LeadItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>(user.role);
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
    { user_id: string; full_name: string; role: string; login: string }[]
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

  // Диалог отмены лида с причиной
  const [cancelDialog, setCancelDialog] = React.useState<{
    isOpen: boolean;
    leadId: string | null;
    clientName: string;
    reason: string;
  }>({
    isOpen: false,
    leadId: null,
    clientName: '',
    reason: '',
  });

  // Состояние модального окна связывания «Лид -> Продавец»
  const [currentUserId, setCurrentUserId] = React.useState<string>('');
  const [mappingModal, setMappingModal] = React.useState<{
    isOpen: boolean;
    lead: LeadItem | null;
  }>({
    isOpen: false,
    lead: null,
  });

  // Загрузка начальных данных и профиля
  const fetchInitialData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [leadsRes, statsRes, consultantsRes] = await Promise.all([
        getLeads({ page: 1, pageSize: 100 }),
        getLeadsStats(),
        getConsultantsList(),
      ]);

      setLeads(leadsRes.leads);
      setTotalCount(leadsRes.totalCount);
      setStats(statsRes);
      setConsultants(consultantsRes);

      if (leadsRes.currentUserRole) {
        setCurrentUserRole(leadsRes.currentUserRole as UserRole);
      }
    } catch (err) {
      console.error(err);
      showToast('Ошибка при загрузке лидов', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

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
    if (currentUserRole === 'consultant') {
      return currentUserId;
    }
    const currentInList = consultants.find((c) => c.user_id === currentUserId);
    if (currentInList) {
      return currentInList.user_id;
    }
    return consultants[0]?.user_id || '';
  }, [currentUserRole, currentUserId, consultants]);

  // Автоматическое открытие формы создания при переходе по ?action=create (кнопка FAB)
  React.useEffect(() => {
    if (searchParams.get('action') === 'create') {
      setModalState({
        isOpen: true,
        mode: 'create',
        selectedLead: {
          assigned_to: defaultConsultantId,
          status: 'Открыт',
        } as any,
      });
    }
  }, [searchParams, defaultConsultantId]);

  // Конфигурация колонок DataJournal
  const columns: ColumnDef<LeadItem>[] = [
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
      phoneAccessor: (row) => `+${row.country_code || '996'} ${row.phone}`,
      renderCell: (row) => {
        const fullPhone = `+${row.country_code || '996'} ${row.phone}`;
        return (
          <span className="font-mono text-zinc-800 dark:text-zinc-200">
            {fullPhone}
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
      statusOptions: PIPELINE_STATUS_OPTIONS,
    },
    {
      key: 'assigned_to',
      label: 'Ответственный',
      width: 180,
      minWidth: 150,
      sortable: true,
      filterable: true,
      renderCell: (row) => {
        if (currentUserRole === 'admin') {
          const isUnassigned = !row.assigned_to;
          return (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <select
                value={row.assigned_to || ''}
                onChange={async (e) => {
                  const newConsultantId = e.target.value;
                  if (!newConsultantId) return;
                  try {
                    const res = await assignLeadConsultant(row.lead_id, newConsultantId);
                    if (res.success) {
                      showToast('Консультант назначен', 'success');
                      fetchInitialData();
                    } else {
                      showToast(res.error || 'Ошибка назначения', 'error');
                    }
                  } catch {
                    showToast('Ошибка при назначении консультанта', 'error');
                  }
                }}
                className={`h-7 px-2 text-xs font-semibold rounded-lg shadow-sm focus:outline-none cursor-pointer transition-all ${
                  isUnassigned
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 hover:bg-amber-500/25 ring-1 ring-amber-500/20'
                    : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 focus:ring-1 focus:ring-blue-500'
                }`}
              >
                <option value="" disabled>
                  + Назначить сотрудника
                </option>
                {consultants.map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </div>
          );
        }
        if (!row.assigned_user) {
          return (
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800/60 px-2 py-0.5 rounded-md">
              Не назначен
            </span>
          );
        }
        return (
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 text-[10px] font-bold flex items-center justify-center">
              {row.assigned_user.full_name.charAt(0)}
            </div>
            <span className="text-xs font-medium truncate">
              {row.assigned_user.full_name}
            </span>
          </div>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Поступил',
      width: 140,
      minWidth: 120,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="text-zinc-500 dark:text-zinc-400 font-mono text-[11px]">
          <FormattedDate date={row.created_at} type="shortDateTime" />
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
  ];

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
        immutable: true,
        isSystem: true,
      },
      {
        name: 'client_name',
        label: 'Имя клиента или название точки',
        required: true,
        immutable: currentUserRole === 'consultant',
        placeholder: 'Например: Айбек (Магазин Береке)',
      },
      {
        name: 'phone',
        label: 'Номер телефона',
        type: 'phone',
        required: true,
        immutable: currentUserRole === 'consultant',
        placeholder: '700123456 (без кода страны)',
        helperText: 'Номер абонента без пробелов и тире (код страны слева)',
      },
      {
        name: 'instagram',
        label: 'Instagram аккаунт',
        immutable: currentUserRole === 'consultant',
        placeholder: '@username или ссылка',
      },
      {
        name: 'status',
        label: 'Этап воронки',
        type: 'status',
        required: true,
      },
      {
        name: 'assigned_to',
        label: 'Ответственный консультант',
        type: 'select',
        disabled: currentUserRole !== 'admin',
        immutable: currentUserRole === 'consultant',
        isSystem: currentUserRole === 'smm',
        defaultValue: currentUserRole === 'consultant' ? currentUserId : '',
        helperText:
          currentUserRole === 'consultant'
            ? 'Лид закреплен за вами'
            : currentUserRole === 'smm'
            ? 'Куратор назначается администратором'
            : undefined,
        options:
          currentUserRole === 'consultant'
            ? [
                {
                  value: currentUserId,
                  label: `${userName || 'Текущий сотрудник'} (Консультант)`,
                },
              ]
            : [
                { value: '', label: '— Не назначен —' },
                ...consultants.map((c) => ({
                  value: c.user_id,
                  label: `${c.full_name} (${c.role === 'admin' ? 'Администратор' : 'Консультант'})`,
                })),
              ],
      },
      {
        name: 'comment',
        label: 'Комментарий и история контакта',
        type: 'textarea',
        placeholder: 'Заметки по клиенту, детали разговора, пожелания...',
      },
    ],
    [consultants, currentUserRole, currentUserId, userName]
  );

  // Права на редактирование текущего лида в EntityModal
  const canEditCurrentLead = React.useMemo(() => {
    if (currentUserRole === 'admin') return true;
    if (currentUserRole === 'consultant') {
      return (
        modalState.selectedLead?.assigned_to === currentUserId &&
        ['Назначен', 'Подписан', 'Отмена'].includes(modalState.selectedLead?.status || '')
      );
    }
    if (currentUserRole === 'smm') {
      return ['Открыт', 'Обработан'].includes(modalState.selectedLead?.status || '');
    }
    return false;
  }, [currentUserRole, currentUserId, modalState.selectedLead]);

  // Доступные статусы воронки по ролям
  const roleStatusOptions = React.useMemo(() => {
    if (currentUserRole === 'smm') {
      return PIPELINE_STATUS_OPTIONS.filter((s) => ['Открыт', 'Обработан'].includes(s.value));
    }
    if (currentUserRole === 'consultant') {
      return PIPELINE_STATUS_OPTIONS.filter((s) =>
        ['Назначен', 'Подписан', 'Отмена'].includes(s.value)
      );
    }
    return PIPELINE_STATUS_OPTIONS;
  }, [currentUserRole]);

  // Обработчики строк DataJournal
  const handleRowClick = (lead: LeadItem) => {
    setModalState({
      isOpen: true,
      mode: 'view',
      selectedLead: lead,
    });
  };

  const handleCreateClick = () => {
    setModalState({
      isOpen: true,
      mode: 'create',
      selectedLead: {
        assigned_to: currentUserRole === 'consultant' ? currentUserId : null,
        status: 'Открыт',
      } as any,
    });
  };

  const handleStatusChangeInJournal = async (lead: LeadItem, newStatus: string) => {
    if (currentUserRole === 'smm' && !['Открыт', 'Обработан'].includes(newStatus)) {
      showToast('SMM-специалисту доступен перевод только между статусами «Открыт» и «Обработан»', 'error');
      return;
    }
    if (currentUserRole === 'consultant' && !['Назначен', 'Подписан', 'Отмена'].includes(newStatus)) {
      showToast('Консультанту доступны только статусы «Назначен», «Подписан» или «Отмена»', 'error');
      return;
    }
    const res = await updateLeadStatus(lead.lead_id, newStatus as LeadStatus);
    if (!res.success) {
      showToast(res.error || 'Ошибка при обновлении статуса лида', 'error');
      return;
    }
    setLeads((prev) =>
      prev.map((item) =>
        item.lead_id === lead.lead_id
          ? { ...item, status: newStatus as LeadStatus }
          : item
      )
    );
    getLeadsStats().then(setStats);
  };

  // Обработчики формы EntityModal
  const handleSaveLead = async (updated: LeadItem) => {
    const res = await updateLead(updated.lead_id, {
      client_name: updated.client_name,
      phone: updated.phone,
      country_code: updated.country_code,
      instagram: updated.instagram,
      comment: updated.comment,
      assigned_to: updated.assigned_to,
      status: updated.status,
    });

    if (!res.success) {
      throw new Error(res.error || 'Ошибка при сохранении лида');
    }

    await fetchInitialData();
  };

  const handleCreateLead = async (newLeadData: Partial<LeadItem>) => {
    if (!newLeadData.client_name || !newLeadData.phone) {
      throw new Error('Заполните имя клиента и номер телефона');
    }

    const assignedConsultant =
      currentUserRole === 'consultant'
        ? currentUserId
        : currentUserRole === 'smm'
        ? null
        : newLeadData.assigned_to || null;

    const res = await createLead({
      client_name: newLeadData.client_name,
      phone: newLeadData.phone,
      country_code: newLeadData.country_code || '996',
      instagram: newLeadData.instagram || undefined,
      comment: newLeadData.comment || undefined,
      assigned_to: assignedConsultant,
    });

    if (!res.success) {
      throw new Error(res.error || 'Ошибка создания лида');
    }

    await fetchInitialData();
  };

  const handleStatusChangeInModal = async (newStatus: string) => {
    if (!modalState.selectedLead) return;
    const res = await updateLeadStatus(modalState.selectedLead.lead_id, newStatus as LeadStatus);
    if (!res.success) {
      throw new Error(res.error || 'Ошибка при смене статуса');
    }
    await fetchInitialData();
  };

  const handleOpenCancelDialog = (lead: LeadItem) => {
    setCancelDialog({
      isOpen: true,
      leadId: lead.lead_id,
      clientName: lead.client_name,
      reason: '',
    });
  };

  const handleConfirmCancelLead = async () => {
    if (!cancelDialog.leadId || !cancelDialog.reason.trim()) {
      showToast('Укажите причину отмены сделки', 'error');
      return;
    }

    const res = await cancelLead(cancelDialog.leadId, cancelDialog.reason.trim());
    if (!res.success) {
      showToast(res.error || 'Ошибка при отмене сделки', 'error');
      return;
    }

    showToast('Лид переведен в статус «Отмена»', 'info');
    setCancelDialog({ isOpen: false, leadId: null, clientName: '', reason: '' });
    setModalState((prev) => ({ ...prev, isOpen: false }));
    await fetchInitialData();
  };

  const handleLinkSeller = (lead: LeadItem) => {
    if (lead.seller_phone) {
      showToast(`Лид уже привязан к продавцу +${lead.seller_phone}`, 'info');
      return;
    }
    if (currentUserRole === 'smm') {
      showToast('Привязка продавцов доступна только администраторам и консультантам', 'error');
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
          <option value="Открыт">Открыт</option>
          <option value="Обработан">Обработан</option>
          <option value="Назначен">Назначен</option>
          <option value="Подписан">Подписан</option>
          <option value="Отмена">Отмена</option>
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
          <option value="unassigned">Без куратора</option>
          {consultants.map((c) => (
            <option key={c.user_id} value={c.user_id}>
              {c.full_name}
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
    <div className="flex items-center gap-2">
      {/* Кнопка открытия базы скриптов */}
      <button
        type="button"
        onClick={() => setIsScriptsOpen(true)}
        className="min-h-[44px] h-11 px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive"
        title="Скрипты продаж"
        aria-label="Скрипты продаж"
      >
        <BookOpen className="w-4 h-4 text-purple-500 flex-shrink-0" strokeWidth={1.75} />
        <span className="hidden sm:inline">Скрипты продаж</span>
      </button>
    </div>
  );

  // Быстрые действия в строках таблицы и карточках DataJournal
  const renderCustomRowActions = React.useCallback(
    (row: LeadItem) => {
      if (currentUserRole === 'smm') return null;

      if (!row.seller_phone && row.status !== 'Отмена') {
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleLinkSeller(row);
            }}
            className="p-1.5 rounded-lg text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 bg-purple-500/10 border border-purple-500/20 transition-all active:scale-95 flex items-center gap-1"
            title="Быстро связать с продавцом платформы"
          >
            <Link2 className="w-3.5 h-3.5" strokeWidth={2} />
            <span className="hidden xl:inline text-[11px] font-semibold">Связать</span>
          </button>
        );
      }

      if (row.seller_phone) {
        return (
          <span
            className="p-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono flex items-center gap-1"
            title={`Привязан к продавцу +${row.seller_phone}`}
          >
            <Store className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span className="hidden xl:inline font-semibold">Связан</span>
          </span>
        );
      }

      return null;
    },
    [currentUserRole, handleLinkSeller]
  );

  const isAnyModalOpen =
    modalState.isOpen || mappingModal.isOpen || isScriptsOpen || cancelDialog.isOpen;

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
      onCreateClick={handleCreateClick}
      createTooltip="Добавить лид"
      hideFab={isAnyModalOpen}
    >
      <div className="space-y-4">
        {/* ЯРУС 2: KPI воронки продаж (Адаптивная сетка под роль пользователя) */}
        {currentUserRole === 'consultant' ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            {/* Всего в работе */}
            <button
              type="button"
              onClick={() => setFilterStatus('all')}
              className={`text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl backdrop-blur-xl border shadow-sm transition-all active:scale-95 flex flex-col justify-between ${
                filterStatus === 'all'
                  ? 'bg-white/95 dark:bg-zinc-800/90 border-zinc-400 dark:border-zinc-500 shadow-md ring-2 ring-zinc-500/20'
                  : 'bg-white/75 dark:bg-zinc-900/75 border-white/20 dark:border-zinc-800/40 hover:bg-white/90 dark:hover:bg-zinc-800/60'
              }`}
              title="Показать все лиды в работе"
            >
              <span className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 font-medium truncate block w-full">
                Всего в работе
              </span>
              <p className="text-base sm:text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">
                {stats.total}
              </p>
            </button>

            {/* Назначен */}
            <button
              type="button"
              onClick={() => setFilterStatus(filterStatus === 'Назначен' ? 'all' : 'Назначен')}
              className={`text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl backdrop-blur-xl border shadow-sm transition-all active:scale-95 flex flex-col justify-between ${
                filterStatus === 'Назначен'
                  ? 'bg-amber-500/20 dark:bg-amber-500/25 border-amber-500/50 shadow-md ring-2 ring-amber-500/30'
                  : 'bg-amber-500/10 dark:bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/15'
              }`}
              title="Фильтровать по статусу «Назначен»"
            >
              <span className="text-[10px] sm:text-[11px] text-amber-600 dark:text-amber-400 font-semibold truncate block w-full">
                Назначен
              </span>
              <p className="text-base sm:text-xl font-bold font-mono text-amber-700 dark:text-amber-300 mt-0.5">
                {stats.assigned}
              </p>
            </button>

            {/* Подписан */}
            <button
              type="button"
              onClick={() => setFilterStatus(filterStatus === 'Подписан' ? 'all' : 'Подписан')}
              className={`text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl backdrop-blur-xl border shadow-sm transition-all active:scale-95 flex flex-col justify-between ${
                filterStatus === 'Подписан'
                  ? 'bg-emerald-500/20 dark:bg-emerald-500/25 border-emerald-500/50 shadow-md ring-2 ring-emerald-500/30'
                  : 'bg-emerald-500/10 dark:bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/15'
              }`}
              title="Фильтровать по статусу «Подписан»"
            >
              <span className="text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold truncate block w-full">
                Подписан
              </span>
              <p className="text-base sm:text-xl font-bold font-mono text-emerald-700 dark:text-emerald-300 mt-0.5">
                {stats.signed}
              </p>
            </button>

            {/* Отмена */}
            <button
              type="button"
              onClick={() => setFilterStatus(filterStatus === 'Отмена' ? 'all' : 'Отмена')}
              className={`text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl backdrop-blur-xl border shadow-sm transition-all active:scale-95 flex flex-col justify-between ${
                filterStatus === 'Отмена'
                  ? 'bg-rose-500/20 dark:bg-rose-500/25 border-rose-500/50 shadow-md ring-2 ring-rose-500/30'
                  : 'bg-rose-500/10 dark:bg-rose-500/5 border-rose-500/20 hover:bg-rose-500/15'
              }`}
              title="Фильтровать по статусу «Отмена»"
            >
              <span className="text-[10px] sm:text-[11px] text-rose-600 dark:text-rose-400 font-semibold truncate block w-full">
                Отмена
              </span>
              <p className="text-base sm:text-xl font-bold font-mono text-rose-700 dark:text-rose-300 mt-0.5">
                {stats.cancelled}
              </p>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
            {/* Всего в базе */}
            <button
              type="button"
              onClick={() => setFilterStatus('all')}
              className={`text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl backdrop-blur-xl border shadow-sm transition-all active:scale-95 flex flex-col justify-between ${
                filterStatus === 'all'
                  ? 'bg-white/95 dark:bg-zinc-800/90 border-zinc-400 dark:border-zinc-500 shadow-md ring-2 ring-zinc-500/20'
                  : 'bg-white/75 dark:bg-zinc-900/75 border-white/20 dark:border-zinc-800/40 hover:bg-white/90 dark:hover:bg-zinc-800/60'
              }`}
              title="Показать все лиды"
            >
              <span className="text-[10px] sm:text-[11px] text-zinc-500 dark:text-zinc-400 font-medium truncate block w-full">
                Всего в базе
              </span>
              <p className="text-base sm:text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">
                {stats.total}
              </p>
            </button>

            {/* Открыт */}
            <button
              type="button"
              onClick={() => setFilterStatus(filterStatus === 'Открыт' ? 'all' : 'Открыт')}
              className={`text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl backdrop-blur-xl border shadow-sm transition-all active:scale-95 flex flex-col justify-between ${
                filterStatus === 'Открыт'
                  ? 'bg-blue-500/20 dark:bg-blue-500/25 border-blue-500/50 shadow-md ring-2 ring-blue-500/30'
                  : 'bg-blue-500/10 dark:bg-blue-500/5 border-blue-500/20 hover:bg-blue-500/15'
              }`}
              title="Фильтровать по статусу «Открыт»"
            >
              <span className="text-[10px] sm:text-[11px] text-blue-600 dark:text-blue-400 font-semibold truncate block w-full">
                Открыт
              </span>
              <p className="text-base sm:text-xl font-bold font-mono text-blue-700 dark:text-blue-300 mt-0.5">
                {stats.open}
              </p>
            </button>

            {/* Обработан */}
            <button
              type="button"
              onClick={() => setFilterStatus(filterStatus === 'Обработан' ? 'all' : 'Обработан')}
              className={`text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl backdrop-blur-xl border shadow-sm transition-all active:scale-95 flex flex-col justify-between ${
                filterStatus === 'Обработан'
                  ? 'bg-purple-500/20 dark:bg-purple-500/25 border-purple-500/50 shadow-md ring-2 ring-purple-500/30'
                  : 'bg-purple-500/10 dark:bg-purple-500/5 border-purple-500/20 hover:bg-purple-500/15'
              }`}
              title="Фильтровать по статусу «Обработан»"
            >
              <span className="text-[10px] sm:text-[11px] text-purple-600 dark:text-purple-400 font-semibold truncate block w-full">
                Обработан
              </span>
              <p className="text-base sm:text-xl font-bold font-mono text-purple-700 dark:text-purple-300 mt-0.5">
                {stats.processed}
              </p>
            </button>

            {/* Назначен */}
            <button
              type="button"
              onClick={() => setFilterStatus(filterStatus === 'Назначен' ? 'all' : 'Назначен')}
              className={`text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl backdrop-blur-xl border shadow-sm transition-all active:scale-95 flex flex-col justify-between ${
                filterStatus === 'Назначен'
                  ? 'bg-amber-500/20 dark:bg-amber-500/25 border-amber-500/50 shadow-md ring-2 ring-amber-500/30'
                  : 'bg-amber-500/10 dark:bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/15'
              }`}
              title="Фильтровать по статусу «Назначен»"
            >
              <span className="text-[10px] sm:text-[11px] text-amber-600 dark:text-amber-400 font-semibold truncate block w-full">
                Назначен
              </span>
              <p className="text-base sm:text-xl font-bold font-mono text-amber-700 dark:text-amber-300 mt-0.5">
                {stats.assigned}
              </p>
            </button>

            {/* Подписан */}
            <button
              type="button"
              onClick={() => setFilterStatus(filterStatus === 'Подписан' ? 'all' : 'Подписан')}
              className={`text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl backdrop-blur-xl border shadow-sm transition-all active:scale-95 flex flex-col justify-between ${
                filterStatus === 'Подписан'
                  ? 'bg-emerald-500/20 dark:bg-emerald-500/25 border-emerald-500/50 shadow-md ring-2 ring-emerald-500/30'
                  : 'bg-emerald-500/10 dark:bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/15'
              }`}
              title="Фильтровать по статусу «Подписан»"
            >
              <span className="text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold truncate block w-full">
                Подписан
              </span>
              <p className="text-base sm:text-xl font-bold font-mono text-emerald-700 dark:text-emerald-300 mt-0.5">
                {stats.signed}
              </p>
            </button>

            {/* Отмена */}
            <button
              type="button"
              onClick={() => setFilterStatus(filterStatus === 'Отмена' ? 'all' : 'Отмена')}
              className={`text-left p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl backdrop-blur-xl border shadow-sm transition-all active:scale-95 flex flex-col justify-between ${
                filterStatus === 'Отмена'
                  ? 'bg-rose-500/20 dark:bg-rose-500/25 border-rose-500/50 shadow-md ring-2 ring-rose-500/30'
                  : 'bg-rose-500/10 dark:bg-rose-500/5 border-rose-500/20 hover:bg-rose-500/15'
              }`}
              title="Фильтровать по статусу «Отмена»"
            >
              <span className="text-[10px] sm:text-[11px] text-rose-600 dark:text-rose-400 font-semibold truncate block w-full">
                Отмена
              </span>
              <p className="text-base sm:text-xl font-bold font-mono text-rose-700 dark:text-rose-300 mt-0.5">
                {stats.cancelled}
              </p>
            </button>
          </div>
        )}

        {/* ЯРУС 3: Полиморфный реестр заявок DataJournal */}
        <DataJournal<LeadItem>
          data={filteredLeads}
          columns={columns}
          keyField="lead_id"
          storageKey="leads_live"
          externalSearchQuery={searchQuery}
          customActions={leadActions}
          customRowActions={renderCustomRowActions}
          onRowClick={handleRowClick}
          onStatusChange={handleStatusChangeInJournal}
          totalCount={totalCount}
        />

        {/* 4. Единая гибридная форма сущности EntityModal */}
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
          statusOptions={roleStatusOptions}
          onSave={canEditCurrentLead ? handleSaveLead : undefined}
          onCreate={handleCreateLead}
          onStatusChange={canEditCurrentLead ? handleStatusChangeInModal : undefined}
          onLinkSeller={handleLinkSeller}
          createSubmitLabel="Сохранить запись"
        />

        {/* 5. Шторка базы знаний скриптов продаж */}
        <SalesScriptsSheet
          isOpen={isScriptsOpen}
          onClose={() => setIsScriptsOpen(false)}
        />

        {/* 6. Диалог отмены сделки с указанием причины */}
        {cancelDialog.isOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 text-rose-500">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/10 flex items-center justify-center">
                  <Ban className="w-5 h-5" strokeWidth={2} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    Отмена сделки
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {cancelDialog.clientName}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Укажите причину отмены (обязательно):
                </label>
                <textarea
                  value={cancelDialog.reason}
                  onChange={(e) =>
                    setCancelDialog((prev) => ({ ...prev, reason: e.target.value }))
                  }
                  rows={3}
                  placeholder="Например: Высокая цена, закрылся бизнес, выбрал другое решение..."
                  className="w-full px-3 py-2 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() =>
                    setCancelDialog({ isOpen: false, leadId: null, clientName: '', reason: '' })
                  }
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancelLead}
                  disabled={!cancelDialog.reason.trim()}
                  className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-md transition-all disabled:opacity-50"
                >
                  Подтвердить отмену
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 7. Модальное окно ручного связывания Лид -> Продавец */}
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

