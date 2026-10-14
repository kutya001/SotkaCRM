'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { CircleHelp, Lightbulb } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { getModuleHelp } from '@/lib/module-help';

interface HelpButtonProps {
  className?: string;
  iconClassName?: string;
}

/**
 * Значок «?» верхней панели: открывает окно подсказки по текущему модулю.
 * Не рендерится для маршрутов без справки.
 */
export function HelpButton({ className, iconClassName = 'w-4 h-4' }: HelpButtonProps) {
  const pathname = usePathname();
  const help = React.useMemo(() => getModuleHelp(pathname), [pathname]);
  const [open, setOpen] = React.useState(false);

  // Закрытие при смене маршрута
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!help) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ||
          'w-10 h-10 rounded-xl bg-zinc-200/50 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50 flex items-center justify-center transition-colors island-interactive'
        }
        title={`Подсказка: ${help.title}`}
        aria-label="Подсказка по модулю"
      >
        <CircleHelp className={iconClassName} strokeWidth={1.75} />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={help.title}
        subtitle="О модуле и подсказки по работе"
        icon={CircleHelp}
        tone="info"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{help.description}</p>
          {help.tips.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                <Lightbulb className="w-3.5 h-3.5" strokeWidth={2} />
                Подсказки
              </div>
              <ul className="space-y-2">
                {help.tips.map((tip, i) => (
                  <li
                    key={i}
                    className="flex gap-2.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 rounded-xl bg-zinc-100/70 dark:bg-zinc-800/50 px-3 py-2"
                  >
                    <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
