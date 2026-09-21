'use client';

import * as React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  BarChart3,
  TrendingUp,
  UserCheck,
  Store,
  Banknote,
  Percent,
  CheckCircle2,
  Clock,
  Ban,
  ArrowUpRight,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { getAnalyticsSummaryAction } from '@/app/analytics/actions';
import { getUserProfileAndKpi, type UserProfileData } from '@/app/profile/actions';
import { formatMoney } from '@/lib/utils/money';
import type { UserRole } from '@/types/database.types';

export default function AnalyticsPage() {
  const [isLoading, setIsLoading] = React.useState(true);
  const [userRole, setUserRole] = React.useState<UserRole>('consultant');
  const [userName, setUserName] = React.useState('Сотрудник');
  const [userLogin, setUserLogin] = React.useState('user');

  const [leadsStats, setLeadsStats] = React.useState({
    total: 0,
    open: 0,
    processed: 0,
    assigned: 0,
    signed: 0,
    cancelled: 0,
  });

  const [payoutsStats, setPayoutsStats] = React.useState({
    totalPaid: 0,
    totalAdvances: 0,
    totalDeductions: 0,
    transactionsCount: 0,
  });

  const [sellersStats, setSellersStats] = React.useState({
    total: 0,
    active: 0,
    pending: 0,
    totalBalance: 0,
  });

  React.useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const [profileRes, summaryRes] = await Promise.all([
          getUserProfileAndKpi(),
          getAnalyticsSummaryAction(),
        ]);

        if (profileRes.profile) {
          setUserRole(profileRes.profile.role as UserRole);
          setUserName(profileRes.profile.full_name);
          setUserLogin(profileRes.profile.login);
        }

        if (summaryRes.success && summaryRes.data) {
          setLeadsStats(summaryRes.data.leads);
          setPayoutsStats(summaryRes.data.payouts);
          setSellersStats(summaryRes.data.sellers);
        }
      } catch (err) {
        console.error('Ошибка загрузки аналитики:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  // Расчет конверсии воронки
  const conversionRate =
    leadsStats.total > 0
      ? Math.round((leadsStats.signed / leadsStats.total) * 1000) / 10
      : 0;

  return (
    <AppLayout
      userRole={userRole}
      userName={userName}
      userLogin={userLogin}
    >
      <div className="space-y-6 pb-20 lg:pb-6">
        {/* Заголовок страницы */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <BarChart3 className="w-4 h-4" strokeWidth={2} />
              <span>Сводная аналитика</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight mt-1">
              KPI и показатели эффективности
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Оперативная статистика воронки лидов, клиентской базы и фонда выплат
            </p>
          </div>
        </div>

        {/* 1. Главные метрики воронки */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Конверсия воронки */}
          <div className="p-5 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Конверсия воронки</span>
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Percent className="w-4 h-4" strokeWidth={2} />
              </div>
            </div>
            <p className="text-2xl font-black text-zinc-900 dark:text-zinc-100">{conversionRate}%</p>
            <p className="text-[11px] text-zinc-400">
              {leadsStats.signed} подписано из {leadsStats.total} заявок
            </p>
          </div>

          {/* Активные продавцы */}
          <div className="p-5 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">База продавцов</span>
              <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                <Store className="w-4 h-4" strokeWidth={2} />
              </div>
            </div>
            <p className="text-2xl font-black text-zinc-900 dark:text-zinc-100">{sellersStats.total}</p>
            <p className="text-[11px] text-zinc-400">
              Синхронизировано из платформы Сотка
            </p>
          </div>

          {/* Фонд выплат */}
          <div className="p-5 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Всего выплат</span>
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Banknote className="w-4 h-4" strokeWidth={2} />
              </div>
            </div>
            <p className="text-2xl font-black text-zinc-900 dark:text-zinc-100">
              {formatMoney(payoutsStats.totalPaid)}
            </p>
            <p className="text-[11px] text-zinc-400">
              Транзакций начислений: {payoutsStats.transactionsCount}
            </p>
          </div>

          {/* Удержания */}
          <div className="p-5 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Авансы / Удержания</span>
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" strokeWidth={2} />
              </div>
            </div>
            <p className="text-2xl font-black text-zinc-900 dark:text-zinc-100">
              {formatMoney(payoutsStats.totalAdvances)}
            </p>
            <p className="text-[11px] text-zinc-400">
              Удержания: {formatMoney(payoutsStats.totalDeductions)}
            </p>
          </div>
        </div>

        {/* 2. Детализация воронки продаж */}
        <div className="p-6 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Этапы воронки продаж
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Текущее распределение клиентских заявок по жизненному циклу
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-semibold bg-blue-500/10 px-3 py-1 rounded-xl">
              <TrendingUp className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Конверсия {conversionRate}%</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
            <div className="p-4 rounded-2xl bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20 space-y-1">
              <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 text-xs font-semibold">
                <Clock className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Открыт</span>
              </div>
              <p className="text-xl font-black text-blue-700 dark:text-blue-300">{leadsStats.open}</p>
              <p className="text-[10px] text-zinc-400">Новые обращения</p>
            </div>

            <div className="p-4 rounded-2xl bg-purple-500/5 dark:bg-purple-500/10 border border-purple-500/20 space-y-1">
              <div className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400 text-xs font-semibold">
                <UserCheck className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Обработан</span>
              </div>
              <p className="text-xl font-black text-purple-700 dark:text-purple-300">{leadsStats.processed}</p>
              <p className="text-[10px] text-zinc-400">Взят в контакт</p>
            </div>

            <div className="p-4 rounded-2xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 space-y-1">
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs font-semibold">
                <Users className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Назначен</span>
              </div>
              <p className="text-xl font-black text-amber-700 dark:text-amber-300">{leadsStats.assigned}</p>
              <p className="text-[10px] text-zinc-400">Передан консультанту</p>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Подписан</span>
              </div>
              <p className="text-xl font-black text-emerald-700 dark:text-emerald-300">{leadsStats.signed}</p>
              <p className="text-[10px] text-zinc-400">Связан с продавцом</p>
            </div>

            <div className="p-4 rounded-2xl bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/20 space-y-1 col-span-2 sm:col-span-1">
              <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 text-xs font-semibold">
                <Ban className="w-3.5 h-3.5" strokeWidth={2} />
                <span>Отмена</span>
              </div>
              <p className="text-xl font-black text-rose-700 dark:text-rose-300">{leadsStats.cancelled}</p>
              <p className="text-[10px] text-zinc-400">Отказ клиента</p>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
