'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, type ColumnDef } from '@/components/ui/DataJournal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import {
  getEmployees,
  createEmployee,
  updateEmployee,
  toggleEmployeeActive,
  resetEmployeePassword,
  type EmployeeItem,
} from './actions';
import { getUserProfileAndKpi } from '@/app/profile/actions';
import {
  Users,
  Plus,
  Edit3,
  KeyRound,
  ShieldCheck,
  UserCheck,
  Sparkles,
  Phone,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  ShieldAlert,
} from 'lucide-react';
import type { UserRole } from '@/types/database.types';

export default function EmployeesPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>('consultant');
  const [currentUserName, setCurrentUserName] = React.useState('Администратор');
  const [currentUserLogin, setCurrentUserLogin] = React.useState('admin');

  const [employees, setEmployees] = React.useState<EmployeeItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);

  // Фильтры и поиск
  const [searchQuery, setSearchQuery] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  // Модальное окно создания сотрудника
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const [newLogin, setNewLogin] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newFullName, setNewFullName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');
  const [newRole, setNewRole] = React.useState<UserRole>('consultant');
  const [isCreating, setIsCreating] = React.useState(false);

  // Модальное окно редактирования сотрудника
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [selectedEmployee, setSelectedEmployee] = React.useState<EmployeeItem | null>(null);
  const [editFullName, setEditFullName] = React.useState('');
  const [editPhone, setEditPhone] = React.useState('');
  const [editRole, setEditRole] = React.useState<UserRole>('consultant');
  const [editIsActive, setEditIsActive] = React.useState(true);
  const [isUpdating, setIsUpdating] = React.useState(false);

  // Модальное окно сброса пароля
  const [isPasswordModalOpen, setIsPasswordModalOpen] = React.useState(false);
  const [resetTargetEmployee, setResetTargetEmployee] = React.useState<EmployeeItem | null>(null);
  const [resetNewPassword, setResetNewPassword] = React.useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = React.useState('');
  const [isResetting, setIsResetting] = React.useState(false);

  const fetchEmployeesData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [profileRes, employeesRes] = await Promise.all([
        getUserProfileAndKpi(),
        getEmployees({
          search: searchQuery,
          role: roleFilter,
          isActive: statusFilter,
        }),
      ]);

      if (profileRes.profile) {
        setCurrentUserRole(profileRes.role);
        setCurrentUserName(profileRes.profile.full_name);
        setCurrentUserLogin(profileRes.profile.login);

        if (profileRes.role !== 'admin') {
          showToast('Доступ к модулю «Сотрудники» разрешен только администраторам', 'error');
          router.push('/');
          return;
        }
      }

      setEmployees(employeesRes.employees);
      setTotalCount(employeesRes.totalCount);
    } catch {
      showToast('Ошибка загрузки сотрудников', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, roleFilter, statusFilter, showToast, router]);

  React.useEffect(() => {
    fetchEmployeesData();
  }, [fetchEmployeesData]);

  // Обработка создания
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLogin.trim() || newLogin.trim().length < 3) {
      showToast('Логин должен содержать не менее 3 символов', 'error');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      showToast('Пароль должен содержать не менее 6 символов', 'error');
      return;
    }
    if (!newFullName.trim() || newFullName.trim().length < 2) {
      showToast('Укажите корректное ФИО сотрудника', 'error');
      return;
    }

    setIsCreating(true);
    try {
      const res = await createEmployee({
        login: newLogin.trim(),
        password: newPassword,
        full_name: newFullName.trim(),
        phone: newPhone.trim() || undefined,
        role: newRole,
      });

      if (res.success) {
        showToast(`Сотрудник ${newFullName} успешно добавлен`, 'success');
        setIsCreateModalOpen(false);
        setNewLogin('');
        setNewPassword('');
        setNewFullName('');
        setNewPhone('');
        setNewRole('consultant');
        fetchEmployeesData();
      } else {
        showToast(res.error || 'Ошибка при создании сотрудника', 'error');
      }
    } catch {
      showToast('Непредвиденная ошибка при создании', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  // Открытие окна редактирования
  const handleOpenEdit = (emp: EmployeeItem) => {
    setSelectedEmployee(emp);
    setEditFullName(emp.full_name);
    setEditPhone(emp.phone || '');
    setEditRole(emp.role);
    setEditIsActive(emp.is_active);
    setIsEditModalOpen(true);
  };

  // Сохранение изменений сотрудника
  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    if (!editFullName.trim() || editFullName.trim().length < 2) {
      showToast('ФИО должно содержать минимум 2 символа', 'error');
      return;
    }

    setIsUpdating(true);
    try {
      const res = await updateEmployee(selectedEmployee.user_id, {
        full_name: editFullName.trim(),
        phone: editPhone.trim() || null,
        role: editRole,
        is_active: editIsActive,
      });

      if (res.success) {
        showToast('Данные сотрудника обновлены', 'success');
        setIsEditModalOpen(false);
        fetchEmployeesData();
      } else {
        showToast(res.error || 'Ошибка при обновлении', 'error');
      }
    } catch {
      showToast('Ошибка сохранения изменений', 'error');
    } finally {
      setIsUpdating(false);
    }
  };

  // Открытие окна сброса пароля
  const handleOpenResetPassword = (emp: EmployeeItem) => {
    setResetTargetEmployee(emp);
    setResetNewPassword('');
    setResetConfirmPassword('');
    setIsPasswordModalOpen(true);
  };

  // Сброс пароля
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetEmployee) return;

    if (resetNewPassword.length < 6) {
      showToast('Пароль должен содержать минимум 6 символов', 'error');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      showToast('Пароли не совпадают', 'error');
      return;
    }

    setIsResetting(true);
    try {
      const res = await resetEmployeePassword(
        resetTargetEmployee.user_id,
        resetNewPassword
      );

      if (res.success) {
        showToast(`Пароль для @${resetTargetEmployee.login} успешно обновлен`, 'success');
        setIsPasswordModalOpen(false);
      } else {
        showToast(res.error || 'Ошибка при сбросе пароля', 'error');
      }
    } catch {
      showToast('Ошибка сброса пароля', 'error');
    } finally {
      setIsResetting(false);
    }
  };

  // Быстрое переключение активности
  const handleToggleActive = async (emp: EmployeeItem) => {
    const newStatus = !emp.is_active;
    try {
      const res = await toggleEmployeeActive(emp.user_id, newStatus);
      if (res.success) {
        showToast(
          `Сотрудник ${emp.full_name} ${newStatus ? 'разблокирован' : 'заблокирован'}`,
          'info'
        );
        fetchEmployeesData();
      } else {
        showToast(res.error || 'Ошибка смены статуса', 'error');
      }
    } catch {
      showToast('Ошибка изменения активности', 'error');
    }
  };

  // Конфигурация колонок DataJournal
  const columns: ColumnDef<EmployeeItem>[] = [
    {
      key: 'full_name',
      label: 'Сотрудник',
      sortable: true,
      renderCell: (item: EmployeeItem) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-zinc-800 to-zinc-950 text-white dark:from-zinc-100 dark:to-zinc-300 dark:text-zinc-900 flex items-center justify-center text-xs font-bold shadow-sm flex-shrink-0">
            {item.full_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-zinc-900 dark:text-zinc-100 truncate">
              {item.full_name}
            </p>
            <p className="text-[11px] text-zinc-400 font-mono">@{item.login}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Роль',
      sortable: true,
      renderCell: (item: EmployeeItem) => {
        if (item.role === 'admin') {
          return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <ShieldCheck className="w-3 h-3" strokeWidth={2} />
              <span>Администратор</span>
            </span>
          );
        }
        if (item.role === 'consultant') {
          return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <UserCheck className="w-3 h-3" strokeWidth={2} />
              <span>Консультант</span>
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            <Sparkles className="w-3 h-3" strokeWidth={2} />
            <span>SMM-специалист</span>
          </span>
        );
      },
    },
    {
      key: 'phone',
      label: 'Телефон',
      renderCell: (item: EmployeeItem) =>
        item.phone ? (
          <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
            +{item.phone}
          </span>
        ) : (
          <span className="text-zinc-400 text-xs">—</span>
        ),
    },
    {
      key: 'is_active',
      label: 'Статус',
      sortable: true,
      renderCell: (item: EmployeeItem) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleActive(item);
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all active:scale-95 ${
            item.is_active
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
          }`}
          title={item.is_active ? 'Нажмите для блокировки' : 'Нажмите для активации'}
        >
          {item.is_active ? (
            <>
              <CheckCircle2 className="w-3 h-3" strokeWidth={2} />
              <span>Активен</span>
            </>
          ) : (
            <>
              <XCircle className="w-3 h-3" strokeWidth={2} />
              <span>Заблокирован</span>
            </>
          )}
        </button>
      ),
    },
    {
      key: 'created_at',
      label: 'Дата добавления',
      sortable: true,
      renderCell: (item: EmployeeItem) => (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          <FormattedDate date={item.created_at} type="date" />
        </span>
      ),
    },
    {
      key: 'user_id',
      label: 'Действия',
      renderCell: (item: EmployeeItem) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => handleOpenEdit(item)}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            title="Редактировать сотрудника"
          >
            <Edit3 className="w-4 h-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => handleOpenResetPassword(item)}
            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            title="Сбросить пароль"
          >
            <KeyRound className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      ),
    },
  ];

  // Подсчет статистики
  const adminsCount = employees.filter((e) => e.role === 'admin').length;
  const consultantsCount = employees.filter((e) => e.role === 'consultant').length;
  const smmCount = employees.filter((e) => e.role === 'smm').length;
  const blockedCount = employees.filter((e) => !e.is_active).length;

  return (
    <AppLayout
      userRole={currentUserRole}
      userName={currentUserName}
      userLogin={currentUserLogin}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Поиск по ФИО, логину или номеру..."
    >
      <div className="space-y-6 pb-16">
        {/* Шапка модуля */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <Users className="w-4 h-4" strokeWidth={2} />
              <span>Администрирование пользователей</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight mt-1">
              Реестр сотрудников
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Управление доступом, ролевой моделью и учетными записями CRM
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="h-10 px-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-semibold flex items-center gap-2 shadow-sm transition-all active:scale-95 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" strokeWidth={2} />
            <span>Добавить сотрудника</span>
          </button>
        </div>

        {/* Карточки оперативной статистики по сотрудникам */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Всего в штате</span>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {totalCount}
            </p>
          </div>
          <div className="p-4 rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">Администраторы</span>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 font-mono">
              {adminsCount}
            </p>
          </div>
          <div className="p-4 rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Консультанты</span>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 font-mono">
              {consultantsCount}
            </p>
          </div>
          <div className="p-4 rounded-2xl backdrop-blur-xl bg-purple-500/10 dark:bg-purple-500/5 border border-purple-500/20 shadow-sm space-y-1">
            <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold">SMM-операторы</span>
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-300 font-mono">
              {smmCount}
            </p>
          </div>
          <div className="p-4 rounded-2xl backdrop-blur-xl bg-rose-500/10 dark:bg-rose-500/5 border border-rose-500/20 shadow-sm space-y-1 col-span-2 sm:col-span-1">
            <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">Заблокировано</span>
            <p className="text-2xl font-bold text-rose-700 dark:text-rose-300 font-mono">
              {blockedCount}
            </p>
          </div>
        </div>

        {/* Быстрые фильтры */}
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-2xl backdrop-blur-xl bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-800/50">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">Роль:</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="h-8 px-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все роли</option>
              <option value="admin">Администратор</option>
              <option value="consultant">Консультант</option>
              <option value="smm">SMM-специалист</option>
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">Статус:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 px-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-200 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все статусы</option>
              <option value="true">Только активные</option>
              <option value="false">Только заблокированные</option>
            </select>
          </div>
        </div>

        {/* Таблица DataJournal */}
        <DataJournal<EmployeeItem>
          data={employees}
          columns={columns}
          keyField="user_id"
          title="Сотрудники"
          totalCount={totalCount}
          storageKey="employees_journal"
          emptyMessage="Сотрудники не найдены"
          onRowClick={(item) => handleOpenEdit(item)}
        />

        {/* 1. МОДАЛЬНОЕ ОКНО ДОБАВЛЕНИЯ СОТРУДНИКА */}
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-blue-500" strokeWidth={2} />
                  <span>Новый сотрудник</span>
                </h3>
              </div>

              <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Логин для входа <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={newLogin}
                    onChange={(e) => setNewLogin(e.target.value.toLowerCase().trim())}
                    className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="ivanov"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Пароль (минимум 6 символов) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="••••••••"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Полное ФИО <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Иванов Иван Иванович"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Номер телефона
                  </label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="996555123456"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Роль в системе CRM
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                  >
                    <option value="consultant">Продавец-консультант</option>
                    <option value="admin">Администратор</option>
                    <option value="smm">SMM-специалист</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="h-9 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isCreating ? 'Создание...' : 'Зарегистрировать'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 2. МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ СОТРУДНИКА */}
        {isEditModalOpen && selectedEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-blue-500" strokeWidth={2} />
                  <span>Редактирование сотрудника</span>
                </h3>
                <span className="text-xs text-zinc-400 font-mono">@{selectedEmployee.login}</span>
              </div>

              <form onSubmit={handleUpdateSubmit} className="space-y-3.5 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    ФИО сотрудника <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Номер телефона
                  </label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Роль в системе CRM
                  </label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as UserRole)}
                    className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                  >
                    <option value="consultant">Продавец-консультант</option>
                    <option value="admin">Администратор</option>
                    <option value="smm">SMM-специалист</option>
                  </select>
                </div>

                <div className="flex items-center justify-between p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                  <div>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 block">
                      Активность аккаунта
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      Разрешить авторизацию в CRM
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={editIsActive}
                    onChange={(e) => setEditIsActive(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="h-9 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isUpdating ? 'Сохранение...' : 'Сохранить изменения'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 3. МОДАЛЬНОЕ ОКНО СБРОСА ПАРОЛЯ */}
        {isPasswordModalOpen && resetTargetEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-sm p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 text-blue-500">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                  <KeyRound className="w-5 h-5" strokeWidth={2} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    Сброс пароля
                  </h3>
                  <p className="text-xs text-zinc-400">
                    @{resetTargetEmployee.login} ({resetTargetEmployee.full_name})
                  </p>
                </div>
              </div>

              <form onSubmit={handleResetPasswordSubmit} className="space-y-3.5 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Новый пароль (от 6 символов)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="••••••••"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Подтверждение пароля
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={resetConfirmPassword}
                    onChange={(e) => setResetConfirmPassword(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="••••••••"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsPasswordModalOpen(false)}
                    className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isResetting}
                    className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isResetting ? 'Сброс...' : 'Обновить пароль'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
