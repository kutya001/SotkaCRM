import { z } from 'zod';

export const PG_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PayoutSchema = z.object({
  user_id: z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника'),
  accrual_month: z.string().regex(/^\d{4}-\d{2}$/, 'Период начисления должен быть в формате ГГГГ-ММ'),
  payout_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата выплаты должна быть в формате ГГГГ-ММ-ДД'),
  amount: z.coerce.number().positive('Сумма выплаты должна быть больше нуля'),
  payout_category: z.enum(['аванс', 'выплата зп', 'бонус', 'прочие начисления', 'удержание'], {
    message: 'Недопустимая категория выплаты',
  }),
  payment_method: z.string().min(1, 'Укажите способ проведения выплаты'),
  comment: z.string().optional().nullable(),
});

export const EmployeeRateSchema = z.object({
  user_id: z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника'),
  connection_percent: z.coerce.number().min(0).max(100, 'Процент подключения должен быть от 0 до 100'),
  maintenance_percent: z.coerce.number().min(0).max(100, 'Процент сопровождения должен быть от 0 до 100'),
  effective_from: z.string().regex(/^\d{4}-\d{2}$/, 'Период действия должен быть в формате ГГГГ-ММ'),
});

export const PlanUpdateSchema = z.object({
  plan_name: z.string().min(1, 'Укажите название тарифа'),
  price: z.coerce.number().min(0, 'Стоимость не может быть отрицательной'),
  billing_period: z.string().min(1, 'Укажите расчетный период'),
  description: z.string().nullable().optional(),
  is_active: z.boolean(),
});

/**
 * Приведение идентификаторов внешних ключей к строгому UUID PostgreSQL или null.
 * Whitelist: если строка соответствует формату UUID (32 hex-символа), возвращается строка.
 * Любые иные значения (пустые строки, плейсхолдеры "—", "-", "unassigned", "none", null, undefined)
 * гарантированно преобразуются в null.
 */
export function normalizeNullableUuid(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (PG_UUID_REGEX.test(trimmed)) {
      return trimmed;
    }
    return null;
  }
  return null;
}

export const LeadCreateSchema = z.object({
  client_name: z.string().min(2, 'Имя должно содержать не менее 2 символов'),
  phone: z.string().min(6, 'Укажите корректный номер телефона'),
  country_code: z.string().default('996').optional(),
  instagram: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  assigned_to: z
    .preprocess(
      (val) => normalizeNullableUuid(val),
      z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор ответственного').nullable().optional()
    )
    .default(null),
});

/**
 * Валидация произвольного HEX-кода цвета (#RGB или #RRGGBB)
 */
export const HexColorSchema = z
  .string()
  .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Некорректный HEX-код цвета')
  .nullable()
  .optional();

export const employeeSchema = z.object({
  user_id: z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника').optional(),
  login: z.string().min(3, 'Логин должен содержать не менее 3 символов'),
  full_name: z.string().min(2, 'ФИО должно содержать минимум 2 символа'),
  phone: z.string().nullable().optional(),
  role: z.enum(['admin', 'consultant', 'smm'], { message: 'Недопустимая роль' }),
  is_active: z.boolean().default(true),
  color: HexColorSchema,
});

export const createEmployeeSchema = z.object({
  login: z.string().min(3, 'Логин должен содержать не менее 3 символов'),
  password: z.string().min(6, 'Пароль должен содержать минимум 6 символов'),
  full_name: z.string().min(2, 'ФИО должно содержать минимум 2 символа'),
  phone: z.string().optional().nullable(),
  role: z.enum(['admin', 'consultant', 'smm'], { message: 'Недопустимая роль' }),
  color: HexColorSchema,
});

export const updateEmployeeSchema = z.object({
  full_name: z.string().min(2, 'ФИО должно содержать минимум 2 символа').optional(),
  phone: z.string().nullable().optional(),
  role: z.enum(['admin', 'consultant', 'smm'], { message: 'Недопустимая роль' }).optional(),
  is_active: z.boolean().optional(),
  color: HexColorSchema,
});


