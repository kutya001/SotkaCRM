'use client';

import * as React from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  UserCheck,
  Store,
  CreditCard,
  Link2,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  ShieldCheck,
  Banknote,
} from 'lucide-react';
import type { UserRole } from '@/types/database.types';

import { signOut } from '@/app/auth/actions';
import { createClient } from '@/lib/supabase/client';

export default function DashboardPage() {
  const [userRole, setUserRole] = React.useState<UserRole>('admin');
  const [userName, setUserName] = React.useState('Айбек Исмаилов');
  const [isSyncing, setIsSyncing] = React.useState(false);

  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('role, full_name, login')
          .eq('auth_id', user.id)
          .single();
        if (profile) {
          setUserRole(profile.role);
          setUserName(profile.full_name);
        }
      }
    });
  }, []);

  const handleSyncApi = async () => {
    setIsSyncing(true);
    // В этапе 3 здесь будет вызов POST /api/sync/sotka
    setTimeout(() => {
      setIsSyncing(false);
    }, 1500);
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <AppLayout
      userRole={userRole}
      userName={userName}
      onSyncApi={handleSyncApi}
      isSyncing={isSyncing}
      onSignOut={handleSignOut}
    >
      <div className="space-y-6">
        {/* Приветственный блок */}
        <div className="island-card p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-200/60 dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300 mb-2 border border-zinc-300/40 dark:border-zinc-700/40">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
              <span>Роль: {userRole === 'admin' ? 'Администратор' : userRole === 'consultant' ? 'Консультант' : 'SMM-оператор'}</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Добро пожаловать в SotkaCRM
            </h2>
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
              Единая система управления лидами, продавцами и финансовыми начислениями
            </p>
          </div>

          {/* Быстрый переключатель роли (для удобства демонстрации в этапе 1) */}
          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-zinc-200/60 dark:bg-zinc-800/60 self-start sm:self-center border border-zinc-300/40 dark:border-zinc-700/40">
            {(['admin', 'consultant', 'smm'] as UserRole[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setUserRole(r)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all island-interactive ${
                  userRole === r
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm font-semibold'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Сетка KPI-метрик (динамически под роль) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {userRole === 'admin' && (
            <>
              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Всего лидов в воронке</span>
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                    <UserCheck className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">148</span>
                  <span className="text-xs text-emerald-600 ml-2 font-medium">+12 сегодня</span>
                </div>
              </div>

              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Продавцы на платформе</span>
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
                    <Store className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">142</span>
                  <span className="text-xs text-zinc-500 ml-2 font-medium">98 активных</span>
                </div>
              </div>

              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Сумма транзакций</span>
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                    <CreditCard className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">584 000 сом</span>
                  <span className="text-xs text-emerald-600 ml-2 font-medium">+8.4%</span>
                </div>
              </div>

              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Выплаты персоналу</span>
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                    <Banknote className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">64 200 сом</span>
                  <span className="text-xs text-zinc-500 ml-2 font-medium">за сентябрь</span>
                </div>
              </div>
            </>
          )}

          {userRole === 'consultant' && (
            <>
              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">В активной работе</span>
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                    <Clock className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">7 заявок</span>
                  <span className="text-xs text-blue-600 ml-2 font-medium">требуют контакта</span>
                </div>
              </div>

              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Закрытые сделки</span>
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">19 сделок</span>
                  <span className="text-xs text-emerald-600 ml-2 font-medium">статус Подписан</span>
                </div>
              </div>

              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Бонус за подключения</span>
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">22 500 сом</span>
                  <span className="text-xs text-zinc-500 ml-2 font-medium">30% от тарифов</span>
                </div>
              </div>

              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Сопровождение клиентов</span>
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
                    <Link2 className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">7 800 сом</span>
                  <span className="text-xs text-zinc-500 ml-2 font-medium">10% активные связи</span>
                </div>
              </div>
            </>
          )}

          {userRole === 'smm' && (
            <>
              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Создано сегодня</span>
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                    <UserCheck className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">8 лидов</span>
                  <span className="text-xs text-emerald-600 ml-2 font-medium">новые заявки</span>
                </div>
              </div>

              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">За текущую неделю</span>
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">43 лида</span>
                  <span className="text-xs text-zinc-500 ml-2 font-medium">план 50</span>
                </div>
              </div>

              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Успешная конверсия</span>
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">68%</span>
                  <span className="text-xs text-emerald-600 ml-2 font-medium">высокое качество</span>
                </div>
              </div>

              <div className="island-card p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">Отмененные заявки</span>
                  <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
                    <AlertCircle className="w-4 h-4" strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">4 лида</span>
                  <span className="text-xs text-rose-600 ml-2 font-medium">9.3% брака</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Быстрые переходы к модулям */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/leads"
            className="island-card p-6 group hover:border-zinc-400/50 dark:hover:border-zinc-700 transition-all island-interactive"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                <UserCheck className="w-5 h-5" strokeWidth={2} />
              </div>
              <ArrowUpRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors" />
            </div>
            <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
              Воронка лидов
            </h3>
            <p className="text-xs text-zinc-500 mt-1">
              Реестр входящих заявок, обработка статусов и связывание с продавцами
            </p>
          </Link>

          {userRole !== 'smm' && (
            <Link
              href="/sellers"
              className="island-card p-6 group hover:border-zinc-400/50 dark:hover:border-zinc-700 transition-all island-interactive"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
                  <Store className="w-5 h-5" strokeWidth={2} />
                </div>
                <ArrowUpRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors" />
              </div>
              <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                Каталог продавцов
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                База зарегистрированных аккаунтов, синхронизированных с api.sotka.kg
              </p>
            </Link>
          )}

          {userRole !== 'smm' && (
            <Link
              href="/connections"
              className="island-card p-6 group hover:border-zinc-400/50 dark:hover:border-zinc-700 transition-all island-interactive"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                  <Link2 className="w-5 h-5" strokeWidth={2} />
                </div>
                <ArrowUpRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors" />
              </div>
              <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                Связи и начисления
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                Закрепление продавцов 1:1, расчет комиссий за подключение и сопровождение
              </p>
            </Link>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
