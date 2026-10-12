'use client';

import dynamic from 'next/dynamic';
import type { LocationPickerMapProps } from './LocationPickerMap';

function MapSkeleton() {
  return (
    <div className="h-64 w-full rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse flex items-center justify-center text-xs text-zinc-400">
      Загрузка карты...
    </div>
  );
}

/** Карта выбора места проживания (Leaflet работает только в браузере — без SSR) */
export const LocationPicker = dynamic<LocationPickerMapProps>(
  () => import('./LocationPickerMap').then((m) => m.LocationPickerMap),
  { ssr: false, loading: MapSkeleton }
);
