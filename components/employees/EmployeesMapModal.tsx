'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { MapPin, X, Loader2 } from 'lucide-react';
import { getEmployeesForMap } from '@/app/employees/actions';
import type { EmployeeMapPoint, EmployeesMapProps } from './EmployeesMap';

const EmployeesMap = dynamic<EmployeesMapProps>(
  () => import('./EmployeesMap').then((m) => m.EmployeesMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[70vh] w-full rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
    ),
  }
);

interface EmployeesMapModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Общая карта мест проживания сотрудников (только администратор) */
export function EmployeesMapModal({ isOpen, onClose }: EmployeesMapModalProps) {
  const [points, setPoints] = React.useState<EmployeeMapPoint[]>([]);
  const [withoutPoint, setWithoutPoint] = React.useState<string[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getEmployeesForMap()
      .then((res) => {
        if (cancelled) return;
        if (res.error) setError(res.error);
        setPoints(res.points);
        setWithoutPoint(res.withoutCoordinates);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 bg-black/50 dark:bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl p-4 sm:p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Карта сотрудников</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {isLoading
                  ? 'Загрузка...'
                  : `На карте: ${points.length}${withoutPoint.length ? ` · без координат: ${withoutPoint.length}` : ''}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-500 transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="h-[70vh] flex items-center justify-center text-zinc-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <EmployeesMap employees={points} />
        )}

        {withoutPoint.length > 0 && !isLoading && (
          <p className="text-[11px] text-zinc-400 leading-snug">
            Без координат: {withoutPoint.join(', ')}. Укажите место проживания в карточке сотрудника — кликом по карте.
          </p>
        )}
      </div>
    </div>
  );
}
