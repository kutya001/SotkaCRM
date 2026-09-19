'use client';

import * as React from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef } from '@/components/ui/DataJournal';
import { useToast } from '@/components/ui/Toast';
import {
  getEmployeeRates,
  upsertEmployeeRate,
  type EmployeeRateItem,
} from './actions';
import {
  Percent,
  BookOpen,
  RotateCcw,
  UserCheck,
  Edit2,
  X,
  TrendingUp,
  ShieldAlert,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/components/auth/AuthProvider';
import type { UserRole } from '@/types/database.types';

export default function RatesPage() {
  const { showToast } = useToast();
  const user = useUser();

  const [rates, setRates] = React.useState<EmployeeRateItem[]>([]);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>(user.role);
  const [userName, setUserName] = React.useState(user.userName);
  const [userLogin, setUserLogin] = React.useState(user.userLogin);

  // Модалка настройки ставок
  const [selectedRate, setSelectedRate] = React.useState<EmployeeRateItem | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formData, setFormData] = React.useState({
    connection_percent: 30,
    maintenance_percent: 10,
    effective_from: new Date().toISOString().substring(0, 7),
  });

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getEmployeeRates();
      setRates(res.rates);
      if (res.currentUserRole) {
        setCurrentUserRole(res.currentUserRole);
      }
    } catch {
      showToast('Ошибка при загрузке персональных ставок', 'error');
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

  const handleOpenEdit = (item: EmployeeRateItem) => {
    setSelectedRate(item);
    setFormData({
      connection_percent: item.connection_percent,
      maintenance_percent: item.maintenance_percent,
      effective_from: item.effective_from,
    });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRate) return;

    setIsSubmitting(true);
    try {
      const res = await upsertEmployeeRate({
        user_id: selectedRate.user_id,
        connection_percent: formData.connection_percent,
        maintenance_percent: formData.maintenance_percent,
        effective_from: formData.effective_from,
      });

      if (res.success) {
        showToast('Персональные условия сотрудника сохранены', 'success');
        setSelectedRate(null);
        fetchData();
      } else {
        showToast(res.error || 'Ошибка при сохранении ставок', 'error');
      }
    } catch {
      showToast('Сбой при сохранении условий', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const columns: ColumnDef<EmployeeRateItem>[] = [
    {
      key: 'full_name',
      label: 'Сотрудник',
      width: 240,
      minWidth: 200,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-bold flex items-center justify-center flex-shrink-0">
            {row.full_name.charAt(0)}
          </div>
          <div className="flex flex-col truncate">
            <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate">
              {row.full_name}
            </span>
            <span className="text-[10px] text-zinc-400 capitalize">
              {row.role} • @{row.login}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'connection_percent',
      label: 'Бонус подключения',
      width: 170,
      minWidth: 150,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          {row.connection_percent}%
        </span>
      ),
    },
    {
      key: 'maintenance_percent',
      label: 'Бонус сопровождения',
      width: 180,
      minWidth: 150,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
          {row.maintenance_percent}%
        </span>
      ),
    },
    {
      key: 'effective_from',
      label: 'Действует с месяца',
      width: 150,
      minWidth: 130,
      sortable: true,
      filterable: true,
      renderCell: (row) => (
        <span className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
          {row.effective_from}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Действия',
      width: 120,
      minWidth: 100,
      sortable: false,
      filterable: false,
      renderCell: (row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleOpenEdit(row);
          }}
          disabled={currentUserRole !== 'admin'}
          className="h-7 px-2.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[11px] font-medium flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Настроить процентную ставку"
        >
          <Edit2 className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Настроить</span>
        </button>
      ),
    },
  ];

  // Контекстные действия тулбара реестра ставок (ЯРУС 3)
  const rateActions = (
    <button
      type="button"
      onClick={() => fetchData()}
      className="min-w-[44px] min-h-[44px] h-11 px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive"
      title="Обновить реестр"
      aria-label="Обновить реестр"
    >
      <RotateCcw className={`w-4 h-4 text-blue-500 flex-shrink-0 ${isLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
      <span className="hidden sm:inline">Обновить</span>
    </button>
  );

  return (
    <AppLayout
      userRole={currentUserRole}
      userName={userName}
      userLogin={userLogin}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Поиск по имени сотрудника или логину..."
    >
      <div className="space-y-4">
        {/* Вкладки справочников */}
        <div className="flex items-center gap-2 border-b border-zinc-200/60 dark:border-zinc-800/60 pb-3">
          <Link
            href="/plans"
            className="px-4 py-2 rounded-2xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold flex items-center gap-2 transition-colors"
          >
            <BookOpen className="w-4 h-4" strokeWidth={1.75} />
            <span>Тарифные планы</span>
          </Link>
          <Link
            href="/rates"
            className="px-4 py-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-bold flex items-center gap-2 shadow-sm"
          >
            <Percent className="w-4 h-4" strokeWidth={1.75} />
            <span>Персональные ставки</span>
          </Link>
        </div>

        {/* Реестр ставок DataJournal (ЯРУС 3) */}
        <DataJournal<EmployeeRateItem>
          data={rates}
          columns={columns}
          keyField="user_id"
          storageKey="rates_journal"
          searchPlaceholder="Поиск по имени сотрудника или логину..."
          onRowClick={currentUserRole === 'admin' ? handleOpenEdit : undefined}
          totalCount={rates.length}
          externalSearchQuery={searchQuery}
          customActions={rateActions}
        />

        {/* Модальное окно редактирования персональных условий */}
        {selectedRate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <form
              onSubmit={handleFormSubmit}
              className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-600 dark:text-purple-400">
                    <Percent className="w-5 h-5" strokeWidth={2} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      Настройка условий мотивации
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {selectedRate.full_name} • @{selectedRate.login}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRate(null)}
                  className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500"
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-1">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold">
                    Должность в системе:
                  </span>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100 capitalize">
                    {selectedRate.role}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Бонус подключения (%) *
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      required
                      value={formData.connection_percent}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          connection_percent: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <span className="text-[10px] text-zinc-400 block">Базово: 30%</span>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      Бонус сопровождения (%) *
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      required
                      value={formData.maintenance_percent}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          maintenance_percent: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <span className="text-[10px] text-zinc-400 block">Базово: 10%</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Месяц активации условий (YYYY-MM) *
                  </label>
                  <input
                    type="text"
                    pattern="^\d{4}-\d{2}$"
                    required
                    value={formData.effective_from}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, effective_from: e.target.value }))
                    }
                    placeholder="2026-09"
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setSelectedRate(null)}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {isSubmitting ? 'Сохранение...' : 'Сохранить ставки'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
