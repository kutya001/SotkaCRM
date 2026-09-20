# Спецификация и документация базы данных SotkaCRM (PostgreSQL / Supabase)

База данных построена на базе реляционной СУБД **PostgreSQL 15+ (Supabase)**. Архитектура объединяет данные внешнего биллинга платформы Sotka (`api.sotka.kg`), внутренний модуль входящих заявок (воронка лидов), систему комиссионных вознаграждений сотрудников и ролевую модель доступа.

---

### 1. Архитектурная диаграмма связей (ERD)

```
       +------------------------------------+
       |               users                |
       |------------------------------------|
       | user_id (PK, UUID)                 |
       | login (UQ, VARCHAR)                |<--------------------+
       | role (ENUM: admin,consultant,smm)  |                     |
       +------------------------------------+                     |
          | 1                 | 1                                 |
          |                   |                                   |
          | 1:N               | 1:N                               |
          v                   v                                   |
+---------------------+    +---------------------+                |
|        leads        |    |   employee_rates    |                |
|---------------------|    |---------------------|                |
| lead_id (PK, UUID)  |    | rate_id (PK, UUID)  |                |
| created_by (FK)     |    | user_id (FK, UUID)  |                |
| assigned_to (FK)    |    +---------------------+                |
| seller_phone (FK,UQ)|                                           |
+---------------------+                                           |
          | 0..1                                                  |
          |                                                       |
          | (1:1 связывание)                                      |
          v                                                       |
+------------------------------------+                            |
|              sellers               |                            |
|------------------------------------|                            |
| seller_phone (PK, VARCHAR)         |                            |
| plan_id (FK -> plans.plan_id)      |                            |
+------------------------------------+                            |
    | 1                            | 1                            |
    |                              |                              |
    | 1:N                          | 1:N                          |
    v                              v                              |
+---------------------+    +---------------------+                |
|       outlets       |    |     connections     |                |
|---------------------|    |---------------------|                |
| outlet_id (PK, UUID)|    | connection_id (PK)  |                |
| seller_phone (FK)   |    | seller_phone (FK)   |                |
| manager_id (FK)-----+    | manager_id (FK)-----+----------------+
+---------------------+    +---------------------+                |
                                      | 1                         |
                                      | 1:N                       |
                                      v                           |
                           +---------------------+                |
                           | client_maintenance  |                |
                           |---------------------|                |
                           | maintenance_id (PK) |                |
                           | seller_phone (FK)   |                |
                           | manager_id (FK)-----+----------------+
                           +---------------------+                |
                                                                  |
+---------------------+    +---------------------+                |
|      payments       |    |  employee_payouts   |                |
|---------------------|    |---------------------|                |
| payment_id (PK, STR)|    | payout_id (PK, UUID)|                |
| user_phone (INDEX)  |    | user_id (FK, UUID)--+----------------+
+---------------------+    +---------------------+

```

---

### 2. Пользовательские типы и перечисления (ENUM)

```sql
-- Роли пользователей системы
CREATE TYPE user_role AS ENUM ('admin', 'consultant', 'smm');

-- Статусы воронки лидов
CREATE TYPE lead_status AS ENUM ('Открыт', 'Обработан', 'Назначен', 'Подписан', 'Отмена');

-- Статусы жизненного цикла клиента
CREATE TYPE client_lifecycle_status AS ENUM ('новый', 'подключен', 'сопровождение', 'готов', 'отменен');

-- Статусы начислений за сопровождение
CREATE TYPE maintenance_status AS ENUM ('начислено', 'выплачено', 'отменено');

-- Категории выплат сотрудникам
CREATE TYPE payout_category_type AS ENUM ('аванс', 'выплата зп', 'бонус', 'прочие начисления', 'удержание');

-- Статусы модерации продавца на внешней платформе
CREATE TYPE seller_moderation_status AS ENUM ('approved', 'pending', 'rejected', 'blocked');

```

---

### 3. Детальная спецификация таблиц

**3.1. Таблица `users` (Учетные записи и доступы)**

* **Назначение:** Профили сотрудников CRM, роли и связка с провайдером аутентификации Supabase Auth.


* **Источник наполнения:** Администратор системы через UI или автогенерация при приглашении сотрудника.



| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `user_id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Внутренний суррогатный идентификатор сотрудника.

 |
| `auth_id` | `UUID` | `UNIQUE, REFERENCES auth.users(id)` | Ссылка на UID пользователя в сервисе Supabase Auth. |
| `login` | `VARCHAR(100)` | `NOT NULL, UNIQUE` | Рабочий логин для идентификации (регистронезависимая уникальность `users_login_lower_idx`). Для провайдера Supabase Auth инкапсулируется в синтетический адрес `${login.toLowerCase()}@internal.sotka.kg`, скрытый от пользователя. |
| `full_name` | `VARCHAR(255)` | `NOT NULL` | Полное ФИО сотрудника.

 |
| `phone` | `VARCHAR(30)` | `NULL` | Личный контактный телефон сотрудника. |
| `role` | `user_role` | `NOT NULL, DEFAULT 'consultant'` | Роль в системе: `admin`, `consultant`, `smm`. |
| `is_active` | `BOOLEAN` | `NOT NULL, DEFAULT true` | Флаг активности (доступ к CRM заблокирован при `false`).

 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Дата и время создания учетной записи. |

---

**3.2. Таблица `leads` (Модуль входящих заявок)**

* **Назначение:** Реестр потенциальных клиентов, карточки первого контакта, фиксация канала лидогенерации и последующего связывания с продавцом платформы.
* **Источник наполнения:** SMM-специалисты и администраторы через мобильный интерфейс CRM.
* **Целостность:** Физическое удаление запрещено триггером `prevent_lead_delete`.

| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `lead_id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Уникальный идентификатор лида. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Время поступления лида (базовый таймлайн SLA). |
| `client_name` | `VARCHAR(255)` | `NOT NULL` | Контактное лицо или рабочее название торговой точки. |
| `phone` | `VARCHAR(20)` | `NOT NULL` | Номер абонента (только цифры без кода, например `500888268`). |
| `country_code` | `VARCHAR(10)` | `NOT NULL, DEFAULT '996'` | Телефонный код юрисдикции. |
| `status` | `lead_status` | `NOT NULL, DEFAULT 'Открыт'` | Текущий этап воронки продаж. |
| `instagram` | `VARCHAR(255)` | `NULL` | Instagram-аккаунт (`@username`) или прямая ссылка. |
| `comment` | `TEXT` | `NULL` | История контактов, заметки, причина отмены. |
| `created_by` | `UUID` | `NOT NULL, REFERENCES users(user_id)` | Идентификатор сотрудника (SMM), зафиксировавшего лид. |
| `assigned_to` | `UUID` | `NULL, REFERENCES users(user_id)` | Идентификатор ответственного продавца-консультанта. |
| `seller_phone` | `VARCHAR(20)` | `NULL, UNIQUE, REFERENCES sellers(seller_phone)` | Ссылка на продавца. Ограничение `UNIQUE` исключает дубли связывания. |
| `linked_at` | `TIMESTAMPTZ` | `NULL` | Момент установления ручной связки с зарегистрированным продавцом. |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Время последнего изменения параметров карточки. |

---

**3.3. Таблица `sellers` (Реестр продавцов платформы)**

* **Назначение:** Каталог аккаунтов, зарегистрированных на платформе Sotka.


* **Источник наполнения:** Внешний API (`GET /api/private/v1/admin/sellers-overview/`), эндпоинт синхронизации, доступный только роли `admin`.



| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `seller_phone` | `VARCHAR(20)` | `PRIMARY KEY` | Международный номер продавца (`996XXXXXXXXX`).

 |
| `seller_name` | `VARCHAR(255)` | `NOT NULL` | Имя владельца бизнеса или контактного лица.

 |
| `store` | `VARCHAR(255)` | `NOT NULL, DEFAULT 'Без названия'` | Наименование торговой точки / магазина.

 |
| `plan_id` | `VARCHAR(50)` | `NULL, REFERENCES plans(plan_id)` | Идентификатор текущего тарифа.

 |
| `plan_name` | `VARCHAR(100)` | `NOT NULL, DEFAULT 'Без тарифа'` | Текстовое наименование подключенного тарифа.

 |
| `balance` | `NUMERIC(12,2)` | `NOT NULL, DEFAULT 0.00` | Баланс лицевого счета продавца в системе Sotka.

 |
| `moderation` | `seller_moderation_status` | `NOT NULL, DEFAULT 'pending'` | Статус модерации в платформе (`approved`, `pending` и т.д.).

 |
| `is_active` | `BOOLEAN` | `NOT NULL, DEFAULT true` | Признак активности продавца.

 |
| `registered_at` | `TIMESTAMPTZ` | `NULL` | Точная дата регистрации в сервисе.

 |
| `last_activity` | `TIMESTAMPTZ` | `NULL` | Время последнего входа в сервис.

 |
| `employees_count` | `INTEGER` | `NOT NULL, DEFAULT 0` | Количество сотрудников в магазине продавца.

 |
| `outlets_count` | `INTEGER` | `NOT NULL, DEFAULT 0` | Количество филиалов/точек на платформе.

 |
| `brands` | `TEXT` | `NULL` | Торговые бренды магазина (через запятую).

 |
| `organization_id` | `VARCHAR(100)` | `NULL` | Идентификатор юридической организации во внешней системе.

 |
| `manager_id` | `UUID` | `NULL, REFERENCES users(user_id)` | Назначенный менеджер (сохраняется при синхронизации API).

 |
