'use client';

import * as React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { DataJournal, JournalMenuItem, type ColumnDef, type DataJournalTab, type StatusOption } from '@/components/ui/DataJournal';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TelegramBroadcastModal } from '@/components/telegram/TelegramBroadcastModal';
import { useUser } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/utils/format';
import { ROLE_LABELS } from '@/lib/constants/roles';
import {
  Send,
  Bot,
  Webhook,
  Users,
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
  MinusCircle,
  RotateCcw,
  Unlink,
  Eye,
  AlertTriangle,
  ShieldCheck,
  Trash2,
  MessageSquareText,
  UserRound,
} from 'lucide-react';
import type { UserRole } from '@/types/database.types';

type Overview = Awaited<ReturnType<typeof api.telegram.adminOverview>>;
type EmployeeLink = Overview['employees'][number];
type OutboxItem = Awaited<ReturnType<typeof api.telegram.adminOutbox>>['items'][number];
type PrefKey = keyof EmployeeLink['prefs'];
type PageTab = 'outbox' | 'employees';

const PAGE_TAB_STORAGE_KEY = 'sotka_telegram_tab';

/** Статусы, из которых сообщение можно отправить повторно */
const RETRYABLE_STATUSES = new Set(['failed', 'skipped', 'pending']);

const STATUS_OPTIONS: StatusOption[] = [
  { value: 'sent', label: 'Отправлено', colorClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', dotColor: 'bg-emerald-500' },
  { value: 'pending', label: 'В очереди', colorClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30', dotColor: 'bg-amber-500' },
  { value: 'sending', label: 'Отправляется', colorClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30', dotColor: 'bg-sky-500' },
  { value: 'failed', label: 'Ошибка', colorClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30', dotColor: 'bg-rose-500' },
  { value: 'skipped', label: 'Пропущено', colorClass: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30', dotColor: 'bg-zinc-400' },
];

const KIND_OPTIONS: StatusOption[] = [
  { value: 'connections', label: 'Подключения', colorClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30', dotColor: 'bg-blue-500' },
  { value: 'payroll', label: 'Операции по ЗП', colorClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', dotColor: 'bg-emerald-500' },
  { value: 'leads', label: 'Лиды', colorClass: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30', dotColor: 'bg-purple-500' },
  { value: 'tasks', label: 'Задачи', colorClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30', dotColor: 'bg-amber-500' },
  { value: 'broadcast', label: 'Рассылка', colorClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30', dotColor: 'bg-sky-500' },
  { value: 'system', label: 'Системное', colorClass: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30', dotColor: 'bg-zinc-400' },
];

const PREF_LABELS: Record<PrefKey, string> = {
  payroll: 'ЗП',
  connections: 'Подключения',
  leads: 'Лиды',
  tasks: 'Задачи',
  broadcast: 'Рассылка',
};

function Badge({ value, options }: { value: string; options: StatusOption[] }) {
  const opt = options.find((o) => o.value === value);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${
        opt?.colorClass || 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${opt?.dotColor || 'bg-zinc-400'}`} />
      {opt?.label || value}
    </span>
  );
}

export default function TelegramPage() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const user = useUser();
  const isAdmin = user.can('telegram.manage') || user.can('telegram.broadcast');
  // Массовые действия над журналом доступны только с правом управления (сервер проверяет telegram.manage)
  const canManageOutbox = user.can('telegram.manage');

  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [items, setItems] = React.useState<OutboxItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isDispatching, setIsDispatching] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusTab, setStatusTab] = React.useState('all');
  const [pageTab, setPageTab] = React.useState<PageTab>('outbox');
  const [isBroadcastOpen, setIsBroadcastOpen] = React.useState(false);
  const [selectedItem, setSelectedItem] = React.useState<OutboxItem | null>(null);
  const [retryingId, setRetryingId] = React.useState<string | null>(null);
  const [workingUserId, setWorkingUserId] = React.useState<string | null>(null);
  const [showAllEmployees, setShowAllEmployees] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [isBatchLoading, setIsBatchLoading] = React.useState(false);

  // Вкладка страницы запоминается в браузере (читается после монтирования, чтобы не ломать гидратацию)
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PAGE_TAB_STORAGE_KEY);
      if (saved === 'outbox' || saved === 'employees') setPageTab(saved);
    } catch {
      /* localStorage недоступен */
    }
  }, []);

  const changePageTab = (next: PageTab) => {
    setPageTab(next);
    try {
      window.localStorage.setItem(PAGE_TAB_STORAGE_KEY, next);
    } catch {
      /* localStorage недоступен */
    }
  };

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [ov, box] = await Promise.all([api.telegram.adminOverview(), api.telegram.adminOutbox({ limit: 1000 })]);
      setOverview(ov);
      setItems(box.items);
    } catch (err: any) {
      showToast(err.message || 'Не удалось загрузить данные Telegram', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    if (isAdmin) fetchData();
  }, [fetchData, isAdmin]);

  const handleDispatchNow = async () => {
    setIsDispatching(true);
    try {
      const res = await api.telegram.dispatchNow();
      showToast(
        res.claimed === 0
          ? 'Очередь пуста'
          : `Отправлено: ${res.sent}, ошибок: ${res.failed}, пропущено: ${res.skipped}`,
        res.failed > 0 ? 'info' : 'success'
      );
      await fetchData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось отправить очередь', 'error');
    } finally {
      setIsDispatching(false);
    }
  };

  const handleRetry = async (item: OutboxItem) => {
    setRetryingId(item.id);
    try {
      const res = await api.telegram.adminRetry(item.id);
      showToast(
        res.status === 'sent' ? 'Сообщение отправлено' : `Статус: ${res.status}${res.error ? ` — ${res.error}` : ''}`,
        res.status === 'sent' ? 'success' : 'info'
      );
      await fetchData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось отправить повторно', 'error');
    } finally {
      setRetryingId(null);
    }
  };

  // Массовые действия над журналом сообщений
  const handleBulkRetry = async (ids: string[], clearSelection: () => void) => {
    setIsBatchLoading(true);
    try {
      const res = await api.telegram.adminOutboxBatch({ action: 'retry', ids });
      showToast(
        res.affected === 0
          ? 'Среди выбранных нет сообщений для повторной отправки'
          : `В очередь: ${res.affected}, отправлено: ${res.sent ?? 0}, ошибок: ${res.failed ?? 0}`,
        res.affected === 0 ? 'info' : (res.failed ?? 0) > 0 ? 'info' : 'success'
      );
      clearSelection();
      await fetchData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось отправить повторно', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  const handleBulkDelete = async (ids: string[], clearSelection: () => void) => {
    const ok = await confirm({
      title: `Удалить сообщения (${ids.length})?`,
      description: 'Записи журнала будут удалены безвозвратно. Уже отправленные сообщения у получателей останутся.',
      tone: 'danger',
      icon: Trash2,
      confirmLabel: 'Удалить',
    });
    if (!ok) return;
    setIsBatchLoading(true);
    try {
      const res = await api.telegram.adminOutboxBatch({ action: 'delete', ids });
      showToast(`Удалено сообщений: ${res.affected}`, 'info');
      clearSelection();
      await fetchData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось удалить сообщения', 'error');
    } finally {
      setIsBatchLoading(false);
    }
  };

  const handleUnlink = async (emp: EmployeeLink) => {
    const ok = await confirm({
      title: 'Отвязать Telegram сотрудника?',
      subtitle: emp.full_name,
      description: 'Уведомления перестанут приходить. Сотрудник сможет подключить Telegram заново в своем профиле.',
      tone: 'warning',
      icon: Unlink,
      confirmLabel: 'Отвязать',
    });
    if (!ok) return;
    setWorkingUserId(emp.user_id);
    try {
      await api.telegram.adminUnlinkUser(emp.user_id);
      showToast(`Telegram сотрудника ${emp.full_name} отвязан`, 'info');
      await fetchData();
    } catch (err: any) {
      showToast(err.message || 'Не удалось отвязать', 'error');
    } finally {
      setWorkingUserId(null);
    }
  };

  const togglePref = async (emp: EmployeeLink, key: PrefKey) => {
    const next = !emp.prefs[key];
    setOverview((prev) =>
      prev
        ? { ...prev, employees: prev.employees.map((e) => (e.user_id === emp.user_id ? { ...e, prefs: { ...e.prefs, [key]: next } } : e)) }
        : prev
    );
    try {
      await api.telegram.adminUpdateUserPrefs(emp.user_id, { [key]: next });
    } catch (err: any) {
      showToast(err.message || 'Не удалось сохранить настройку', 'error');
      await fetchData();
    }
  };

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const it of items) c[it.status] = (c[it.status] || 0) + 1;
    return c;
  }, [items]);

  const tabs: DataJournalTab[] = [
    { id: 'all', label: 'Все', count: counts.all || 0 },
    { id: 'sent', label: 'Отправлено', count: counts.sent || 0, icon: CheckCircle2 },
    { id: 'pending', label: 'В очереди', count: (counts.pending || 0) + (counts.sending || 0), icon: Clock },
    { id: 'failed', label: 'Ошибки', count: counts.failed || 0, icon: XCircle },
    { id: 'skipped', label: 'Пропущено', count: counts.skipped || 0, icon: MinusCircle },
  ];

  const visibleItems = React.useMemo(() => {
    if (statusTab === 'all') return items;
    if (statusTab === 'pending') return items.filter((i) => i.status === 'pending' || i.status === 'sending');
    return items.filter((i) => i.status === statusTab);
  }, [items, statusTab]);

  const columns: ColumnDef<OutboxItem>[] = React.useMemo(
    () => [
      {
        key: 'created_at',
        label: 'Создано',
        type: 'datetime',
        width: 170,
        minWidth: 150,
        sortable: true,
        filterable: true,
        filterType: 'dateRange',
      },
      {
        key: 'recipient',
        label: 'Получатель',
        width: 200,
        minWidth: 160,
        sortable: true,
        filterable: true,
        textValue: (row) => row.recipient?.full_name || '',
        renderCell: (row) =>
          row.recipient ? (
            <EmployeeBadge name={row.recipient.full_name} color={row.recipient.color} size="sm" />
          ) : (
            <span className="text-xs text-zinc-400">—</span>
          ),
      },
      {
        key: 'kind',
        label: 'Вид',
        type: 'status',
        statusOptions: KIND_OPTIONS,
        width: 150,
        minWidth: 120,
        sortable: true,
        filterable: true,
        filterType: 'select',
        renderCell: (row) => <Badge value={row.kind} options={KIND_OPTIONS} />,
      },
      {
        key: 'title',
        label: 'Сообщение',
        width: 320,
        minWidth: 200,
        sortable: true,
        filterable: true,
        cardTitle: true,
        renderCell: (row) => (
          <div className="min-w-0">
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{row.title}</div>
            {row.body && <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{row.body.split('\n')[0]}</div>}
          </div>
        ),
      },
      {
        key: 'status',
        label: 'Статус',
        type: 'status',
        statusOptions: STATUS_OPTIONS,
        width: 140,
        minWidth: 120,
        sortable: true,
        filterable: true,
        filterType: 'select',
        renderCell: (row) => <Badge value={row.status} options={STATUS_OPTIONS} />,
      },
      {
        key: 'sent_at',
        label: 'Отправлено',
        type: 'datetime',
        width: 170,
        minWidth: 150,
        sortable: true,
        filterable: false,
      },
      {
        key: 'error',
        label: 'Ошибка',
        width: 220,
        minWidth: 160,
        sortable: false,
        filterable: true,
        renderCell: (row) =>
          row.error ? (
            <span className="text-[11px] text-rose-600 dark:text-rose-400 truncate block" title={row.error}>
              {row.error}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">—</span>
          ),
      },
    ],
    []
  );

  // Контекстное меню строки журнала (ПКМ / «⋯»)
  const renderRowActions = React.useCallback(
    (row: OutboxItem) => (
      <>
        <JournalMenuItem icon={Eye} label="Открыть текст" onClick={() => setSelectedItem(row)} />
        {RETRYABLE_STATUSES.has(row.status) && (
          <JournalMenuItem
            icon={RotateCcw}
            label="Повторить отправку"
            tone="info"
            disabled={retryingId === row.id}
            onClick={() => void handleRetry(row)}
          />
        )}
        {row.recipient && (
          <JournalMenuItem icon={UserRound} label="Открыть получателя" href={`/employees?q=${encodeURIComponent(row.recipient.login)}`} />
        )}
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [retryingId]
  );

  const employees = React.useMemo(() => {
    const list = overview?.employees || [];
    return showAllEmployees ? list : list.filter((e) => e.is_active);
  }, [overview, showAllEmployees]);

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="p-8 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 text-center space-y-2">
          <ShieldCheck className="w-8 h-8 mx-auto text-zinc-400" strokeWidth={1.5} />
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Модуль доступен только администратору</p>
          <p className="text-xs text-zinc-500">Подключить свои уведомления можно в разделе «Профиль».</p>
        </div>
      </AppLayout>
    );
  }

  const webhook = overview?.webhook;
  const webhookOk = Boolean(webhook?.url && webhook.secret_configured && !webhook.last_error);
  const activeEmployeesTotal = overview?.employees.filter((e) => e.is_active).length ?? '—';

  // Действия модуля в тулбаре журнала: отправить очередь, рассылка
  const outboxActions = (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
      <button
        type="button"
        onClick={handleDispatchNow}
        disabled={isDispatching || !overview?.configured}
        className="h-9 md:h-11 w-9 md:w-auto p-0 md:px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center md:gap-2 transition-all active:scale-95 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 island-interactive flex-shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        title="Отправить сообщения, ожидающие в очереди"
        aria-label="Отправить очередь"
      >
        <Inbox className={`w-4 h-4 flex-shrink-0 ${isDispatching ? 'animate-pulse' : ''}`} strokeWidth={1.75} />
        <span className="hidden md:inline">Отправить очередь{overview && overview.outbox.pending > 0 ? ` (${overview.outbox.pending})` : ''}</span>
      </button>
      <button
        type="button"
        onClick={() => setIsBroadcastOpen(true)}
        disabled={!overview?.configured}
        className="h-9 md:h-11 w-9 md:w-auto p-0 md:px-3.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center justify-center md:gap-2 transition-all active:scale-95 shadow-sm island-interactive flex-shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        title="Рассылка сотрудникам"
        aria-label="Рассылка"
      >
        <Send className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
        <span className="hidden md:inline">Рассылка</span>
      </button>
    </div>
  );

  // KPI журнала сообщений (над тулбаром, сворачиваются кнопкой «статистика»)
  const outboxStats = (
    <div className="grid grid-cols-3 gap-3">
      <div className="p-4 rounded-2xl backdrop-blur-xl bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 shadow-sm space-y-1">
        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Отправлено</span>
        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 font-mono">{overview?.outbox.sent ?? '—'}</p>
      </div>
      <div className="p-4 rounded-2xl backdrop-blur-xl bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 shadow-sm space-y-1">
        <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">В очереди</span>
        <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 font-mono">{overview?.outbox.pending ?? '—'}</p>
      </div>
      <div className="p-4 rounded-2xl backdrop-blur-xl bg-rose-500/10 dark:bg-rose-500/5 border border-rose-500/20 shadow-sm space-y-1">
        <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">Ошибки / пропущено</span>
        <p className="text-2xl font-bold text-rose-700 dark:text-rose-300 font-mono">
          {overview ? overview.outbox.failed : '—'}
          <span className="text-xs text-rose-600/70 dark:text-rose-400/70 font-medium"> / {overview?.outbox.skipped ?? '—'}</span>
        </p>
      </div>
    </div>
  );

  // Состояние бота и вебхука + сколько сотрудников подключили Telegram (шапка вкладки сотрудников)
  const botStatus = (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="p-4 rounded-2xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-1 sm:col-span-2">
        <span className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5" /> Бот
        </span>
        {overview?.configured ? (
          <>
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
              {overview.bot ? `@${overview.bot.username}` : 'Токен задан, Bot API недоступен'}
            </p>
            <p className={`text-[11px] flex items-center gap-1 ${webhookOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              <Webhook className="w-3 h-3" />
              {webhookOk
                ? 'Вебхук работает'
                : !webhook?.secret_configured
                ? 'Не задан TELEGRAM_WEBHOOK_SECRET'
                : !webhook?.url
                ? 'Вебхук не зарегистрирован — зарегистрируется при первой привязке'
                : webhook.last_error || 'Проверьте вебхук'}
            </p>
          </>
        ) : (
          <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Не задан TELEGRAM_BOT_TOKEN
          </p>
        )}
      </div>
      <div className="p-4 rounded-2xl backdrop-blur-xl bg-sky-500/10 dark:bg-sky-500/5 border border-sky-500/20 shadow-sm space-y-1">
        <span className="text-[11px] text-sky-600 dark:text-sky-400 font-semibold flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Подключили
        </span>
        <p className="text-2xl font-bold text-sky-700 dark:text-sky-300 font-mono">
          {overview?.linked_total ?? '—'}
          <span className="text-xs text-sky-600/70 dark:text-sky-400/70 font-medium"> / {activeEmployeesTotal}</span>
        </p>
      </div>
    </div>
  );

  const pageTabs: { id: PageTab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'outbox', label: 'Журнал сообщений', icon: MessageSquareText, count: items.length },
    { id: 'employees', label: 'Подключения сотрудников', icon: Users, count: overview?.linked_total },
  ];

  return (
    <AppLayout
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Поиск по сообщениям, получателям, ошибкам..."
      hideFab
    >
      <div className="space-y-6 pb-16">
        {/* Вкладки страницы: журнал сообщений / подключения сотрудников */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-zinc-200/60 dark:bg-zinc-800/60 p-1 rounded-2xl border border-zinc-200/40 dark:border-zinc-700/40 h-10 max-w-full overflow-x-auto no-scrollbar">
            {pageTabs.map((t) => {
              const isActive = pageTab === t.id;
              const TabIcon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => changePageTab(t.id)}
                  className={`h-8 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                    isActive ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                  aria-pressed={isActive}
                >
                  <TabIcon className="w-3.5 h-3.5" strokeWidth={1.75} />
                  <span>{t.label}</span>
                  {t.count !== undefined && (
                    <span
                      className={`min-w-[18px] h-4.5 px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                        isActive ? 'bg-zinc-900/10 dark:bg-white/15' : 'bg-zinc-300/60 dark:bg-zinc-700/60'
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <TelegramBroadcastModal
          isOpen={isBroadcastOpen}
          onClose={() => {
            setIsBroadcastOpen(false);
            fetchData();
          }}
        />

        {/* Подключения сотрудников */}
        {pageTab === 'employees' && (
        <div className="space-y-4">
        {botStatus}
        <div className="rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Подключения сотрудников</h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Кто получает уведомления и какие виды включены. Сотрудник подключает Telegram сам: Профиль → Telegram.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showAllEmployees}
                onChange={(e) => setShowAllEmployees(e.target.checked)}
                className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
              />
              Показывать заблокированных
            </label>
          </div>
          {/* Мобильные карточки (< md): таблица не помещается на экран телефона */}
          <div className="md:hidden divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
            {isLoading && !overview ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-400">Загрузка...</div>
            ) : employees.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-400">Сотрудники не найдены</div>
            ) : (
              employees.map((emp) => (
                <div key={emp.user_id} className={`p-4 space-y-2.5 ${emp.is_active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <EmployeeBadge name={emp.full_name} color={emp.color} size="sm" />
                      <div className="text-[11px] text-zinc-400 font-mono truncate">
                        @{emp.login} · <span className="font-sans">{ROLE_LABELS[emp.role as UserRole] || emp.role}</span>
                      </div>
                    </div>
                    {emp.linked ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex-shrink-0 max-w-[45%] truncate">
                        <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{emp.username ? `@${emp.username}` : 'подключен'}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border border-zinc-200 dark:border-zinc-700 flex-shrink-0">
                        <MinusCircle className="w-3 h-3" />
                        не подключен
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {(Object.keys(PREF_LABELS) as PrefKey[]).map((key) => {
                      const on = emp.prefs[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => togglePref(emp, key)}
                          title={on ? 'Выключить' : 'Включить'}
                          className={`h-7 px-2 rounded-lg text-[10px] font-semibold border transition-colors cursor-pointer ${
                            on
                              ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                              : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 line-through'
                          }`}
                        >
                          {PREF_LABELS[key]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className="font-mono">
                      Отправлено: <b className="text-zinc-800 dark:text-zinc-200">{emp.sent_count}</b>
                      {emp.last_sent_at && <span className="block text-[10px] text-zinc-400">{formatDateTime(emp.last_sent_at)}</span>}
                      {emp.linked && emp.linked_at && <span className="block text-[10px] text-zinc-400">подключен с {formatDateTime(emp.linked_at)}</span>}
                    </span>
                    {emp.linked && (
                      <Button
                        variant="dangerSoft"
                        size="xs"
                        loading={workingUserId === emp.user_id}
                        onClick={() => handleUnlink(emp)}
                        leftIcon={<Unlink className="w-3 h-3" />}
                      >
                        Отвязать
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50/70 dark:bg-zinc-800/40 text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="text-left px-5 py-2.5 font-semibold">Сотрудник</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Роль</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Telegram</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Виды уведомлений</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Отправлено</th>
                  <th className="text-right px-5 py-2.5 font-semibold">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                {isLoading && !overview ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-zinc-400">
                      Загрузка...
                    </td>
                  </tr>
                ) : employees.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-zinc-400">
                      Сотрудники не найдены
                    </td>
                  </tr>
                ) : (
                  employees.map((emp) => (
                    <tr key={emp.user_id} className={emp.is_active ? '' : 'opacity-60'}>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <EmployeeBadge name={emp.full_name} color={emp.color} size="sm" />
                          <span className="text-[11px] text-zinc-400 font-mono">@{emp.login}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{ROLE_LABELS[emp.role as UserRole] || emp.role}</td>
                      <td className="px-3 py-2.5">
                        {emp.linked ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 className="w-3 h-3" />
                              {emp.username ? `@${emp.username}` : 'подключен'}
                            </span>
                            {emp.linked_at && <span className="block text-[10px] text-zinc-400 font-mono">с {formatDateTime(emp.linked_at)}</span>}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                            <MinusCircle className="w-3 h-3" />
                            не подключен
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          {(Object.keys(PREF_LABELS) as PrefKey[]).map((key) => {
                            const on = emp.prefs[key];
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => togglePref(emp, key)}
                                title={on ? 'Выключить' : 'Включить'}
                                className={`h-6 px-2 rounded-lg text-[10px] font-semibold border transition-colors cursor-pointer ${
                                  on
                                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 line-through'
                                }`}
                              >
                                {PREF_LABELS[key]}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-zinc-700 dark:text-zinc-300">
                        {emp.sent_count}
                        {emp.last_sent_at && <span className="block text-[10px] text-zinc-400">{formatDateTime(emp.last_sent_at)}</span>}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {emp.linked && (
                          <Button
                            variant="dangerSoft"
                            size="xs"
                            loading={workingUserId === emp.user_id}
                            onClick={() => handleUnlink(emp)}
                            leftIcon={<Unlink className="w-3 h-3" />}
                          >
                            Отвязать
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
        )}

        {/* Журнал сообщений */}
        {pageTab === 'outbox' && (
        <DataJournal<OutboxItem>
          data={visibleItems}
          columns={columns}
          keyField="id"
          title="Журнал сообщений"
          storageKey="telegram_outbox_journal"
          emptyMessage="Сообщений пока нет"
          externalSearchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          tabs={tabs}
          activeTab={statusTab}
          onTabChange={setStatusTab}
          totalCount={visibleItems.length}
          stats={outboxStats}
          onRefresh={fetchData}
          refreshing={isLoading}
          customActions={outboxActions}
          customRowActions={renderRowActions}
          onRowClick={(row) => setSelectedItem(row)}
          enableSelection={canManageOutbox}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          renderBulkActions={(ids, clearSelection) => (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isBatchLoading || !overview?.configured}
                onClick={() => void handleBulkRetry(ids, clearSelection)}
                className="h-8 px-3 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 text-xs font-semibold text-sky-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Повторно отправить неотправленные (ошибка, пропущено, в очереди)"
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Повторить ({ids.length})</span>
              </button>
              <button
                type="button"
                disabled={isBatchLoading}
                onClick={() => void handleBulkDelete(ids, clearSelection)}
                className="h-8 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-xs font-semibold text-rose-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Удалить ({ids.length})</span>
              </button>
            </div>
          )}
        />
        )}

        {/* Текст сообщения */}
        {selectedItem && (
          <Modal
            open
            onClose={() => setSelectedItem(null)}
            title={selectedItem.title}
            subtitle={`${selectedItem.recipient?.full_name || 'Без получателя'} • ${formatDateTime(selectedItem.created_at)}`}
            icon={Send}
            tone="sky"
            size="md"
            footerClassName="justify-between"
            footer={
              <>
                <div className="flex items-center gap-2">
                  <Badge value={selectedItem.kind} options={KIND_OPTIONS} />
                  <Badge value={selectedItem.status} options={STATUS_OPTIONS} />
                </div>
                <div className="flex items-center gap-2">
                  {(selectedItem.status === 'failed' || selectedItem.status === 'skipped') && (
                    <Button
                      variant="secondary"
                      loading={retryingId === selectedItem.id}
                      onClick={async () => {
                        await handleRetry(selectedItem);
                        setSelectedItem(null);
                      }}
                      leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                    >
                      Повторить
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setSelectedItem(null)}>
                    Закрыть
                  </Button>
                </div>
              </>
            }
          >
            <div className="space-y-3 text-xs">
              <pre className="whitespace-pre-wrap font-sans text-zinc-800 dark:text-zinc-200 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/60 leading-relaxed">
                {selectedItem.body || '—'}
              </pre>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span>Попыток: <b className="text-zinc-800 dark:text-zinc-200">{selectedItem.attempts}</b></span>
                <span>Отправлено: <b className="text-zinc-800 dark:text-zinc-200">{selectedItem.sent_at ? formatDateTime(selectedItem.sent_at) : '—'}</b></span>
              </div>
              {selectedItem.error && (
                <p className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300">{selectedItem.error}</p>
              )}
            </div>
          </Modal>
        )}
      </div>
    </AppLayout>
  );
}
