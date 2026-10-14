'use client';

import * as React from 'react';
import { ROLE_LABELS } from '@/lib/constants/roles';
import { api, type RoleItem } from '@/lib/api/client';
import { useUser } from '@/components/auth/AuthProvider';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import { PhoneInput, usePhoneParts } from '@/components/ui/PhoneInput';
import { formatDateTime } from '@/lib/utils/format';
import { formatPhoneDisplay } from '@/lib/utils/phone';
import {
  getUserProfileAndKpi,
  updateProfileData,
  changeUserPassword,
  getAllUsersForAdmin,
  type UserProfileData,
  type SmmKpiStats,
  type ConsultantKpiStats,
  type AdminKpiStats,
} from './actions';
import { signOut } from '@/app/auth/actions';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select } from '@/components/ui/Field';
import { TelegramCard } from '@/components/profile/TelegramCard';
import { DEFAULT_EMPLOYEE_COLOR, getEmployeeColorConfig } from '@/lib/constants/colors';
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
import {
  User,
  ShieldCheck,
  Shield,
  Phone,
  Calendar,
  Activity,
  MapPin,
  Fingerprint,
  FileText,
  LogOut,
  Sun,
  Moon,
  Monitor,
  TrendingUp,
  UserCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Banknote,
  Store,
  Layers,
  Sparkles,
  RotateCcw,
  Percent,
  KeyRound,
  Edit3,
  Users,
  ArrowLeft,
  Lock,
  ExternalLink,
  Palette,
  BookOpen,
  ArrowUpRight,
} from 'lucide-react';
import type { UserRole } from '@/types/database.types';

const PROFILE_FORM_ID = 'profile-edit-form';
const PASSWORD_FORM_ID = 'profile-password-form';

