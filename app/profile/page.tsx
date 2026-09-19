'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { FormattedDate } from '@/components/ui/FormattedDate';
import { useToast } from '@/components/ui/Toast';
import {
  getUserProfileAndKpi,
  type UserProfileData,
  type SmmKpiStats,
  type ConsultantKpiStats,
  type AdminKpiStats,
} from './actions';
import { signOut } from '@/app/auth/actions';
import {
  User,
  ShieldCheck,
  Shield,
  Phone,
  Calendar,
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
} from 'lucide-react';
import type { UserRole } from '@/types/database.types';

export default function ProfilePage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = React.useState(true);
  const [profile, setProfile] = React.useState<UserProfileData | null>(null);
  const [role, setRole] = React.useState<UserRole>('consultant');

  const [smmStats, setSmmStats] = React.useState<SmmKpiStats | null>(null);
  const [consultantStats, setConsultantStats] = React.useState<ConsultantKpiStats | null>(null);
  const [adminStats, setAdminStats] = React.useState<AdminKpiStats | null>(null);

  // Тема оформления
  const [currentTheme, setCurrentTheme] = React.useState<'light' | 'dark' | 'system'>('system');

  // Диалог выхода
  const [isSignOutConfirmOpen, setIsSignOutConfirmOpen] = React.useState(false);
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  const fetchProfile = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getUserProfileAndKpi();
      if (res.profile) {
        setProfile(res.profile);
        setRole(res.role);
        if (res.smmStats) setSmmStats(res.smmStats);
        if (res.consultantStats) setConsultantStats(res.consultantStats);
        if (res.adminStats) setAdminStats(res.adminStats);
      } else {
        showToast('Не удалось загрузить данные профиля', 'error');
      }
    } catch {
      showToast('Ошибка при загрузке профиля', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    fetchProfile();

    // Определяем текущую тему из localStorage
    try {
      const savedTheme = localStorage.getItem('crm_theme') as 'light' | 'dark' | 'system';
      if (savedTheme) setCurrentTheme(savedTheme);
    } catch {}
  }, [fetchProfile]);

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

    showToast(`Тема оформления: ${theme === 'dark' ? 'Тёмная' : theme === 'light' ? 'Светлая' : 'Системная'}`, 'info');
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

  const roleLabel =
    role === 'admin'
      ? 'Администратор системы'
      : role === 'consultant'
      ? 'Продавец-консультант'
      : 'SMM-специалист';

  return (
    <AppLayout
      userRole={role}
      userName={profile?.full_name || 'Сотрудник'}
      userLogin={profile?.login || 'user'}
    >
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* 1. Карточка профиля пользователя (Apple Island Glassmorphism) */}
        <div className="p-6 sm:p-8 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-gradient-to-br from-zinc-800 to-zinc-950 text-white dark:from-zinc-100 dark:to-zinc-300 dark:text-zinc-900 flex items-center justify-center text-2xl sm:text-3xl font-bold shadow-lg flex-shrink-0">
              {profile?.full_name ? profile.full_name.charAt(0) : 'U'}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {profile?.full_name || 'Загрузка...'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Активен
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
                      +{profile.phone}
                    </span>
                  </>
                )}
              </div>
              {profile?.created_at && (
                <p className="text-[11px] text-zinc-400 pt-0.5">
                  В системе с <FormattedDate date={profile.created_at} type="monthYear" />
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-4 md:pt-0 border-zinc-100 dark:border-zinc-800">
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
              className="h-10 px-4 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-1.5 transition-all border border-rose-500/20 active:scale-95"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.75} />
              <span>Выйти</span>
            </button>
          </div>
        </div>

        {/* 2. Персональный KPI-дашборд в зависимости от роли */}

        {/* ДАШБОРД ДЛЯ SMM-СПЕЦИАЛИСТА */}
        {role === 'smm' && smmStats && (
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
        {role === 'consultant' && consultantStats && (
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
                  <span className="text-zinc-400 block">Бонус за первичное подключение (30%):</span>
                  <span className="font-mono font-bold text-base text-zinc-900 dark:text-zinc-100">
                    +{consultantStats.monthConnectionBonus.toLocaleString('ru-RU')} сом
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-1">
                  <span className="text-zinc-400 block">Бонус за ежемесячное сопровождение (10%):</span>
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
        {role === 'admin' && adminStats && (
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
                <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 pt-1.5 truncate">
                  {adminStats.lastSyncedAt
                    ? new Date(adminStats.lastSyncedAt).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : 'Синхронизировано'}
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

        {/* 3. Диалог подтверждения выхода */}
        {isSignOutConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div
              className="w-full max-w-sm p-6 rounded-3xl backdrop-blur-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 text-rose-500">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/10 flex items-center justify-center">
                  <LogOut className="w-5 h-5" strokeWidth={2} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    Выход из системы
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Завершить текущую сессию CRM?
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSignOutConfirmOpen(false)}
                  className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSignOut}
                  disabled={isSigningOut}
                  className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {isSigningOut ? 'Выход...' : 'Выйти из аккаунта'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
