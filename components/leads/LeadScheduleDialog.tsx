'use client';

import * as React from 'react';
import { CalendarClock, PhoneCall } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormField, Input } from '@/components/ui/Field';
import { cn } from '@/lib/utils/cn';

export type ScheduleStatus = 'Встреча' | 'Перезвонить';

export interface LeadScheduleState {
  status: ScheduleStatus;
  leadIds: string[];
  clientName: string;
  /** Перенос даты без смены статуса */
  reschedule: boolean;
  /** Текущая дата (при переносе) */
  initial?: string | null;
  onDone?: () => void;
}

interface LeadScheduleDialogProps {
  state: LeadScheduleState | null;
  onClose: () => void;
  /** Подтверждение: дата в ISO */
  onConfirm: (iso: string) => Promise<void>;
}

/** Значение для <input type="datetime-local"> в часовом поясе браузера: «ГГГГ-ММ-ДДTчч:мм» */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function at(daysFromToday: number, hours: number, minutes = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/** Быстрые варианты даты: для встречи — ближайшие слоты, для звонка — интервалы */
function presetsFor(status: ScheduleStatus): { label: string; date: Date }[] {
  const now = new Date();
  if (status === 'Встреча') {
    const list = [
      { label: 'Сегодня 16:00', date: at(0, 16) },
      { label: 'Завтра 10:00', date: at(1, 10) },
      { label: 'Завтра 16:00', date: at(1, 16) },
      { label: 'Послезавтра 10:00', date: at(2, 10) },
    ];
    return list.filter((p) => p.date.getTime() > now.getTime());
  }
  const inTwoHours = new Date(now.getTime() + 2 * 3_600_000);
  inTwoHours.setSeconds(0, 0);
  return [
    { label: 'Через 2 часа', date: inTwoHours },
    { label: 'Завтра 10:00', date: at(1, 10) },
    { label: 'Через 3 дня', date: at(3, 10) },
    { label: 'Через неделю', date: at(7, 10) },
  ];
}

/**
 * Дата встречи («Встреча») или следующего контакта («Перезвонить»): быстрые варианты и поле даты.
 * Тот же диалог переносит дату без смены статуса и работает для нескольких лидов сразу.
 */
export function LeadScheduleDialog({ state, onClose, onConfirm }: LeadScheduleDialogProps) {
  const [value, setValue] = React.useState('');

  React.useEffect(() => {
    if (!state) return;
    setValue(state.initial ? toLocalInputValue(new Date(state.initial)) : '');
  }, [state]);

  const status = state?.status || 'Встреча';
  const isMeeting = status === 'Встреча';
  const presets = React.useMemo(() => presetsFor(status), [status, state]);
  const parsed = value ? new Date(value) : null;
  const valid = Boolean(parsed && !Number.isNaN(parsed.getTime()));
  const many = (state?.leadIds.length || 0) > 1;

  const title = isMeeting
    ? state?.reschedule
      ? 'Перенести встречу'
      : many
      ? 'Встреча для выбранных лидов'
      : 'Назначить встречу'
    : state?.reschedule
    ? 'Перенести звонок'
    : 'Когда перезвонить';

  return (
    <ConfirmDialog
      open={Boolean(state)}
      onClose={onClose}
      onConfirm={async () => {
        if (!parsed || !valid) return;
        await onConfirm(parsed.toISOString());
      }}
      title={title}
      subtitle={state?.clientName}
      tone="info"
      icon={isMeeting ? CalendarClock : PhoneCall}
      confirmLabel={state?.reschedule ? 'Перенести' : isMeeting ? 'Назначить встречу' : 'Сохранить'}
      cancelLabel="Назад"
      confirmDisabled={!valid}
      level={2}
      description={
        isMeeting
          ? 'Лид перейдет в статус «Встреча». В списке и канбане будет видно, к кому ехать сегодня.'
          : 'Лид перейдет в статус «Перезвонить». В день звонка он появится во вкладке «На сегодня», просроченные подсветятся.'
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const v = toLocalInputValue(p.date);
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => setValue(v)}
                className={cn(
                  'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
                  value === v
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-transparent'
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <FormField
          label={isMeeting ? 'Дата и время встречи' : 'Дата следующего контакта'}
          required
          htmlFor="lead-schedule-date"
        >
          <Input
            id="lead-schedule-date"
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </FormField>
      </div>
    </ConfirmDialog>
  );
}
