'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { useToast } from '@/components/ui/Toast';
import {
  UserCheck,
  Store,
  CreditCard,
  Link2,
  Banknote,
  BookOpen,
  User,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  ArrowRight,
  Plus,
  Clock,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getUserProfileAndKpi, type UserProfileData } from '@/app/profile/actions';
import { FormattedDate } from '@/components/ui/FormattedDate';
import type { UserRole } from '@/types/database.types';

export default function DashboardPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = React.useState(true);
  const [profile, setProfile] = React.useState<UserProfileData | null>(null);
  const [userRole, setUserRole] = React.useState<UserRole>('consultant');
  const [userName, setUserName] = React.useState('Сотрудник CRM');
  const [userLogin, setUserLogin] = React.useState('user');

  // Реальные оперативные метрики
  const [counts, setCounts] = React.useState({
    totalLeads: 0,
    openLeads: 0,
    signedLeads: 0,
    totalSellers: 0,
    totalConnections: 0,
    monthPayouts: 0,
  });

  const [recentLeads, setRecentLeads] = React.useState<
    { lead_id: string; client_name: string; phone: string; status: string; created_at: string }[]
  >([]);

  React.useEffect(() => {
    async function loadDashboardData() {
      setIsLoading(true);
      try {
        const supabase = createClient();
        const profileRes = await getUserProfileAndKpi();

        if (profileRes.profile) {
          setProfile(profileRes.profile);
          setUserRole(profileRes.role);
          setUserName(profileRes.profile.full_name);
          setUserLogin(profileRes.profile.login);
        }

        // Запрашиваем реальные счетчики
        const [leadsCountRes, sellersCountRes, connCountRes, payoutsRes, recentLeadsRes] =
          await Promise.all([
            supabase.from('leads').select('status', { count: 'exact' }),
            supabase.from('sellers').select('*', { count: 'exact', head: true }),
            supabase.from('connections').select('*', { count: 'exact', head: true }),
            supabase.from('employee_payouts').select('amount, payout_category'),
            supabase
              .from('leads')
              .select('lead_id, client_name, phone, status, created_at')
              .order('created_at', { ascending: false })
              .limit(5),
          ]);

        const allLeads = leadsCountRes.data || [];
        let openCount = 0;
        let signedCount = 0;
        for (const l of allLeads) {
          if (l.status === 'Открыт') openCount++;
          if (l.status === 'Подписан') signedCount++;
        }

        let payoutsSum = 0;
        if (payoutsRes.data) {
          for (const p of payoutsRes.data) {
            if (p.payout_category !== 'удержание') {
              payoutsSum += Number(p.amount) || 0;
            }
          }
        }

        setCounts({
          totalLeads: leadsCountRes.count || allLeads.length,
          openLeads: openCount,
          signedLeads: signedCount,
          totalSellers: sellersCountRes.count || 0,
          totalConnections: connCountRes.count || 0,
          monthPayouts: Math.round(payoutsSum),
        });

        if (recentLeadsRes.data) {
          setRecentLeads(recentLeadsRes.data);
        }
      } catch (err) {
        console.error('Error loading dashboard:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadDashboardData();
  }, []);

  const roleLabel =
    userRole === 'admin'
      ? 'Администратор системы'
      : userRole === 'consultant'
      ? 'Продавец-консультант'
      : 'SMM-специалист';

  return (
    <AppLayout
      userRole={userRole}
      userName={userName}
      userLogin={userLogin}
    >
      <div className="space-y-6">
        {/* 1. Приветственный баннер Apple Island Glassmorphism */}
        <div className="p-6 sm:p-8 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2} />
              <span>{roleLabel}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Здравствуйте, {userName}!
            </h1>
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 max-w-xl">
              Единый командный центр SotkaCRM: оперативный учет входящего потока заявок, сопровождение продавцов платформы и прозрачные финансовые расчеты.
            </p>
          </div>

          <div className="flex items-center gap-2.5 w-full md:w-auto justify-between md:justify-end">
            <Link
              href="/leads"
              className="h-10 px-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold flex items-center gap-2 shadow-md transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} />
              <span>Создать лид</span>
            </Link>
            <Link
              href="/profile"
              className="h-10 px-4 rounded-2xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 border border-zinc-200/50 dark:border-zinc-700/50"
            >
              <User className="w-4 h-4 text-purple-500" strokeWidth={1.75} />
              <span>Мой профиль</span>
            </Link>
          </div>
        </div>

        {/* 2. Живые оперативные счетчики */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <Link
            href="/leads"
            className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer block"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium">Всего лидов в воронке</span>
              <div className="w-7 h-7 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <UserCheck className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {counts.totalLeads}
            </p>
            <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold block">
              {counts.openLeads} открытых заявок
            </span>
          </Link>

          <Link
            href={userRole === 'smm' ? '/leads' : '/sellers'}
            className="p-4 rounded-2xl backdrop-blur-xl bg-purple-500/10 dark:bg-purple-500/5 border border-purple-500/20 shadow-sm space-y-1 hover:border-purple-500/40 transition-all cursor-pointer block"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold">
                Продавцы Sotka
              </span>
              <div className="w-7 h-7 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                <Store className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-300 font-mono">
              {counts.totalSellers}
            </p>
            <span className="text-[11px] text-purple-600 dark:text-purple-400 block">
              Синхронизировано из API
            </span>
          </Link>

          <Link
            href={userRole === 'smm' ? '/leads' : '/connections'}
            className="p-4 rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1 hover:border-emerald-500/40 transition-all cursor-pointer block"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                Активные подключения
              </span>
              <div className="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Link2 className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 font-mono">
              {counts.totalConnections}
            </p>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 block">
              {counts.signedLeads} подписанных лидов
            </span>
          </Link>

          <Link
            href={userRole === 'smm' ? '/profile' : '/payouts'}
            className="p-4 rounded-2xl backdrop-blur-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 shadow-sm space-y-1 hover:border-amber-500/40 transition-all cursor-pointer block"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                Фонд выплат сотрудникам
              </span>
              <div className="w-7 h-7 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Banknote className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 font-mono">
              {counts.monthPayouts.toLocaleString('ru-RU')} сом
            </p>
            <span className="text-[11px] text-amber-600 dark:text-amber-400 block">
              Начисления и авансы
            </span>
          </Link>
        </div>

        {/* 3. Быстрая навигация по ключевым разделам */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-500" strokeWidth={2} />
            <span>Быстрый доступ к рабочим модулям</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Link
              href="/leads"
              className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group flex items-start justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <UserCheck className="w-5 h-5" strokeWidth={1.75} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 transition-colors">
                    Воронка лидов
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Реестр заявок, воронка статусов и скрипты продаж
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
            </Link>

            {userRole !== 'smm' && (
              <Link
                href="/sellers"
                className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group flex items-start justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <Store className="w-5 h-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-purple-600 transition-colors">
                      База продавцов
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Клиенты платформы Sotka и их лицевые балансы
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            )}

            {userRole !== 'smm' && (
              <Link
                href="/connections"
                className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group flex items-start justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Link2 className="w-5 h-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-emerald-600 transition-colors">
                      Подключения клиентов
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Привязка к консультантам и сопровождение
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            )}

            {userRole !== 'smm' && (
              <Link
                href="/payouts"
                className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group flex items-start justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                    <Banknote className="w-5 h-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-amber-600 transition-colors">
                      Журнал выплат
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Учет заработной платы, авансов и премий
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            )}

            {userRole === 'admin' && (
              <Link
                href="/plans"
                className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group flex items-start justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 flex items-center justify-center">
                    <BookOpen className="w-5 h-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-zinc-600 transition-colors">
                      Справочники системы
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Тарифы платформы и индивидуальные процентные ставки
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            )}

            <Link
              href="/profile"
              className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group flex items-start justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white flex items-center justify-center">
                  <User className="w-5 h-5" strokeWidth={1.75} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-purple-600 transition-colors">
                    Профиль и KPI
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Персональные показатели, переключатель темы и сессия
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </div>

        {/* 4. Последние события воронки лидов */}
        <div className="p-6 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-zinc-400" strokeWidth={1.75} />
                <span>Последние поступившие лиды</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Оперативный входящий поток заявок
              </p>
            </div>
            <Link
              href="/leads"
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <span>Ко всем лидам</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="space-y-2">
            {recentLeads.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-4">Лиды отсутствуют в базе</p>
            ) : (
              recentLeads.map((l) => (
                <div
                  key={l.lead_id}
                  onClick={() => router.push('/leads')}
                  className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between gap-3 text-xs cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                      {l.client_name.charAt(0)}
                    </div>
                    <div>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100 block">
                        {l.client_name}
                      </span>
                      <span className="text-[11px] text-zinc-400 font-mono">
                        +{l.phone}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
                      {l.status}
                    </span>
                    <span className="text-[11px] text-zinc-400 font-mono hidden sm:inline">
                      <FormattedDate date={l.created_at} type="date" />
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
