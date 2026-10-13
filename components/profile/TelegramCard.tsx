'use client';

import * as React from 'react';
import { Send, Link2, Unlink, Copy, Check, Loader2, BellRing, ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { formatDateTime } from '@/lib/utils/format';

type TelegramStatus = Awaited<ReturnType<typeof api.telegram.status>>;
type PrefKey = keyof TelegramStatus['prefs'];

const PREF_LABELS: Record<PrefKey, { title: string; hint: string }> = {
  payroll: { title: 'Операции по ЗП', hint: 'Начисления, удержания и выплаты' },
  connections: { title: 'Подключения', hint: 'Подтверждение и отклонение подключений' },
  leads: { title: 'Лиды', hint: 'Лиды, назначенные вам' },
  broadcast: { title: 'Сообщения администратора', hint: 'Напоминания и объявления для всех' },
};

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 5 * 60 * 1000;

/** Подключение Telegram-уведомлений для текущего сотрудника */
export function TelegramCard() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = React.useState<TelegramStatus | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isWorking, setIsWorking] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const pollStartedAt = React.useRef<number | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await api.telegram.status();
      setStatus(res);
      return res;
    } catch (err: any) {
      showToast(err.message || 'Не удалось получить состояние Telegram', 'error');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Пока сотрудник открывает бота, страница ждет подтверждения привязки
  const waitingForLink = Boolean(status && !status.linked && status.pending);
  React.useEffect(() => {
    if (!waitingForLink) {
      pollStartedAt.current = null;
      return;
    }
    if (pollStartedAt.current === null) pollStartedAt.current = Date.now();

    const timer = window.setInterval(async () => {
      if (Date.now() - (pollStartedAt.current || 0) > POLL_MAX_MS) {
        window.clearInterval(timer);
        return;
      }
      const res = await load();
      if (res?.linked) {
        showToast('Telegram подключен — уведомления включены', 'success');
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [waitingForLink, load, showToast]);

  const handleConnect = async () => {
    setIsWorking(true);
    try {
      const res = await api.telegram.createLink();
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              bot_username: res.bot_username,
              pending: { code: res.code, deep_link: res.deep_link, expires_at: res.expires_at },
            }
          : prev
      );
      if (!res.webhook_ok && res.webhook_reason && res.webhook_reason !== 'preview') {
        showToast(`Бот не принимает сообщения: ${res.webhook_reason}`, 'error');
      }
      window.open(res.deep_link, '_blank', 'noopener');
    } catch (err: any) {
      showToast(err.message || 'Не удалось создать код привязки', 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const handleUnlink = async () => {
    const ok = await confirm({
      title: 'Отключить Telegram-уведомления?',
      description: 'Уведомления о начислениях, подключениях и лидах перестанут приходить в Telegram. Подключить заново можно в любой момент.',
      tone: 'warning',
      icon: Unlink,
      confirmLabel: 'Отключить',
    });
    if (!ok) return;
    setIsWorking(true);
    try {
      await api.telegram.unlink();
      await load();
      showToast('Telegram отключен', 'info');
    } catch (err: any) {
      showToast(err.message || 'Не удалось отключить Telegram', 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const handleTest = async () => {
    setIsWorking(true);
    try {
      await api.telegram.sendTest();
      showToast('Тестовое сообщение отправлено', 'success');
    } catch (err: any) {
      showToast(err.message || 'Не удалось отправить сообщение', 'error');
      await load();
    } finally {
      setIsWorking(false);
    }
  };

  const togglePref = async (key: PrefKey) => {
    if (!status) return;
    const next = { ...status.prefs, [key]: !status.prefs[key] };
    setStatus({ ...status, prefs: next });
    try {
      const res = await api.telegram.updatePrefs({ [key]: next[key] });
      setStatus((prev) => (prev ? { ...prev, prefs: res.prefs } : prev));
    } catch (err: any) {
      showToast(err.message || 'Не удалось сохранить настройку', 'error');
      await load();
    }
  };

  const copyCommand = async () => {
    if (!status?.pending) return;
    try {
      await navigator.clipboard.writeText(`/start ${status.pending.code}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast('Не удалось скопировать', 'error');
    }
  };

  return (
    <div className="p-6 rounded-3xl backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75 border border-white/20 dark:border-zinc-800/40 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center flex-shrink-0">
            <Send className="w-5 h-5" strokeWidth={1.75} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Уведомления в Telegram</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {isLoading
                ? 'Проверка подключения...'
                : !status?.configured
                ? 'Бот не настроен администратором'
                : status.linked
                ? `Подключено${status.username ? `: @${status.username}` : ''}${
                    status.linked_at ? ` · с ${formatDateTime(status.linked_at)}` : ''
                  }`
                : 'Начисления, подключения и назначенные лиды — прямо в Telegram'}
            </p>
          </div>
        </div>

        {!isLoading && status?.configured && (
          <div className="flex items-center gap-2 flex-wrap">
            {status.linked ? (
              <>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={isWorking}
                  className="h-9 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <BellRing className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Тест
                </button>
                <button
                  type="button"
                  onClick={handleUnlink}
                  disabled={isWorking}
                  className="h-9 px-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Unlink className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Отключить
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={isWorking}
                className="h-9 px-3.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {isWorking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" strokeWidth={2} />}
                {status.pending ? 'Открыть бота снова' : 'Подключить Telegram'}
              </button>
            )}
          </div>
        )}
      </div>

      {!isLoading && status?.configured && !status.linked && status.pending && (
        <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/20 space-y-2.5 text-xs text-sky-900 dark:text-sky-200">
          <p className="font-semibold flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Ожидаем подтверждения в Telegram...
          </p>
          <p className="leading-relaxed">
            Бот {status.bot_username ? <b>@{status.bot_username}</b> : null} должен открыться с кодом привязки — нажмите в нем
            «Start». Если бот не открылся, отправьте ему команду вручную:
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-sky-500/20 font-mono text-[12px] tracking-wider">
              /start {status.pending.code}
            </code>
            <button
              type="button"
              onClick={copyCommand}
              className="h-8 px-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-sky-500/20 flex items-center gap-1 font-semibold"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
            {status.pending.deep_link && (
              <a
                href={status.pending.deep_link}
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 px-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-sky-500/20 flex items-center gap-1 font-semibold"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Открыть бота
              </a>
            )}
            <button
              type="button"
              onClick={() => load()}
              className="h-8 px-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-sky-500/20 flex items-center gap-1 font-semibold"
              title="Проверить подключение"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-sky-700/80 dark:text-sky-300/70">
            Код действует до {formatDateTime(status.pending.expires_at)}.
          </p>
        </div>
      )}

      {!isLoading && status?.configured && status.linked && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(Object.keys(PREF_LABELS) as PrefKey[]).map((key) => {
            const enabled = status.prefs[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => togglePref(key)}
                className={`p-3 rounded-2xl border text-left flex items-center gap-3 transition-colors ${
                  enabled
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60'
                }`}
                role="switch"
                aria-checked={enabled}
              >
                <span
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
                    enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      enabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-100">{PREF_LABELS[key].title}</span>
                  <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">{PREF_LABELS[key].hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
