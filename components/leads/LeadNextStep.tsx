'use client';

import * as React from 'react';
import { CalendarClock, PhoneCall } from 'lucide-react';
import { formatDateTime } from '@/lib/utils/format';
import { bishkekDayBounds } from '@/lib/leads/stats';
import { cn } from '@/lib/utils/cn';

interface LeadNextStepProps {
  status: string;
  meeting_at?: string | null;
  next_contact_at?: string | null;
}

export type NextStepState = 'overdue' | 'today' | 'future';

/** Срок шага по Бишкеку: просрочен, сегодня или позже */
export function nextStepState(iso: string, now: Date = new Date()): NextStepState {
  const t = Date.parse(iso);
  if (t < now.getTime()) return 'overdue';
  return t < bishkekDayBounds(now).end ? 'today' : 'future';
}

const STATE_CLASS: Record<NextStepState, string> = {
  overdue: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
  today: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  future: 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700',
};

const STATE_LABEL: Record<NextStepState, string> = {
  overdue: 'просрочено',
  today: 'сегодня',
  future: '',
};

/**
 * Следующий шаг по лиду: встреча («Встреча») или звонок («Перезвонить») с датой.
 * Сегодня — янтарная метка, просрочено — розовая. Для других статусов — «—».
 */
export function LeadNextStep({ status, meeting_at, next_contact_at }: LeadNextStepProps) {
  const isMeeting = status === 'Встреча';
  const iso = isMeeting ? meeting_at : status === 'Перезвонить' ? next_contact_at : null;
  if (!iso) return <span className="text-zinc-400">—</span>;
  const state = nextStepState(iso);
  const Icon = isMeeting ? CalendarClock : PhoneCall;
  const note = STATE_LABEL[state];
  return (
    <span
      className={cn(
        // Переносится на узких карточках: дата не обрезается, пометка уходит на вторую строку
        'inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 max-w-full px-2 py-0.5 rounded-lg border text-[11px] font-semibold',
        STATE_CLASS[state]
      )}
      title={`${isMeeting ? 'Встреча' : 'Перезвонить'}: ${formatDateTime(iso)}${note ? ` — ${note}` : ''}`}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
      {/* «ДД.ММ.ГГГГ - чч:мм» без секунд */}
      <span className="font-mono whitespace-nowrap">{formatDateTime(iso).slice(0, 18)}</span>
      {note && <span className="whitespace-nowrap">· {note}</span>}
    </span>
  );
}