| `synced_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Время последней синхронизации данных из API. |

---

**3.4. Таблица `payments` (Журнал платежей и транзакций платформы)**

* **Назначение:** Неизменяемый аудит-лог финансовых операций платформы для расчета бонусов консультантов.


* **Источник наполнения:** Внешний API (`GET /api/private/v1/admin/transactions/`).



| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `payment_id` | `VARCHAR(100)` | `PRIMARY KEY` | Уникальный ID платежа из внешней системы Sotka.

 |
| `user_phone` | `VARCHAR(20)` | `NOT NULL` | Телефон плательщика (индексируется).

 |
| `user_id` | `VARCHAR(100)` | `NULL` | Идентификатор пользователя во внешней платформе.

 |
| `user_name` | `VARCHAR(255)` | `NULL` | Отображаемое имя плательщика.

 |
| `amount` | `NUMERIC(12,2)` | `NOT NULL` | Сумма операции в сомах.

 |
| `date_time` | `TIMESTAMPTZ` | `NOT NULL` | Дата и время совершения транзакции.

 |
| `tran_type` | `VARCHAR(50)` | `NOT NULL` | Тип транзакции (`topup`, `subscription` и т.д.).

 |
| `description` | `TEXT` | `NULL` | Описание платежа («Оплата тарифа»).

 |
| `status` | `VARCHAR(50)` | `NOT NULL` | Статус операции (`succeeded`, `failed`, `pending`).

 |
| `synced_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Время загрузки транзакции в Supabase. |

---

**3.5. Таблица `connections` (Закрепления клиентов за сотрудниками)**

* **Назначение:** Учет привязки продавцов к консультантам (модель 1:1), расчет разовых комиссий за первичное подключение.


* **Источник наполнения:** Модальное окно закрепления в CRM.



| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `connection_id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Идентификатор закрепления.

 |
| `seller_phone` | `VARCHAR(20)` | `NOT NULL, REFERENCES sellers(seller_phone) ON DELETE CASCADE` | Привязанный продавец.

 |
| `seller_name` | `VARCHAR(255)` | `NOT NULL` | Имя продавца на момент фиксации.

 |
| `store` | `VARCHAR(255)` | `NOT NULL` | Торговая точка.

 |
| `manager_id` | `UUID` | `NOT NULL, REFERENCES users(user_id)` | Ответственный менеджер по продажам / консультант.

 |
| `assigned_by` | `UUID` | `NOT NULL, REFERENCES users(user_id)` | Кто назначил закрепление (`admin` или консультант).

 |
| `assigned_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Время фиксации закрепления.

 |
| `status` | `VARCHAR(50)` | `NOT NULL, DEFAULT 'подключен'` | Технический статус связи (`подключен`, `отвязан`, `отменен`).

 |
| `plan_id` | `VARCHAR(50)` | `NULL, REFERENCES plans(plan_id)` | Тариф на момент закрытия сделки.

 |
| `plan_price` | `NUMERIC(12,2)` | `NOT NULL, DEFAULT 0.00` | Базовая стоимость тарифа (сом).

 |
| `connection_fee_percent` | `NUMERIC(5,2)` | `NOT NULL, DEFAULT 30.00` | Процент бонуса консультанта за подключение.

 |
| `connection_fee_amount` | `NUMERIC(12,2)` | `NOT NULL, DEFAULT 0.00` | Рассчитанная сумма вознаграждения.

 |
| `accrual_month` | `VARCHAR(7)` | `NOT NULL` | Расчетный месяц начисления бонуса (`YYYY-MM`).

 |
| `maintenance_months_limit` | `INTEGER` | `NOT NULL, DEFAULT 3` | Предельный лимит месяцев сопровождения клиента (1–3).

 |
| `maintenance_months_accrued` | `INTEGER` | `NOT NULL, DEFAULT 0` | Фактически начисленное количество месяцев.

 |
| `client_status` | `client_lifecycle_status` | `NOT NULL, DEFAULT 'новый'` | Статус клиента в жизненном цикле.

 |

---

**3.6. Таблица `employee_rates` (Персональные ставки сотрудников)**

* **Назначение:** Хранение персональных условий мотивации сотрудников.


* **Источник наполнения:** Ручной ввод администратором в разделе «Справочники».



| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `rate_id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Уникальный идентификатор ставки.

 |
| `user_id` | `UUID` | `NOT NULL, REFERENCES users(user_id) ON DELETE CASCADE` | Ссылка на аккаунт сотрудника.

 |
| `connection_percent` | `NUMERIC(5,2)` | `NOT NULL, DEFAULT 30.00` | Процент за первичное подключение.

 |
| `maintenance_percent` | `NUMERIC(5,2)` | `NOT NULL, DEFAULT 10.00` | Процент за ежемесячное сопровождение.

 |
| `effective_from` | `VARCHAR(7)` | `NOT NULL` | Месяц активации условий (`YYYY-MM`).

 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Дата создания записи.

 |
| `created_by` | `UUID` | `NOT NULL, REFERENCES users(user_id)` | Администратор, утвердивший ставку.

 |

---

**3.7. Таблица `client_maintenance` (Начисления за сопровождение)**

* **Назначение:** Ежемесячные комиссионные начисления сотрудникам за удержание клиентов.


* **Источник наполнения:** Внутренний крон/биллинг CRM или запуск администратором.



| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `maintenance_id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Идентификатор начисления.

 |
