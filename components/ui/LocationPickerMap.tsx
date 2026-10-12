'use client';

import * as React from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import { LocateFixed, Search, Loader2, X } from 'lucide-react';

/** Центр по умолчанию — Бишкек */
export const DEFAULT_MAP_CENTER: [number, number] = [42.8746, 74.5698];
export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Маркер-булавка заданного цвета (без картинок Leaflet, которые теряются при сборке) */
export function createPinIcon(color = '#f43f5e', label?: string): L.DivIcon {
  const text = label
    ? `<text x="14" y="17" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="system-ui, sans-serif">${label}</text>`
    : '<circle cx="14" cy="13" r="4.5" fill="#fff"/>';
  return L.divIcon({
    className: 'crm-map-pin',
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38" style="display:block;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M14 1C7.1 1 1.5 6.6 1.5 13.5c0 9.4 11 22.5 12.5 23.5 1.5-1 12.5-14.1 12.5-23.5C26.5 6.6 20.9 1 14 1z" fill="${color}" stroke="#fff" stroke-width="2"/>${text}</svg>`,
    iconSize: [28, 38],
    iconAnchor: [14, 37],
    popupAnchor: [0, -34],
  });
}

export interface LocationPickerMapProps {
  latitude: number | null;
  longitude: number | null;
  onChange?: (latitude: number, longitude: number) => void;
  /** Только просмотр: клики по карте не меняют точку */
  readOnly?: boolean;
  heightClassName?: string;
  /** Цвет булавки */
  color?: string;
}

function ClickHandler({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

/** Следит за точкой: при изменении координат извне (ввод в поля) центрирует карту */
function FollowPoint({ point }: { point: [number, number] | null }) {
  const map = useMap();
  React.useEffect(() => {
    if (point) map.setView(point, Math.max(map.getZoom(), 14), { animate: true });
  }, [map, point?.[0], point?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Интерактивная карта места проживания: клик по карте или перетаскивание булавки
 * задает широту и долготу, есть поиск адреса и определение текущего местоположения.
 */
export function LocationPickerMap({
  latitude,
  longitude,
  onChange,
  readOnly = false,
  heightClassName = 'h-64',
  color = '#f43f5e',
}: LocationPickerMapProps) {
  const point = React.useMemo<[number, number] | null>(
    () => (latitude !== null && longitude !== null ? [latitude, longitude] : null),
    [latitude, longitude]
  );
  const icon = React.useMemo(() => createPinIcon(color), [color]);

  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [isLocating, setIsLocating] = React.useState(false);
  const [hint, setHint] = React.useState<string | null>(null);

  const pick = (lat: number, lon: number) => {
    if (readOnly || !onChange) return;
    onChange(round6(lat), round6(lon));
  };

  const searchAddress = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setIsSearching(true);
    setHint(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ru&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = (await res.json()) as NominatimResult[];
      setResults(Array.isArray(data) ? data : []);
      if (!data || data.length === 0) setHint('Адрес не найден — укажите точку кликом по карте');
    } catch {
      setHint('Поиск адреса недоступен — укажите точку кликом по карте');
    } finally {
      setIsSearching(false);
    }
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      setHint('Геолокация не поддерживается браузером');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pick(pos.coords.latitude, pos.coords.longitude);
        setIsLocating(false);
      },
      () => {
        setHint('Не удалось определить местоположение — разрешите доступ к геолокации');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="space-y-2">
      {!readOnly && (
        <form onSubmit={searchAddress} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти адрес на карте: Бишкек, ул. Киевская, 95"
              className="w-full h-9 pl-8 pr-8 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                aria-label="Очистить"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="h-9 px-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
          >
            {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Найти</span>
          </button>
          <button
            type="button"
            onClick={locateMe}
            disabled={isLocating}
            title="Моё местоположение"
            className="h-9 w-9 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 text-blue-600 dark:text-blue-400 flex items-center justify-center disabled:opacity-50"
          >
            {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" strokeWidth={1.75} />}
          </button>
        </form>
      )}

      {results.length > 0 && (
        <ul className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 max-h-40 overflow-y-auto">
          {results.map((r) => (
            <li key={r.place_id}>
              <button
                type="button"
                onClick={() => {
                  pick(Number(r.lat), Number(r.lon));
                  setResults([]);
                }}
                className="w-full text-left px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={`${heightClassName} w-full rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 relative z-0`}>
        <MapContainer
          center={point || DEFAULT_MAP_CENTER}
          zoom={point ? 15 : 12}
          scrollWheelZoom
          className="h-full w-full"
          style={{ cursor: readOnly ? 'grab' : 'crosshair' }}
        >
          <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
          {!readOnly && <ClickHandler onPick={pick} />}
          <FollowPoint point={point} />
          {point && (
            <Marker
              position={point}
              icon={icon}
              draggable={!readOnly}
              eventHandlers={{
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  pick(ll.lat, ll.lng);
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      <p className="text-[10px] text-zinc-400 leading-snug">
        {hint ||
          (readOnly
            ? point
              ? `Координаты: ${point[0]}, ${point[1]}`
              : 'Место проживания не указано'
            : point
            ? `Точка: ${point[0]}, ${point[1]} — перетащите булавку или кликните в другое место`
            : 'Кликните по карте, чтобы указать место проживания, или найдите адрес')}
      </p>
    </div>
  );
}
