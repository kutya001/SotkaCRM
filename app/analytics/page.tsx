'use client';

import * as React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
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
  PhoneOff,
  CalendarClock,
  PhoneCall,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { getUserProfileAndKpi, type UserProfileData } from '@/app/profile/actions';
import { formatMoney } from '@/lib/utils/money';
import type { UserRole } from '@/types/database.types';
import { EMPTY_LEAD_STATUS_COUNTS, type CancelReasonCount, type LeadStatusCounts } from '@/lib/leads/stats';

/** Этапы воронки на странице: статус, счетчик, подпись и цвет */
const FUNNEL_TILES: {
  key: keyof LeadStatusCounts;
  label: string;
  hint: string;
  icon: React.ElementType;
  tone: string;
}[] = [
  { key: 'open', label: 'Открыт', hint: 'Новые обращения', icon: Clock, tone: 'blue' },
  { key: 'noAnswer', label: 'Нет ответа', hint: 'Не вышли на связь', icon: PhoneOff, tone: 'zinc' },
  { key: 'processed', label: 'Обработан', hint: 'Взят в контакт', icon: UserCheck, tone: 'purple' },
  { key: 'assigned', label: 'Назначен', hint: 'Передан консультанту', icon: Users, tone: 'amber' },
  { key: 'meeting', label: 'Встреча', hint: 'Записан на выезд', icon: CalendarClock, tone: 'sky' },
  { key: 'callback', label: 'Перезвонить', hint: 'Думает, есть дата', icon: PhoneCall, tone: 'orange' },
  { key: 'signed', label: 'Подписан', hint: 'Связан с продавцом', icon: CheckCircle2, tone: 'emerald' },
  { key: 'cancelled', label: 'Отмена', hint: 'Отказ клиента', icon: Ban, tone: 'rose' },
];

const TILE_TONE: Record<string, { box: string; head: string; value: string; bar: string }> = {
  blue: { box: 'bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/20', head: 'text-blue-600 dark:text-blue-400', value: 'text-blue-700 dark:text-blue-300', bar: 'bg-blue-500' },
  zinc: { box: 'bg-zinc-500/5 dark:bg-zinc-500/10 border-zinc-500/20', head: 'text-zinc-600 dark:text-zinc-400', value: 'text-zinc-700 dark:text-zinc-300', bar: 'bg-zinc-500' },
  purple: { box: 'bg-purple-500/5 dark:bg-purple-500/10 border-purple-500/20', head: 'text-purple-600 dark:text-purple-400', value: 'text-purple-700 dark:text-purple-300', bar: 'bg-purple-500' },
  amber: { box: 'bg-amber-500/5 dark:bg-amber-500/10 border-amber-500/20', head: 'text-amber-600 dark:text-amber-400', value: 'text-amber-700 dark:text-amber-300', bar: 'bg-amber-500' },
  sky: { box: 'bg-sky-500/5 dark:bg-sky-500/10 border-sky-500/20', head: 'text-sky-600 dark:text-sky-400', value: 'text-sky-700 dark:text-sky-300', bar: 'bg-sky-500' },
  orange: { box: 'bg-orange-500/5 dark:bg-orange-500/10 border-orange-500/20', head: 'text-orange-600 dark:text-orange-400', value: 'text-orange-700 dark:text-orange-300', bar: 'bg-orange-500' },
  emerald: { box: 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20', head: 'text-emerald-600 dark:text-emerald-400', value: 'text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500' },
  rose: { box: 'bg-rose-500/5 dark:bg-rose-500/10 border-rose-500/20', head: 'text-rose-600 dark:text-rose-400', value: 'text-rose-700 dark:text-rose-300', bar: 'bg-rose-500' },
};

export default function AnalyticsPage() {
  const [isLoading, setIsLoading] = React.useState(true);
  const [userRole, setUserRole] = React.useState<UserRole>('consultant');
  const [userName, setUserName] = React.useState('Сотрудник');
  const [userLogin, setUserLogin] = React.useState('user');

  const [leadsStats, setLeadsStats] = React.useState<LeadStatusCounts>(EMPTY_LEAD_STATUS_COUNTS);
  const [cancelReasons, setCancelReasons] = React.useState<CancelReasonCount[]>([]);

  const [payoutsStats, setPayoutsStats] = React.useState({
    totalAccrued: 0,
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
        const [profileRes, summaryData] = await Promise.all([
          getUserProfileAndKpi(),
          api.analytics.getSummary(),
        ]);

        if (profileRes.profile) {
          setUserRole(profileRes.profile.role as UserRole);
          setUserName(profileRes.profile.full_name);
          setUserLogin(profileRes.profile.login);
        }

        if (summaryData) {
          if (summaryData.leads) setLeadsStats({ ...EMPTY_LEAD_STATUS_COUNTS, ...summaryData.leads });
          if (Array.isArray(summaryData.cancelReasons)) setCancelReasons(summaryData.cancelReasons);
          if (summaryData.payouts) setPayoutsStats(summaryData.payouts);
          if (summaryData.sellers) setSellersStats(summaryData.sellers);
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
              ЗП и авансы • в т.ч. аванс: {formatMoney(payoutsStats.totalAdvances)}
            </p>
          </div>

          {/* Удержания */}
          <div className="p-5 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Удержания</span>
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" strokeWidth={2} />
              </div>
            </div>
            <p className="text-2xl font-black text-zinc-900 dark:text-zinc-100">
              {formatMoney(payoutsStats.totalDeductions)}
            </p>
            <p className="text-[11px] text-zinc-400">
              Начислено: {formatMoney(payoutsStats.totalAccrued)} • операций: {payoutsStats.transactionsCount}
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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            {FUNNEL_TILES.map(({ key, label, hint, icon: Icon, tone }) => {
              const t = TILE_TONE[tone];
              return (
                <div key={key} className={`p-4 rounded-2xl border space-y-1 ${t.box}`}>
                  <div className={`flex items-center gap-1.5 text-xs font-semibold ${t.head}`}>
                    <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>{label}</span>
                  </div>
                  <p className={`text-xl font-black ${t.value}`}>{leadsStats[key]}</p>
                  <p className="text-[10px] text-zinc-400">{hint}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Причины отмены: где теряются лиды — качество рекламы или продажа */}
        <div className="p-6 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-4">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Причины отмены</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Отменено лидов: {leadsStats.cancelled}. «Не целевой» и «Не отвечает» — о качестве заявок, «Дорого» и «Уже есть программа» — о продаже.
            </p>
          </div>
          {cancelReasons.length === 0 ? (
            <p className="text-xs text-zinc-400">Отмен за период нет</p>
          ) : (
            <div className="space-y-2.5">
              {cancelReasons.map((r) => {
                const percent = leadsStats.cancelled > 0 ? Math.round((r.count / leadsStats.cancelled) * 100) : 0;
                return (
                  <div key={r.code} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">{r.label}</span>
                      <span className="font-mono text-zinc-500">
                        {r.count} · {percent}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${r.code === 'unknown' ? 'bg-zinc-400' : 'bg-rose-500'}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