| `connection_id` | `UUID` | `NOT NULL, REFERENCES connections(connection_id)` | Закрепление, на основании которого сделан расчет. |
| `accrual_month` | `VARCHAR(7)` | `NOT NULL` | Расчетный месяц (`YYYY-MM`).

 |
| `seller_phone` | `VARCHAR(20)` | `NOT NULL, REFERENCES sellers(seller_phone)` | Клиент.

 |
| `manager_id` | `UUID` | `NOT NULL, REFERENCES users(user_id)` | Менеджер-получатель.

 |
| `plan_id` | `VARCHAR(50)` | `NULL, REFERENCES plans(plan_id)` | Действующий тариф.

 |
| `plan_price` | `NUMERIC(12,2)` | `NOT NULL` | Базовая стоимость тарифа.

 |
| `maintenance_percent` | `NUMERIC(5,2)` | `NOT NULL, DEFAULT 10.00` | Процент за сопровождение (10%).

 |
| `maintenance_amount` | `NUMERIC(12,2)` | `NOT NULL` | Сумма начисления (`plan_price * percent / 100`).

 |
| `status` | `maintenance_status` | `NOT NULL, DEFAULT 'начислено'` | Статус начисления.

 |
| `accrued_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Момент генерации строки.

 |
| `accrued_by` | `UUID` | `NULL, REFERENCES users(user_id)` | Инициатор операции (`NULL` для системного крона).

 |

---

**3.8. Таблица `employee_payouts` (Журнал выплат персоналу)**

* **Назначение:** Учет взаиморасчетов с сотрудниками (авансы, зарплаты, удержания).


* **Источник наполнения:** Ручная регистрация выплат администратором.



| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `payout_id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Идентификатор платежа.

 |
| `user_id` | `UUID` | `NOT NULL, REFERENCES users(user_id)` | Сотрудник-получатель.

 |
| `accrual_month` | `VARCHAR(7)` | `NOT NULL` | К какому расчетному месяцу относится выплата (`YYYY-MM`).

 |
| `payout_date` | `DATE` | `NOT NULL, DEFAULT CURRENT_DATE` | Дата фактической выдачи средств.

 |
| `amount` | `NUMERIC(12,2)` | `NOT NULL` | Сумма выплаты/удержания в сомах.

 |
| `payout_category` | `payout_category_type` | `NOT NULL` | Категория финансовой проводки.

 |
| `payment_method` | `VARCHAR(50)` | `NOT NULL` | Инструмент расчета (`Mbank`, `О!Деньги`, `Наличные`).

 |
| `comment` | `TEXT` | `NULL` | Обоснование или служебная заметка.

 |
| `created_by` | `UUID` | `NOT NULL, REFERENCES users(user_id)` | Администратор, выполнивший проводку.

 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Дата и время проведения записи. |

---

**3.9. Таблица `outlets` (Торговые точки на карте)**

* **Назначение:** Географические координаты физических магазинов клиентов.


* **Источник наполнения:** Ручной ввод через картографический интерфейс CRM.



| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `outlet_id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Уникальный ID филиала.

 |
| `seller_phone` | `VARCHAR(20)` | `NOT NULL, REFERENCES sellers(seller_phone) ON DELETE CASCADE` | Владелец торговой точки.

 |
| `store_name` | `VARCHAR(255)` | `NOT NULL` | Название/ориентир филиала (например: «Device - ЦУМ 1 эт.»).

 |
| `latitude` | `DOUBLE PRECISION` | `NOT NULL` | Географическая широта.

 |
| `longitude` | `DOUBLE PRECISION` | `NOT NULL` | Географическая долгота.

 |
| `manager_id` | `UUID` | `NULL, REFERENCES users(user_id)` | Менеджер, курирующий точку.

 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Время добавления геометки.

 |

---

**3.10. Таблица `plans` (Справочник тарифов платформы)**

* **Назначение:** Справочник действующих планов подписки платформы.


* **Источник наполнения:** Раздел справочников CRM (Администратор).



| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `plan_id` | `VARCHAR(50)` | `PRIMARY KEY` | Код плана (`PLN-BASE`, `PLN-PREM`, `PLN-BIZ`, `PLN-CORP`).

 |
| `plan_name` | `VARCHAR(100)` | `NOT NULL` | Название тарифа (`Базовый`, `Премиум`, `Бизнес`, `Корпоративный`).

 |
| `price` | `NUMERIC(12,2)` | `NOT NULL` | Стоимость за расчетный период (сом).

 |
| `billing_period` | `VARCHAR(20)` | `NOT NULL, DEFAULT 'Месяц'` | Период (`Месяц`, `Год`).

 |
| `description` | `TEXT` | `NULL` | Перечень опций.

 |
| `is_active` | `BOOLEAN` | `NOT NULL, DEFAULT true` | Доступность для выбора.

 |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Момент обновления условий. |

---

**3.11. Таблица `plans_history` (Аудит изменения тарифов)**

* **Назначение:** Журнал версий тарифов для корректного исторического перерасчета комиссий.


* **Источник наполнения:** Автоматический триггер при обновлении поля `price` в таблице `plans`.



| Поле | Тип данных | Ограничения | Описание |
| --- | --- | --- | --- |
| `history_id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Идентификатор версии.

 |
