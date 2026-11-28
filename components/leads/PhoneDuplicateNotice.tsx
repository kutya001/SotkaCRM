'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, Store } from 'lucide-react';
import { api, type PhoneDuplicatesDto } from '@/lib/api/client';
import { PIPELINE_STATUS_OPTIONS } from '@/components/ui/DataJournal';
import { formatDateOnly } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

/**
 * Проверка номера на дубликаты при вводе (задержка 400 мс): лиды с тем же номером и продавец платформы.
 * Результат — предупреждение; сохранить лид все равно можно.
 */
export function usePhoneDuplicates(
  phone: string | null | undefined,
  countryCode: string | null | undefined,
  excludeLeadId: string | null | undefined,
  enabled = true
): { result: PhoneDuplicatesDto | null; loading: boolean } {
  const [result, setResult] = React.useState<PhoneDuplicatesDto | null>(null);
  const [loading, setLoading] = React.useState(false);
  const digits = String(phone || '').replace(/\D/g, '');

  React.useEffect(() => {
    if (!enabled || digits.length < 7) {
      setResult(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.leads
        .checkDuplicates(digits, countryCode, excludeLeadId)
        .then((res) => {
          if (!cancelled) setResult(res);
        })
        .catch(() => {
          // Проверка — подсказка: при ошибке сети просто не показываем предупреждение
          if (!cancelled) setResult(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [digits, countryCode, excludeLeadId, enabled]);

  return { result, loading };
}

export function hasDuplicates(result: PhoneDuplicatesDto | null | undefined): boolean {
  return Boolean(result && (result.leads.length > 0 || result.seller));
}

interface PhoneDuplicateNoticeProps {
  result: PhoneDuplicatesDto | null;
  loading?: boolean;
  /** Открыть найденный лид (только свои / видимые) */
  onOpenLead?: (leadId: string) => void;
}

/** Янтарное предупреждение под полем телефона: кто уже работает с этим номером */
export function PhoneDuplicateNotice({ result, loading, onOpenLead }: PhoneDuplicateNoticeProps) {
  if (loading && !result) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
        <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />
        Проверяем номер на дубликаты...
      </p>
    );
  }
  if (!result || !hasDuplicates(result)) return null;

  const { leads, seller } = result;
  return (
    <div
      role="status"
      className="mt-2 p-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200 space-y-2"
    >
      {leads.length > 0 && (
        <>
          <p className="flex items-start gap-1.5 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" strokeWidth={1.75} />
            Этот номер уже есть у {leads.length === 1 ? 'другого лида' : `${leads.length} лидов`}. Сохранить можно, но проверьте, не дубль ли это.
          </p>
          <ul className="space-y-1.5">
            {leads.slice(0, 5).map((lead) => {
              const statusOpt = PIPELINE_STATUS_OPTIONS.find((o) => o.value === lead.status);
              const clickable = lead.visible && Boolean(onOpenLead);
              return (
                <li key={lead.lead_id}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && onOpenLead?.(lead.lead_id)}
                    className={cn(
                      'w-full text-left flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5 rounded-xl bg-white/70 dark:bg-zinc-900/60 border border-amber-500/20 text-[11px] text-zinc-700 dark:text-zinc-300',
                      clickable ? 'hover:border-amber-500/50 cursor-pointer' : 'cursor-default'
                    )}
                  >
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate max-w-[12rem]">
                      {lead.visible ? lead.client_name || 'Без имени' : 'Лид другого сотрудника'}
                    </span>
                    {statusOpt && (
                      <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${statusOpt.colorClass}`}>
                        {statusOpt.label}
                      </span>
                    )}
                    <span className="text-zinc-500">{lead.assigned_name || 'не назначен'}</span>
                    <span className="font-mono text-zinc-400">{formatDateOnly(lead.created_at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {seller && (
        <p className="flex items-start gap-1.5 text-xs">
          <Store className="w-4 h-4 flex-shrink-0 mt-px" strokeWidth={1.75} />
          <span>
            Номер принадлежит продавцу платформы <b>{seller.seller_name}</b>
            {seller.manager_name ? ` (консультант — ${seller.manager_name})` : ' (без консультанта)'}. Возможно, лид уже подключен — проверьте в
            модуле «Продавцы».
          </span>
        </p>
      )}
    </div>
  );
}
