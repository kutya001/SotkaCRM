'use client';

import * as React from 'react';
import { MapPin, ExternalLink, Search } from 'lucide-react';
import { LocationPicker } from '@/components/ui/LocationPicker';
import { FormField, Input, Select, Textarea } from '@/components/ui/Field';
import { ButtonLink } from '@/components/ui/Button';

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

/** Карта места проживания: точка задается кликом/перетаскиванием, ссылки на внешние карты */
export function EmployeeLocationMap({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange?: (latitude: number, longitude: number) => void;
}) {
  const hasPoint = latitude !== null && longitude !== null;
  return (
    <div className="space-y-1.5">
      <LocationPicker latitude={latitude} longitude={longitude} onChange={onChange} readOnly={!onChange} />
      {hasPoint && (
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
      )}
    </div>
  );
}

/**
 * Поля анкеты сотрудника для форм создания и редактирования.
 * Место проживания задается кликом по карте (или поиском адреса); координаты можно
 * ввести и вручную — в поле широты принимается пара «42.8746, 74.5698» из карт.
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
  const handleMapPick = (pickedLat: number, pickedLon: number) =>
    onChange({ ...value, latitude: String(pickedLat), longitude: String(pickedLon) });
  const age = ageFromBirthDate(value.birth_date);
  const today = new Date().toISOString().slice(0, 10);

  const innInvalid = Boolean(value.inn) && value.inn.length !== 14;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField label="ИНН" error={innInvalid ? `Осталось цифр: ${14 - value.inn.length}` : undefined}>
          <Input
            type="text"
            inputMode="numeric"
            maxLength={14}
            value={value.inn}
            onChange={(e) => set('inn', e.target.value.replace(/\D/g, '').slice(0, 14))}
            placeholder="14 цифр"
            mono
            size="lg"
            invalid={innInvalid}
          />
        </FormField>

        <FormField label={`Дата рождения${age !== null ? ` (${age} лет)` : ''}`}>
          <Input
            type="date"
            min="1900-01-01"
            max={today}
            value={value.birth_date}
            onChange={(e) => set('birth_date', e.target.value)}
            mono
            size="lg"
          />
        </FormField>

        <FormField label="Пол">
          <Select
            value={value.gender}
            onChange={(e) => set('gender', e.target.value as EmployeeProfileFormValue['gender'])}
            size="lg"
          >
            <option value="">Не указан</option>
            <option value="male">{GENDER_LABELS.male}</option>
            <option value="female">{GENDER_LABELS.female}</option>
          </Select>
        </FormField>
      </div>

      <FormField
        label={
          <span className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-rose-500" strokeWidth={1.75} />
            Адрес проживания
          </span>
        }
      >
        <div className="flex gap-2">
          <Input
            type="text"
            maxLength={300}
            value={value.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="г. Бишкек, ул. Киевская, 95"
            size="lg"
          />
          {value.address.trim() && (
            <ButtonLink
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value.address.trim())}`}
              target="_blank"
              title="Найти адрес на карте и скопировать координаты"
              variant="secondary"
              size="lg"
              className="text-xs"
              leftIcon={<Search className="w-3.5 h-3.5" strokeWidth={1.75} />}
            >
              <span className="hidden sm:inline">На карте</span>
            </ButtonLink>
          )}
        </div>
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Широта">
          <Input
            type="text"
            inputMode="decimal"
            value={value.latitude}
            onChange={(e) => handleLatitudeChange(e.target.value)}
            placeholder="42.874621"
            mono
            size="lg"
            invalid={Boolean(value.latitude) && lat === null}
          />
        </FormField>
        <FormField label="Долгота">
          <Input
            type="text"
            inputMode="decimal"
            value={value.longitude}
            onChange={(e) => set('longitude', e.target.value)}
            placeholder="74.569762"
            mono
            size="lg"
            invalid={Boolean(value.longitude) && lon === null}
          />
        </FormField>
      </div>
      <p className="text-[10px] text-zinc-400 -mt-2">
        Кликните по карте ниже — координаты заполнятся сами. Или вставьте в «Широту» пару из карт, например «42.874621, 74.569762».
      </p>

      <EmployeeLocationMap latitude={hasPoint ? lat : null} longitude={hasPoint ? lon : null} onChange={handleMapPick} />

      <FormField label="Биография">
        <Textarea
          rows={3}
          maxLength={2000}
          value={value.bio}
          onChange={(e) => set('bio', e.target.value)}
          placeholder="Опыт работы, образование, навыки..."
        />
      </FormField>
    </div>
  );
}
