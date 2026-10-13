'use client';

import * as React from 'react';
import { Send } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Textarea } from '@/components/ui/Field';
import { ROLE_LABELS } from '@/lib/constants/roles';
import type { UserRole } from '@/types/database.types';

const ROLES: UserRole[] = ['admin', 'supervisor', 'consultant', 'smm'];
const FORM_ID = 'telegram-broadcast-form';

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
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Рассылка в Telegram"
      subtitle={
        stats ? (stats.configured ? `Подключили Telegram: ${stats.total} сотр.` : 'Telegram-бот не настроен') : 'Загрузка...'
      }
      icon={Send}
      tone="sky"
      size="lg"
      busy={isSending}
      formId={FORM_ID}
      onSubmit={handleSend}
      footerClassName="justify-between"
      footer={
        <>
          <span className="text-xs text-zinc-500">
            Получат: <b className="text-zinc-900 dark:text-zinc-100">{recipients}</b>
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={isSending}>
              Отмена
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              className="bg-sky-600 hover:bg-sky-700 text-white"
              disabled={!stats?.configured || recipients === 0}
              loading={isSending}
              leftIcon={<Send className="w-3.5 h-3.5" strokeWidth={2} />}
            >
              Отправить
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-4 text-xs">
        <FormField label="Получатели">
          <div className="flex flex-wrap gap-2">
            {ROLES.map((role) => {
              const count = stats?.by_role[role] || 0;
              const active = roles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={`h-8 px-3 rounded-xl border font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
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
        </FormField>

        <FormField label="Заголовок (необязательно)">
          <Input type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Напоминание" size="lg" />
        </FormField>

        <FormField label="Сообщение" required hint={<span className="block text-right">{message.length} / 3500</span>}>
          <Textarea
            rows={5}
            maxLength={3500}
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Коллеги, напоминаю: до пятницы закрываем начисления за месяц..."
          />
        </FormField>
      </div>
    </Modal>
  );
}
