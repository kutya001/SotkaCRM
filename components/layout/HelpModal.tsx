'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { CircleHelp, GraduationCap, Lightbulb, Sparkles, Compass } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { getModuleHelp } from '@/lib/module-help';
import { APP_VERSION } from '@/lib/changelog';
import { useGuide } from '@/components/onboarding/GuideProvider';

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
  const guide = useGuide();
  const moduleTour = guide?.currentTour || null;

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
        data-tour="help"
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

          {guide && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                <GraduationCap className="w-3.5 h-3.5" strokeWidth={2} />
                Обучение
              </div>
              <div className="flex flex-wrap gap-2">
                {moduleTour && (
                  <Button
                    size="sm"
                    leftIcon={<GraduationCap className="w-3.5 h-3.5" strokeWidth={1.75} />}
                    onClick={() => {
                      setOpen(false);
                      guide.startTour(moduleTour.id);
                    }}
                  >
                    Пройти обучение: {moduleTour.title}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Compass className="w-3.5 h-3.5" strokeWidth={1.75} />}
                  onClick={() => {
                    setOpen(false);
                    guide.startTour('welcome');
                  }}
                >
                  Знакомство с интерфейсом
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />}
                  onClick={() => {
                    setOpen(false);
                    guide.openWhatsNew();
                  }}
                >
                  Что нового · {APP_VERSION}
                </Button>
              </div>
              {guide.disabled ? (
                <p className="text-[11px] text-zinc-500">
                  Подсказки обучения отключены.{' '}
                  <button type="button" onClick={() => guide.setDisabled(false)} className="font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                    Включить снова
                  </button>
                </p>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  Подсказки модуля появляются сами при первом открытии.{' '}
                  <button type="button" onClick={() => guide.setDisabled(true)} className="font-semibold text-zinc-600 dark:text-zinc-300 hover:underline">
                    Не показывать
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
