'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { CollapsibleStats } from '@/components/ui/CollapsibleStats';
import { DataJournal, type ColumnDef, type DataJournalTab } from '@/components/ui/DataJournal';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import { PhoneInput, usePhoneParts } from '@/components/ui/PhoneInput';
import { formatMonth } from '@/lib/utils/format';
import { formatPhoneDisplay } from '@/lib/utils/phone';
import { api } from '@/lib/api/client';
import {
  resetEmployeePassword,
  type EmployeeItem,
} from './actions';
import {
  getEmployeeRatesHistory,
  type EmployeeRateHistoryItem,
} from '@/app/rates/actions';
import { useUser } from '@/components/auth/AuthProvider';
import { RolesAccessPanel } from '@/components/employees/RolesAccessPanel';
import { api as apiClient, type RoleItem } from '@/lib/api/client';
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
  Palette,
  Percent,
  Trash2,
  MapPin,
  Send,
  ShieldHalf,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select } from '@/components/ui/Field';
import type { UserRole } from '@/types/database.types';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { EmployeeBadge, EmployeeColorDot } from '@/components/ui/EmployeeBadge';
import { DEFAULT_EMPLOYEE_COLOR } from '@/lib/constants/colors';
import {
  EmployeeProfileFields,
  EMPTY_EMPLOYEE_PROFILE,
  GENDER_LABELS,
  ageFromBirthDate,
  employeeProfileToForm,
  employeeProfileToPayload,
  mapLinkForCoordinates,
  type EmployeeProfileFormValue,
} from '@/components/employees/EmployeeProfileFields';
import { EmployeesMapModal } from '@/components/employees/EmployeesMapModal';

const CREATE_FORM_ID = 'employee-create-form';
const EDIT_FORM_ID = 'employee-edit-form';
const RESET_FORM_ID = 'employee-reset-password-form';

