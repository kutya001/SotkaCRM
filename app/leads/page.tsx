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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { LeadStatus, UserRole } from '@/types/database.types';

function LeadsContent() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();

  const [leads, setLeads] = React.useState<LeadItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>('consultant');
  const [userName, setUserName] = React.useState('Сотрудник CRM');
  const [userLogin, setUserLogin] = React.useState('user');

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
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('user_id, role, full_name, login')
          .eq('auth_id', user.id)
          .single();
        if (profile) {
          setCurrentUserId(profile.user_id);
          setCurrentUserRole(profile.role);
          setUserName(profile.full_name);
          setUserLogin(profile.login);
        }
      }
    });

    fetchInitialData();
  }, [fetchInitialData]);

  // Автоматическое открытие формы создания при переходе по ?action=create (кнопка FAB)
  React.useEffect(() => {
    if (searchParams.get('action') === 'create') {
      setModalState({
        isOpen: true,
        mode: 'create',
        selectedLead: null,
      });
    }
  }, [searchParams]);

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
      width: 170,
      minWidth: 140,
      sortable: true,
      filterable: true,
      renderCell: (row) => {
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

  // Конфигурация полей EntityModal
  const entityFields: EntityFieldConfig<LeadItem>[] = [
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
      placeholder: 'Например: Айбек (Магазин Береке)',
    },
    {
      name: 'phone',
      label: 'Номер телефона',
      type: 'phone',
      required: true,
      placeholder: '555123456 (без кода или полный)',
      helperText: 'Номер абонента без пробелов и тире',
    },
    {
      name: 'country_code',
      label: 'Код страны',
      placeholder: '996',
      required: true,
    },
    {
      name: 'instagram',
      label: 'Instagram аккаунт',
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
      options: [
        { value: '', label: '— Не назначен —' },
        ...consultants.map((c) => ({
          value: c.user_id,
          label: `${c.full_name} (${c.role})`,
        })),
      ],
    },
    {
      name: 'comment',
      label: 'Комментарий и история контакта',
      type: 'textarea',
      placeholder: 'Заметки по клиенту, детали разговора, пожелания...',
    },
  ];

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
      selectedLead: null,
    });
  };

  const handleStatusChangeInJournal = async (lead: LeadItem, newStatus: string) => {
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
      showToast(res.error || 'Ошибка при сохранении лида', 'error');
      throw new Error(res.error);
    }

    await fetchInitialData();
  };

  const handleCreateLead = async (newLeadData: Partial<LeadItem>) => {
    if (!newLeadData.client_name || !newLeadData.phone) {
      showToast('Заполните имя клиента и номер телефона', 'error');
      throw new Error('Заполните имя клиента и номер телефона');
    }

    const res = await createLead({
      client_name: newLeadData.client_name,
      phone: newLeadData.phone,
      country_code: newLeadData.country_code || '996',
      instagram: newLeadData.instagram || undefined,
      comment: newLeadData.comment || undefined,
      assigned_to:
        newLeadData.assigned_to && newLeadData.assigned_to.trim() !== ''
          ? newLeadData.assigned_to
          : null,
    });

    if (!res.success) {
      showToast(res.error || 'Ошибка создания лида', 'error');
      throw new Error(res.error);
    }

    await fetchInitialData();
  };

  const handleStatusChangeInModal = async (newStatus: string) => {
    if (!modalState.selectedLead) return;
    const res = await updateLeadStatus(modalState.selectedLead.lead_id, newStatus as LeadStatus);
    if (!res.success) {
      showToast(res.error || 'Ошибка при смене статуса', 'error');
      throw new Error(res.error);
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

  return (
    <AppLayout
      userRole={currentUserRole}
      userName={userName}
      userLogin={userLogin}
    >
      <div className="space-y-6">
        {/* 1. Верхний информационный блок: KPI воронки и вызов скриптов */}
        <div className="p-5 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                Входящие заявки (Лиды)
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 text-xs font-semibold border border-blue-500/30">
                {stats.total} заявок
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Реестр потенциальных клиентов, ведение воронки и коммуникация с продавцами
            </p>
          </div>

          <div className="flex items-center gap-2.5 w-full lg:w-auto justify-between lg:justify-end">
            {/* Кнопка открытия базы скриптов */}
            <button
              onClick={() => setIsScriptsOpen(true)}
              className="h-10 px-4 rounded-2xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50"
            >
              <BookOpen className="w-4 h-4 text-purple-500" strokeWidth={1.75} />
              <span>Скрипты продаж</span>
            </button>

            {/* Кнопка создания лида */}
            <button
              onClick={handleCreateClick}
              className="h-10 px-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold flex items-center gap-2 shadow-md transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} />
              <span>Добавить лид</span>
            </button>
          </div>
        </div>

        {/* 2. KPI воронки продаж (Apple Island таблетки) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3.5 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Всего в базе</span>
            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{stats.total}</p>
          </div>
          <div className="p-3.5 rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">Открыт</span>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{stats.open}</p>
          </div>
          <div className="p-3.5 rounded-2xl backdrop-blur-xl bg-purple-500/10 dark:bg-purple-500/5 border border-purple-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold">Обработан</span>
            <p className="text-xl font-bold text-purple-700 dark:text-purple-300">{stats.processed}</p>
          </div>
          <div className="p-3.5 rounded-2xl backdrop-blur-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">Назначен</span>
            <p className="text-xl font-bold text-amber-700 dark:text-amber-300">{stats.assigned}</p>
          </div>
          <div className="p-3.5 rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Подписан</span>
            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{stats.signed}</p>
          </div>
          <div className="p-3.5 rounded-2xl backdrop-blur-xl bg-rose-500/10 dark:bg-rose-500/5 border border-rose-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">Отмена</span>
            <p className="text-xl font-bold text-rose-700 dark:text-rose-300">{stats.cancelled}</p>
          </div>
        </div>

        {/* 3. Полиморфный реестр заявок DataJournal */}
        <DataJournal<LeadItem>
          data={leads}
          columns={columns}
          keyField="lead_id"
          storageKey="leads_live"
          title="Реестр лидов"
          subtitle="Синхронизировано с базой данных PostgreSQL"
          searchPlaceholder="Поиск по клиенту, номеру телефона или заметке..."
          onRowClick={handleRowClick}
          onStatusChange={handleStatusChangeInJournal}
          onCreateClick={handleCreateClick}
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
          statusOptions={PIPELINE_STATUS_OPTIONS}
          onSave={handleSaveLead}
          onCreate={handleCreateLead}
          onStatusChange={handleStatusChangeInModal}
          onLinkSeller={handleLinkSeller}
        />

        {/* 5. Шторка базы знаний скриптов продаж */}
        <SalesScriptsSheet
          isOpen={isScriptsOpen}
          onClose={() => setIsScriptsOpen(false)}
        />

        {/* 6. Диалог отмены сделки с указанием причины */}
        {cancelDialog.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
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

