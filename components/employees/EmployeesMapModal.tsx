'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { MapPin, Loader2 } from 'lucide-react';
import { getEmployeesForMap } from '@/app/employees/actions';
import { Modal, ModalCallout } from '@/components/ui/Modal';
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

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Карта сотрудников"
      subtitle={
        isLoading
          ? 'Загрузка...'
          : `На карте: ${points.length}${withoutPoint.length ? ` · без координат: ${withoutPoint.length}` : ''}`
      }
      icon={MapPin}
      tone="danger"
      size="5xl"
      mobileSheet={false}
    >
      <div className="space-y-4">
        {error && <ModalCallout tone="danger">{error}</ModalCallout>}

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
    </Modal>
  );
}
