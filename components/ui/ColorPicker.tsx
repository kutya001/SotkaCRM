'use client';

import * as React from 'react';
import { Check, Palette, Hash } from 'lucide-react';
import {
  EMPLOYEE_COLORS,
  DEFAULT_EMPLOYEE_COLOR,
  isValidHex,
  normalizeHex,
} from '@/lib/constants/colors';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  className?: string;
}

export function ColorPicker({
  value,
  onChange,
  label = 'Цвет сотрудника',
  className = '',
}: ColorPickerProps) {
  const [hexInput, setHexInput] = React.useState(value || DEFAULT_EMPLOYEE_COLOR);
  const colorInputRef = React.useRef<HTMLInputElement>(null);

  // Синхронизация локального инпута при внешнем изменении value
  React.useEffect(() => {
    if (value) {
      setHexInput(value);
    }
  }, [value]);

  const currentValidHex = isValidHex(value) ? normalizeHex(value) : DEFAULT_EMPLOYEE_COLOR;
  const isCustomColor = !EMPLOYEE_COLORS.some(
    (c) => c.value.toLowerCase() === value?.toLowerCase()
  );
  const isInputValid = isValidHex(hexInput);

  const handleSelectPreset = (hex: string) => {
    const normalized = normalizeHex(hex);
    setHexInput(normalized);
    onChange(normalized);
  };

  const handleOpenNativePicker = () => {
    colorInputRef.current?.click();
  };

  const handleNativePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (isValidHex(val)) {
      const normalized = normalizeHex(val);
      setHexInput(normalized);
      onChange(normalized);
    }
  };

  const handleManualHexChange = (cleanChars: string) => {
    const formatted = `#${cleanChars}`;
    setHexInput(formatted);
    if (isValidHex(formatted)) {
      onChange(normalizeHex(formatted));
    }
  };

  const handleManualHexBlur = () => {
    if (isValidHex(hexInput)) {
      const normalized = normalizeHex(hexInput);
      setHexInput(normalized);
      onChange(normalized);
    } else {
      setHexInput(currentValidHex);
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 block">
            {label}
          </label>
          <span className="text-[10px] font-mono text-zinc-400 uppercase">
            {currentValidHex}
          </span>
        </div>
      )}

      {/* Быстрые пресеты + кнопка радужного спектра */}
      <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700">
        {EMPLOYEE_COLORS.map((col) => {
          const isSelected = value?.toLowerCase() === col.value.toLowerCase();
          return (
            <button
              key={col.value}
              type="button"
              onClick={() => handleSelectPreset(col.value)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${col.dotClass} hover:scale-110 active:scale-95 shadow-xs relative ${
                isSelected
                  ? 'ring-2 ring-offset-2 ring-zinc-900 dark:ring-white ring-offset-white dark:ring-offset-zinc-900 scale-105'
                  : 'opacity-85 hover:opacity-100'
              }`}
              title={col.label}
              aria-label={col.label}
            >
              {isSelected && (
                <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
              )}
            </button>
          );
        })}

        {/* Кнопка спектра для произвольного выбора цвета */}
        <button
          type="button"
          onClick={handleOpenNativePicker}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-xs relative cursor-pointer ${
            isCustomColor
              ? 'ring-2 ring-offset-2 ring-zinc-900 dark:ring-white ring-offset-white dark:ring-offset-zinc-900 scale-105'
              : 'opacity-90 hover:opacity-100'
          }`}
          style={{
            background:
              'conic-gradient(from 180deg at 50% 50%, #FF0000 0deg, #FF7A00 45deg, #FFEB3B 90deg, #4CAF50 135deg, #00BCD4 180deg, #2196F3 225deg, #9C27B0 270deg, #FF0000 360deg)',
          }}
          title="Произвольный выбор цвета (спектр / пипетка)"
          aria-label="Произвольный выбор цвета (спектр / пипетка)"
        >
          <Palette className="w-3.5 h-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" strokeWidth={2.25} />
          {isCustomColor && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500 border border-white dark:border-zinc-900" />
          )}
        </button>

        {/* Скрытый нативный input[type=color] */}
        <input
          ref={colorInputRef}
          type="color"
          value={currentValidHex}
          onChange={handleNativePickerChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      {/* Ручной ввод HEX-значения с превью оттенка */}
      <div className="flex items-center gap-2 p-2 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          onClick={handleOpenNativePicker}
          className="w-8 h-8 rounded-xl border border-black/10 dark:border-white/10 shadow-xs flex-shrink-0 cursor-pointer transition-transform hover:scale-105 active:scale-95 flex items-center justify-center relative group"
          style={{ backgroundColor: currentValidHex }}
          title="Кликните для выбора в палитре"
          aria-label="Текущий оттенок"
        >
          <Palette className="w-3.5 h-3.5 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={2} />
        </button>

        <div className="flex-1 relative flex items-center">
          <div className="absolute left-2.5 text-zinc-400 pointer-events-none flex items-center">
            <Hash className="w-3.5 h-3.5" strokeWidth={2} />
          </div>
          <input
            type="text"
            value={hexInput.replace(/^#/, '')}
            onChange={(e) => handleManualHexChange(e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6))}
            onBlur={handleManualHexBlur}
            maxLength={6}
            placeholder="3B82F6"
            className={`w-full h-8 pl-7 pr-3 rounded-xl bg-white dark:bg-zinc-900 border text-xs font-mono font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 transition-all ${
              !isInputValid && hexInput.length > 0
                ? 'border-rose-400 dark:border-rose-500 focus:ring-rose-500/20'
                : 'border-zinc-200 dark:border-zinc-700 focus:ring-blue-500/20 focus:border-blue-500'
            }`}
            title="Ручной ввод HEX-кода"
          />
        </div>

        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 flex-shrink-0">
          {isCustomColor ? 'Кастомный' : 'Пресет'}
        </span>
      </div>
    </div>
  );
}
