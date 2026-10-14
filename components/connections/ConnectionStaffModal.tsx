'use client';

import * as React from 'react';
import { Users, Check, ShieldCheck, X } from 'lucide-react';
import { Modal, ModalCallout } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { formatMonth } from '@/lib/utils/format';
import type { ConnectionItem, ConnectionEmployeeOption } from '@/app/connections/actions';

export const MAX_PARTICIPANTS = 3;

export interface StaffSelection {
  /** Полный состав участников (первый — основной); undefined — не менять */
  participants?: string[];
  /** Сопровождающие по месяцам; пустой список — все участники */
  maintenance: { month_index: number; user_ids: string[] }[];
}

interface ConnectionStaffModalProps {
  open: boolean;
  onClose: () => void;
  /** Одно подключение (карточка, контекстное меню) или несколько (массовое действие) */
  connections: ConnectionItem[];
  employees: ConnectionEmployeeOption[];
  /** Администратор: право редактировать подключение (любой состав) */
  canEdit: boolean;
  canConfirm: boolean;
  /** Текущий сотрудник (режим участника: только исключение) */
  currentUserId: string;
  busy?: boolean;
  onSubmit: (selection: StaffSelection) => Promise<void> | void;
}

/** Месяц сопровождения по номеру: старт сопровождения + (номер − 1) */
function maintenanceMonthLabel(conn: ConnectionItem, index: number): string | null {
  const start = conn.maintenance_month_start;
  if (!start || !/^\d{4}-\d{2}$/.test(start)) return null;
  const [y, m] = start.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + (index - 1), 1));
  return formatMonth(d.toISOString().substring(0, 7));
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** Выбор сотрудников кнопками-чипами (до MAX_PARTICIPANTS) */
function PeoplePicker({
  options,
  value,
  onChange,
  disabled,
  removeOnly,
  max = MAX_PARTICIPANTS,
  emptyHint,
}: {
  options: ConnectionEmployeeOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Режим участника: только снятие галочек */
  removeOnly?: boolean;
  max?: number;
  emptyHint?: string;
}) {
  const byId = new Map(options.map((o) => [o.user_id, o]));
  const visible = removeOnly ? options.filter((o) => value.includes(o.user_id)) : options;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {visible.map((o) => {
          const selected = value.includes(o.user_id);
          const canAdd = !selected && value.length < max && !removeOnly;
          const isDisabled = disabled || (!selected && !canAdd);
          return (
            <button
              key={o.user_id}
              type="button"
              disabled={isDisabled}
              onClick={() => onChange(selected ? value.filter((id) => id !== o.user_id) : [...value, o.user_id])}
              className={`inline-flex items-center gap-1.5 h-8 pl-1 pr-2.5 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                selected
                  ? 'bg-blue-500/15 border-blue-500/40 text-blue-700 dark:text-blue-300'
                  : 'bg-white/60 dark:bg-zinc-900/60 border-zinc-200/80 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
              title={selected ? 'Исключить' : 'Добавить'}
            >
              <EmployeeBadge name={o.full_name} color={o.color} size="xs" />
              {selected ? <X className="w-3 h-3" strokeWidth={2.5} /> : <span className="w-3 h-3 rounded-full border border-current opacity-50" />}
            </button>
          );
        })}
        {visible.length === 0 && <span className="text-xs text-zinc-400">{emptyHint || 'Нет сотрудников'}</span>}
      </div>
      {value.length > 1 && (
        <p className="text-[10px] text-zinc-400">
          Участников: {value.length} — бонус делится поровну{value.length === 1 ? '' : ` (по 1/${value.length})`}.{' '}
          {value.map((id) => byId.get(id)?.full_name).filter(Boolean).join(', ')}
        </p>
      )}
    </div>
  );
}

/**
 * Сотрудники подключения: участники (2–3 консультанта, бонус за подключение поровну; назначение
 * администратором подтверждает подключение) и сопровождающие по каждому месяцу (по умолчанию —
 * все участники; бонус сопровождения делится между сопровождающими месяца и подтверждается при начислении).
 * Участник подключения может только исключать (себя или коллег).
 */
export function ConnectionStaffModal({
  open,
  onClose,
  connections,
  employees,
  canEdit,
  canConfirm,
  currentUserId,
  busy = false,
  onSubmit,
}: ConnectionStaffModalProps) {
  const single = connections.length === 1 ? connections[0] : null;
  const participantMode = !canEdit;
  const monthsCount = React.useMemo(
    () => Math.max(1, ...connections.map((c) => Number(c.maintenance_months_total || c.maintenance_months_limit || 2))),
    [connections]
  );

  const currentParticipants = React.useMemo(() => {
    if (!single) return [] as string[];
    const list = (single.participants || []).map((p) => p.user_id);
    if (list.length === 0 && single.manager_id) list.push(single.manager_id);
    return list;
  }, [single]);

  // Варианты для выбора: в режиме участника — только текущие участники (их можно лишь исключить)
  const options = React.useMemo<ConnectionEmployeeOption[]>(() => {
    if (!participantMode) return employees;
    return (single?.participants || []).map((p) => ({ ...p, color: p.color ?? null }));
  }, [employees, participantMode, single]);

  const KEEP = '__keep__';
  const [participantsMode, setParticipantsMode] = React.useState<'keep' | 'set'>('keep');
  const [participants, setParticipants] = React.useState<string[]>([]);
  const [maintenanceMode, setMaintenanceMode] = React.useState<Record<number, 'keep' | 'set'>>({});
  const [maintenance, setMaintenance] = React.useState<Record<number, string[]>>({});

  // Начальные значения: одно подключение — текущие составы, несколько — «не менять»
  React.useEffect(() => {
    if (!open) return;
    const m: Record<number, string[]> = {};
    const modes: Record<number, 'keep' | 'set'> = {};
    if (single) {
      setParticipantsMode('set');
      setParticipants(currentParticipants);
      for (let i = 1; i <= monthsCount; i++) {
        const rows = (single.maintenance_assignments || []).filter((x) => x.month_index === i);
        m[i] = rows.map((r) => r.user_id);
        modes[i] = 'set';
      }
    } else {
      setParticipantsMode('keep');
      setParticipants([]);
      for (let i = 1; i <= monthsCount; i++) {
        m[i] = [];
        modes[i] = 'keep';
      }
    }
    setMaintenance(m);
    setMaintenanceMode(modes);
  }, [open, single, monthsCount, currentParticipants]);

  const accruedFor = (index: number) =>
    single ? (single.maintenance_assignments || []).filter((x) => x.month_index === index && x.status === 'accrued') : [];

  const participantsChanged = participantsMode === 'set' && (!single || !sameSet(participants, currentParticipants));
  const needsConfirm = single ? single.confirmation_status !== 'confirmed' : connections.some((c) => c.confirmation_status !== 'confirmed');

  const maintenanceChanges = React.useMemo(() => {
    const list: { month_index: number; user_ids: string[] }[] = [];
    for (let i = 1; i <= monthsCount; i++) {
      if (maintenanceMode[i] !== 'set') continue;
      if (accruedFor(i).length > 0) continue;
      const next = maintenance[i] || [];
      if (single) {
        const current = (single.maintenance_assignments || []).filter((x) => x.month_index === i).map((x) => x.user_id);
        if (sameSet(next, current)) continue;
        // Режим участника: пустой набор запрещен (можно только исключать)
        if (participantMode && next.length === 0) continue;
      }
      list.push({ month_index: i, user_ids: next });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenance, maintenanceMode, monthsCount, single, participantMode]);

  const participantsValid = participantsMode !== 'set' || participants.length >= 1;
  const hasChanges =
    (participantsChanged && participantsValid) ||
    (participantsMode === 'set' && participantsValid && needsConfirm && !participantMode) ||
    maintenanceChanges.length > 0;

  const handleSubmit = async () => {
    await onSubmit({
      participants:
        participantsMode === 'set' && participantsValid && (participantsChanged || (needsConfirm && !participantMode))
          ? participants
          : undefined,
      maintenance: maintenanceChanges,
    });
  };

  // Эффективный состав месяца для подсказки «как у подключения»
  const effectiveParticipantsNames = (participantsMode === 'set' && participants.length > 0 ? participants : currentParticipants)
    .map((id) => options.find((o) => o.user_id === id)?.full_name || employees.find((o) => o.user_id === id)?.full_name)
    .filter(Boolean)
    .join(', ');

  const maintenanceOptions = React.useMemo<ConnectionEmployeeOption[]>(() => {
    if (!participantMode) return employees;
    // Участник исключает только из текущего состава месяца (назначенные или все участники)
    return options;
  }, [employees, options, participantMode]);

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Сотрудники подключения"
      subtitle={single ? `${single.seller_name} · ${single.store || 'Без магазина'}` : `Выбрано подключений: ${connections.length}`}
      icon={Users}
      tone="info"
      size="lg"
      busy={busy}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={busy} disabled={!hasChanges} onClick={handleSubmit} leftIcon={<Check className="w-3.5 h-3.5" strokeWidth={1.75} />}>
            {participantMode ? 'Сохранить' : 'Назначить'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {participantMode && (
          <ModalCallout tone="info">
            Вы участник этого подключения: можно исключить себя или коллегу из участников и из сопровождения месяца.
            Добавляет сотрудников администратор.
          </ModalCallout>
        )}

        {/* Участники подключения */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Участники подключения</span>
            {!single && !participantMode && (
              <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-700 text-blue-600"
                  checked={participantsMode === 'set'}
                  onChange={(e) => setParticipantsMode(e.target.checked ? 'set' : 'keep')}
                />
                Изменить состав
              </label>
            )}
          </div>
          {participantsMode === 'set' ? (
            <PeoplePicker
              options={options}
              value={participants}
              onChange={setParticipants}
              removeOnly={participantMode}
              disabled={!participantMode && !canConfirm}
              emptyHint="Сотрудников нет"
            />
          ) : (
            <p className="text-xs text-zinc-400">Состав участников не меняется.</p>
          )}
          {participantsMode === 'set' && participants.length === 0 && (
            <p className="text-[11px] text-rose-500">В подключении должен остаться хотя бы один участник.</p>
          )}
          <p className="text-[10px] text-zinc-400 leading-relaxed">
            Первый участник — основной (подключивший, консультант продавца). Бонус за подключение делится поровну между
            участниками; при изменении состава неоплаченные доли пересчитываются.
            {!participantMode && !canConfirm && ' Для смены состава нужно право подтверждать подключения.'}
          </p>
          {!participantMode && participantsMode === 'set' && needsConfirm && participants.length > 0 && (
            <ModalCallout tone="success">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2} />
                {single ? 'Подключение будет подтверждено.' : 'Неподтвержденные подключения из выбранных будут подтверждены.'}
              </span>
            </ModalCallout>
          )}
        </div>

        {/* Сопровождение по месяцам */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Сопровождение по месяцам</span>
            <span className="text-[10px] text-zinc-400">подтверждается при начислении</span>
          </div>
          <div className="space-y-2">
            {Array.from({ length: monthsCount }, (_, i) => i + 1).map((index) => {
              const accrued = accruedFor(index);
              const monthLabel = single ? maintenanceMonthLabel(single, index) : null;
              const mode = maintenanceMode[index] || (single ? 'set' : 'keep');
              const value = maintenance[index] || [];
              // Участник видит эффективный состав месяца (назначенные или все участники) и может его сократить
              const effectiveValue = participantMode && value.length === 0 ? currentParticipants : value;
              return (
                <div
                  key={index}
                  className="p-2.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{index}-й месяц</span>
                      {monthLabel && <span className="text-[10px] text-zinc-400 font-mono ml-2">{monthLabel}</span>}
                    </div>
                    {accrued.length > 0 ? (
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        начислено {accrued[0].accrued_month ? formatMonth(accrued[0].accrued_month) : ''}
                      </span>
                    ) : !single ? (
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-700 text-blue-600"
                          checked={mode === 'set'}
                          onChange={(e) => setMaintenanceMode((prev) => ({ ...prev, [index]: e.target.checked ? 'set' : 'keep' }))}
                        />
                        Изменить
                      </label>
                    ) : null}
                  </div>
                  {accrued.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {accrued.map((a) => (
                        <EmployeeBadge key={a.user_id} name={a.user?.full_name || 'Сотрудник'} color={a.user?.color} size="xs" />
                      ))}
                    </div>
                  ) : mode === 'set' ? (
                    <>
                      <PeoplePicker
                        options={maintenanceOptions}
                        value={effectiveValue}
                        onChange={(next) => setMaintenance((prev) => ({ ...prev, [index]: next }))}
                        removeOnly={participantMode}
                        emptyHint="Сотрудников нет"
                      />
                      {!participantMode && value.length === 0 && (
                        <p className="text-[10px] text-zinc-400">
                          Как у подключения{effectiveParticipantsNames ? `: ${effectiveParticipantsNames}` : ''} — все участники сопровождают этот месяц.
                        </p>
                      )}
                      {participantMode && effectiveValue.length === 1 && (
                        <p className="text-[10px] text-zinc-400">Последнего сопровождающего исключить нельзя.</p>
                      )}
                    </>
                  ) : (
                    <p className="text-[11px] text-zinc-400">Не меняется.</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-zinc-400 leading-relaxed">
            По умолчанию месяц сопровождают все участники подключения. Бонус за сопровождение делится поровну между
            сопровождающими месяца и начисляется им в момент начисления за этот месяц; до этого состав можно изменить.
          </p>
        </div>
      </div>
    </Modal>
  );
}
