'use client';

import * as React from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, JournalMenuItem, type ColumnDef } from '@/components/ui/DataJournal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { formatDateOnly } from '@/lib/utils/format';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api/client';
import {
  getPlanHistory,
  getPlanPrices,
  upsertPlanPrice,
  deletePlanPrice,
  type PlanItem,
  type PlanHistoryItem,
  type PlanPriceItem,
} from './actions';
import {
  Plus,
  History,
  Tag,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Trash2,
  Calendar,
  Archive,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog, useConfirm } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Textarea } from '@/components/ui/Field';
import { useUser } from '@/components/auth/AuthProvider';
import type { UserRole } from '@/types/database.types';

const PLAN_FORM_ID = 'plan-edit-form';

export default function PlansPage() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const user = useUser();

  const [plans, setPlans] = React.useState<PlanItem[]>([]);
  // Массовые действия
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [isBatchLoading, setIsBatchLoading] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>(user.role);
  const canManagePlans = user.can('plans.manage');
  const [userName, setUserName] = React.useState(user.userName);
  const [userLogin, setUserLogin] = React.useState(user.userLogin);

  // Модалка редактирования / создания
  const [editModal, setEditModal] = React.useState<{
    isOpen: boolean;
    isNew: boolean;
    plan: PlanItem | null;
  }>({
    isOpen: false,
    isNew: false,
    plan: null,
  });

  const [formData, setFormData] = React.useState({
    plan_id: '',
    plan_name: '',
    price: 0,
    billing_period: 'Месяц',
    description: '',
    is_active: true,
    effective_from: new Date().toISOString().substring(0, 10),
  });

  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // История цен по датам тарифа (plan_prices) внутри формы
  const [priceItems, setPriceItems] = React.useState<PlanPriceItem[]>([]);
  const [isPriceItemsLoading, setIsPriceItemsLoading] = React.useState(false);
  const [inlinePriceDate, setInlinePriceDate] = React.useState(new Date().toISOString().substring(0, 10));
  const [inlinePriceValue, setInlinePriceValue] = React.useState<number>(0);
  const [isAddingInlinePrice, setIsAddingInlinePrice] = React.useState(false);

  // Модалка истории изменений цен (триггер audit_plan_price_trigger)
  const [historyModal, setHistoryModal] = React.useState<{
    isOpen: boolean;
    planName: string;
    items: PlanHistoryItem[];
    loading: boolean;
  }>({
    isOpen: false,
    planName: '',
    items: [],
    loading: false,
  });

  // Модалка подтверждения удаления тарифа
  const [deleteDialog, setDeleteDialog] = React.useState<{
    isOpen: boolean;
    plan: PlanItem | null;
  }>({
    isOpen: false,
    plan: null,
  });

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.plans.getAll();
      setPlans(res.items || []);
    } catch {
      showToast('Ошибка при загрузке тарифов', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    if (user.profile) {
      setUserName(user.userName);
      setUserLogin(user.userLogin);
      setCurrentUserRole(user.role);
    }
  }, [user]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenEdit = async (plan: PlanItem) => {
    setFormData({
      plan_id: plan.plan_id,
      plan_name: plan.plan_name,
      price: Number(plan.price),
      billing_period: plan.billing_period,
      description: plan.description || '',
      is_active: plan.is_active,
      effective_from: new Date().toISOString().substring(0, 10),
    });
    setInlinePriceDate(new Date().toISOString().substring(0, 10));
    setInlinePriceValue(Number(plan.price));
    setPriceItems([]);
    setIsPriceItemsLoading(true);
    setEditModal({ isOpen: true, isNew: false, plan });

    try {
      const items = await getPlanPrices(plan.plan_id);
      setPriceItems(items);
    } catch {
      showToast('Не удалось загрузить историю цен', 'error');
    } finally {
      setIsPriceItemsLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setFormData({
      plan_id: '',
      plan_name: '',
      price: 0,
      billing_period: 'Месяц',
      description: '',
      is_active: true,
      effective_from: new Date().toISOString().substring(0, 10),
    });
    setPriceItems([]);
    setEditModal({ isOpen: true, isNew: true, plan: null });
  };

  const handleAddInlinePrice = async () => {
    if (!editModal.plan) return;
    if (inlinePriceValue <= 0) {
      showToast('Укажите корректную стоимость тарифа', 'error');
      return;
    }
    setIsAddingInlinePrice(true);
    try {
      const res = await upsertPlanPrice(editModal.plan.plan_id, inlinePriceValue, inlinePriceDate);
      if (res.success) {
        showToast(`Цена ${inlinePriceValue} сом зафиксирована с даты ${inlinePriceDate}`, 'success');
        const items = await getPlanPrices(editModal.plan.plan_id);
        setPriceItems(items);
        fetchData();
      } else {
        showToast(res.error || 'Ошибка при фиксации цены', 'error');
      }
    } catch {
      showToast('Сбой сервера при сохранении цены', 'error');
    } finally {
      setIsAddingInlinePrice(false);
    }
  };

  const handleDeleteInlinePrice = async (priceId: string) => {
    if (!editModal.plan) return;
    try {
      const res = await deletePlanPrice(priceId, editModal.plan.plan_id);
      if (res.success) {
        showToast('Период цены удален', 'success');
        const items = await getPlanPrices(editModal.plan.plan_id);
        setPriceItems(items);
        fetchData();
      } else {
        showToast(res.error || 'Ошибка удаления периода', 'error');
      }
    } catch {
      showToast('Сбой сервера при удалении периода', 'error');
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (editModal.isNew) {
        await api.plans.create(formData);
        showToast('Тариф успешно добавлен', 'success');
        setEditModal({ isOpen: false, isNew: false, plan: null });
        fetchData();
      } else if (editModal.plan) {
        await api.plans.update(editModal.plan.plan_id, formData);
        showToast('Тариф успешно обновлен. Зафиксирован аудит цены.', 'success');
        setEditModal({ isOpen: false, isNew: false, plan: null });
        fetchData();
      }
    } catch (err: any) {
      showToast(err.message || 'Сбой при сохранении тарифа', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenHistory = async (plan: PlanItem) => {
    setHistoryModal({ isOpen: true, planName: plan.plan_name, items: [], loading: true });
    try {
      const history = await getPlanHistory(plan.plan_id);
      setHistoryModal((p) => ({ ...p, items: history, loading: false }));
    } catch {
      showToast('Не удалось загрузить историю тарифа', 'error');
      setHistoryModal((p) => ({ ...p, loading: false }));
    }
  };

  const closeEditModal = () => setEditModal({ isOpen: false, isNew: false, plan: null });
  const closeHistoryModal = () => setHistoryModal((p) => ({ ...p, isOpen: false }));

  const handleDeletePlan = async () => {
    if (!deleteDialog.plan) return;
    try {
      await api.plans.delete(deleteDialog.plan.plan_id);
      showToast('Тариф успешно удален', 'success');
      setDeleteDialog({ isOpen: false, plan: null });
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка при удалении тарифа', 'error');
    }
  };

  // Массовая активация / архивация (одиночное действие из меню — те же ids из одного элемента)
  const handleBulkSetActive = async (ids: string[], isActive: boolean, clearSelection?: () => void) => {
    const targetIds = ids.filter((id) => {
      const plan = plans.find((p) => p.plan_id === id);
      return plan && plan.is_active !== isActive;
    });
    if (targetIds.length === 0) {
      showToast(isActive ? 'Среди выбранных нет архивных тарифов' : 'Среди выбранных нет активных тарифов', 'info');
      return;
    }
    setIsBatchLoading(true);
    try {
      const res = await api.plans.batch({ action: 'set_active', ids: targetIds, is_active: isActive });
      showToast(`${isActive ? 'Активировано' : 'Отправлено в архив'} тарифов: ${res.affected}`, 'success');
      clearSelection?.();
      setSelectedIds([]);
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка массового изменения статуса тарифов', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  // Массовое удаление с подтверждением (проверки использования — на сервере по каждому тарифу)
  const handleBulkDelete = async (ids: string[], clearSelection: () => void) => {
    const ok = await confirm({
      title: `Удалить ${ids.length} тарифов?`,
      description:
        'Действие необратимо. Тарифы, привязанные к действующим продавцам или зафиксированные в подключениях, удалены не будут.',
      tone: 'danger',
      icon: Trash2,
      confirmLabel: 'Удалить',
    });
    if (!ok) return;
    setIsBatchLoading(true);
    try {
      const res = await api.plans.batch({ action: 'delete', ids });
      const failed = ids.length - (res.affected ?? 0);
      showToast(
        failed > 0 ? `Удалено тарифов: ${res.affected}, заблокировано: ${failed}` : `Удалено тарифов: ${res.affected}`,
        failed > 0 ? 'info' : 'success'
      );
      clearSelection();
      setSelectedIds([]);
      fetchData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка массового удаления тарифов', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  // Контекстное меню строки (ПКМ / «⋯» / карточка)
  const renderCustomRowActions = (row: PlanItem) => (
    <>
      <JournalMenuItem icon={Calendar} label="Тариф и история цен" tone="info" onClick={() => handleOpenEdit(row)} />
      <JournalMenuItem icon={History} label="Аудит изменений цен" tone="purple" onClick={() => handleOpenHistory(row)} />
      {canManagePlans && (
        <JournalMenuItem
          icon={row.is_active ? Archive : CheckCircle2}
          label={row.is_active ? 'В архив' : 'Активировать'}
          tone={row.is_active ? 'warning' : 'success'}
          disabled={isBatchLoading}
          onClick={() => handleBulkSetActive([row.plan_id], !row.is_active)}
        />
      )}
      {canManagePlans && (
        <JournalMenuItem icon={Trash2} label="Удалить тариф" tone="danger" onClick={() => setDeleteDialog({ isOpen: true, plan: row })} />
      )}
    </>
  );

  const columns: ColumnDef<PlanItem>[] = [
    {
      key: 'plan_id',
      label: 'Код тарифа',
      width: 140,
      minWidth: 120,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="font-mono text-xs font-semibold px-2.5 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
          {row.plan_id}
        </span>
      ),
    },
    {
      key: 'plan_name',
      label: 'Название тарифа',
      width: 200,
      minWidth: 160,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <div className="flex items-center gap-2">
          <Tag className="w-3.5 h-3.5 text-blue-500" strokeWidth={1.75} />
          <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
            {row.plan_name}
          </span>
        </div>
      ),
    },
    {
      key: 'price',
      label: 'Стоимость',
      width: 150,
      minWidth: 120,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100">
          {Number(row.price).toLocaleString('ru-RU')} сом
        </span>
      ),
    },
    {
      key: 'billing_period',
      label: 'Период',
      width: 120,
      minWidth: 100,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          {row.billing_period}
        </span>
      ),
    },
    {
      key: 'is_active',
      label: 'Статус',
      width: 130,
      minWidth: 110,
      sortable: true,
      filterable: true,
      renderCell: (row) =>
        row.is_active ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" strokeWidth={2} />
            <span>Активен</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border border-zinc-200 dark:border-zinc-700">
            <XCircle className="w-3 h-3" strokeWidth={2} />
            <span>Архив</span>
          </span>
        ),
    },
    {
      key: 'description',
      label: 'Описание',
      width: 250,
      minWidth: 180,
      sortable: false,
      filterable: true,
      renderCell: (row) => (
        <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-xs block">
          {row.description || '—'}
        </span>
      ),
    },
  ];

  return (
    <AppLayout
      userRole={currentUserRole}
      userName={userName}
      userLogin={userLogin}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Поиск по названию или описанию тарифа..."
      onCreateClick={canManagePlans ? handleOpenCreate : undefined}
      createTooltip="Добавить тариф"
    >
      <div className="space-y-4">
        {/* Реестр тарифов DataJournal (ЯРУС 3): действия — в стандартном тулбаре и контекстном меню */}
        <DataJournal<PlanItem>
          data={plans}
          columns={columns}
          keyField="plan_id"
          storageKey="plans_journal"
          searchPlaceholder="Поиск по коду или названию тарифа..."
          onRowClick={canManagePlans ? handleOpenEdit : undefined}
          totalCount={plans.length}
          externalSearchQuery={searchQuery}
          onCreateClick={canManagePlans ? handleOpenCreate : undefined}
          createTooltip="Добавить тариф"
          onRefresh={fetchData}
          refreshing={isLoading}
          customRowActions={renderCustomRowActions}
          enableSelection={canManagePlans}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          renderBulkActions={(ids, clearSelection) => {
            const selected = plans.filter((p) => ids.includes(p.plan_id));
            const toArchive = selected.filter((p) => p.is_active).length;
            const toActivate = selected.filter((p) => !p.is_active).length;
            return (
              <div className="flex items-center gap-2">
                {toActivate > 0 && (
                  <button
                    type="button"
                    disabled={isBatchLoading}
                    onClick={() => handleBulkSetActive(ids, true, clearSelection)}
                    className="h-8 px-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs font-semibold border border-emerald-500/30 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Активировать выбранные тарифы"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    <span>Активировать ({toActivate})</span>
                  </button>
                )}
                {toArchive > 0 && (
                  <button
                    type="button"
                    disabled={isBatchLoading}
                    onClick={() => handleBulkSetActive(ids, false, clearSelection)}
                    className="h-8 px-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold border border-amber-500/30 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Отправить выбранные тарифы в архив"
                  >
                    <Archive className="w-3.5 h-3.5" strokeWidth={1.75} />
                    <span>Деактивировать ({toArchive})</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isBatchLoading}
                  onClick={() => handleBulkDelete(ids, clearSelection)}
                  className="h-8 px-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-semibold border border-rose-500/30 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Удалить выбранные тарифы"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                  <span>Удалить ({ids.length})</span>
                </button>
              </div>
            );
          }}
        />

        {/* Модальное окно создания / редактирования тарифа с историей действия цен */}
        <Modal
          open={editModal.isOpen}
          onClose={closeEditModal}
          title={editModal.isNew ? 'Новый тариф' : 'Редактирование тарифа'}
          subtitle={editModal.isNew ? 'Добавление в систему' : formData.plan_id}
          icon={Tag}
          tone="info"
          size="xl"
          busy={isSubmitting}
          formId={PLAN_FORM_ID}
          onSubmit={handleFormSubmit}
          footerClassName="justify-between"
          footer={
            <>
              {!editModal.isNew && canManagePlans ? (
                <Button
                  variant="dangerSoft"
                  disabled={isSubmitting}
                  onClick={() => {
                    const currentPlan = editModal.plan;
                    closeEditModal();
                    if (currentPlan) {
                      setDeleteDialog({ isOpen: true, plan: currentPlan });
                    }
                  }}
                  leftIcon={<Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />}
                >
                  Удалить
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={closeEditModal} disabled={isSubmitting}>
                  Отмена
                </Button>
                <Button type="submit" form={PLAN_FORM_ID} variant="info" loading={isSubmitting}>
                  {isSubmitting ? 'Сохранение...' : 'Сохранить тариф'}
                </Button>
              </div>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="Код тарифа (ID)" required htmlFor="plan-form-id">
              <Input
                id="plan-form-id"
                type="text"
                required
                disabled={!editModal.isNew}
                value={formData.plan_id}
                onChange={(e) => setFormData((p) => ({ ...p, plan_id: e.target.value }))}
                placeholder="Например: PLN-BASE"
                className="uppercase"
                mono
                size="lg"
              />
            </FormField>

            <FormField label="Название тарифа" required htmlFor="plan-form-name">
              <Input
                id="plan-form-name"
                type="text"
                required
                value={formData.plan_name}
                onChange={(e) => setFormData((p) => ({ ...p, plan_name: e.target.value }))}
                placeholder="Например: Базовый тариф"
                size="lg"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Текущая цена (сом)" required htmlFor="plan-form-price">
                <Input
                  id="plan-form-price"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={formData.price || ''}
                  onChange={(e) => setFormData((p) => ({ ...p, price: parseFloat(e.target.value) || 0 }))}
                  placeholder="1500"
                  mono
                  size="lg"
                />
              </FormField>

              <FormField label="Период" required htmlFor="plan-form-period">
                <Input
                  id="plan-form-period"
                  type="text"
                  required
                  value={formData.billing_period}
                  onChange={(e) => setFormData((p) => ({ ...p, billing_period: e.target.value }))}
                  placeholder="Месяц"
                  size="lg"
                />
              </FormField>
            </div>

            {editModal.isNew && (
              <FormField
                label="Действует с даты"
                required
                htmlFor="plan-form-effective"
                hint="Дата начала действия базовой стоимости"
              >
                <Input
                  id="plan-form-effective"
                  type="date"
                  required
                  value={formData.effective_from}
                  onChange={(e) => setFormData((p) => ({ ...p, effective_from: e.target.value }))}
                  mono
                  size="lg"
                />
              </FormField>
            )}

            <FormField label="Описание тарифа" htmlFor="plan-form-description">
              <Textarea
                id="plan-form-description"
                rows={2}
                value={formData.description}
                onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                placeholder="Описание возможностей..."
              />
            </FormField>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="is_active_plan"
                checked={formData.is_active}
                onChange={(e) => setFormData((p) => ({ ...p, is_active: e.target.checked }))}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <label htmlFor="is_active_plan" className="text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                Тариф активен и доступен для выбора
              </label>
            </div>

            {/* ВСТРОЕННАЯ ИСТОРИЯ ДЕЙСТВИЙ ТАРИФА (plan_prices) */}
            {!editModal.isNew && editModal.plan && (
              <div className="pt-4 border-t border-zinc-200/70 dark:border-zinc-800/70 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <Calendar className="w-4 h-4" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                      История действий тарифа (Цены по датам)
                    </h4>
                    <p className="text-[10px] text-zinc-400">
                      При проведении подключений задним числом сумма пересчитывается по этой таблице
                    </p>
                  </div>
                </div>

                {canManagePlans && (
                  <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/70 dark:border-zinc-700/70 space-y-2">
                    <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 block">
                      Добавить / изменить цену с определенной даты
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                      <FormField label="Действует с даты" className="sm:col-span-5">
                        <Input
                          type="date"
                          value={inlinePriceDate}
                          onChange={(e) => setInlinePriceDate(e.target.value)}
                          mono
                          size="sm"
                        />
                      </FormField>
                      <FormField label="Стоимость (сом)" className="sm:col-span-4">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={inlinePriceValue || ''}
                          onChange={(e) => setInlinePriceValue(parseFloat(e.target.value) || 0)}
                          placeholder="1500"
                          mono
                          size="sm"
                        />
                      </FormField>
                      <div className="sm:col-span-3">
                        <Button
                          variant="info"
                          size="sm"
                          fullWidth
                          loading={isAddingInlinePrice}
                          onClick={handleAddInlinePrice}
                          leftIcon={<Plus className="w-3.5 h-3.5" strokeWidth={2} />}
                        >
                          Зафиксировать
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Список периодов цен */}
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-0.5">
                  {isPriceItemsLoading ? (
                    <div className="p-4 text-center text-xs text-zinc-400">Загрузка истории цен...</div>
                  ) : priceItems.length === 0 ? (
                    <div className="p-4 text-center text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200/50 dark:border-zinc-800">
                      Периоды цен еще не зафиксированы. Используется текущая стоимость тарифа.
                    </div>
                  ) : (
                    priceItems.map((item) => (
                      <div
                        key={item.price_id}
                        className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">
                            {Number(item.price).toLocaleString('ru-RU')} сом
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono text-[10px] font-semibold border border-blue-500/20">
                            с {formatDateOnly(item.effective_from)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-400 font-mono hidden sm:inline">
                            Создано: <FormattedDate date={item.created_at} type="dateTime" />
                          </span>
                          {canManagePlans && priceItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteInlinePrice(item.price_id)}
                              className="w-6 h-6 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center justify-center transition-colors"
                              title="Удалить период цены"
                            >
                              <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </Modal>

        {/* Модальное окно просмотра истории цен (audit_plan_price_trigger) */}
        <Modal
          open={historyModal.isOpen}
          onClose={closeHistoryModal}
          title="Аудит изменения цен"
          subtitle={`${historyModal.planName} • Журнал триггера plans_history`}
          icon={History}
          tone="purple"
          size="md"
          footer={
            <Button variant="outline" onClick={closeHistoryModal}>
              Закрыть
            </Button>
          }
        >
          <div className="space-y-2">
            {historyModal.loading ? (
              <div className="p-6 text-center text-xs text-zinc-400">Загрузка аудита...</div>
            ) : historyModal.items.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 rounded-2xl border border-zinc-200/50 dark:border-zinc-800">
                История изменений цен отсутствует. Стоимость еще не менялась.
              </div>
            ) : (
              historyModal.items.map((item) => (
                <div
                  key={item.history_id}
                  className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-mono font-bold">
                      <span className="text-rose-500 line-through">
                        {Number(item.old_price).toLocaleString('ru-RU')} сом
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {Number(item.new_price).toLocaleString('ru-RU')} сом
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-400 font-mono">
                      <FormattedDate date={item.changed_at} type="dateTime" />
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1 border-t border-zinc-200/40 dark:border-zinc-700/40">
                    <span>Изменил:</span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {item.changer?.full_name || 'Администратор'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Modal>

        {/* Подтверждение удаления тарифа */}
        <ConfirmDialog
          open={deleteDialog.isOpen && Boolean(deleteDialog.plan)}
          onClose={() => setDeleteDialog({ isOpen: false, plan: null })}
          onConfirm={handleDeletePlan}
          title="Удаление тарифа"
          subtitle={deleteDialog.plan ? `${deleteDialog.plan.plan_id} • ${deleteDialog.plan.plan_name}` : undefined}
          description={
            <>
              Вы действительно хотите удалить тариф <strong>«{deleteDialog.plan?.plan_name}»</strong>? Действие
              необратимо. Если тариф привязан к действующим продавцам, система заблокирует удаление.
            </>
          }
          tone="danger"
          confirmLabel="Удалить тариф"
        />
      </div>
    </AppLayout>
  );
}
