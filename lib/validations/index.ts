import { z } from 'zod';
import {
  DEFAULT_COUNTRY_CODE,
  digitsOnly,
  findPhoneCountry,
  isKnownCountryCode,
  isValidNational,
  normalizeNational,
  splitFullNumber,
  toFullDigits,
} from '@/lib/utils/phone';

export const PG_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const paymentMethodSchema = z.enum(['mbank', 'odengi', 'bakai', 'abank', 'cash'], {
  message: 'Недопустимый метод оплаты (кошелек)',
});

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  mbank: 'МБанк',
  odengi: 'О!Деньги',
  bakai: 'Бакай Банк',
  abank: 'АБанк',
  cash: 'Наличка',
};

export const salaryOperationSignSchema = z.enum(['+', '-']);
export type SalaryOperationSign = z.infer<typeof salaryOperationSignSchema>;

export const salaryOperationTypeSchema = z.enum([
  'accrual_connection',
  'accrual_maintenance',
  'salary_base',
  'bonus_other',
  'deduction',
  'fine',
  'payout',
  'advance',
]);
export type SalaryOperationType = z.infer<typeof salaryOperationTypeSchema>;

export const SALARY_OPERATION_TYPE_LABELS: Record<SalaryOperationType, string> = {
  accrual_connection: 'Начисление по подключению',
  accrual_maintenance: 'Начисление по сопровождению',
  salary_base: 'Оклад',
  bonus_other: 'Прочая надбавка',
  deduction: 'Удержание',
  fine: 'Штраф',
  payout: 'Выплата',
  advance: 'Аванс',
};

export const PayoutSchema = z.preprocess((raw: any) => {
  if (!raw || typeof raw !== 'object') return raw;
  const clone = { ...raw };
  if (!clone.user_id && clone.userId) clone.user_id = clone.userId;
  if (!clone.user_id && clone.employeeId) clone.user_id = clone.employeeId;
  if (!clone.user_id && clone.employee_id) clone.user_id = clone.employee_id;
  if (!clone.employee_id && clone.employeeId) clone.employee_id = clone.employeeId;
  if (!clone.employee_id && clone.user_id) clone.employee_id = clone.user_id;

  if (!clone.settlement_month && clone.settlementMonth) clone.settlement_month = clone.settlementMonth;
  if (!clone.accrual_month && clone.accrualMonth) clone.accrual_month = clone.accrualMonth;
  if (!clone.settlement_month && clone.accrual_month) clone.settlement_month = clone.accrual_month;

  if (!clone.actual_date && clone.actualDate) clone.actual_date = clone.actualDate;
  if (!clone.payout_date && clone.payoutDate) clone.payout_date = clone.payoutDate;
  if (!clone.actual_date && clone.payout_date) clone.actual_date = clone.payoutDate;

  if (!clone.operation_type && clone.operationType) clone.operation_type = clone.operationType;
  if (!clone.operation_sign && clone.operationSign) clone.operation_sign = clone.operationSign;
  if (!clone.payment_method && clone.paymentMethod) clone.payment_method = clone.paymentMethod;
  if (!clone.payout_category && clone.payoutCategory) clone.payout_category = clone.payoutCategory;
  if (!clone.connection_id && clone.connectionId) clone.connection_id = clone.connectionId;
  if (!clone.seller_phone && clone.sellerPhone) clone.seller_phone = clone.sellerPhone;
  if (!clone.accrual_ids && clone.accrualIds) clone.accrual_ids = clone.accrualIds;

  // Если операция advance, а категория не задана
  if (clone.operation_type === 'advance' && !clone.payout_category) {
    clone.payout_category = 'аванс';
  }

  return clone;
}, z.object({
  user_id: z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор сотрудника'),
  employee_id: z.string().regex(PG_UUID_REGEX).optional().nullable(),
  accrual_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Период начисления должен быть в формате ГГГГ-ММ').optional(),
  settlement_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Расчетный месяц должен быть в формате ГГГГ-ММ').optional().nullable(),
  payout_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата выплаты должна быть в формате ГГГГ-ММ-ДД').optional(),
  actual_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата операции должна быть в формате ГГГГ-ММ-ДД').optional(),
  amount: z.coerce.number().positive('Сумма операции должна быть больше нуля'),
  operation_sign: salaryOperationSignSchema.optional(),
  operation_type: salaryOperationTypeSchema.optional().default('payout'),
  payout_category: z.enum(['аванс', 'выплата зп', 'бонус', 'прочие начисления', 'удержание']).optional(),
  payment_method: paymentMethodSchema.optional().nullable(),
  comment: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  connection_id: z.string().regex(PG_UUID_REGEX).optional().nullable(),
  seller_phone: z.string().optional().nullable(),
  accrual_ids: z.array(z.string().regex(PG_UUID_REGEX)).optional().nullable(),
}).refine((data) => {
  if (data.operation_type === 'payout' || data.operation_type === 'advance' || data.payout_category === 'аванс') {
    return !!data.payment_method && ['mbank', 'odengi', 'bakai', 'abank', 'cash'].includes(data.payment_method);
  }
  return true;
}, {
  message: 'Для выплат и авансов необходимо выбрать кошелек (метод оплаты)',
  path: ['payment_method'],
}));