| `plan_id` | `VARCHAR(50)` | `NOT NULL, REFERENCES plans(plan_id) ON DELETE CASCADE` | Ссылка на тариф.

 |
| `plan_name` | `VARCHAR(100)` | `NOT NULL` | Имя тарифа на момент правки.

 |
| `old_price` | `NUMERIC(12,2)` | `NOT NULL` | Старая стоимость.

 |
| `new_price` | `NUMERIC(12,2)` | `NOT NULL` | Новая цена.

 |
| `changed_by` | `UUID` | `NULL, REFERENCES users(user_id)` | Инициатор изменения.

 |
| `changed_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Время фиксации изменения.

 |

---

### 4. Индексы базы данных

```sql
-- Оптимизация поиска лидов по воронке и фильтрам операторов
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX idx_leads_created_by ON leads(created_by);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX idx_leads_phone ON leads(phone);

-- Быстрый поиск и сопоставление платежей
CREATE INDEX idx_payments_user_phone ON payments(user_phone);
CREATE INDEX idx_payments_status_type ON payments(status, tran_type);
CREATE INDEX idx_payments_date ON payments(date_time DESC);

-- Индексация продавцов
CREATE INDEX idx_sellers_plan_id ON sellers(plan_id);
CREATE INDEX idx_sellers_manager_id ON sellers(manager_id);
CREATE INDEX idx_sellers_registered ON sellers(registered_at DESC);

-- Оптимизация выборки начислений и выплат по сотрудникам и периодам
CREATE INDEX idx_conn_manager_month ON connections(manager_id, accrual_month);
CREATE INDEX idx_maint_manager_month ON client_maintenance(manager_id, accrual_month);
CREATE INDEX idx_payouts_user_month ON employee_payouts(user_id, accrual_month);

-- Регистронезависимая уникальность логина сотрудников
CREATE UNIQUE INDEX users_login_lower_idx ON users (LOWER(TRIM(login)));

```

---

### 5. Бизнес-логика, хранимые процедуры и триггеры

**5.1. Защита от физического удаления лидов**

```sql
CREATE OR REPLACE FUNCTION trg_lock_lead_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Физическое удаление лида запрещено бизнес-правилами. Установите статус "Отмена".';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_lead_delete
BEFORE DELETE ON leads
FOR EACH ROW
EXECUTE FUNCTION trg_lock_lead_delete();

```

**5.2. Автоматическое версионирование стоимости тарифов**

```sql
CREATE OR REPLACE FUNCTION trg_audit_plan_price()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.price <> NEW.price THEN
        INSERT INTO plans_history (
            plan_id,
            plan_name,
            old_price,
            new_price,
            changed_at
        ) VALUES (
            OLD.plan_id,
            NEW.plan_name,
            OLD.price,
            NEW.price,
            now()
        );
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_plan_price_trigger
BEFORE UPDATE ON plans
FOR EACH ROW
EXECUTE FUNCTION trg_audit_plan_price();

```

**5.3. Защита привязки продавца к лиду**
Связывание лида с зарегистрированным продавцом допустимо только если продавец свободен:

```sql
CREATE OR REPLACE FUNCTION trg_validate_lead_seller_link()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.seller_phone IS NOT NULL THEN
        -- Если продавца привязали, автоматически переводим лид в статус "Подписан"
        NEW.status := 'Подписан';
        NEW.linked_at := coalesce(NEW.linked_at, now());
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_lead_seller_link_trigger
BEFORE INSERT OR UPDATE OF seller_phone ON leads
FOR EACH ROW
EXECUTE FUNCTION trg_validate_lead_seller_link();

