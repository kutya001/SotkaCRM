'use client';

import * as React from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import {
  DEFAULT_MAP_CENTER,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  createPinIcon,
} from '@/components/ui/LocationPickerMap';
import { mapLinkForCoordinates } from '@/components/employees/EmployeeProfileFields';
import { ROLE_LABELS } from '@/lib/constants/roles';
import { formatPhoneDisplay, telHref } from '@/lib/utils/phone';

export interface EmployeeMapPoint {
  user_id: string;
  full_name: string;
  login: string;
  role: string;
  color: string | null;
  phone: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
}

export interface EmployeesMapProps {
  employees: EmployeeMapPoint[];
  heightClassName?: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');
}

/** Подгоняет область карты под все булавки */
function FitToEmployees({ employees }: { employees: EmployeeMapPoint[] }) {
  const map = useMap();
  React.useEffect(() => {
    if (employees.length === 0) {
      map.setView(DEFAULT_MAP_CENTER, 11);
      return;
    }
    const bounds = L.latLngBounds(employees.map((e) => [e.latitude, e.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }, [map, employees]);
  return null;
}

/** Общая карта мест проживания сотрудников (администратор) */
export function EmployeesMap({ employees, heightClassName = 'h-[70vh]' }: EmployeesMapProps) {
  const icons = React.useMemo(
    () =>
      new Map(
        employees.map((e) => [e.user_id, createPinIcon(e.color || '#2563eb', initials(e.full_name))])
      ),
    [employees]
  );

  return (
    <div className={`${heightClassName} w-full rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 relative z-0`}>
      <MapContainer center={DEFAULT_MAP_CENTER} zoom={11} scrollWheelZoom className="h-full w-full">
        <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
        <FitToEmployees employees={employees} />
        {employees.map((e) => (
          <Marker key={e.user_id} position={[e.latitude, e.longitude]} icon={icons.get(e.user_id)}>
            <Popup>
              <div style={{ minWidth: 180, fontSize: 12, lineHeight: 1.4 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{e.full_name}</div>
                <div style={{ color: '#71717a' }}>
                  @{e.login} · {ROLE_LABELS[e.role as keyof typeof ROLE_LABELS] || e.role}
                </div>
                {e.address && <div style={{ marginTop: 4 }}>{e.address}</div>}
                {e.phone && (
                  <div style={{ marginTop: 4 }}>
                    <a href={telHref(e.phone)}>{formatPhoneDisplay(e.phone)}</a>
                  </div>
                )}
                <div style={{ marginTop: 6 }}>
                  <a href={mapLinkForCoordinates(e.latitude, e.longitude)} target="_blank" rel="noopener noreferrer">
                    Открыть в Google Maps
                  </a>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