const SETTLEMENT_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Виды операций, которые можно назначать вручную (бонусы по подключениям создает система) */
export const manualSalaryOperationTypeSchema = z.enum([
  'salary_base',
  'bonus_other',
  'deduction',
  'fine',
  'payout',
  'advance',
]);

export const PayoutsBatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    ids: z.array(z.string().regex(PG_UUID_REGEX)).min(1, 'Выберите хотя бы одну операцию').max(500),
    changes: z
      .object({
        settlement_month: z
          .string()
          .regex(SETTLEMENT_MONTH_PATTERN, 'Расчетный месяц должен быть в формате ГГГГ-ММ')
          .optional(),
        actual_date: z.string().regex(ISO_DATE_PATTERN, 'Дата операции должна быть в формате ГГГГ-ММ-ДД').optional(),
        payment_method: paymentMethodSchema.optional(),
        operation_type: manualSalaryOperationTypeSchema.optional(),
        note: z.string().max(1000).nullable().optional(),
      })
      .refine((c) => Object.values(c).some((v) => v !== undefined), {
        message: 'Не выбрано ни одного изменения',
      }),
  }),
  z.object({
    action: z.literal('delete'),
    ids: z.array(z.string().regex(PG_UUID_REGEX)).min(1, 'Выберите хотя бы одну операцию').max(500),
  }),
]);

export type PayoutsBatchInput = z.infer<typeof PayoutsBatchSchema>;

export const LeadStatusSchema = z.enum(['Открыт', 'Обработан', 'Назначен', 'Подписан', 'Отмена'], {
  message: 'Недопустимый статус лида',
});

/** Причина отмены лида: обязательна при переводе в «Отмена» */
export const CancelReasonSchema = z
  .string()
  .trim()
  .min(3, 'Укажите причину отмены (не менее 3 символов)')
  .max(500, 'Причина отмены не длиннее 500 символов');

export const LeadsBatchActionSchema = z.object({
  action: z.enum(['change_status', 'change_assigned', 'delete']),
  ids: z.array(z.string().regex(PG_UUID_REGEX)).optional(),
  lead_ids: z.array(z.string().regex(PG_UUID_REGEX)).optional(),
  status: LeadStatusSchema.optional(),
  cancel_reason: z.string().optional().nullable(),
  assigned_to: z.string().uuid().nullable().optional(),
  payload: z.any().optional(),
}).refine((data) => (data.ids && data.ids.length > 0) || (data.lead_ids && data.lead_ids.length > 0), {
  message: 'Необходимо выбрать хотя бы один лид',
});

/**
 * Телефон с кодом страны СНГ: код из справочника, национальный номер нужной длины.
 * Входные данные: country_code (цифры) и phone (национальный номер, допускается ввод с кодом).
 */
export const phonePartsRefine = {
  check: (d: { phone?: string | null; country_code?: string | null }) => {
    if (d.phone === undefined || d.phone === null) return true;
    const code = digitsOnly(d.country_code) || DEFAULT_COUNTRY_CODE;
    if (!isKnownCountryCode(code)) return false;
    return isValidNational(normalizeNational(d.phone, code), code);
  },
  message: {
    path: ['phone'],
    error: (issue: { input?: unknown }) => {
      const d = (issue.input || {}) as { country_code?: string | null };
      const code = digitsOnly(d.country_code) || DEFAULT_COUNTRY_CODE;
      const country = findPhoneCountry(code);
      return country
        ? `Номер для ${country.name} (+${country.code}) должен содержать ${country.nationalLength} цифр без кода страны`
        : 'Неизвестный код страны';
    },
  },
};

/**
 * Полный номер цифрами с кодом страны СНГ («996555123456», допускается «+996 555 123 456»).
 * Пустая строка → null. Результат — нормализованная строка цифр.
 */
