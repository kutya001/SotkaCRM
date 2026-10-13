'use client';

import * as React from 'react';
import { Input, Select, type FieldSize } from './Field';
import {
  DEFAULT_COUNTRY_CODE,
  PHONE_COUNTRIES,
  digitsOnly,
  findPhoneCountry,
  isValidNational,
  nationalLengthFor,
  normalizeNational,
  splitFullNumber,
  toFullDigits,
} from '@/lib/utils/phone';
import { cn } from '@/lib/utils/cn';

export interface PhoneParts {
  countryCode: string;
  national: string;
}

export interface PhoneInputProps {
  value: PhoneParts;
  onChange: (value: PhoneParts) => void;
  disabled?: boolean;
  required?: boolean;
  size?: FieldSize;
  autoFocus?: boolean;
  id?: string;
  className?: string;
  /** Показывать подсказку о длине под полем */
  showHint?: boolean;
}

/**
 * Телефон с выбором кода страны СНГ и проверкой длины национального номера.
 * Вставка полного номера («+996 700 123 456») разбирается на код и номер.
 */
export function PhoneInput({
  value,
  onChange,
  disabled,
  required,
  size = 'md',
  autoFocus,
  id,
  className,
  showHint = true,
}: PhoneInputProps) {
  const countryCode = value.countryCode || DEFAULT_COUNTRY_CODE;
  const country = findPhoneCountry(countryCode) || PHONE_COUNTRIES[0];
  const expected = nationalLengthFor(countryCode);
  const national = digitsOnly(value.national);
  const touched = national.length > 0;
  const valid = isValidNational(national, countryCode);

  const handleNationalChange = (raw: string) => {
    const digits = digitsOnly(raw);
    // Вставили полный номер с кодом другой страны — переключаем страну
    if (digits.length > expected) {
      const parts = splitFullNumber(digits);
      if (parts) {
        onChange(parts);
        return;
      }
    }
    onChange({ countryCode, national: normalizeNational(digits, countryCode).slice(0, expected) });
  };

  // RU и KZ делят код 7 — различаем по iso в селекте
  const [iso, setIso] = React.useState(country.iso);
  React.useEffect(() => {
    if (findPhoneCountry(countryCode)?.code !== PHONE_COUNTRIES.find((c) => c.iso === iso)?.code) {
      setIso(country.iso);
    }
  }, [countryCode, country.iso, iso]);

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-stretch gap-2">
        <Select
          size={size}
          value={iso}
          disabled={disabled}
          aria-label="Код страны"
          onChange={(e) => {
            const next = PHONE_COUNTRIES.find((c) => c.iso === e.target.value) || PHONE_COUNTRIES[0];
            setIso(next.iso);
            onChange({ countryCode: next.code, national: national.slice(0, next.nationalLength) });
          }}
          className="w-[7.5rem] flex-shrink-0 font-mono"
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.flag} +{c.code} {c.iso}
            </option>
          ))}
        </Select>
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          size={size}
          mono
          value={national}
          onChange={(e) => handleNationalChange(e.target.value)}
          onPaste={(e) => {
            e.preventDefault();
            handleNationalChange(e.clipboardData.getData('text'));
          }}
          placeholder={country.placeholder}
          maxLength={expected}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          invalid={touched && !valid}
          className="flex-1"
        />
      </div>
      {showHint && (
        <p className={cn('text-[10px] leading-snug', touched && !valid ? 'text-rose-500' : 'text-zinc-400')}>
          {touched && !valid
            ? `${country.name}: номер должен содержать ${expected} цифр (введено ${national.length})`
            : `${country.name}: ${expected} цифр без кода страны · полный номер +${toFullDigits(countryCode, national || country.placeholder)}`}
        </p>
      )}
    </div>
  );
}

/**
 * Хук для форм, которые хранят полный номер цифрами («996555123456»):
 * возвращает части для PhoneInput и собранный номер (null, если пусто).
 */
export function usePhoneParts(initialFull: string | null | undefined) {
  const parse = React.useCallback((full: string | null | undefined): PhoneParts => {
    const parts = splitFullNumber(full);
    if (parts) return parts;
    const digits = digitsOnly(full);
    return { countryCode: DEFAULT_COUNTRY_CODE, national: digits.slice(-nationalLengthFor(DEFAULT_COUNTRY_CODE)) };
  }, []);

  const [parts, setParts] = React.useState<PhoneParts>(() => parse(initialFull));
  const reset = React.useCallback((full: string | null | undefined) => setParts(parse(full)), [parse]);

  const national = digitsOnly(parts.national);
  const isEmpty = national.length === 0;
  const isValid = isEmpty || isValidNational(national, parts.countryCode);
  const full = isEmpty ? null : toFullDigits(parts.countryCode, national);

  return { parts, setParts, reset, full, isValid, isEmpty };
}
