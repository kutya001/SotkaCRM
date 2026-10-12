'use client';

import * as React from 'react';
import { Send, X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui/Toast';
import { ROLE_LABELS } from '@/lib/constants/roles';
import type { UserRole } from '@/types/database.types';

const ROLES: UserRole[] = ['admin', 'supervisor', 'consultant', 'smm'];

interface TelegramBroadcastModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Сообщение администратора всем сотрудникам с подключенным Telegram */
export function TelegramBroadcastModal({ isOpen, onClose }: TelegramBroadcastModalProps) {
  const { showToast } = useToast();
  const [stats, setStats] = React.useState<{ configured: boolean; total: number; by_role: Record<string, number> } | null>(null);
  const [title, setTitle] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [roles, setRoles] = React.useState<UserRole[]>(ROLES);
  const [isSending, setIsSending] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    api.telegram
      .broadcastStats()
      .then(setStats)
      .catch((err: any) => showToast(err.message || 'Не удалось получить статистику Telegram', 'error'));
  }, [isOpen, showToast]);

  if (!isOpen) return null;

  const recipients = roles.reduce((sum, r) => sum + (stats?.by_role[r] || 0), 0);

  const toggleRole = (role: UserRole) =>
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim().length < 2) {
      showToast('Введите текст сообщения', 'error');
      return;
    }
    if (recipients === 0) {
      showToast('Нет получателей с подключенным Telegram', 'error');
      return;
    }
    setIsSending(true);
    try {
      const res = await api.telegram.broadcast({
        message: message.trim(),
        title: title.trim() || undefined,
        roles: roles.length === ROLES.length ? undefined : roles,
      });
      showToast(res.message || `Отправлено: ${res.sent}`, res.failed > 0 ? 'info' : 'success');
      setMessage('');
      setTitle('');
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Ошибка рассылки', 'error');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <form
        onSubmit={handleSend}
        className="w-full max-w-lg p-6 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl space-y-4 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center flex-shrink-0">
              <Send className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Рассылка в Telegram</h3>
              <p className="text-zinc-500 dark:text-zinc-400">
                {stats
                  ? stats.configured
                    ? `Подключили Telegram: ${stats.total} сотр.`
                    : 'Telegram-бот не настроен'
                  : 'Загрузка...'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        <div className="space-y-1">
          <label className="font-semibold text-zinc-700 dark:text-zinc-300">Получатели</label>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((role) => {
              const count = stats?.by_role[role] || 0;
              const active = roles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={`h-8 px-3 rounded-xl border font-semibold flex items-center gap-1.5 transition-colors ${
                    active
                      ? 'border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-500'
                  }`}
                >
                  {ROLE_LABELS[role]}
                  <span className={`px-1.5 rounded-full text-[10px] ${active ? 'bg-sky-500/20' : 'bg-zinc-200 dark:bg-zinc-700'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1">
          <label className="font-semibold text-zinc-700 dark:text-zinc-300">Заголовок (необязательно)</label>
          <input
            type="text"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Напоминание"
            className="w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="space-y-1">
          <label className="font-semibold text-zinc-700 dark:text-zinc-300">Сообщение</label>
          <textarea
            rows={5}
            maxLength={3500}
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Коллеги, напоминаю: до пятницы закрываем начисления за месяц..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <p className="text-[10px] text-zinc-400 text-right">{message.length} / 3500</p>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-zinc-500">
            Получат: <b className="text-zinc-900 dark:text-zinc-100">{recipients}</b>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSending || !stats?.configured || recipients === 0}
              className="h-9 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" strokeWidth={2} />}
              Отправить
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
