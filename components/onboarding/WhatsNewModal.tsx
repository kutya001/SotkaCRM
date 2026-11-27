'use client';

import * as React from 'react';
import { CircleCheck, Plus, RefreshCw, Sparkles, Wrench } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { APP_VERSION, CHANGELOG, type ChangelogEntry } from '@/lib/changelog';
import { formatDateOnly } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

interface WhatsNewModalProps {
  open: boolean;
  onClose: () => void;
  /** Записи для показа; без них — весь журнал */
  entries?: ChangelogEntry[];
}

const SECTIONS: { key: 'added' | 'changed' | 'fixed'; label: string; icon: React.ElementType; tone: string }[] = [
  { key: 'added', label: 'Добавлено', icon: Plus, tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
  { key: 'changed', label: 'Изменено', icon: RefreshCw, tone: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
  { key: 'fixed', label: 'Исправлено', icon: Wrench, tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
];

function EntryBlock({ entry, defaultOpen }: { entry: ChangelogEntry; defaultOpen: boolean }) {
  const isCurrent = entry.version === APP_VERSION;
  return (
    <details
      open={defaultOpen}
      className="group rounded-2xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 overflow-hidden"
    >
      <summary className="cursor-pointer list-none px-4 py-3 flex items-start justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Версия {entry.version}</span>
            {isCurrent && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                текущая
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{entry.title}</p>
        </div>
        <span className="text-[11px] font-mono text-zinc-400 flex-shrink-0 mt-0.5">{formatDateOnly(entry.date)}</span>
      </summary>
      <div className="px-4 pb-4 space-y-3">
        {SECTIONS.map(({ key, label, icon: Icon, tone }) => {
          const items = entry[key];
          if (!items || items.length === 0) return null;
          return (
            <div key={key} className="space-y-1.5">
              <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold', tone)}>
                <Icon className="w-3 h-3" strokeWidth={2} />
                {label}
              </span>
              <ul className="space-y-1.5">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                    <span className="mt-[6px] w-1 h-1 rounded-full bg-zinc-400 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </details>
  );
}

/** Журнал изменений: после обновления — новые версии, по кнопке версии — весь журнал */
export function WhatsNewModal({ open, onClose, entries }: WhatsNewModalProps) {
  const [showAll, setShowAll] = React.useState(false);
  React.useEffect(() => {
    if (open) setShowAll(false);
  }, [open]);

  const list = showAll || !entries || entries.length === 0 ? CHANGELOG : entries;
  const partial = list.length < CHANGELOG.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      tone="purple"
      icon={Sparkles}
      title="Что нового"
      subtitle={`SotkaCRM, версия ${APP_VERSION}`}
      footer={
        <>
          {partial && (
            <Button variant="outline" onClick={() => setShowAll(true)}>
              Все версии
            </Button>
          )}
          <Button onClick={onClose} leftIcon={<CircleCheck className="w-4 h-4" strokeWidth={1.75} />}>
            Понятно
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {list.map((entry, i) => (
          <EntryBlock key={entry.version} entry={entry} defaultOpen={i === 0 || partial} />
        ))}
      </div>
    </Modal>
  );
}