export const fullPhoneSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string()
    .transform((v, ctx) => {
      const parts = splitFullNumber(v);
      if (!parts) {
        ctx.addIssue({
          code: 'custom',
          message: 'Укажите номер с кодом страны СНГ, например +996 555 123 456',
        });
        return z.NEVER;
      }
      return toFullDigits(parts.countryCode, parts.national);
    })
    .nullable()
    .optional()
);

export const SellersBatchActionSchema = z.object({
  action: z.enum(['change_manager', 'delete']),
  ids: z.array(z.string().min(1)).optional(),
  seller_ids: z.array(z.string().min(1)).optional(),
  manager_id: z.string().uuid().nullable().optional(),
  payload: z.any().optional(),
}).refine((data) => (data.ids && data.ids.length > 0) || (data.seller_ids && data.seller_ids.length > 0), {
  message: 'Необходимо выбрать хотя бы одного продавца',
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

export const LeadCreateSchema = z
  .object({
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
  })
  .refine(phonePartsRefine.check, phonePartsRefine.message);

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
  phone: fullPhoneSchema,
  role: z.enum(['admin', 'consultant', 'smm'], { message: 'Недопустимая роль' }),
  is_active: z.boolean().default(true),
  color: HexColorSchema,
});

/** Пустая строка из формы → null */
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Анкета сотрудника: адрес и координаты проживания, ИНН, дата рождения, пол, биография */
export const employeeProfileFieldsSchema = z.object({
  address: z.preprocess(emptyToNull, z.string().trim().max(300, 'Адрес не длиннее 300 символов').nullable().optional()),
  latitude: z.preprocess(
    emptyToNull,
    z.coerce.number().min(-90, 'Широта от −90 до 90').max(90, 'Широта от −90 до 90').nullable().optional()
  ),
  longitude: z.preprocess(
    emptyToNull,
    z.coerce.number().min(-180, 'Долгота от −180 до 180').max(180, 'Долгота от −180 до 180').nullable().optional()
  ),
  inn: z.preprocess(
    emptyToNull,
    z.string().trim().regex(/^\d{14}$/, 'ИНН должен состоять из 14 цифр').nullable().optional()
  ),
  birth_date: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата рождения в формате ГГГГ-ММ-ДД')
      .refine((d) => d >= '1900-01-01' && d <= new Date().toISOString().slice(0, 10), {
        message: 'Дата рождения не может быть в будущем',
      })
      .nullable()
      .optional()
  ),
  gender: z.preprocess(emptyToNull, z.enum(['male', 'female'], { message: 'Недопустимое значение пола' }).nullable().optional()),
  bio: z.preprocess(emptyToNull, z.string().trim().max(2000, 'Биография не длиннее 2000 символов').nullable().optional()),
});

const coordinatesPairRefine = {
  check: (d: { latitude?: number | null; longitude?: number | null }) =>
    d.latitude === undefined && d.longitude === undefined
      ? true
      : (d.latitude ?? null) === null === ((d.longitude ?? null) === null),
  message: { message: 'Укажите и широту, и долготу (или очистите оба поля)', path: ['latitude'] },
};

export const createEmployeeSchema = z
  .object({
    login: z.string().min(3, 'Логин должен содержать не менее 3 символов'),
    password: z.string().min(6, 'Пароль должен содержать минимум 6 символов'),
    full_name: z.string().min(2, 'ФИО должно содержать минимум 2 символа'),
    phone: fullPhoneSchema,
    role: z.enum(['admin', 'consultant', 'smm'], { message: 'Недопустимая роль' }),
    color: HexColorSchema,
  })
  .extend(employeeProfileFieldsSchema.shape)
  .refine(coordinatesPairRefine.check, coordinatesPairRefine.message);

export const updateEmployeeSchema = z
  .object({
    full_name: z.string().min(2, 'ФИО должно содержать минимум 2 символа').optional(),
    phone: fullPhoneSchema,
    role: z.enum(['admin', 'consultant', 'smm'], { message: 'Недопустимая роль' }).optional(),
    is_active: z.boolean().optional(),
    color: HexColorSchema,
  })
  .extend(employeeProfileFieldsSchema.shape)
  .refine(coordinatesPairRefine.check, coordinatesPairRefine.message);

export const LeadUpdateSchema = z
  .object({
    client_name: z.string().min(2, 'Имя должно содержать не менее 2 символов').optional(),
    phone: z.string().min(6, 'Укажите корректный номер телефона').optional(),
    country_code: z.string().optional(),
    instagram: z.string().optional().nullable(),
    comment: z.string().optional().nullable(),
    assigned_to: z.string().regex(PG_UUID_REGEX, 'Некорректный идентификатор ответственного').nullable().optional(),
  })
  .refine(phonePartsRefine.check, phonePartsRefine.message);


