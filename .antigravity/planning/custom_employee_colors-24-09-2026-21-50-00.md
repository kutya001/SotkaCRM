# План реализации: Снятие ограничений палитры цветов сотрудников (Custom Color Picker)

**Дата создания:** 24.09.2026 21:50:00 (UTC+6)  
**Статус:** В работе

---

## 1. Архитектурный контекст и цели

Снять ограничение на выбор только предустановленных 10 цветов сотрудников. Обеспечить возможность назначения абсолютно любого цвета через нативный диалог выбора цвета (`<input type="color">`) или прямой ввод HEX-значения (`#RRGGBB`), сохранив массив `EMPLOYEE_COLORS` как вспомогательные быстрые пресеты.

---

## 2. Пошаговый план изменений

### Шаг 1: `lib/constants/colors.ts`
- Сохранить массив `EMPLOYEE_COLORS` как быстрые пресеты.
- Убрать фиксацию цвета как enum; базовый тип цвета — `string`.
- Добавить утилиты работы с цветом:
  - `isValidHex(hex: string): boolean`
  - `normalizeHex(hex: string): string`
  - `hexToRgb(hex: string): { r, g, b } | null`
  - `getYiqBrightness(hex: string): number`
  - `getContrastTextColor(hex: string): string` (формула YIQ / Luminance)
  - `hexToRgba(hex: string, alpha: number): string`
- Обновить `getEmployeeColorConfig`: для произвольных цветов возвращать безопасный синтетический `ColorOption`.

### Шаг 2: `components/ui/EmployeeBadge.tsx`
- Обеспечить поддержку как пресетов (через существующие Tailwind-классы), так и произвольных HEX-кодов (через динамические стили с расчетом прозрачности и YIQ-контраста).
- `EmployeeBadge`: аватар с первой буквой получает фон `customHex` и вычисленный контрастный цвет текста (`getContrastTextColor`).
- `EmployeeColorDot`: для кастомных цветов использует `style={{ backgroundColor: customHex }}`.

### Шаг 3: `lib/validations/index.ts`
- Создать и экспортировать `HexColorSchema`:
  `z.string().regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Некорректный HEX-код цвета').nullable().optional()`
- Добавить/обновить схемы:
  - `employeeSchema`
  - `createEmployeeSchema`
  - `updateEmployeeSchema`

### Шаг 4: `app/employees/actions.ts`
- Подключить валидацию через `createEmployeeSchema` и `updateEmployeeSchema`.
- Гарантировать корректную передачу и сохранение произвольного HEX-кода в PostgreSQL `users.color`.

### Шаг 5: `components/ui/ColorPicker.tsx`
- Сохранить быстрые пресеты `EMPLOYEE_COLORS`.
- Добавить кнопку спектра с иконкой `Palette`, открывающую скрытый нативный `<input type="color">`.
- Добавить блок ручного ввода HEX (`#RRGGBB`) с превью-свотчем выбранного цвета и валидацией формата.
- Поддержать автоматическое добавление `#` при вводе без префикса.

### Шаг 6: Верификация и тесты
- Проверка типов: `npx tsc --noEmit` (0 ошибок).
- Сборка проекта: `npm run build` (16/16 страниц).
- Создание отчета верификации: `.antigravity/results/custom_employee_colors_verified-24-09-2026-21-50-00.md`.
