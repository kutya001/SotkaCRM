'use client';

import * as React from 'react';
import { Loader2, MessageSquareText, Send } from 'lucide-react';
import { Modal, ModalCallout } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Field';
import { EmployeeColorDot } from '@/components/ui/EmployeeBadge';
import { useToast } from '@/components/ui/Toast';
import { useUser } from '@/components/auth/AuthProvider';
import { api, type LeadCommentDto } from '@/lib/api/client';
import { formatDateTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

export interface LeadCommentsTarget {
  lead_id: string;
  client_name?: string | null;
}

interface LeadCommentsModalProps {
  target: LeadCommentsTarget | null;
  onClose: () => void;
  /** Комментарий добавлен: страница обновляет «последний комментарий» лида */
  onAdded?: (leadId: string, comment: LeadCommentDto) => void;
}

const MAX_LENGTH = 4000;

/**
 * История комментариев лида: кто и когда писал, от старых к новым (новые внизу, как в чате),
 * и поле нового комментария. Открывается кнопкой «Комментарий» в карточке лида и меню строки.
 */
export function LeadCommentsModal({ target, onClose, onAdded }: LeadCommentsModalProps) {
  const { showToast } = useToast();
  const user = useUser();
  const myId = user.profile?.user_id;

  const [comments, setComments] = React.useState<LeadCommentDto[]>([]);
  const [historyAvailable, setHistoryAvailable] = React.useState(true);
  const [canComment, setCanComment] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const listEndRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);

  const leadId = target?.lead_id;

  React.useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    setLoading(true);
    setComments([]);
    setDraft('');
    api.leads
      .getComments(leadId)
      .then((res) => {
        if (cancelled) return;
        setComments(res.comments);
        setHistoryAvailable(res.history_available);
        setCanComment(res.can_comment);
      })
      .catch((err: any) => {
        if (!cancelled) showToast(err?.message || 'Не удалось загрузить комментарии', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, showToast]);

  // Новые комментарии внизу: после загрузки и отправки лента прокручивается к последнему
  React.useEffect(() => {
    if (!loading) listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [loading, comments.length]);

  // Поле ввода в фокусе сразу — кнопка «Комментарий» ведет к быстрому добавлению
  React.useEffect(() => {
    if (!loading && canComment) inputRef.current?.focus({ preventScroll: true });
  }, [loading, canComment]);

  if (!target || !leadId) return null;

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await api.leads.addComment(leadId, text);
      setComments((prev) => (res.history_available ? [...prev, res.comment] : [res.comment]));
      setHistoryAvailable(res.history_available);
      setDraft('');
      onAdded?.(leadId, res.comment);
      showToast('Комментарий добавлен', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Не удалось добавить комментарий', 'error');
    } finally {
      setSending(false);
    }
  };

  const footer = canComment ? (
    <div className="w-full flex items-end gap-2">
      <Textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void handleSend();
          }
        }}
        rows={2}
        maxLength={MAX_LENGTH}
        placeholder="Новый комментарий: итог звонка, договоренности, следующий шаг..."
        aria-label="Новый комментарий"
        className="flex-1 min-h-[44px] text-sm"
      />
      <Button
        onClick={() => void handleSend()}
        loading={sending}
        disabled={!draft.trim()}
        size="icon"
        className="h-11 w-11 flex-shrink-0"
        title="Отправить (Ctrl+Enter)"
        aria-label="Отправить комментарий"
      >
        {!sending && <Send className="w-4 h-4" strokeWidth={1.75} />}
      </Button>
    </div>
  ) : (
    <p className="w-full text-[11px] text-zinc-500">
      Комментировать лид может ответственный, создатель лида и сотрудники с правом видеть все лиды — при праве на комментарий.
    </p>
  );

  return (
    <Modal
      open
      onClose={onClose}
      level={2}
      size="lg"
      tone="info"
      icon={MessageSquareText}
      title="Комментарии"
      subtitle={target.client_name || 'Лид'}
      footer={footer}
      bodyClassName="min-h-[40vh]"
    >
      <div className="space-y-3" data-tour="lead-comments-list">
        {!historyAvailable && (
          <ModalCallout tone="warning">
            История комментариев включится после применения миграции 048 к базе. Пока новый комментарий заменяет текущий.
          </ModalCallout>
        )}

        {loading ? (
          <div className="py-10 flex justify-center text-zinc-400">
            <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.75} />
          </div>
        ) : comments.length === 0 ? (
          <p className="py-10 text-center text-xs text-zinc-400">Комментариев пока нет</p>
        ) : (
          comments.map((c) => {
            const mine = Boolean(myId && c.author?.user_id === myId);
            return (
              <div
                key={c.comment_id}
                className={cn(
                  'rounded-2xl border px-3.5 py-2.5 space-y-1',
                  mine
                    ? 'bg-blue-500/10 border-blue-500/20 ml-6'
                    : 'bg-zinc-100/70 dark:bg-zinc-800/50 border-zinc-200/60 dark:border-zinc-700/60 mr-6'
                )}
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-1.5 min-w-0 font-semibold text-zinc-700 dark:text-zinc-200">
                    {c.author ? <EmployeeColorDot color={c.author.color} size="xs" /> : null}
                    <span className="truncate">
                      {c.author ? (mine ? 'Вы' : c.author.full_name) : c.is_legacy ? 'Прежний комментарий' : 'Сотрудник удален'}
                    </span>
                  </span>
                  {c.created_at && (
                    <span className="font-mono text-zinc-400 flex-shrink-0">{formatDateTime(c.created_at)}</span>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>
    </Modal>
  );
}