export default function ProfilePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const user = useUser();

  const [isLoading, setIsLoading] = React.useState(true);
  const [profile, setProfile] = React.useState<UserProfileData | null>(null);
  const [currentUserRole, setCurrentUserRole] = React.useState<UserRole>('consultant');
  const [activeViewingUserId, setActiveViewingUserId] = React.useState<string | undefined>(undefined);

  // Список всех сотрудников для администратора
  const [allUsers, setAllUsers] = React.useState<UserProfileData[]>([]);

  // KPI метрики
  const [smmStats, setSmmStats] = React.useState<SmmKpiStats | null>(null);
  const [consultantStats, setConsultantStats] = React.useState<ConsultantKpiStats | null>(null);
  const [adminStats, setAdminStats] = React.useState<AdminKpiStats | null>(null);

  // Тема оформления
  const [currentTheme, setCurrentTheme] = React.useState<'light' | 'dark' | 'system'>('system');

  // Модальные окна
  const [isSignOutConfirmOpen, setIsSignOutConfirmOpen] = React.useState(false);
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  // Модальное окно редактирования профиля
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [editFullName, setEditFullName] = React.useState('');
  const editPhoneParts = usePhoneParts(null);
  const [editRole, setEditRole] = React.useState<UserRole>('consultant');
  const [editRoleId, setEditRoleId] = React.useState<string>('');
  // Справочник ролей для смены роли сотрудника (право employees.edit)
  const [rolesList, setRolesList] = React.useState<RoleItem[]>([]);
  React.useEffect(() => {
    if (!user.can('employees.edit')) return;
    api.roles
      .getAll()
      .then((res) => setRolesList(res.items || []))
      .catch(() => undefined);
  }, [user]);
  const [editColor, setEditColor] = React.useState<string>(DEFAULT_EMPLOYEE_COLOR);
  const [editIsActive, setEditIsActive] = React.useState(true);
  const [editProfileFields, setEditProfileFields] = React.useState<EmployeeProfileFormValue>(EMPTY_EMPLOYEE_PROFILE);
  const [isSavingProfile, setIsSavingProfile] = React.useState(false);

  // Проверка анкеты до отправки (сервер проверяет те же правила)
  const validateProfileFields = (value: EmployeeProfileFormValue): string | null => {
    if (value.inn && !/^\d{14}$/.test(value.inn)) return 'ИНН должен состоять из 14 цифр';
    const hasLat = value.latitude.trim() !== '';
    const hasLon = value.longitude.trim() !== '';
    if (hasLat !== hasLon) return 'Укажите и широту, и долготу (или очистите оба поля)';
    if (hasLat) {
      const lat = Number(value.latitude.replace(',', '.'));
      const lon = Number(value.longitude.replace(',', '.'));
      if (!Number.isFinite(lat) || Math.abs(lat) > 90) return 'Широта должна быть числом от −90 до 90';
      if (!Number.isFinite(lon) || Math.abs(lon) > 180) return 'Долгота должна быть числом от −180 до 180';
    }
    return null;
  };

  // Модальное окно смены пароля
  const [isPasswordModalOpen, setIsPasswordModalOpen] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [isSavingPassword, setIsSavingPassword] = React.useState(false);

  const fetchProfile = React.useCallback(
    async (targetId?: string) => {
      setIsLoading(true);
      try {
        const res = await getUserProfileAndKpi(targetId);
        if (res.profile) {
          setProfile(res.profile);
          if (res.currentUserRole) {
            setCurrentUserRole(res.currentUserRole);
          }

          // Сбрасываем статы перед установкой новых
          setSmmStats(res.smmStats || null);
          setConsultantStats(res.consultantStats || null);
          setAdminStats(res.adminStats || null);

          // Если администратор, подгружаем список пользователей
          if (user.can('profile.others')) {
            const usersRes = await getAllUsersForAdmin();
            if (usersRes.users) {
              setAllUsers(usersRes.users);
            }
          }
        } else {
          showToast(res.error || 'Не удалось загрузить профиль', 'error');
        }
      } catch {
        showToast('Ошибка при загрузке данных профиля', 'error');
      } finally {
        setIsLoading(false);
      }
    },
    [showToast]
  );

  React.useEffect(() => {
    fetchProfile(activeViewingUserId);

    try {
      const savedTheme = localStorage.getItem('crm_theme') as 'light' | 'dark' | 'system';
      if (savedTheme) setCurrentTheme(savedTheme);
    } catch {}
  }, [fetchProfile, activeViewingUserId]);

  const handleSetTheme = (theme: 'light' | 'dark' | 'system') => {
    setCurrentTheme(theme);
    try {
      localStorage.setItem('crm_theme', theme);
    } catch {}

    const isDark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    showToast(
      `Тема оформления: ${theme === 'dark' ? 'Тёмная' : theme === 'light' ? 'Светлая' : 'Системная'}`,
      'info'
    );
  };

  const handleConfirmSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      router.push('/login');
    } catch {
      showToast('Ошибка при выходе из системы', 'error');
      setIsSigningOut(false);
    }
  };

  const openEditModal = () => {
    if (!profile) return;
    setEditFullName(profile.full_name);
    editPhoneParts.reset(profile.phone);
    setEditRole(profile.role);
    setEditRoleId(profile.role_id || '');
    setEditColor(profile.color || DEFAULT_EMPLOYEE_COLOR);
    setEditIsActive(profile.is_active);
    setEditProfileFields(employeeProfileToForm(profile));
    setIsEditModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editFullName.trim() || editFullName.trim().length < 2) {
      showToast('ФИО должно содержать не менее 2 символов', 'error');
      return;
    }
    if (!editPhoneParts.isValid) {
      showToast('Укажите корректный номер телефона для выбранной страны', 'error');
      return;
    }
    const profileFieldsError = validateProfileFields(editProfileFields);
    if (profileFieldsError) {
      showToast(profileFieldsError, 'error');
      return;
    }

    // Роль и активность отправляет только сотрудник с правом редактировать других
    const canEditAccess = user.can('employees.edit');
    setIsSavingProfile(true);
    try {
      const res = await updateProfileData({
        full_name: editFullName.trim(),
        phone: editPhoneParts.full,
        ...(canEditAccess && editRoleId
          ? { role: rolesList.find((r) => r.role_id === editRoleId)?.base_role || editRole, role_id: editRoleId }
          : {}),
        ...(canEditAccess ? { is_active: editIsActive } : {}),
        color: editColor,
        ...employeeProfileToPayload(editProfileFields),
        targetUserId: activeViewingUserId,
      });

      if (res.success) {
        showToast('Профиль успешно обновлен', 'success');
        setIsEditModalOpen(false);
        fetchProfile(activeViewingUserId);
      } else {
        showToast(res.error || 'Ошибка при сохранении профиля', 'error');
      }
    } catch {
      showToast('Непредвиденная ошибка при сохранении', 'error');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      showToast('Пароль должен содержать минимум 6 символов', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Введенные пароли не совпадают', 'error');
      return;
    }

    setIsSavingPassword(true);
    try {
      const res = await changeUserPassword({
        newPassword,
        targetUserId: activeViewingUserId,
      });

      if (res.success) {
        showToast('Пароль успешно изменен', 'success');
        setIsPasswordModalOpen(false);
        setNewPassword('');
        setConfirmPassword('');
      } else {
        showToast(res.error || 'Ошибка при смене пароля', 'error');
      }
    } catch {
      showToast('Ошибка при смене пароля', 'error');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const isViewingOtherUser = Boolean(activeViewingUserId && profile && activeViewingUserId !== allUsers.find(u => u.login === profile.login)?.user_id);

  const displayedRole = profile?.role || 'consultant';
  const roleLabel =
    displayedRole === 'admin'
      ? 'Администратор'
      : displayedRole === 'consultant'
      ? 'Консультант'
      : 'SMM-специалист';

  return (
    <AppLayout
      userRole={currentUserRole}
      userName={profile?.full_name || 'Сотрудник'}
      userLogin={profile?.login || 'user'}
    >
      <div className="space-y-6 max-w-5xl mx-auto pb-16">
        {/* ПАНЕЛЬ АДМИНИСТРАТОРА: ВЫБОР СОТРУДНИКА ДЛЯ ПРОСМОТРА И РЕДАКТИРОВАНИЯ */}
        {user.can('profile.others') && allUsers.length > 0 && (
          <div className="p-4 sm:p-5 rounded-3xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                <Users className="w-5 h-5" strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Управление профилями сотрудников
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Администратор может просматривать KPI и редактировать данные любого сотрудника
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <select
                value={activeViewingUserId || ''}
                onChange={(e) => setActiveViewingUserId(e.target.value || undefined)}
                className="h-9 px-3 text-xs font-semibold rounded-xl bg-white dark:bg-zinc-800 border border-blue-500/30 text-zinc-900 dark:text-zinc-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Мой профиль</option>
                {allUsers.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.full_name} ({u.role_name || ROLE_LABELS[u.role] || u.role})
                  </option>
                ))}
              </select>

              <Link
                href="/employees"
                className="h-9 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
              >
                <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Все сотрудники</span>
              </Link>
            </div>
          </div>
        )}

        {/* 1. Карточка профиля пользователя (Apple Island Glassmorphism) */}
        <div className="p-6 sm:p-8 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl text-white flex items-center justify-center text-2xl sm:text-3xl font-bold shadow-lg flex-shrink-0 transition-transform hover:scale-105"
              style={{ backgroundColor: profile?.color || DEFAULT_EMPLOYEE_COLOR }}
            >
              {profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {profile?.full_name || 'Загрузка...'}
                </h1>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                    profile?.is_active
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                  }`}
                >
                  {profile?.is_active ? 'Активен' : 'Заблокирован'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">
                  @{profile?.login}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-500" strokeWidth={2} />
                  {roleLabel}
                </span>
                {profile?.phone && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1 font-mono">
                      <Phone className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {formatPhoneDisplay(profile.phone)}
                    </span>
                  </>
                )}
              </div>
              {profile?.created_at && (
                <p className="text-[11px] text-zinc-400 pt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>
                    В системе с <FormattedDate date={profile.created_at} type="date" />
                  </span>
                  <span className="flex items-center gap-1" title="Последняя активность в CRM">
                    <Activity className="w-3 h-3 text-emerald-500" strokeWidth={2} />
                    Последняя активность:{' '}
                    {profile.last_active_at ? <FormattedDate date={profile.last_active_at} type="dateTime" /> : 'нет данных'}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-4 md:pt-0 border-zinc-100 dark:border-zinc-800">
            {/* Кнопка редактирования данных профиля */}
            <button
              type="button"
              onClick={openEditModal}
              className="h-10 px-3.5 rounded-2xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 shadow-sm"
              title="Изменить данные профиля"
            >
              <Edit3 className="w-4 h-4 text-zinc-500" strokeWidth={1.75} />
              <span>Изменить данные</span>
            </button>

            {/* Кнопка смены пароля */}
            <button
              type="button"
              onClick={() => {
                setNewPassword('');
                setConfirmPassword('');
                setIsPasswordModalOpen(true);
              }}
              className="h-10 px-3.5 rounded-2xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 shadow-sm"
              title="Сменить пароль"
            >
              <KeyRound className="w-4 h-4 text-zinc-500" strokeWidth={1.75} />
              <span>Пароль</span>
            </button>

            {/* Переключатель темы оформления */}
            <div className="flex items-center p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/60">
              <button
                type="button"
                onClick={() => handleSetTheme('light')}
                title="Светлая тема"
                className={`p-2 rounded-xl transition-all ${
                  currentTheme === 'light'
                    ? 'bg-white text-zinc-900 shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                <Sun className="w-4 h-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => handleSetTheme('dark')}
                title="Тёмная тема"
                className={`p-2 rounded-xl transition-all ${
                  currentTheme === 'dark'
                    ? 'bg-zinc-900 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                <Moon className="w-4 h-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => handleSetTheme('system')}
                title="Системная тема"
                className={`p-2 rounded-xl transition-all ${
                  currentTheme === 'system'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                <Monitor className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>

            {/* Кнопка выхода */}
            <button
              onClick={() => setIsSignOutConfirmOpen(true)}
              className="h-10 px-3.5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-1.5 transition-all border border-rose-500/20 active:scale-95"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.75} />
              <span>Выйти</span>
            </button>
          </div>
        </div>


        {/* Анкета сотрудника */}
        {profile && (
          <div className="p-5 sm:p-6 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-500" strokeWidth={1.75} />
                Анкета сотрудника
              </h2>
              <button
                type="button"
                onClick={openEditModal}
                className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                Изменить
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-rose-500 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
                <div className="min-w-0">
                  <span className="text-[10px] text-zinc-400 block">Адрес проживания</span>
                  {profile.address || (profile.latitude !== null && profile.longitude !== null) ? (
                    <span className="text-zinc-800 dark:text-zinc-200 break-words">
                      {profile.address || `${profile.latitude}, ${profile.longitude}`}
                      {profile.latitude !== null && profile.longitude !== null && (
                        <a
                          href={mapLinkForCoordinates(Number(profile.latitude), Number(profile.longitude))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1.5 text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          на карте
                        </a>
                      )}
                    </span>
                  ) : (
                    <span className="text-zinc-400">не указан</span>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Fingerprint className="w-3.5 h-3.5 text-zinc-400 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
                <div>
                  <span className="text-[10px] text-zinc-400 block">ИНН</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-200">{profile.inn || 'не указан'}</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="w-3.5 h-3.5 text-zinc-400 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
                <div>
                  <span className="text-[10px] text-zinc-400 block">Дата рождения</span>
                  <span className="text-zinc-800 dark:text-zinc-200">
                    {profile.birth_date ? (
                      <>
                        <FormattedDate date={profile.birth_date} type="dateOnly" />
                        {ageFromBirthDate(profile.birth_date) !== null && (
                          <span className="text-zinc-400"> • {ageFromBirthDate(profile.birth_date)} лет</span>
                        )}
                      </>
                    ) : (
                      'не указана'
                    )}
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <User className="w-3.5 h-3.5 text-zinc-400 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
                <div>
                  <span className="text-[10px] text-zinc-400 block">Пол</span>
                  <span className="text-zinc-800 dark:text-zinc-200">
                    {profile.gender === 'male' || profile.gender === 'female' ? GENDER_LABELS[profile.gender] : 'не указан'}
                  </span>
                </div>
              </div>
              {profile.bio && (
                <div className="sm:col-span-2">
                  <span className="text-[10px] text-zinc-400 block">О себе</span>
                  <p className="text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-snug">{profile.bio}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Telegram-уведомления (только для своего профиля) */}
        {!activeViewingUserId && <TelegramCard />}

        {/* Ссылка на документацию API (Swagger) — строго для роли Администратора */}
        {user.can('docs.menu') && (
          <Link
            href="/docs"
            className="flex items-center justify-between p-4 sm:p-5 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 hover:border-blue-500/40 hover:bg-blue-50/20 dark:hover:bg-zinc-800/60 transition-all group shadow-sm"
          >
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <BookOpen className="w-5 h-5" strokeWidth={1.75} />
              </div>
              <div>
                <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span>Документация API (Swagger)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono font-semibold">
                    OpenAPI 3.0
                  </span>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Интерактивная спецификация эндпоинтов и шлюз синхронизации Sotka HQ
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <span className="hidden sm:inline">Открыть Swagger UI</span>
              <ArrowUpRight className="w-4 h-4 text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" strokeWidth={2} />
            </div>
          </Link>
        )}

        {/* Персональный KPI-дашборд в зависимости от отображаемой роли */}
        {/* ДАШБОРД ДЛЯ SMM-СПЕЦИАЛИСТА */}
        {displayedRole === 'smm' && smmStats && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" strokeWidth={2} />
                <span>Оперативные показатели SMM</span>
              </h2>
              <span className="text-xs text-zinc-400">Лидогенерация и конверсия</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1">
                <span className="text-[11px] text-zinc-400 font-medium">За сегодня</span>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                  {smmStats.todayLeads}
                </p>
              </div>
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
                <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">За неделю</span>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 font-mono">
                  {smmStats.weekLeads}
                </p>
              </div>
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-purple-500/10 dark:bg-purple-500/5 border border-purple-500/20 shadow-sm space-y-1">
                <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold">За текущий месяц</span>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-300 font-mono">
                  {smmStats.monthLeads}
                </p>
              </div>
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 shadow-sm space-y-1">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">Всего в базе</span>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                  {smmStats.totalLeads}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-5 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" strokeWidth={2} />
                    Успешная конверсия в подписание
                  </span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    {smmStats.signedRate}%
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${smmStats.signedRate}%` }}
                  />
                </div>
                <p className="text-[11px] text-zinc-400">
                  {smmStats.signedLeads} из {smmStats.totalLeads} заявок успешно завершились подключением
                </p>
              </div>

              <div className="p-5 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <XCircle className="w-4 h-4 text-rose-500" strokeWidth={2} />
                    Уровень отмены заявок (отказ / брак)
                  </span>
                  <span className="font-mono font-bold text-rose-600 dark:text-rose-400 text-sm">
                    {smmStats.cancellationRate}%
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-rose-500 rounded-full transition-all duration-500"
                    style={{ width: `${smmStats.cancellationRate}%` }}
                  />
                </div>
                <p className="text-[11px] text-zinc-400">
                  {smmStats.cancelledLeads} заявок были аннулированы с фиксацией причины
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ДАШБОРД ДЛЯ ПРОДАВЦА-КОНСУЛЬТАНТА */}
        {displayedRole === 'consultant' && consultantStats && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" strokeWidth={2} />
                <span>KPI и вознаграждения консультанта</span>
              </h2>
              <span className="text-xs text-zinc-400">Текущий расчетный период</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 shadow-sm space-y-1">
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">Лидов в обработке</span>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 font-mono">
                  {consultantStats.activeAssignedLeads}
                </p>
              </div>
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1">
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Подписанные сделки</span>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 font-mono">
                  {consultantStats.closedDeals}
                </p>
              </div>
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-purple-500/10 dark:bg-purple-500/5 border border-purple-500/20 shadow-sm space-y-1">
                <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold">В сопровождении</span>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-300 font-mono">
                  {consultantStats.totalActiveClients}
                </p>
              </div>
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
                <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">Выплачено за месяц</span>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 font-mono">
                  {consultantStats.monthTotalPayouts.toLocaleString('ru-RU')} сом
                </p>
              </div>
            </div>

            {/* Карточка детальных начислений */}
            <div className="p-6 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Banknote className="w-4 h-4 text-emerald-500" strokeWidth={2} />
                <span>Структура заработка за расчетный месяц</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-1">
                  <span className="text-zinc-400 block">Бонус за первичное подключение:</span>
                  <span className="font-mono font-bold text-base text-zinc-900 dark:text-zinc-100">
                    +{consultantStats.monthConnectionBonus.toLocaleString('ru-RU')} сом
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-1">
                  <span className="text-zinc-400 block">Бонус за ежемесячное сопровождение:</span>
                  <span className="font-mono font-bold text-base text-purple-600 dark:text-purple-400">
                    +{consultantStats.monthMaintenanceBonus.toLocaleString('ru-RU')} сом
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/20 space-y-1">
                  <span className="text-emerald-700 dark:text-emerald-300 font-semibold block">
                    Итого начислено к выплате:
                  </span>
                  <span className="font-mono font-bold text-lg text-emerald-600 dark:text-emerald-400">
                    +{consultantStats.monthTotalEarnings.toLocaleString('ru-RU')} сом
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ДАШБОРД ДЛЯ АДМИНИСТРАТОРА СИСТЕМЫ */}
        {displayedRole === 'admin' && adminStats && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-500" strokeWidth={2} />
                <span>Глобальные показатели CRM (Консоль Администратора)</span>
              </h2>
              <span className="text-xs text-zinc-400">Сквозной аудит системы</span>
            </div>

            {/* Финансы и продавцы */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1">
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Фонд выплат (месяц)</span>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 font-mono">
                  {adminStats.totalPayoutFundMonth.toLocaleString('ru-RU')} сом
                </p>
              </div>
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-blue-500/10 dark:bg-blue-500/5 border border-blue-500/20 shadow-sm space-y-1">
                <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">Активных продавцов</span>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 font-mono">
                  {adminStats.totalActiveSellers}
                </p>
              </div>
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-purple-500/10 dark:bg-purple-500/5 border border-purple-500/20 shadow-sm space-y-1">
                <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold">Баланс продавцов</span>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-300 font-mono">
                  {adminStats.totalSellersBalance.toLocaleString('ru-RU')} сом
                </p>
              </div>
              <div className="p-4 rounded-2xl backdrop-blur-xl bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 shadow-sm space-y-1">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">Синхронизация API</span>
                <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 pt-1.5 truncate font-mono" suppressHydrationWarning>
                  {adminStats.lastSyncedAt ? formatDateTime(adminStats.lastSyncedAt) : 'Синхронизировано'}
                </p>
              </div>
            </div>

            {/* Сквозная воронка лидов */}
            <div className="p-6 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-500" strokeWidth={2} />
                <span>Сквозная воронка лидов по всей компании</span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-center">
                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800">
                  <span className="text-[11px] text-zinc-400 block">Всего</span>
                  <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                    {adminStats.leadsFunnel.total}
                  </span>
                </div>
                <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400">
                  <span className="text-[11px] block font-semibold">Открыт</span>
                  <span className="text-lg font-bold font-mono">{adminStats.leadsFunnel.open}</span>
                </div>
                <div className="p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400">
                  <span className="text-[11px] block font-semibold">Обработан</span>
                  <span className="text-lg font-bold font-mono">{adminStats.leadsFunnel.processed}</span>
                </div>
                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
                  <span className="text-[11px] block font-semibold">Назначен</span>
                  <span className="text-lg font-bold font-mono">{adminStats.leadsFunnel.assigned}</span>
                </div>
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                  <span className="text-[11px] block font-semibold">Подписан</span>
                  <span className="text-lg font-bold font-mono">{adminStats.leadsFunnel.signed}</span>
                </div>
                <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">
                  <span className="text-[11px] block font-semibold">Отмена</span>
                  <span className="text-lg font-bold font-mono">{adminStats.leadsFunnel.cancelled}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ПРОФИЛЯ */}
        <Modal
          open={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          title="Редактирование профиля"
          subtitle={profile?.login ? `@${profile.login}` : undefined}
          icon={Edit3}
          tone="info"
          size="xl"
          busy={isSavingProfile}
          formId={PROFILE_FORM_ID}
          onSubmit={handleSaveProfile}
          footer={
            <>
              <Button variant="outline" onClick={() => setIsEditModalOpen(false)} disabled={isSavingProfile}>
                Отмена
              </Button>
              <Button type="submit" form={PROFILE_FORM_ID} loading={isSavingProfile}>
                {isSavingProfile ? 'Сохранение...' : 'Сохранить изменения'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="ФИО сотрудника" required htmlFor="profile-edit-name">
              <Input
                id="profile-edit-name"
                type="text"
                required
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                placeholder="Например: Исмаилов Айбек"
                size="lg"
              />
            </FormField>

            <FormField label="Номер телефона">
              <PhoneInput value={editPhoneParts.parts} onChange={editPhoneParts.setParts} size="lg" />
            </FormField>

            {/* Поля роли и активности доступны только администратору */}
            {user.can('employees.edit') && (
              <>
                <FormField label="Роль в системе CRM" htmlFor="profile-edit-role">
                  <Select
                    id="profile-edit-role"
                    value={editRoleId}
                    onChange={(e) => setEditRoleId(e.target.value)}
                    className="font-semibold"
                    size="lg"
                  >
                    {rolesList.length === 0 && <option value="">— Роли не загружены —</option>}
                    {rolesList.map((r) => (
                      <option key={r.role_id} value={r.role_id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </FormField>

                <label className="flex items-center justify-between p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 cursor-pointer text-xs">
                  <div>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 block">
                      Статус активности аккаунта
                    </span>
                    <span className="text-[11px] text-zinc-400">Разрешить вход в систему CRM</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={editIsActive}
                    onChange={(e) => setEditIsActive(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </label>
              </>
            )}

            <ColorPicker value={editColor} onChange={setEditColor} label="Цвет индикатора сотрудника" />

            <div className="pt-3 border-t border-zinc-200/70 dark:border-zinc-800/70 space-y-3">
              <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Анкета сотрудника</h4>
              <p className="text-[11px] text-zinc-400">
                Роль, персональные ставки и активность аккаунта меняет только сотрудник с правами модуля «Сотрудники».
              </p>
              <EmployeeProfileFields value={editProfileFields} onChange={setEditProfileFields} />
            </div>
          </div>
        </Modal>

        {/* 4. МОДАЛЬНОЕ ОКНО СМЕНЫ ПАРОЛЯ */}
        <Modal
          open={isPasswordModalOpen}
          onClose={() => setIsPasswordModalOpen(false)}
          title="Смена пароля"
          subtitle={profile ? `${profile.full_name} (@${profile.login})` : undefined}
          icon={KeyRound}
          tone="info"
          size="sm"
          busy={isSavingPassword}
          formId={PASSWORD_FORM_ID}
          onSubmit={handleSavePassword}
          footer={
            <>
              <Button variant="outline" onClick={() => setIsPasswordModalOpen(false)} disabled={isSavingPassword}>
                Отмена
              </Button>
              <Button type="submit" form={PASSWORD_FORM_ID} variant="info" loading={isSavingPassword}>
                {isSavingPassword ? 'Сохранение...' : 'Обновить пароль'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="Новый пароль (от 6 символов)" required htmlFor="profile-new-password">
              <Input
                id="profile-new-password"
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                size="lg"
              />
            </FormField>

            <FormField label="Подтверждение пароля" required htmlFor="profile-confirm-password">
              <Input
                id="profile-confirm-password"
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                size="lg"
              />
            </FormField>
          </div>
        </Modal>

        {/* 5. ДИАЛОГ ВЫХОДА */}
        <ConfirmDialog
          open={isSignOutConfirmOpen}
          onClose={() => setIsSignOutConfirmOpen(false)}
          onConfirm={handleConfirmSignOut}
          title="Выход из системы"
          subtitle="Завершить текущую сессию CRM?"
          icon={LogOut}
          tone="danger"
          confirmLabel="Выйти из аккаунта"
        />
      </div>
    </AppLayout>
  );
}
