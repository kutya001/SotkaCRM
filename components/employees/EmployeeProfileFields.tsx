'use client';

import * as React from 'react';
import { MapPin, ExternalLink, Search } from 'lucide-react';

export interface EmployeeProfileFormValue {
  address: string;
  latitude: string;
  longitude: string;
  inn: string;
  birth_date: string;
  gender: '' | 'male' | 'female';
  bio: string;
}

export const EMPTY_EMPLOYEE_PROFILE: EmployeeProfileFormValue = {
  address: '',
  latitude: '',
  longitude: '',
  inn: '',
  birth_date: '',
  gender: '',
  bio: '',
};

export const GENDER_LABELS: Record<'male' | 'female', string> = {
  male: 'Мужской',
  female: 'Женский',
};

/** Данные сотрудника → значения формы */
export function employeeProfileToForm(emp: {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  inn?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  bio?: string | null;
}): EmployeeProfileFormValue {
  return {
    address: emp.address || '',
    latitude: emp.latitude !== null && emp.latitude !== undefined ? String(emp.latitude) : '',
    longitude: emp.longitude !== null && emp.longitude !== undefined ? String(emp.longitude) : '',
    inn: emp.inn || '',
    birth_date: emp.birth_date || '',
    gender: emp.gender === 'male' || emp.gender === 'female' ? emp.gender : '',
    bio: emp.bio || '',
  };
}

/** Значения формы → тело запроса (пустые поля очищаются: null) */
export function employeeProfileToPayload(value: EmployeeProfileFormValue) {
  return {
    address: value.address.trim() || null,
    latitude: value.latitude.trim() ? Number(value.latitude.replace(',', '.')) : null,
    longitude: value.longitude.trim() ? Number(value.longitude.replace(',', '.')) : null,
    inn: value.inn.trim() || null,
    birth_date: value.birth_date || null,
    gender: value.gender || null,
    bio: value.bio.trim() || null,
  };
}

function parseCoordinate(value: string, limit: number): number | null {
  if (!value.trim()) return null;
  const num = Number(value.replace(',', '.'));
  return Number.isFinite(num) && Math.abs(num) <= limit ? num : null;
}

/** Возраст в полных годах */
export function ageFromBirthDate(birthDate: string | null | undefined): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age >= 0 ? age : null;
}

/** Ссылка на точку в Google Maps */
export function mapLinkForCoordinates(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

/** Встроенная карта OpenStreetMap с маркером места проживания */
export function EmployeeLocationMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const delta = 0.01;
  const bbox = [longitude - delta, latitude - delta, longitude + delta, latitude + delta]
    .map((n) => n.toFixed(6))
    .join(',');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`;

  return (
    <div className="space-y-1.5">
      <iframe
        title="Место проживания сотрудника"
        src={src}
        loading="lazy"
        className="w-full h-48 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800"
      />
      <div className="flex items-center gap-3 text-[11px]">
        <a
          href={mapLinkForCoordinates(latitude, longitude)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
        >
          <ExternalLink className="w-3 h-3" />
          Открыть в Google Maps
        </a>
        <a
          href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
        >
          <ExternalLink className="w-3 h-3" />
          OpenStreetMap
        </a>
      </div>
    </div>
  );
}

const inputClass =
  'w-full h-10 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500';

/**
 * Поля анкеты сотрудника для форм создания и редактирования.
 * В поле широты можно вставить пару координат «42.8746, 74.5698» из карт — она разделится сама.
 */
export function EmployeeProfileFields({
  value,
  onChange,
}: {
  value: EmployeeProfileFormValue;
  onChange: (value: EmployeeProfileFormValue) => void;
}) {
  const set = <K extends keyof EmployeeProfileFormValue>(key: K, v: EmployeeProfileFormValue[K]) =>
    onChange({ ...value, [key]: v });

  const handleLatitudeChange = (raw: string) => {
    // «42.874621, 74.569762» или «42.874621 74.569762» — пара координат из Google Maps / 2GIS
    const pair = raw.trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
    if (pair) {
      onChange({ ...value, latitude: pair[1].replace(',', '.'), longitude: pair[2].replace(',', '.') });
      return;
    }
    set('latitude', raw);
  };

  const lat = parseCoordinate(value.latitude, 90);
  const lon = parseCoordinate(value.longitude, 180);
  const hasPoint = lat !== null && lon !== null;
  const age = ageFromBirthDate(value.birth_date);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="font-semibold text-zinc-700 dark:text-zinc-300">ИНН</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={14}
            value={value.inn}
            onChange={(e) => set('inn', e.target.value.replace(/\D/g, '').slice(0, 14))}
            placeholder="14 цифр"
            className={`${inputClass} font-mono ${value.inn && value.inn.length !== 14 ? 'border-rose-500' : ''}`}
          />
          {value.inn && value.inn.length !== 14 && (
            <p className="text-[10px] text-rose-500">Осталось цифр: {14 - value.inn.length}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className="font-semibold text-zinc-700 dark:text-zinc-300">
            Дата рождения{age !== null ? ` (${age} лет)` : ''}
          </label>
          <input
            type="date"
            min="1900-01-01"
            max={today}
            value={value.birth_date}
            onChange={(e) => set('birth_date', e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>

        <div className="space-y-1">
          <label className="font-semibold text-zinc-700 dark:text-zinc-300">Пол</label>
          <select
            value={value.gender}
            onChange={(e) => set('gender', e.target.value as EmployeeProfileFormValue['gender'])}
            className={inputClass}
          >
            <option value="">Не указан</option>
            <option value="male">{GENDER_LABELS.male}</option>
            <option value="female">{GENDER_LABELS.female}</option>
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-rose-500" strokeWidth={1.75} />
          Адрес проживания
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            maxLength={300}
            value={value.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="г. Бишкек, ул. Киевская, 95"
            className={inputClass}
          />
          {value.address.trim() && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value.address.trim())}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Найти адрес на карте и скопировать координаты"
              className="h-10 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Search className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">На карте</span>
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="font-semibold text-zinc-700 dark:text-zinc-300">Широта</label>
          <input
            type="text"
            inputMode="decimal"
            value={value.latitude}
            onChange={(e) => handleLatitudeChange(e.target.value)}
            placeholder="42.874621"
            className={`${inputClass} font-mono ${value.latitude && lat === null ? 'border-rose-500' : ''}`}
          />
        </div>
        <div className="space-y-1">
          <label className="font-semibold text-zinc-700 dark:text-zinc-300">Долгота</label>
          <input
            type="text"
            inputMode="decimal"
            value={value.longitude}
            onChange={(e) => set('longitude', e.target.value)}
            placeholder="74.569762"
            className={`${inputClass} font-mono ${value.longitude && lon === null ? 'border-rose-500' : ''}`}
          />
        </div>
      </div>
      <p className="text-[10px] text-zinc-400 -mt-2">
        Можно вставить в «Широту» пару координат из карт, например «42.874621, 74.569762».
      </p>

      {hasPoint && <EmployeeLocationMap latitude={lat} longitude={lon} />}

      <div className="space-y-1">
        <label className="font-semibold text-zinc-700 dark:text-zinc-300">Биография</label>
        <textarea
          rows={3}
          maxLength={2000}
          value={value.bio}
          onChange={(e) => set('bio', e.target.value)}
          placeholder="Опыт работы, образование, навыки..."
          className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}
