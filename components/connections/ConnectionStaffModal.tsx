'use client';

import * as React from 'react';
import { Users, Check, ShieldCheck } from 'lucide-react';
import { Modal, ModalCallout } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, Select } from '@/components/ui/Field';
import { EmployeeBadge } from '@/components/ui/EmployeeBadge';
import { formatMonth } from '@/lib/utils/format';
import type { ConnectionItem, ConnectionEmployeeOption } from '@/app/connections/actions';

const KEEP = '__keep__';
const DEFAULT = '__default__';

export interface StaffSelection {
  manager_id?: string;
  maintenance: { month_index: number; user_id: string | null }[];
}

interface ConnectionStaffModalProps {
  open: boolean;
  onClose: () => void;
  /** Одно подключение (карточка, контекстное меню) или несколько (массовое действие) */
  connections: ConnectionItem[];
  employees: ConnectionEmployeeOption[];
  canConfirm: boolean;
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

/**
 * Назначение сотрудников подключения: «кто подключил» (с подтверждением подключения)
 * и «кто сопровождает» по каждому месяцу. По умолчанию сопровождает подключивший.
 * Сопровождение подтверждается только при начислении за соответствующий месяц.
 */
export function ConnectionStaffModal({ open, onClose, connections, employees, canConfirm, busy = false, onSubmit }: ConnectionStaffModalProps) {
  const single = connections.length === 1 ? connections[0] : null;
  const monthsCount = React.useMemo(
    () => Math.max(1, ...connections.map((c) => Number(c.maintenance_months_total || c.maintenance_months_limit || 2))),
    [connections]
  );

  const [managerId, setManagerId] = React.useState<string>(KEEP);
  const [maintenance, setMaintenance] = React.useState<Record<number, string>>({});

  // Начальные значения: одно подключение — текущие назначения, несколько — «не менять»
  React.useEffect(() => {
    if (!open) return;
    const initial: Record<number, string> = {};
    if (single) {
      setManagerId(single.manager_id || KEEP);
      for (let i = 1; i <= monthsCount; i++) {
        const a = single.maintenance_assignments?.find((x) => x.month_index === i);
        initial[i] = a ? a.user_id : DEFAULT;
      }
    } else {
      setManagerId(KEEP);
      for (let i = 1; i <= monthsCount; i++) initial[i] = KEEP;
    }
    setMaintenance(initial);
  }, [open, single, monthsCount]);

  const accruedFor = (index: number) =>
    single ? single.maintenance_assignments?.find((x) => x.month_index === index && x.status === 'accrued') || null : null;

  const employeeById = React.useMemo(() => new Map(employees.map((e) => [e.user_id, e])), [employees]);

  const managerChanged = managerId !== KEEP && (!single || managerId !== single.manager_id);
  const needsConfirm = single ? single.confirmation_status !== 'confirmed' : connections.some((c) => c.confirmation_status !== 'confirmed');
  const maintenanceChanges = React.useMemo(() => {
    const list: { month_index: number; user_id: string | null }[] = [];
    for (let i = 1; i <= monthsCount; i++) {
      const v = maintenance[i];
      if (v === undefined || v === KEEP) continue;
      if (accruedFor(i)) continue;
      const current = single ? single.maintenance_assignments?.find((x) => x.month_index === i)?.user_id ?? null : undefined;
      const next = v === DEFAULT ? null : v;
      if (single && current === next) continue;
      list.push({ month_index: i, user_id: next });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenance, monthsCount, single]);

  const hasChanges = managerChanged || (managerId !== KEEP && needsConfirm) || maintenanceChanges.length > 0;

  const handleSubmit = async () => {
    await onSubmit({
      manager_id: managerId !== KEEP && (managerChanged || needsConfirm) ? managerId : undefined,
      maintenance: maintenanceChanges,
    });
  };

  const managerName = single?.manager_user?.full_name;

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Сотрудники подключения"
      subtitle={single ? `${single.seller_name} · ${single.store || 'Без магазина'}` : `Выбрано подключений: ${connections.length}`}
      icon={Users}
      tone="info"
      size="md"
      busy={busy}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={busy} disabled={!hasChanges} onClick={handleSubmit} leftIcon={<Check className="w-3.5 h-3.5" strokeWidth={1.75} />}>
            Назначить
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Подключил */}
        <FormField
          label="Подключил"
          hint={
            canConfirm
              ? 'Назначение подтверждает подключение: бонус за подключение начисляется этому сотруднику автоматически.'
              : 'Для смены подключившего нужно право подтверждать подключения.'
          }
        >
          <Select value={managerId} onChange={(e) => setManagerId(e.target.value)} disabled={!canConfirm}>
            <option value={KEEP}>{single && managerName ? `Не менять (${managerName})` : 'Не менять'}</option>
            {employees.map((e) => (
              <option key={e.user_id} value={e.user_id}>
                {e.full_name}
              </option>
            ))}
          </Select>
        </FormField>
        {managerId !== KEEP && needsConfirm && (
          <ModalCallout tone="success">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2} />
              {single ? 'Подключение будет подтверждено.' : 'Неподтвержденные подключения из выбранных будут подтверждены.'}
            </span>
          </ModalCallout>
        )}

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
              const value = maintenance[index] ?? (single ? DEFAULT : KEEP);
              return (
                <div
                  key={index}
                  className="flex items-center gap-3 p-2.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800"
                >
                  <div className="w-24 flex-shrink-0">
                    <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block">{index}-й месяц</span>
                    {monthLabel && <span className="text-[10px] text-zinc-400 font-mono block">{monthLabel}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    {accrued ? (
                      <div className="flex items-center gap-2 min-w-0">
                        {accrued.user ? (
                          <EmployeeBadge name={accrued.user.full_name} color={accrued.user.color} size="sm" />
                        ) : (
                          <span className="text-xs text-zinc-500">{employeeById.get(accrued.user_id)?.full_name || 'Сотрудник'}</span>
                        )}
                        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                          начислено {accrued.accrued_month ? formatMonth(accrued.accrued_month) : ''}
                        </span>
                      </div>
                    ) : (
                      <Select
                        size="sm"
                        value={value}
                        onChange={(e) => setMaintenance((prev) => ({ ...prev, [index]: e.target.value }))}
                      >
                        {!single && <option value={KEEP}>Не менять</option>}
                        <option value={DEFAULT}>Как у подключившего</option>
                        {employees.map((e) => (
                          <option key={e.user_id} value={e.user_id}>
                            {e.full_name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-zinc-400 leading-relaxed">
            По умолчанию каждый месяц сопровождает подключивший сотрудник. Назначенный на месяц сотрудник получает бонус за
            сопровождение в момент начисления за этот месяц; до этого назначение можно изменить.
          </p>
        </div>
      </div>
    </Modal>
  );
}
