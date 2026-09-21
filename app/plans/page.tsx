'use client';

import * as React from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef } from '@/components/ui/DataJournal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import {
  getPlans,
  updatePlan,
  createPlan,
  deletePlan,
  getPlanHistory,
  getPlanPrices,
  upsertPlanPrice,
  deletePlanPrice,
  type PlanItem,
  type PlanHistoryItem,
  type PlanPriceItem,
} from './actions';
import {
  BookOpen,
  Plus,
  Percent,
  History,
  RotateCcw,
  Tag,
  CheckCircle2,
  XCircle,
  X,
  Clock,
  ArrowRight,
  Trash2,
  Calendar,
  Coins,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/components/auth/AuthProvider';
import type { UserRole } from '@/types/database.types';

export default function PlansPage() {
  const { showToast } = useToast();
  const user = useUser();

  const [plans, setPlans] = React.useState<PlanItem[]>([]);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>(user.role);
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
  const [isDeleting, setIsDeleting] = React.useState(false);

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getPlans();
      setPlans(res.plans);
      if (res.currentUserRole) {
        setCurrentUserRole(res.currentUserRole);
      }
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
        const res = await createPlan(formData);
        if (res.success) {
          showToast('Тариф успешно добавлен', 'success');
          setEditModal({ isOpen: false, isNew: false, plan: null });
          fetchData();
        } else {
          showToast(res.error || 'Ошибка при создании тарифа', 'error');
        }
      } else if (editModal.plan) {
        const res = await updatePlan(editModal.plan.plan_id, formData);
        if (res.success) {
          showToast('Тариф успешно обновлен. Зафиксирован аудит цены.', 'success');
          setEditModal({ isOpen: false, isNew: false, plan: null });
          fetchData();
        } else {
          showToast(res.error || 'Ошибка при обновлении тарифа', 'error');
        }
      }
    } catch {
      showToast('Сбой при сохранении тарифа', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenHistory = async (plan: PlanItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistoryModal({ isOpen: true, planName: plan.plan_name, items: [], loading: true });
    try {
      const history = await getPlanHistory(plan.plan_id);
      setHistoryModal((p) => ({ ...p, items: history, loading: false }));
    } catch {
      showToast('Не удалось загрузить историю тарифа', 'error');
      setHistoryModal((p) => ({ ...p, loading: false }));
    }
  };

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
    {
      key: 'actions',
      label: 'Действия',
      width: 200,
      minWidth: 160,
      sortable: false,
      filterable: false,
      renderCell: (row) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => handleOpenEdit(row)}
            className="h-7 px-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-[11px] font-medium flex items-center gap-1 transition-colors"
            title="Тариф и история цен"
          >
            <Calendar className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>Тариф и цены</span>
          </button>
          <button
            onClick={(e) => handleOpenHistory(row, e)}
            className="h-7 px-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[11px] font-medium flex items-center gap-1 transition-colors"
            title="История изменений цен"
          >
            <History className="w-3.5 h-3.5 text-zinc-400" strokeWidth={1.75} />
            <span>Аудит</span>
          </button>
          {currentUserRole === 'admin' && (
            <button
              onClick={() => setDeleteDialog({ isOpen: true, plan: row })}
              className="w-7 h-7 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center justify-center transition-colors"
              title="Удалить тариф"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      ),
    },
  ];

  // Контекстные действия тулбара реестра тарифов (ЯРУС 3)
  const planActions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => fetchData()}
        className="min-w-[44px] min-h-[44px] h-11 px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive"
        title="Обновить каталог"
        aria-label="Обновить каталог"
      >
        <RotateCcw className={`w-4 h-4 text-blue-500 flex-shrink-0 ${isLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
        <span className="hidden sm:inline">Обновить</span>
      </button>
    </div>
  );

  return (
    <AppLayout
      userRole={currentUserRole}
      userName={userName}
      userLogin={userLogin}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Поиск по названию или описанию тарифа..."
      onCreateClick={currentUserRole === 'admin' ? handleOpenCreate : undefined}
      createTooltip="Добавить тариф"
    >
      <div className="space-y-4">
        {/* Заголовок модуля тарифов */}
        <div className="flex items-center justify-between pb-1">
          <div>
            <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-500" strokeWidth={1.75} />
              <span>Тарифные планы</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Каталог тарифных планов и история действия стоимости по датам
            </p>
          </div>
        </div>

        {/* Реестр тарифов DataJournal (ЯРУС 3) */}
        <DataJournal<PlanItem>
          data={plans}
          columns={columns}
          keyField="plan_id"
          storageKey="plans_journal"
          searchPlaceholder="Поиск по коду или названию тарифа..."
          onRowClick={currentUserRole === 'admin' ? handleOpenEdit : undefined}
          totalCount={plans.length}
          externalSearchQuery={searchQuery}
          customActions={planActions}
        />

        {/* Модальное окно создания / редактирования тарифа с историей действия цен */}
        {editModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
                    <Tag className="w-5 h-5" strokeWidth={2} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      {editModal.isNew ? 'Новый тариф' : 'Редактирование тарифа'}
                    </h3>
                    <p className="text-xs text-zinc-400 font-mono">
                      {editModal.isNew ? 'Добавление в систему' : formData.plan_id}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditModal({ isOpen: false, isNew: false, plan: null })}
                  className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500 transition-colors"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div className="space-y-3 text-xs">
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Код тарифа (ID) *
                    </label>
                    <input
                      type="text"
                      required
                      disabled={!editModal.isNew}
                      value={formData.plan_id}
                      onChange={(e) => setFormData((p) => ({ ...p, plan_id: e.target.value }))}
                      placeholder="Например: PLN-BASE"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 uppercase font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Название тарифа *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.plan_name}
                      onChange={(e) => setFormData((p) => ({ ...p, plan_name: e.target.value }))}
                      placeholder="Например: Базовый тариф"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                        Текущая цена (сом) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={formData.price || ''}
                        onChange={(e) =>
                          setFormData((p) => ({ ...p, price: parseFloat(e.target.value) || 0 }))
                        }
                        placeholder="1500"
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                        Период *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.billing_period}
                        onChange={(e) => setFormData((p) => ({ ...p, billing_period: e.target.value }))}
                        placeholder="Месяц"
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {editModal.isNew && (
                    <div className="space-y-1">
                      <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                        Действует с даты *
                      </label>
                      <input
                        type="date"
                        required
                        value={formData.effective_from}
                        onChange={(e) => setFormData((p) => ({ ...p, effective_from: e.target.value }))}
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-[10px] text-zinc-400">
                        Дата начала действия базовой стоимости
                      </p>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Описание тарифа
                    </label>
                    <textarea
                      rows={2}
                      value={formData.description}
                      onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                      placeholder="Описание возможностей..."
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

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
                </div>

                <div className="flex items-center justify-between gap-2.5 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  {!editModal.isNew && currentUserRole === 'admin' ? (
                    <button
                      type="button"
                      onClick={() => {
                        const currentPlan = editModal.plan;
                        setEditModal({ isOpen: false, isNew: false, plan: null });
                        if (currentPlan) {
                          setDeleteDialog({ isOpen: true, plan: currentPlan });
                        }
                      }}
                      className="h-9 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                      <span>Удалить</span>
                    </button>
                  ) : (
                    <div />
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditModal({ isOpen: false, isNew: false, plan: null })}
                      className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      Отмена
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSubmitting ? 'Сохранение...' : 'Сохранить тариф'}
                    </button>
                  </div>
                </div>
              </form>

              {/* ВСТРОЕННАЯ ИСТОРИЯ ДЕЙСТВИЙ ТАРИФА (plan_prices) */}
              {!editModal.isNew && editModal.plan && (
                <div className="pt-4 border-t border-zinc-200/70 dark:border-zinc-800/70 space-y-3">
                  <div className="flex items-center justify-between">
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
                  </div>

                  {currentUserRole === 'admin' && (
                    <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/70 dark:border-zinc-700/70 space-y-2">
                      <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 block">
                        Добавить / изменить цену с определенной даты
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-5">
                          <label className="text-[10px] text-zinc-400 block mb-1">Действует с даты</label>
                          <input
                            type="date"
                            value={inlinePriceDate}
                            onChange={(e) => setInlinePriceDate(e.target.value)}
                            className="w-full h-8 px-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <label className="text-[10px] text-zinc-400 block mb-1">Стоимость (сом)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={inlinePriceValue || ''}
                            onChange={(e) => setInlinePriceValue(parseFloat(e.target.value) || 0)}
                            placeholder="1500"
                            className="w-full h-8 px-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <button
                            type="button"
                            disabled={isAddingInlinePrice}
                            onClick={handleAddInlinePrice}
                            className="w-full h-8 px-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1 shadow-sm"
                          >
                            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                            <span>{isAddingInlinePrice ? '...' : 'Зафиксировать'}</span>
                          </button>
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
                              с {item.effective_from}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-400 font-mono hidden sm:inline">
                              Создано: <FormattedDate date={item.created_at} type="shortDate" />
                            </span>
                            {currentUserRole === 'admin' && priceItems.length > 1 && (
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
          </div>
        )}

        {/* Модальное окно просмотра истории цен (audit_plan_price_trigger) */}
        {historyModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-600 dark:text-purple-400">
                    <History className="w-5 h-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      Аудит изменения цен
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {historyModal.planName} • Журнал триггера `plans_history`
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setHistoryModal((p) => ({ ...p, isOpen: false }))}
                  className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2">
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
                          <FormattedDate date={item.changed_at} type="shortDate" />
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

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setHistoryModal((p) => ({ ...p, isOpen: false }))}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Модальное окно подтверждения удаления тарифа */}
        {deleteDialog.isOpen && deleteDialog.plan && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 text-rose-500">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/10 flex items-center justify-center">
                  <Trash2 className="w-5 h-5" strokeWidth={2} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    Удаление тарифа
                  </h3>
                  <p className="text-xs text-zinc-400 font-mono">
                    {deleteDialog.plan.plan_id} • {deleteDialog.plan.plan_name}
                  </p>
                </div>
              </div>

              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Вы действительно хотите удалить тариф <strong>«{deleteDialog.plan.plan_name}»</strong>?
                Действие необратимо. Если тариф привязан к действующим продавцам, система заблокирует удаление.
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteDialog({ isOpen: false, plan: null })}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={async () => {
                    if (!deleteDialog.plan) return;
                    setIsDeleting(true);
                    try {
                      const res = await deletePlan(deleteDialog.plan.plan_id);
                      if (res.success) {
                        showToast('Тариф успешно удален', 'success');
                        setDeleteDialog({ isOpen: false, plan: null });
                        fetchData();
                      } else {
                        showToast(res.error || 'Ошибка при удалении тарифа', 'error');
                      }
                    } catch {
                      showToast('Сбой сервера при удалении тарифа', 'error');
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                  className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-md transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isDeleting ? 'Удаление...' : 'Удалить тариф'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