```

**5.4. Создание учетной записи сотрудника и синтетический email (`create_crm_user`)**

Инкапсуляция логина в Supabase Auth без раскрытия синтетического адреса пользователю:

```sql
CREATE OR REPLACE FUNCTION get_synthetic_email(p_login TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT LOWER(TRIM(p_login)) || '@internal.sotka.kg';
$$;

CREATE OR REPLACE FUNCTION create_crm_user(
    p_login VARCHAR(100),
    p_password TEXT,
    p_full_name VARCHAR(255),
    p_phone VARCHAR(30) DEFAULT NULL,
    p_role user_role DEFAULT 'consultant'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_auth_id UUID;
    v_user_id UUID;
    v_synthetic_email TEXT;
    v_cleaned_login TEXT;
BEGIN
    IF get_current_user_role() != 'admin' THEN
        RAISE EXCEPTION 'Только администратор имеет право создавать учетные записи сотрудников';
    END IF;

    v_cleaned_login := TRIM(p_login);
    IF LENGTH(v_cleaned_login) < 3 THEN
        RAISE EXCEPTION 'Длина логина должна составлять не менее 3 символов';
    END IF;

    IF EXISTS (SELECT 1 FROM users WHERE LOWER(login) = LOWER(v_cleaned_login)) THEN
        RAISE EXCEPTION 'Пользователь с логином «%» уже существует в системе', v_cleaned_login;
    END IF;

    v_synthetic_email := get_synthetic_email(v_cleaned_login);
    v_auth_id := gen_random_uuid();
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) VALUES (
        v_auth_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        v_synthetic_email, crypt(p_password, gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', p_full_name, 'role', p_role::text, 'login', v_cleaned_login),
        now(), now(), false, false,
        '', '', '', '', '', '', '', ''
    );

    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
        v_auth_id, v_auth_id, format('{"sub":"%s","email":"%s"}', v_auth_id, v_synthetic_email)::jsonb,
        'email', v_synthetic_email, now(), now(), now()
    );

    INSERT INTO users (user_id, auth_id, login, full_name, phone, role, is_active)
    VALUES (v_user_id, v_auth_id, v_cleaned_login, TRIM(p_full_name), p_phone, p_role, true);

    RETURN v_user_id;
END;
$$;
```

---

### 6. Политики безопасности (Row Level Security - RLS)

Вспомогательная функция определения роли текущей сессии:

```sql
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS user_role AS $$
    SELECT role FROM users WHERE auth_id = auth.uid() AND is_active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_current_crm_user_id()
RETURNS UUID AS $$
    SELECT user_id FROM users WHERE auth_id = auth.uid() AND is_active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

```

**6.1. Политики для таблицы `leads**`

```sql
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Просмотр: Администратор видит всё; SMM видит созданные им; Консультант видит свободные (не назначенные) и свои
CREATE POLICY "leads_select_policy" ON leads
FOR SELECT TO authenticated
USING (
    get_current_user_role() = 'admin'
    OR (get_current_user_role() = 'smm' AND created_by = get_current_crm_user_id())
    OR (get_current_user_role() = 'consultant' AND (assigned_to = get_current_crm_user_id() OR assigned_to IS NULL))
);

-- Создание: Доступно Администратору, SMM и Консультантам
CREATE POLICY "leads_insert_policy" ON leads
FOR INSERT TO authenticated
WITH CHECK (
    get_current_user_role() IN ('admin', 'smm', 'consultant')
    AND created_by = get_current_crm_user_id()
);

-- Обновление: SMM не может менять взятые лиды; Консультант меняет свои и открытые; Администратор меняет все
CREATE POLICY "leads_update_policy" ON leads
FOR UPDATE TO authenticated
USING (
    get_current_user_role() = 'admin'
    OR (get_current_user_role() = 'consultant' AND (assigned_to = get_current_crm_user_id() OR assigned_to IS NULL))
)
WITH CHECK (
    get_current_user_role() = 'admin'
    OR (get_current_user_role() = 'consultant')
);

```

**6.2. Политики для таблицы `sellers**`

```sql
ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;

-- Просмотр: Администратор и Консультанты. Роли SMM доступ закрыт.
CREATE POLICY "sellers_select_policy" ON sellers
FOR SELECT TO authenticated
USING (
    get_current_user_role() IN ('admin', 'consultant')
);

-- Изменение/Синхронизация: Доступно строго администратору
CREATE POLICY "sellers_admin_write_policy" ON sellers
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');

```

**6.3. Политики для модуля выплат `employee_payouts**`

```sql
ALTER TABLE employee_payouts ENABLE ROW LEVEL SECURITY;

-- Просмотр: Администратор видит все выплаты; сотрудники видят только свои
CREATE POLICY "payouts_select_policy" ON employee_payouts
FOR SELECT TO authenticated
USING (
    get_current_user_role() = 'admin'
    OR user_id = get_current_crm_user_id()
);

-- Создание/Правка: Исключительно администратор
CREATE POLICY "payouts_admin_modify_policy" ON employee_payouts
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');

```

**6.4. Политики для таблицы учетных записей `users`**

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Просмотр для авторизованных сотрудников
CREATE POLICY "users_select_policy" ON users
FOR SELECT TO authenticated
USING (true);

-- ПРИМЕЧАНИЕ ПО БЕЗОПАСНОСТИ: Публичный анонимный доступ (users_anon_select_policy)
-- был полностью отозван в миграции 003 во избежание утечки логинов, телефонов и ролей.
-- Проверка существования логина при неудачной попытке входа выполняется строго
-- на сервере через createAdminClient() с правами service_role.

-- Управление профилями (строго администратор)
CREATE POLICY "users_admin_write_policy" ON users
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');
```

---

### 7. Хранимые процедуры и агрегатные функции (Миграция `003_security_and_integrity_fixes.sql`)

**7.1. Атомарная процедура связывания «Лид → Продавец → Начисление» (`link_lead_to_seller`)**
Обеспечивает целостность данных в единой транзакции с блокировкой строк `FOR UPDATE` во избежание race conditions при одновременной привязке:

```sql
CREATE OR REPLACE FUNCTION public.link_lead_to_seller(
    p_lead_id UUID,
    p_seller_phone VARCHAR(20),
    p_manager_id UUID,
    p_assigned_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_lead RECORD;
    v_seller RECORD;
    v_collision_lead RECORD;
    v_plan_price NUMERIC(12,2) := 2500.00;
    v_connection_percent NUMERIC(5,2) := 30.00;
    v_connection_fee_amount NUMERIC(12,2);
    v_connection_id UUID;
    v_current_month VARCHAR(7);
    v_now TIMESTAMPTZ := now();
    v_effective_manager_id UUID;
BEGIN
    -- 1. Блокируем и проверяем лид
    SELECT * INTO v_lead FROM public.leads WHERE lead_id = p_lead_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Лид не найден в системе');
    END IF;

    IF v_lead.seller_phone IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Этот лид уже связан с продавцом +' || v_lead.seller_phone);
    END IF;

    IF v_lead.status = 'Подписан' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Лид уже имеет статус «Подписан»');
    END IF;

    IF v_lead.status = 'Отмена' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Нельзя привязать отмененный лид');
    END IF;

    -- 2. Блокируем и проверяем продавца на коллизию
    SELECT * INTO v_seller FROM public.sellers WHERE seller_phone = p_seller_phone FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец не найден в базе данных Sotka');
    END IF;

    SELECT lead_id, client_name INTO v_collision_lead 
    FROM public.leads 
    WHERE seller_phone = p_seller_phone 
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец +' || p_seller_phone || ' уже привязан к другому лиду («' || v_collision_lead.client_name || '»)');
    END IF;

    -- 3. Определяем менеджера / консультанта
    v_effective_manager_id := COALESCE(v_lead.assigned_to, p_manager_id, p_assigned_by);

    -- 4. Получаем стоимость тарифа продавца
    IF v_seller.plan_id IS NOT NULL THEN
        SELECT price INTO v_plan_price FROM public.plans WHERE plan_id = v_seller.plan_id;
        IF v_plan_price IS NULL THEN v_plan_price := 2500.00; END IF;
    END IF;

    -- 5. Получаем персональную ставку комиссии консультанта
    SELECT connection_percent INTO v_connection_percent
    FROM public.employee_rates
    WHERE user_id = v_effective_manager_id
    ORDER BY effective_from DESC
    LIMIT 1;

    IF v_connection_percent IS NULL THEN
        v_connection_percent := 30.00;
    END IF;

    v_connection_fee_amount := round((v_plan_price * v_connection_percent / 100.0), 2);
    v_current_month := to_char(v_now, 'YYYY-MM');

    -- 6. Обновляем лид
    UPDATE public.leads
    SET seller_phone = p_seller_phone,
        status = 'Подписан',
        linked_at = v_now,
        assigned_to = v_effective_manager_id,
        updated_at = v_now
    WHERE lead_id = p_lead_id;

    -- 7. Обновляем продавца: привязываем куратора
    UPDATE public.sellers
    SET manager_id = v_effective_manager_id
    WHERE seller_phone = p_seller_phone;

    -- 8. Создаем запись в connections
    INSERT INTO public.connections (
        seller_phone,
        seller_name,
        store,
        manager_id,
        assigned_by,
        assigned_at,
        status,
        plan_id,
        plan_price,
        connection_fee_percent,
        connection_fee_amount,
        accrual_month,
        client_status,
        maintenance_months_limit,
        maintenance_months_accrued
    ) VALUES (
        p_seller_phone,
        COALESCE(v_seller.seller_name, v_lead.client_name),
        COALESCE(v_seller.store, 'Без названия'),
        v_effective_manager_id,
        p_assigned_by,
        v_now,
        'подключен',
        v_seller.plan_id,
        v_plan_price,
        v_connection_percent,
        v_connection_fee_amount,
        v_current_month,
        'новый',
        3,
        0
    ) RETURNING connection_id INTO v_connection_id;

    RETURN jsonb_build_object(
        'success', true,
        'connection_id', v_connection_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID) TO authenticated;
```

**7.2. Серверные агрегатные функции аналитики**
Предотвращают передачу всей базы строк в оперативную память Node.js/Next.js:

```sql
-- Агрегаты воронки лидов
CREATE OR REPLACE FUNCTION public.get_leads_funnel_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'total', count(*)::int,
        'open', count(*) FILTER (WHERE status = 'Открыт')::int,
        'processed', count(*) FILTER (WHERE status = 'Обработан')::int,
        'assigned', count(*) FILTER (WHERE status = 'Назначен')::int,
        'signed', count(*) FILTER (WHERE status = 'Подписан')::int,
        'cancelled', count(*) FILTER (WHERE status = 'Отмена')::int
    )
    FROM public.leads;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_funnel_stats() TO authenticated;

-- Агрегаты базы продавцов
CREATE OR REPLACE FUNCTION public.get_sellers_kpi_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'total', count(*)::int,
        'active', count(*) FILTER (WHERE is_active = true)::int,
        'pendingModeration', count(*) FILTER (WHERE moderation = 'pending')::int,
        'totalBalance', COALESCE(sum(balance), 0)::numeric(12,2),
        'assigned', count(*) FILTER (WHERE manager_id IS NOT NULL)::int
    )
    FROM public.sellers;
$$;

GRANT EXECUTE ON FUNCTION public.get_sellers_kpi_stats() TO authenticated;
```

---

### 8. Регламент расширения каталога тарифов (Миграция `004_add_biz_plan.sql`)

**8.1. Базовый реестр тарифов (`plans`)**
Включает 4 основных тарифных плана:
1. `PLN-BASE` — «Базовый» (2 500 сом)
2. `PLN-PREM` — «Премиум» (5 000 сом)
3. `PLN-BIZ` — «Бизнес» (7 000 сом)
4. `PLN-CORP` — «Корпоративный» (12 000 сом)

**8.2. Инвариант внешнего ключа `sellers_plan_id_fkey` при синхронизации**
* При импорте продавцов из Sotka API (`/api/sync/sotka`) значение `item.plans[0]` передается в нормализатор `resolveSotkaPlan`.
* Если тариф совпадает с известным («Базовый», «Премиум», «Бизнес», «Корпоративный»), выставляется соответствующий `plan_id`.
* Если от внешнего API поступает новый тариф, он предварительно регистрируется в таблице `plans`.
* Если тариф не определен или пуст, в поле `sellers.plan_id` передается строго `NULL`, гарантируя соблюдение внешнего ключа `sellers_plan_id_fkey` без сбоев транзакции. Исходное название тарифа при этом сохраняется в текстовом поле `sellers.plan_name`.

---

### 9. Регламент оптимизации производительности СУБД (Миграция `005_performance_rpcs_and_indexes.sql`)

**9.1. Кэширование RLS-политик через InitPlan (`(SELECT ...)`):**
* В политиках `leads_select_policy`, `leads_update_policy`, `sellers_select_policy`, `sellers_admin_write_policy`, `payments_select_policy`, `payments_admin_write_policy`, `connections_select_policy` вызовы процедур `get_current_user_role()` и `get_current_crm_user_id()` обернуты в конструкцию `(SELECT ...)`.
* Это исключает вызов функций на каждую сканируемую строку таблицы (Per-Row Evaluation) и позволяет планировщику PostgreSQL вычислять роль пользователя однократно за весь запрос в виде InitPlan.

**9.2. Индексы подстрочного поиска GIN (`pg_trgm`):**
Для ускорения операций подстрочной фильтрации (`ILIKE '%...%'`) подключено расширение `pg_trgm` и развернуты GIN-индексы:
* `idx_leads_client_name_trgm` на `leads(client_name gin_trgm_ops)`
* `idx_leads_phone_trgm` на `leads(phone gin_trgm_ops)`
* `idx_sellers_name_trgm` на `sellers(seller_name gin_trgm_ops)`
* `idx_sellers_store_trgm` на `sellers(store gin_trgm_ops)`
* `idx_sellers_phone_trgm` на `sellers(seller_phone gin_trgm_ops)`

**9.3. Составные B-Tree индексы:**
* `idx_leads_status_created` на `leads(status, created_at DESC)` — ускорение фильтрации воронки лидов с сортировкой по времени.
* `idx_sellers_mod_active` на `sellers(moderation, is_active, registered_at DESC)` — ускорение фильтрации модерации и статуса активности продавцов.
* `idx_sellers_manager_active` на `sellers(manager_id, is_active)` — ускорение фильтрации закрепленных продавцов.