export default function EmployeesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const user = useUser();
  const canCreate = user.can('employees.create');
  const canEdit = user.can('employees.edit');
  const canDeactivate = user.can('employees.deactivate');
  const canResetPassword = user.can('employees.reset_password');
  const canManageRates = user.can('rates.manage');
  const canSeeRoles = user.can('employees.menu');

  const [isLoading, setIsLoading] = React.useState(true);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>('consultant');
  const [currentUserName, setCurrentUserName] = React.useState('Администратор');
  const [currentUserLogin, setCurrentUserLogin] = React.useState('admin');

  // Вкладки модуля: реестр сотрудников и роли с доступами
  const [pageTab, setPageTab] = React.useState<'employees' | 'roles'>('employees');

  // Справочник ролей для назначения сотрудникам
  const [roles, setRoles] = React.useState<RoleItem[]>([]);
  const roleNameById = React.useMemo(() => new Map(roles.map((r) => [r.role_id, r.name])), [roles]);

  const [employees, setEmployees] = React.useState<EmployeeItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);

  // Фильтры и поиск
  const [searchQuery, setSearchQuery] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  // Общая карта сотрудников (администратор)
  const [isMapOpen, setIsMapOpen] = React.useState(false);

  // Модальное окно создания сотрудника
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const [newLogin, setNewLogin] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newFullName, setNewFullName] = React.useState('');
  const newPhoneParts = usePhoneParts(null);
  const [newRoleId, setNewRoleId] = React.useState<string>('');
  const [newColor, setNewColor] = React.useState<string>(DEFAULT_EMPLOYEE_COLOR);
  const [newProfile, setNewProfile] = React.useState<EmployeeProfileFormValue>(EMPTY_EMPLOYEE_PROFILE);
  const [isCreating, setIsCreating] = React.useState(false);

  // Модальное окно редактирования сотрудника
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [selectedEmployee, setSelectedEmployee] = React.useState<EmployeeItem | null>(null);
  const [editFullName, setEditFullName] = React.useState('');
  const editPhoneParts = usePhoneParts(null);
  const [editRoleId, setEditRoleId] = React.useState<string>('');
  const [editColor, setEditColor] = React.useState<string>(DEFAULT_EMPLOYEE_COLOR);
  const [editIsActive, setEditIsActive] = React.useState(true);
  const [editProfile, setEditProfile] = React.useState<EmployeeProfileFormValue>(EMPTY_EMPLOYEE_PROFILE);
  const [isUpdating, setIsUpdating] = React.useState(false);

  // Персональные процентные ставки сотрудника (мотивация)
  const [employeeRates, setEmployeeRates] = React.useState<EmployeeRateHistoryItem[]>([]);
  const [isRatesLoading, setIsRatesLoading] = React.useState(false);
  const [newRatePeriod, setNewRatePeriod] = React.useState(new Date().toISOString().substring(0, 7));
  const [newConnPercent, setNewConnPercent] = React.useState<number>(50);
  const [newMaintPercent, setNewMaintPercent] = React.useState<number>(10);
  const [isAddingRate, setIsAddingRate] = React.useState(false);

  // Модальное окно сброса пароля
  const [isPasswordModalOpen, setIsPasswordModalOpen] = React.useState(false);
  const [resetTargetEmployee, setResetTargetEmployee] = React.useState<EmployeeItem | null>(null);
  const [resetNewPassword, setResetNewPassword] = React.useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = React.useState('');
  const [isResetting, setIsResetting] = React.useState(false);

  const fetchEmployeesData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [employeesRes, rolesRes] = await Promise.all([
        api.employees.getAll({ pageSize: 100 }),
        apiClient.roles.getAll().catch(() => ({ items: [] as RoleItem[] })),
      ]);
      setEmployees(employeesRes.items || []);
      setTotalCount(employeesRes.total || 0);
      setRoles(rolesRes.items || []);
    } catch (err: any) {
      showToast(err.message || 'Ошибка загрузки сотрудников', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  // Доступ к модулю — по праву «Сотрудники: видеть в меню»
  React.useEffect(() => {
    if (!user.profile) return;
    setCurrentUserRole(user.role);
    setCurrentUserName(user.userName);
    setCurrentUserLogin(user.userLogin);
    if (!user.can('employees.menu')) {
      showToast('Доступ к модулю «Сотрудники» не предусмотрен вашей ролью', 'error');
      router.push('/');
    }
  }, [user, router, showToast]);

  React.useEffect(() => {
    fetchEmployeesData();
  }, [fetchEmployeesData]);

  // Вкладка роли и фильтр активности — клиентские фильтры без повторных запросов
  const visibleEmployees = React.useMemo(
    () =>
      employees.filter((e) => {
        if (roleFilter !== 'all' && (e.role_id || '') !== roleFilter) return false;
        if (statusFilter !== 'all' && String(Boolean(e.is_active)) !== statusFilter) return false;
        return true;
      }),
    [employees, roleFilter, statusFilter]
  );

  // Проверка анкеты до отправки (сервер проверяет те же правила)
  const validateProfile = (profile: EmployeeProfileFormValue): string | null => {
    if (profile.inn && !/^\d{14}$/.test(profile.inn)) return 'ИНН должен состоять из 14 цифр';
    const hasLat = profile.latitude.trim() !== '';
    const hasLon = profile.longitude.trim() !== '';
    if (hasLat !== hasLon) return 'Укажите и широту, и долготу (или очистите оба поля)';
    if (hasLat) {
      const lat = Number(profile.latitude.replace(',', '.'));
      const lon = Number(profile.longitude.replace(',', '.'));
      if (!Number.isFinite(lat) || Math.abs(lat) > 90) return 'Широта должна быть числом от −90 до 90';
      if (!Number.isFinite(lon) || Math.abs(lon) > 180) return 'Долгота должна быть числом от −180 до 180';
    }
    return null;
  };

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
    const newProfileError = validateProfile(newProfile);
    if (newProfileError) {
      showToast(newProfileError, 'error');
      return;
    }
    if (!newPhoneParts.isValid) {
      showToast('Укажите корректный номер телефона для выбранной страны', 'error');
      return;
    }

    setIsCreating(true);
    try {
      await api.employees.create({
        login: newLogin.trim(),
        password: newPassword,
        full_name: newFullName.trim(),
        phone: newPhoneParts.full || undefined,
        role: roles.find((r) => r.role_id === newRoleId)?.base_role || 'consultant',
        role_id: newRoleId || undefined,
        color: newColor,
        ...employeeProfileToPayload(newProfile),
      });

      showToast(`Сотрудник ${newFullName} успешно добавлен`, 'success');
      setIsCreateModalOpen(false);
      setNewLogin('');
      setNewPassword('');
      setNewFullName('');
      newPhoneParts.reset(null);
      setNewRoleId(roles.find((r) => r.code === 'consultant')?.role_id || '');
      setNewColor(DEFAULT_EMPLOYEE_COLOR);
      setNewProfile(EMPTY_EMPLOYEE_PROFILE);
      fetchEmployeesData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка при создании сотрудника', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  // Открытие окна редактирования
  const handleOpenEdit = async (emp: EmployeeItem) => {
    setSelectedEmployee(emp);
    setEditFullName(emp.full_name);
    editPhoneParts.reset(emp.phone);
    setEditRoleId(emp.role_id || roles.find((r) => r.base_role === emp.role)?.role_id || '');
    setEditColor(emp.color || DEFAULT_EMPLOYEE_COLOR);
    setEditIsActive(emp.is_active);
    setEditProfile(employeeProfileToForm(emp));
    setNewRatePeriod(new Date().toISOString().substring(0, 7));
    setNewConnPercent(50);
    setNewMaintPercent(10);
    setEmployeeRates([]);
    setIsRatesLoading(true);
    setIsEditModalOpen(true);

    try {
      const history = await getEmployeeRatesHistory(emp.user_id);
      setEmployeeRates(history);
      if (history.length > 0) {
        setNewConnPercent(history[0].connection_percent);
        setNewMaintPercent(history[0].maintenance_percent);
      }
    } catch {
      showToast('Не удалось загрузить ставки сотрудника', 'error');
    } finally {
      setIsRatesLoading(false);
    }
  };

  // Добавление / обновление ставки на период
  const handleAddRatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    if (newConnPercent < 0 || newMaintPercent < 0) {
      showToast('Проценты ставок не могут быть отрицательными', 'error');
      return;
    }
    setIsAddingRate(true);
    try {
      await api.rates.create({
        user_id: selectedEmployee.user_id,
        connection_percent: newConnPercent,
        maintenance_percent: newMaintPercent,
        effective_from: newRatePeriod,
      });
      showToast(`Ставка для периода ${newRatePeriod} установлена`, 'success');
      const history = await getEmployeeRatesHistory(selectedEmployee.user_id);
      setEmployeeRates(history);
    } catch (err: any) {
      showToast(err.message || 'Сбой сервера при сохранении ставки', 'error');
    } finally {
      setIsAddingRate(false);
    }
  };

  // Удаление периода ставки
  const handleDeleteRatePeriod = async (rateId: string) => {
    if (!selectedEmployee) return;
    try {
      await api.rates.delete(rateId);
      showToast('Период ставки удален', 'success');
      const history = await getEmployeeRatesHistory(selectedEmployee.user_id);
      setEmployeeRates(history);
    } catch (err: any) {
      showToast(err.message || 'Сбой сервера при удалении ставки', 'error');
    }
  };

  // Сохранение изменений сотрудника
  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    if (!editFullName.trim() || editFullName.trim().length < 2) {
      showToast('ФИО должно содержать минимум 2 символа', 'error');
      return;
    }
    const editProfileError = validateProfile(editProfile);
    if (editProfileError) {
      showToast(editProfileError, 'error');
      return;
    }
    if (!editPhoneParts.isValid) {
      showToast('Укажите корректный номер телефона для выбранной страны', 'error');
      return;
    }

    setIsUpdating(true);
    try {
      await api.employees.update(selectedEmployee.user_id, {
        full_name: editFullName.trim(),
        phone: editPhoneParts.full,
        role: roles.find((r) => r.role_id === editRoleId)?.base_role || selectedEmployee.role,
        role_id: editRoleId || undefined,
        is_active: editIsActive,
        color: editColor,
        ...employeeProfileToPayload(editProfile),
      });

      showToast('Данные сотрудника обновлены', 'success');
      setIsEditModalOpen(false);
      fetchEmployeesData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка сохранения изменений', 'error');
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

    if (!resetNewPassword || resetNewPassword.length < 6) {
      showToast('Пароль должен содержать минимум 6 символов', 'error');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      showToast('Введенные пароли не совпадают', 'error');
      return;
    }

    setIsResetting(true);
    try {
      const res = await resetEmployeePassword(
        resetTargetEmployee.user_id,
        resetNewPassword
      );

      if (res.success) {
        showToast(`Пароль для @${resetTargetEmployee.login} успешно изменен`, 'success');
        setIsPasswordModalOpen(false);
      } else {
        showToast(res.error || 'Ошибка сброса пароля', 'error');
      }
    } catch {
      showToast('Непредвиденная ошибка при сбросе пароля', 'error');
    } finally {
      setIsResetting(false);
    }
  };

  // Быстрое переключение активности
  const handleToggleActive = async (emp: EmployeeItem) => {
    const newStatus = !emp.is_active;
    try {
      await api.employees.update(emp.user_id, { is_active: newStatus });
      showToast(
        `Сотрудник ${emp.full_name} ${newStatus ? 'разблокирован' : 'заблокирован'}`,
        'info'
      );
      fetchEmployeesData();
    } catch (err: any) {
      showToast(err.message || 'Ошибка изменения активности', 'error');
    }
  };

  // Конфигурация колонок DataJournal
  const columns: ColumnDef<EmployeeItem>[] = [
    {
      key: 'full_name',
      label: 'Сотрудник',
      sortable: true,
      renderCell: (item: EmployeeItem) => (
        <div className="flex items-center gap-2.5">
          <EmployeeBadge name={item.full_name} color={item.color} size="md" />
          <span className="text-[11px] text-zinc-400 font-mono">@{item.login}</span>
        </div>
      ),
    },
    {
      key: 'role_id',
      label: 'Роль',
      sortable: true,
      filterable: true,
      groupable: true,
      filterType: 'select',
      filterOptions: roles.map((r) => ({ value: r.role_id, label: r.name })),
      textValue: (item: EmployeeItem) => item.role_name || roleNameById.get(item.role_id || '') || item.role,
      renderCell: (item: EmployeeItem) => {
        const role = roles.find((r) => r.role_id === item.role_id);
        const name = item.role_name || role?.name || item.role;
        const tone = role?.is_admin
          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
          : item.role === 'supervisor'
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
          : item.role === 'smm'
          ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
        const Icon = role?.is_admin ? ShieldCheck : item.role === 'smm' ? Sparkles : UserCheck;
        return (
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${tone}`}>
            <Icon className="w-3 h-3" strokeWidth={2} />
            <span>{name}</span>
          </span>
        );
      },
    },
    {
      key: 'color',
      label: 'Цвет метки',
      renderCell: (item: EmployeeItem) => (
        <div className="flex items-center gap-2">
          <EmployeeColorDot color={item.color} className="w-3.5 h-3.5" />
          <span className="text-xs font-mono text-zinc-500 uppercase">{item.color || DEFAULT_EMPLOYEE_COLOR}</span>
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'Телефон',
      renderCell: (item: EmployeeItem) =>
        item.phone ? (
          <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
            {formatPhoneDisplay(item.phone)}
          </span>
        ) : (
          <span className="text-zinc-400 text-xs">—</span>
        ),
    },
    {
      key: 'is_active',
      label: 'Статус',
      sortable: true,
      filterable: true,
      groupable: true,
      filterType: 'select',
      filterOptions: [
        { value: 'true', label: 'Активен' },
        { value: 'false', label: 'Заблокирован' },
      ],
      renderCell: (item: EmployeeItem) => (
        <button
          type="button"
          disabled={!canDeactivate}
          onClick={(e) => {
            e.stopPropagation();
            if (canDeactivate) handleToggleActive(item);
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all active:scale-95 disabled:cursor-default ${
            item.is_active
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
          }`}
          title={!canDeactivate ? undefined : item.is_active ? 'Нажмите для блокировки' : 'Нажмите для активации'}
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
      key: 'telegram_username',
      label: 'Telegram',
      width: 140,
      renderCell: (item: EmployeeItem) =>
        item.telegram_linked ? (
          <span className="inline-flex items-center gap-1 text-xs text-sky-600 dark:text-sky-400 font-medium">
            <Send className="w-3 h-3" strokeWidth={2} />
            {item.telegram_username ? `@${item.telegram_username}` : 'подключен'}
          </span>
        ) : (
          <span className="text-xs text-zinc-400">—</span>
        ),
    },
    {
      key: 'birth_date',
      label: 'Дата рождения',
      sortable: true,
      renderCell: (item: EmployeeItem) => {
        if (!item.birth_date) return <span className="text-xs text-zinc-400">—</span>;
        const age = ageFromBirthDate(item.birth_date);
        return (
          <span className="text-xs text-zinc-600 dark:text-zinc-300">
            <FormattedDate date={item.birth_date} type="dateOnly" />
            {age !== null && <span className="text-zinc-400"> • {age} лет</span>}
          </span>
        );
      },
    },
    {
      key: 'gender',
      label: 'Пол',
      sortable: true,
      renderCell: (item: EmployeeItem) => (
        <span className="text-xs text-zinc-600 dark:text-zinc-300">
          {item.gender ? GENDER_LABELS[item.gender] : '—'}
        </span>
      ),
    },
    {
      key: 'inn',
      label: 'ИНН',
      renderCell: (item: EmployeeItem) => (
        <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">{item.inn || '—'}</span>
      ),
    },
    {
      key: 'address',
      label: 'Адрес проживания',
      renderCell: (item: EmployeeItem) => {
        const hasPoint = item.latitude !== null && item.longitude !== null;
        if (!item.address && !hasPoint) return <span className="text-xs text-zinc-400">—</span>;
        return (
          <div className="flex items-center gap-1.5 min-w-0">
            {hasPoint && (
              <a
                href={mapLinkForCoordinates(Number(item.latitude), Number(item.longitude))}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded-lg text-rose-500 hover:bg-rose-500/10 flex-shrink-0"
                title="Показать на карте"
              >
                <MapPin className="w-3.5 h-3.5" strokeWidth={1.75} />
              </a>
            )}
            <span className="text-xs text-zinc-600 dark:text-zinc-300 truncate" title={item.address || ''}>
              {item.address || `${item.latitude}, ${item.longitude}`}
            </span>
          </div>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Дата добавления',
      sortable: true,
      renderCell: (item: EmployeeItem) => (
        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
          <FormattedDate date={item.created_at} type="dateTime" />
        </span>
      ),
    },
    {
      key: 'user_id',
      label: 'Действия',
      renderCell: (item: EmployeeItem) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <button
              type="button"
              onClick={() => handleOpenEdit(item)}
              className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              title="Редактировать сотрудника"
            >
              <Edit3 className="w-4 h-4" strokeWidth={1.75} />
            </button>
          )}
          {canResetPassword && (
            <button
              type="button"
              onClick={() => handleOpenResetPassword(item)}
              className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              title="Сбросить пароль"
            >
              <KeyRound className="w-4 h-4" strokeWidth={1.75} />
            </button>
          )}
        </div>
      ),
    },
  ];

  // Подсчет статистики
  const blockedCount = employees.filter((e) => !e.is_active).length;
  const countByRole = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const e of employees) map.set(e.role_id || '', (map.get(e.role_id || '') || 0) + 1);
    return map;
  }, [employees]);

  // Вкладки по ролям для DataJournal (клиентский фильтр)
  const employeeTabs: DataJournalTab[] = React.useMemo(
    () => [
      { id: 'all', label: 'Все сотрудники', icon: Users, count: employees.length },
      ...roles.map((r) => ({
        id: r.role_id,
        label: r.name,
        icon: r.is_admin ? ShieldCheck : r.base_role === 'smm' ? Sparkles : UserCheck,
        count: countByRole.get(r.role_id) || 0,
      })),
    ],
    [employees.length, roles, countByRole]
  );

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
              {pageTab === 'roles' ? 'Роли и доступы' : 'Реестр сотрудников'}
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {pageTab === 'roles'
                ? 'Создание ролей и гибкая настройка прав по каждому модулю'
                : 'Управление доступом, ролевой моделью и учетными записями CRM'}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            {/* Вкладки модуля */}
            <div className="flex items-center bg-zinc-200/60 dark:bg-zinc-800/60 p-1 rounded-2xl border border-zinc-200/40 dark:border-zinc-700/40 h-10">
              <button
                type="button"
                onClick={() => setPageTab('employees')}
                className={`h-8 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  pageTab === 'employees'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
                aria-pressed={pageTab === 'employees'}
              >
                <Users className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Сотрудники</span>
              </button>
              {canSeeRoles && (
                <button
                  type="button"
                  onClick={() => setPageTab('roles')}
                  className={`h-8 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    pageTab === 'roles'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                  aria-pressed={pageTab === 'roles'}
                >
                  <ShieldHalf className="w-3.5 h-3.5" strokeWidth={1.75} />
                  <span>Роли — Доступы</span>
                </button>
              )}
            </div>

            {pageTab === 'employees' && (
              <>
                <button
                  type="button"
                  onClick={() => setIsMapOpen(true)}
                  className="h-10 px-4 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/70 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold flex items-center gap-2 shadow-sm transition-all active:scale-95"
                  title="Места проживания сотрудников на одной карте"
                >
                  <MapPin className="w-4 h-4 text-rose-500" strokeWidth={2} />
                  <span className="hidden sm:inline">Карта сотрудников</span>
                </button>
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!newRoleId) setNewRoleId(roles.find((r) => r.code === 'consultant')?.role_id || roles[0]?.role_id || '');
                      setIsCreateModalOpen(true);
                    }}
                    className="h-10 px-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-semibold flex items-center gap-2 shadow-sm transition-all active:scale-95"
                  >
                    <Plus className="w-4 h-4" strokeWidth={2} />
                    <span>Добавить сотрудника</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {pageTab === 'roles' && canSeeRoles && <RolesAccessPanel />}

        <EmployeesMapModal isOpen={isMapOpen} onClose={() => setIsMapOpen(false)} />

        {/* Карточки оперативной статистики по сотрудникам */}
        {pageTab === 'employees' && (
        <CollapsibleStats storageKey="employees">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
              <span className="text-[11px] text-zinc-400 font-medium">Всего в штате</span>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">{employees.length}</p>
            </div>
            {roles.map((r) => (
              <div
                key={r.role_id}
                className="p-4 rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1"
              >
                <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold truncate block">{r.name}</span>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 font-mono">{countByRole.get(r.role_id) || 0}</p>
              </div>
            ))}
            <div className="p-4 rounded-2xl backdrop-blur-xl bg-rose-500/10 dark:bg-rose-500/5 border border-rose-500/20 shadow-sm space-y-1">
              <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">Заблокировано</span>
              <p className="text-2xl font-bold text-rose-700 dark:text-rose-300 font-mono">{blockedCount}</p>
            </div>
          </div>
        </CollapsibleStats>
        )}

        {/* Таблица DataJournal */}
        {pageTab === 'employees' && (
        <DataJournal<EmployeeItem>
          data={visibleEmployees}
          columns={columns}
          keyField="user_id"
          title="Сотрудники"
          totalCount={visibleEmployees.length}
          storageKey="employees_journal"
          emptyMessage="Сотрудники не найдены"
          externalSearchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          tabs={employeeTabs}
          activeTab={roleFilter}
          onTabChange={setRoleFilter}
          onRowClick={(item) => (canEdit ? handleOpenEdit(item) : undefined)}
        />
        )}

        {/* 1. МОДАЛЬНОЕ ОКНО ДОБАВЛЕНИЯ СОТРУДНИКА */}
        <Modal
          open={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          title="Новый сотрудник"
          subtitle="Регистрация аккаунта и анкета"
          icon={Plus}
          tone="info"
          size="xl"
          busy={isCreating}
          formId={CREATE_FORM_ID}
          onSubmit={handleCreateSubmit}
          footer={
            <>
              <Button variant="outline" onClick={() => setIsCreateModalOpen(false)} disabled={isCreating}>
                Отмена
              </Button>
              <Button type="submit" form={CREATE_FORM_ID} loading={isCreating}>
                {isCreating ? 'Создание...' : 'Зарегистрировать'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="Логин для входа" required htmlFor="employee-create-login">
              <Input
                id="employee-create-login"
                type="text"
                required
                minLength={3}
                value={newLogin}
                onChange={(e) => setNewLogin(e.target.value.toLowerCase().trim())}
                placeholder="ivanov"
                mono
                size="lg"
              />
            </FormField>

            <FormField label="Пароль (минимум 6 символов)" required htmlFor="employee-create-password">
              <Input
                id="employee-create-password"
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                size="lg"
              />
            </FormField>

            <FormField label="Полное ФИО" required htmlFor="employee-create-name">
              <Input
                id="employee-create-name"
                type="text"
                required
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="Иванов Иван Иванович"
                size="lg"
              />
            </FormField>

            <FormField label="Номер телефона">
              <PhoneInput value={newPhoneParts.parts} onChange={newPhoneParts.setParts} size="lg" />
            </FormField>

            <FormField
              label="Роль в системе CRM"
              htmlFor="employee-create-role"
              hint={roles.find((r) => r.role_id === newRoleId)?.description || 'Права роли настраиваются во вкладке «Роли — Доступы»'}
            >
              <Select
                id="employee-create-role"
                value={newRoleId}
                onChange={(e) => setNewRoleId(e.target.value)}
                className="font-semibold"
                size="lg"
                required
              >
                {roles.map((r) => (
                  <option key={r.role_id} value={r.role_id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </FormField>

            <ColorPicker value={newColor} onChange={setNewColor} label="Цвет индикатора сотрудника" />

            <div className="pt-3 border-t border-zinc-200/70 dark:border-zinc-800/70 space-y-3">
              <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Анкета сотрудника</h4>
              <EmployeeProfileFields value={newProfile} onChange={setNewProfile} />
            </div>
          </div>
        </Modal>

        {/* 2. МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ СОТРУДНИКА */}
        <Modal
          open={isEditModalOpen && Boolean(selectedEmployee)}
          onClose={() => setIsEditModalOpen(false)}
          title="Редактирование сотрудника"
          subtitle={selectedEmployee ? `@${selectedEmployee.login}` : undefined}
          icon={Edit3}
          tone="info"
          size="xl"
          busy={isUpdating}
          formId={EDIT_FORM_ID}
          onSubmit={handleUpdateSubmit}
          footer={
            <>
              <Button variant="outline" onClick={() => setIsEditModalOpen(false)} disabled={isUpdating}>
                Отмена
              </Button>
              <Button type="submit" form={EDIT_FORM_ID} loading={isUpdating}>
                {isUpdating ? 'Сохранение...' : 'Сохранить профиль'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="ФИО сотрудника" required htmlFor="employee-edit-name">
              <Input
                id="employee-edit-name"
                type="text"
                required
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                size="lg"
              />
            </FormField>

            <FormField label="Номер телефона">
              <PhoneInput value={editPhoneParts.parts} onChange={editPhoneParts.setParts} size="lg" />
            </FormField>

            <FormField
              label="Роль в системе CRM"
              htmlFor="employee-edit-role"
              hint={roles.find((r) => r.role_id === editRoleId)?.description || 'Права роли настраиваются во вкладке «Роли — Доступы»'}
            >
              <Select
                id="employee-edit-role"
                value={editRoleId}
                onChange={(e) => setEditRoleId(e.target.value)}
                className="font-semibold"
                size="lg"
                required
              >
                {roles.map((r) => (
                  <option key={r.role_id} value={r.role_id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </FormField>

            <ColorPicker value={editColor} onChange={setEditColor} label="Цвет индикатора сотрудника" />

            <div className="pt-3 border-t border-zinc-200/70 dark:border-zinc-800/70 space-y-3">
              <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Анкета сотрудника</h4>
              <EmployeeProfileFields value={editProfile} onChange={setEditProfile} />
            </div>

            <label className="flex items-center justify-between p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 cursor-pointer text-xs">
              <div>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100 block">Активность аккаунта</span>
                <span className="text-[11px] text-zinc-400">Разрешить авторизацию в CRM</span>
              </div>
              <input
                type="checkbox"
                checked={editIsActive}
                disabled={!canDeactivate}
                onChange={(e) => setEditIsActive(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
              />
            </label>

            {/* ВСТРОЕННАЯ СЕКЦИЯ ПЕРСОНАЛЬНЫХ СТАВОК (МОТИВАЦИЯ) */}
            {canManageRates && (
            <div className="pt-4 border-t border-zinc-200/70 dark:border-zinc-800/70 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                  <Percent className="w-4 h-4" strokeWidth={1.75} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Процентные ставки сотрудника (История мотивации)
                  </h4>
                  <p className="text-[10px] text-zinc-400">
                    Индивидуальные ставки бонуса за подключение и сопровождение по расчетным месяцам
                  </p>
                </div>
              </div>

              {/* Добавление периода ставки */}
              <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/70 dark:border-zinc-700/70 space-y-2">
                <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 block">
                  Установить ставку на расчетный период
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                  <FormField label="Период" className="sm:col-span-4">
                    <Input type="month" value={newRatePeriod} onChange={(e) => setNewRatePeriod(e.target.value)} mono size="sm" />
                  </FormField>
                  <FormField label="Подключение %" className="sm:col-span-3">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={newConnPercent || ''}
                      onChange={(e) => setNewConnPercent(parseFloat(e.target.value) || 0)}
                      placeholder="50"
                      mono
                      size="sm"
                    />
                  </FormField>
                  <FormField label="Сопровождение %" className="sm:col-span-3">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={newMaintPercent || ''}
                      onChange={(e) => setNewMaintPercent(parseFloat(e.target.value) || 0)}
                      placeholder="10"
                      mono
                      size="sm"
                    />
                  </FormField>
                  <div className="sm:col-span-2">
                    <Button
                      size="sm"
                      fullWidth
                      className="bg-purple-600 hover:bg-purple-700 text-white"
                      loading={isAddingRate}
                      onClick={handleAddRatePeriod}
                      leftIcon={<Plus className="w-3.5 h-3.5" strokeWidth={2} />}
                    >
                      Ок
                    </Button>
                  </div>
                </div>
              </div>

              {/* Список периодов ставок */}
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5">
                {isRatesLoading ? (
                  <div className="p-4 text-center text-xs text-zinc-400">Загрузка истории ставок...</div>
                ) : employeeRates.length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200/50 dark:border-zinc-800">
                    Индивидуальные ставки не заданы. Применяются базовые ставки системы (30% / 10%).
                  </div>
                ) : (
                  employeeRates.map((item) => (
                    <div
                      key={item.rate_id}
                      className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 font-mono text-[11px] font-bold border border-purple-500/20">
                          {formatMonth(item.effective_from)}
                        </span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-zinc-800 dark:text-zinc-200">
                            Подкл: <b>{item.connection_percent}%</b>
                          </span>
                          <span className="text-zinc-400">•</span>
                          <span className="text-zinc-800 dark:text-zinc-200">
                            Сопров: <b>{item.maintenance_percent}%</b>
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteRatePeriod(item.rate_id)}
                        className="w-6 h-6 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center justify-center transition-colors"
                        title="Удалить период ставки"
                      >
                        <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
            )}
          </div>
        </Modal>

        {/* 3. МОДАЛЬНОЕ ОКНО СБРОСА ПАРОЛЯ */}
        <Modal
          open={isPasswordModalOpen && Boolean(resetTargetEmployee)}
          onClose={() => setIsPasswordModalOpen(false)}
          title="Сброс пароля"
          subtitle={resetTargetEmployee ? `@${resetTargetEmployee.login} (${resetTargetEmployee.full_name})` : undefined}
          icon={KeyRound}
          tone="info"
          size="sm"
          busy={isResetting}
          formId={RESET_FORM_ID}
          onSubmit={handleResetPasswordSubmit}
          footer={
            <>
              <Button variant="outline" onClick={() => setIsPasswordModalOpen(false)} disabled={isResetting}>
                Отмена
              </Button>
              <Button type="submit" form={RESET_FORM_ID} variant="info" loading={isResetting}>
                {isResetting ? 'Сброс...' : 'Обновить пароль'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="Новый пароль (от 6 символов)" required htmlFor="employee-reset-password">
              <Input
                id="employee-reset-password"
                type="password"
                required
                minLength={6}
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                placeholder="••••••••"
                size="lg"
              />
            </FormField>

            <FormField label="Подтверждение пароля" required htmlFor="employee-reset-confirm">
              <Input
                id="employee-reset-confirm"
                type="password"
                required
                minLength={6}
                value={resetConfirmPassword}
                onChange={(e) => setResetConfirmPassword(e.target.value)}
                placeholder="••••••••"
                size="lg"
              />
            </FormField>
          </div>
        </Modal>
      </div>
    </AppLayout>
  );
}
