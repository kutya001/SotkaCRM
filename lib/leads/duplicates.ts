/**
 * Дубликаты номера телефона среди лидов: ключ — полный номер цифрами (код страны + национальный).
 * Файл чистый: используется в реестре (метка «Дубль»), сервисе проверки и скриптах проверки.
 */
import { fullDigitsFrom } from '../utils/phone.ts';

/** Ключ номера лида: «996700123456»; пустой номер — '' */
export function leadPhoneKey(phone: string | null | undefined, countryCode?: string | null): string {
  if (!phone) return '';
  return fullDigitsFrom(phone, countryCode || undefined);
}

/** Сколько лидов с каждым номером (в выборке, которую видит сотрудник) */
export function countPhoneKeys(leads: { phone: string | null; country_code?: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const key = leadPhoneKey(lead.phone, lead.country_code);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}
