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

| `color` | `VARCHAR(30)` | `NOT NULL, DEFAULT '#3B82F6'` | Цветовая метка сотрудника (HEX) для сквозной идентификации в интерфейсе. |

| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Дата и время создания учетной записи. |



---



**3.2. Таблица `leads` (Модуль входящих заявок)**



* **Назначение:** Реестр потенциальных клиентов, карточки первого контакта, фиксация канала лидогенерации и последующего связывания с продавцом платформы.

* **Источник наполнения:** SMM-специалисты и администраторы через мобильный интерфейс CRM.

* **Целостность:** Физическое удаление разрешено исключительно для роли `admin` через триггер `trg_check_lead_delete`. Для остальных ролей удаление заблокировано (перевод в статус `Отмена`).



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

| `organization_id` | `VARCHAR(100)` | `NULL, INDEX` | Идентификатор юридической организации во внешней системе (Sotka HQ). Индексирован (`idx_sellers_organization_id`) для быстрого поиска и агрегации.



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

* **Регламент удаления (Admin Only):** При удалении подключения через `DELETE /api/v1/connections/[id]` выполняется автоматический сброс куратора продавца (`sellers.manager_id = NULL`) и каскадное удаление связанных начислений из `connection_accruals` и `maintenance_accruals`.







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



**3.8. Таблица `employee_payouts` (Единый регистр операций по ЗП: начисления и выплаты)**



* **Назначение:** Единый бухгалтерский регистр начислений и выплат сотрудникам (оклады, премии, бонусы за подключение/сопровождение, удержания, штрафы, выплаты).

* **Источник наполнения:** Ручная регистрация операций администратором, а также системные триггеры/функции (`link_lead_to_seller`, `run_maintenance_billing`).

* **Регламент удаления (Admin Only):** При удалении операции через `DELETE /api/v1/payouts/[id]` выполняется каскадная разблокировка связанных начислений куратора (`connection_accruals.is_paid = false, payout_id = NULL, paid_at = NULL`), возвращая их в реестр к начислению.



| Поле | Тип данных | Ограничения | Описание |

| --- | --- | --- | --- |

| `payout_id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Идентификатор финансовой проводки. |

| `user_id` | `UUID` | `NOT NULL, REFERENCES users(user_id)` | Сотрудник-получатель (псевдоним `employee_id`). |

| `employee_id` | `UUID` | `NULL, REFERENCES users(user_id)` | Идентификатор сотрудника. |

| `operation_sign` | `VARCHAR(1)` | `NOT NULL, CHECK (operation_sign IN ('+', '-'))` | Знак операции (`+` начисление/бонус/оклад, `-` выплата/удержание/штраф). |

| `operation_type` | `VARCHAR(30)` | `NOT NULL, CHECK (operation_type IN ('accrual_connection', 'accrual_maintenance', 'salary_base', 'bonus_other', 'deduction', 'fine', 'payout', 'advance'))` | Вид операции по ЗП (включая аванс со знаком '-'). |

| `amount` | `NUMERIC(12,2)` | `NOT NULL, CHECK (amount > 0)` | Сумма операции в сомах. |

| `actual_date` | `DATE` | `NOT NULL, DEFAULT CURRENT_DATE` | Дата фактической операции (выдачи/начисления). |

| `settlement_month` | `VARCHAR(7)` | `NOT NULL` | Расчетный месяц начисления (`YYYY-MM`). |

| `accrual_month` | `VARCHAR(7)` | `NOT NULL` | Период начисления (`YYYY-MM`). |

| `payout_date` | `DATE` | `NOT NULL, DEFAULT CURRENT_DATE` | Дата проводки. |

| `payout_category` | `payout_category_type` | `NOT NULL, DEFAULT 'выплата зп'` | Категория финансовой проводки. |

| `payment_method` | `VARCHAR(50)` | `NULL` | Инструмент расчета (`mbank`, `odengi`, `bakai`, `abank`, `cash`). |

| `connection_id` | `UUID` | `NULL, REFERENCES connections(connection_id) ON DELETE SET NULL` | Привязка к сделке/подключению. |

| `seller_phone` | `VARCHAR(20)` | `NULL, REFERENCES sellers(seller_phone) ON DELETE SET NULL` | Привязка к продавцу. |

| `status` | `VARCHAR(20)` | `NOT NULL, DEFAULT 'paid'` | Статус финансовой проводки (`paid`, `pending`, `cancelled`). |

| `note` | `TEXT` | `NULL` | Служебная заметка / комментарий. |

| `comment` | `TEXT` | `NULL` | Дополнительное текстовое обоснование проводки. |

| `created_by` | `UUID` | `NOT NULL, REFERENCES users(user_id)` | Пользователь/администратор, создавший операцию. |

| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Дата и время регистрации записи. |



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

| `changed_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Время фиксации изменения. |



---



**3.12. Таблица `plan_prices` (Версионирование цен тарифов по датам действия)**



* **Назначение:** Хранение интервалов действия цен на тарифы для исторически точного расчета бонусов при подключении на любую дату.

* **Источник наполнения:** Администратор в модуле «Тарифы» (`/plans`).



| Поле | Тип данных | Ограничения | Описание |

| --- | --- | --- | --- |

| `price_id` | `UUID` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Идентификатор ценового интервала. |

| `plan_id` | `VARCHAR(50)` | `NOT NULL, REFERENCES plans(plan_id) ON DELETE CASCADE` | Ссылка на тариф. |

| `price` | `NUMERIC(12,2)` | `NOT NULL` | Действующая цена в сомах. |

| `effective_from` | `DATE` | `NOT NULL, DEFAULT CURRENT_DATE` | Дата начала действия цены (включительно). |

| `created_at` | `TIMESTAMPTZ` | `NOT NULL, DEFAULT now()` | Время регистрации цены. |

| `created_by` | `UUID` | `NULL, REFERENCES users(user_id)` | Администратор, установивший цену. |



*Ограничение целостности:* `CONSTRAINT uq_plan_price_plan_date UNIQUE(plan_id, effective_from)`



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



-- Композитные индексы высокой производительности (Миграция 012)

CREATE INDEX idx_leads_status_created ON leads(status, created_at DESC);

CREATE INDEX idx_leads_assigned_status ON leads(assigned_to, status);

CREATE INDEX idx_sellers_moderation_reg ON sellers(moderation, registered_at DESC);

CREATE INDEX idx_connections_seller_phone ON connections(seller_phone);

CREATE INDEX idx_users_role_active ON users(role, is_active);



```



---



### 5. Бизнес-логика, хранимые процедуры и триггеры



**5.1. Защита от физического удаления лидов**



```sql

CREATE OR REPLACE FUNCTION check_lead_deletion_permission()

RETURNS TRIGGER AS $

BEGIN

    IF public.get_current_user_role() = 'admin' THEN

        RETURN OLD;

    END IF;



    RAISE EXCEPTION 'Физическое удаление лидов разрешено только администраторам системы. Используйте статус Отмена.'

        USING ERRCODE = '42501';

END;

$ LANGUAGE plpgsql SECURITY DEFINER;



CREATE TRIGGER trg_check_lead_delete

BEFORE DELETE ON leads

FOR EACH ROW

EXECUTE FUNCTION check_lead_deletion_permission();



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



-- Просмотр: Администратор видит всё; SMM видит созданные им; Консультант видит строго назначенные ему лиды в статусах Назначен, Подписан, Отмена

CREATE POLICY "leads_select_policy" ON leads

FOR SELECT TO authenticated

USING (

    get_current_user_role() = 'admin'

    OR (get_current_user_role() = 'smm' AND created_by = get_current_crm_user_id())

    OR (get_current_user_role() = 'consultant' AND assigned_to = get_current_crm_user_id() AND status IN ('Назначен', 'Подписан', 'Отмена'))

);



-- Создание: Доступно Администратору, SMM и Консультантам

CREATE POLICY "leads_insert_policy" ON leads

FOR INSERT TO authenticated

WITH CHECK (

    get_current_user_role() IN ('admin', 'smm', 'consultant')

    AND created_by = get_current_crm_user_id()

);



-- Обновление: SMM меняет только созданные им в статусах Открыт/Обработан; Консультант меняет только свои лиды; Администратор меняет все

CREATE POLICY "leads_update_policy" ON leads

FOR UPDATE TO authenticated

USING (

    get_current_user_role() = 'admin'

    OR (get_current_user_role() = 'smm' AND created_by = get_current_crm_user_id() AND status IN ('Открыт', 'Обработан'))

    OR (get_current_user_role() = 'consultant' AND assigned_to = get_current_crm_user_id() AND status IN ('Назначен', 'Подписан', 'Отмена'))

)

WITH CHECK (

    get_current_user_role() = 'admin'

    OR (get_current_user_role() = 'smm' AND created_by = get_current_crm_user_id() AND status IN ('Открыт', 'Обработан'))

    OR (get_current_user_role() = 'consultant' AND assigned_to = get_current_crm_user_id() AND status IN ('Назначен', 'Подписан', 'Отмена'))

);

```



**6.2. Политики для таблицы `sellers**`



```sql

ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;



-- Просмотр: Администраторы и Руководители видят всех продавцов.

-- Консультанты видят исключительно одобренных продавцов (moderation = 'approved'). Роли SMM доступ закрыт.

CREATE POLICY "sellers_select_policy" ON sellers

FOR SELECT TO authenticated

USING (

    (

        COALESCE(

            (SELECT public.get_current_user_role())::text,

            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)

        ) IN ('admin', 'supervisor')

    )

    OR

    (

        COALESCE(

            (SELECT public.get_current_user_role())::text,

            (SELECT role::text FROM public.users WHERE auth_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid()) LIMIT 1)

        ) = 'consultant'

        AND moderation = 'approved'

    )

);



-- Изменение/Синхронизация: Доступно строго администратору

CREATE POLICY "sellers_admin_write_policy" ON sellers

FOR ALL TO authenticated

USING ((SELECT public.get_current_user_role()) = 'admin')

WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');



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



---



### 10. Регламент строгой ролевой изоляции данных (Миграция `006_strict_data_isolation.sql`)



**10.1. Изоляция воронки и выборки лидов (`leads`):**

* В RPC `get_leads_funnel_stats()`:

  * Для роли `consultant` расчет показателей ведется строго по лидам, где `assigned_to = v_user_uuid`.

  * Для роли `smm` — строго по `created_by = v_user_uuid`.

  * Для роли `admin` — сквозной аудит по всей таблице.

* В RLS-политике `leads_select_policy`:

  * `consultant` видит исключительно лиды, где `assigned_to = (SELECT get_current_crm_user_id())`.

  * `smm` видит исключительно лиды, где `created_by = (SELECT get_current_crm_user_id())`.

  * `admin` обладает полным доступом на чтение всех лидов.



**10.2. Изоляция базы продавцов (`sellers`):**

* В RPC `get_sellers_kpi_stats()`:

  * Для роли `consultant` метрики рассчитываются исключительно по продавцам, закрепленным за ним (`manager_id = v_user_uuid`).

  * Для роли `smm` возвращаются нулевые показатели (доступ закрыт).

  * Для роли `admin` возвращаются сквозные агрегаты по всей платформе.

* В RLS-политике `sellers_select_policy`:

  * `consultant` имеет доступ к закрепленным за ним продавцам (`manager_id = (SELECT get_current_crm_user_id())`), а также к незакрепленным (`manager_id IS NULL`) для обеспечения возможности ручной привязки через `getAvailableSellersForMapping`.

  * `admin` имеет доступ ко всем продавцам.



---



### 11. Оптимизация производительности, индексов и СУБД (Миграция `009_performance_and_isolation_optimization.sql`)



**11.1. Мемоизация ролевого контекста (Zero-IO RLS):**

* Функция `get_current_user_role()`: считывает роль пользователя напрямую из JWT-токена (`auth.jwt() -> 'app_metadata' ->> 'role'`), предотвращая дисковые операции ввода-вывода к таблице `users`. При отсутствии клейма выполняет fallback к `users` с кэшированием `STABLE SECURITY DEFINER`.

* Функция `get_current_crm_user_id()`: аналогично считывает UUID сотрудника из `auth.jwt() -> 'app_metadata' ->> 'user_id'`.

* Триггер `trg_sync_user_app_metadata`: синхронизирует изменения роли и user_id в `auth.users.raw_app_meta_data` при вставке и обновлении пользователей.

* Все RLS-политики на `leads`, `sellers`, `connections`, `employee_payouts` оборачивают вызовы функций в скалярные подзапросы `(SELECT public.get_current_user_role())`, позволяя планировщику PostgreSQL выполнять оценку один раз на запрос (InitPlan) вместо сканирования $O(N \times M)$.



**11.2. Композитные индексы для многофакторной фильтрации:**

* `idx_leads_assigned_status_created` на `leads(assigned_to, status, created_at DESC)`

* `idx_leads_created_by_status_created` на `leads(created_by, status, created_at DESC)`

* `idx_connections_seller_phone_assigned` на `connections(seller_phone, assigned_at DESC)`

* `idx_connections_manager_assigned` на `connections(manager_id, assigned_at DESC)`

* `idx_employee_payouts_user_month` на `employee_payouts(user_id, accrual_month, payout_date DESC)`

* `idx_payments_user_phone_date` на `payments(user_phone, date_time DESC)`



**11.3. Серверные аналитические RPC-функции:**

* `get_payouts_summary(p_accrual_month text, p_user_id uuid)` — расчет сводки фонда выплат (`totalPaid`, `totalAdvances`, `totalDeductions`, `transactionsCount`) на стороне PostgreSQL через `FILTER (WHERE ...)`.

* `get_analytics_summary(p_start_date timestamptz, p_end_date timestamptz)` — комплексная агрегация показателей воронки лидов, выплат и базы продавцов в одном запросе с соблюдением ролевой изоляции.



**11.4. Исключение Race Conditions и транзакционные блокировки:**

* Уникальный индекс `idx_payouts_unique_salary_period` на `employee_payouts (user_id, accrual_month) WHERE payout_category = 'выплата зп'` исключает повторное начисление зарплаты сотруднику за один и тот же период.

* Функция `process_employee_payout_atomic(...)` выполняет блокировку `SELECT ... FOR UPDATE` по строке сотрудника в таблице `users`, гарантируя строгую сериализацию финансовых проводок.



---



### 12. Ограничение прав роли Консультант и оптимизация индексов продавцов (Миграция `010_consultant_permissions_and_indexes.sql`)



**12.1. Исключение роли `consultant` из прав создания лидов:**

* Обновлена RLS-политика `leads_insert_policy` на таблице `leads`: вставка разрешена исключительно ролям `admin` и `smm` при условии `created_by = (SELECT public.get_current_crm_user_id())`.

* Роль `consultant` лишена прав на создание лидов как на уровне RLS-политики базы данных, так и на уровне серверных экшенов и UI.



**12.2. Синхронизация расширенных метаданных пользователей:**

* Функция и триггер `sync_user_app_metadata()` дополнены сохранением поля `full_name` в объект `auth.users.raw_app_meta_data` (наряду с `role` и `user_id`).

* Позволяет выполнять мгновенную аутентификацию и извлечение профиля в серверных компонентах и Server Actions без дискового ввода-вывода к таблице `users`.



**12.3. Синхронизация видимости продавцов в RPC-функциях:**

* В RPC `get_sellers_kpi_stats()`: для роли `consultant` метрики рассчитываются по закрепленным за ним продавцам, а также по свободным (не назначенным ни на кого): `WHERE manager_id = v_user_uuid OR manager_id IS NULL`.

* В RPC `get_analytics_summary()`: для роли `consultant` блок `sellers` аналогично учитывает `manager_id = v_user_uuid OR manager_id IS NULL`.



**12.4. Специализированные B-Tree индексы для продавцов:**

* `idx_sellers_manager_synced` на `public.sellers (manager_id, synced_at DESC)` — ускорение фильтрации продавцов по менеджеру с сортировкой по времени синхронизации.

* `idx_sellers_unassigned_synced` на `public.sellers (synced_at DESC) WHERE manager_id IS NULL` — частичный индекс для мгновенной выборки свободных продавцов без куратора.



---



### 13. Изоляция базы продавцов для роли Консультант и представление employees (Миграция `013_consultant_seller_visibility.sql`)



**13.1. Ограничение видимости продавцов по статусу модерации (RBAC):**

* В RLS-политике `sellers_select_policy`:

  * Роли `admin` и `supervisor` сохраняют полный доступ ко всем продавцам в любых статусах модерации (`approved`, `pending`, `rejected`, `blocked`).

  * Роль `consultant` видит **строго и только** продавцов со статусом `moderation = 'approved'`. Доступ к продавцам на модерации (`pending`) и заблокированным/отклоненным (`rejected`, `blocked`) закрыт на уровне СУБД.

  * Роли `smm` доступ к таблице `sellers` закрыт полностью.



**13.2. Представление `public.employees`:**

* Создано представление `CREATE OR REPLACE VIEW public.employees AS SELECT ... FROM public.users` для совместимости запросов внешних и внутренних модулей с сохранением ролей и идентификаторов CRM.



**13.3. Серверная агрегация KPI продавцов:**

* Функция `get_sellers_kpi_stats()` оптимизирована: для консультанта подсчет метрик ведется исключительно по одобренным продавцам (`moderation = 'approved'`), исключая утечку данных о модерации.



---



### 14. Оптимизация триграммного поиска, атомарного связывания и SQL-агрегации (Миграция `014_trgm_search_and_atomic_linking.sql`)



**14.1. Расширение `pg_trgm` и GIN-индексы для поиска подстрок (`ILIKE`):**

* Активировано системное расширение `pg_trgm`.

* Индексы на таблице `leads`:

  * `idx_leads_client_name_trgm` на `client_name gin_trgm_ops`

  * `idx_leads_phone_trgm` on `phone gin_trgm_ops`

  * `idx_leads_comment_trgm` on `comment gin_trgm_ops`

  * `idx_leads_composite_search_trgm` on `((client_name || ' ' || COALESCE(phone, '') || ' ' || COALESCE(comment, '')) gin_trgm_ops)`

* Индексы на таблице `sellers`:

  * `idx_sellers_seller_name_trgm` on `seller_name gin_trgm_ops`

  * `idx_sellers_seller_phone_trgm` on `seller_phone gin_trgm_ops`

  * `idx_sellers_store_trgm` on `store gin_trgm_ops`

  * `idx_sellers_composite_search_trgm` on `((seller_name || ' ' || COALESCE(seller_phone, '') || ' ' || COALESCE(store, '')) gin_trgm_ops)`

* Позволяют PostgreSQL использовать `Bitmap Index Scan` для конструкций `OR ... ILIKE %q%` со временем поиска под 1-2 мс даже на сотнях тысяч записей.



**14.2. Атомарная RPC-процедура `link_lead_to_seller`:**

* Сигнатура: `public.link_lead_to_seller(p_lead_id UUID, p_seller_phone VARCHAR, p_user_id UUID, p_manager_id UUID, p_assigned_by UUID)`

* Выполняет транзакционную блокировку `SELECT ... FOR UPDATE` по строкам лида и продавца, исключая состояние гонки (race conditions) при параллельных кликах.

* Проверяет статус лида (не 'Подписан', не 'Отмена', seller_phone IS NULL) и коллизии продавца (отсутствие других привязанных лидов).

* Автоматически определяет куратора, ставку комиссии из `employee_rates` (по умолчанию 30%), стоимость тарифа из `plans` (по умолчанию 2500.00).

* В единой атомарной транзакции обновляет `leads` (status = 'Подписан', linked_at = now()), назначает `manager_id` в `sellers`, создает проводку в `connections` и возвращает результирующий JSONB (`connection_id`, `connection_fee_amount`, `lead_id`, `seller_phone`).



**14.3. Серверные SQL-агрегаты для аналитики и калькуляций:**

* `public.get_dashboard_kpi(p_user_id UUID, p_role TEXT, p_month TEXT)`:

  * Возвращает полный срез счетчиков воронки лидов (всего, открыт, подписан, отмена, конверсия), метрик продавцов (активные, баланс), закреплений и суммы выплат текущего месяца.

  * Работает через встроенные фильтры `FILTER (WHERE ...)` за 1 запрос без выгрузки сырых строк в память Node.js.

* `public.calculate_payout_accruals(p_accrual_month VARCHAR(7), p_employee_id UUID)`:

  * Выполняет мгновенную калькуляцию фонда начислений за первичное подключение (`connections`) и ежемесячное сопровождение (`client_maintenance`) с возможностью фильтрации по конкретному сотруднику или за весь расчетный месяц.



---



### 15. Рефакторинг модуля Подключений, Биллинг Сопровождения, Начисления и Расчетный Лист (Миграция `015_maintenance_accruals_payroll_and_methods.sql`)



**15.1. Модификация таблицы `connections`:**

* Добавлены поля:

  * `maintenance_months_total INT NOT NULL DEFAULT 2` — установленный срок сопровождения (по умолчанию 2 месяца).

  * `maintenance_month_start VARCHAR(7)` — расчетный месяц старта сопровождения ('YYYY-MM', дата подключения + 1 месяц).

  * `maintenance_fee_monthly NUMERIC(12,2) NOT NULL DEFAULT 0` — фиксированное ежемесячное начисление за сопровождение.

  * `connection_fee NUMERIC(12,2) NOT NULL DEFAULT 0` — сумма разового бонуса за первичное подключение.

* Значение статуса по умолчанию для новых записей при связывании куратором: `'подключен'`.

* Жизненный цикл статусов подключения: `'подключен'` -> `'сопровождение'` -> `'приостановлен'` / `'расторгнут'`.



**15.2. Таблица `connection_accruals` (Реестр начислений кураторам):**

* Назначение: Гранулярный помесячный учет начислений за первичное подключение и каждый месяц сопровождения с привязкой к выплатам.

* Схема:

  * `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`

  * `connection_id UUID REFERENCES connections(connection_id) ON DELETE CASCADE`

  * `seller_phone VARCHAR(20) REFERENCES sellers(seller_phone) ON DELETE CASCADE`

  * `employee_id UUID REFERENCES users(user_id) ON DELETE CASCADE`

  * `accrual_type VARCHAR(20) CHECK (accrual_type IN ('connection', 'maintenance'))`

  * `settlement_month VARCHAR(7) NOT NULL` (формат 'YYYY-MM')

  * `amount NUMERIC(12, 2) NOT NULL DEFAULT 0`

  * `is_paid BOOLEAN NOT NULL DEFAULT false`

  * `payout_id UUID REFERENCES employee_payouts(payout_id) ON DELETE SET NULL`

  * `paid_at TIMESTAMPTZ`

  * `notes TEXT`

* Ограничение уникальности: `CONSTRAINT uq_conn_accrual UNIQUE (connection_id, accrual_type, settlement_month)` исключает дублирование начислений за один и тот же расчетный месяц.

* RLS-политики: `admin` и `supervisor` обладают полным доступом на чтение и изменение; `consultant` имеет доступ на чтение исключительно своих начислений (`employee_id = get_current_crm_user_id()`).



**15.3. Модификация таблицы `employee_payouts`:**

* Добавлены поля:

  * `settlement_month VARCHAR(7)` — расчетный период начисления.

  * `operation_type VARCHAR(20) DEFAULT 'payout' CHECK (operation_type IN ('payout', 'deduction'))` — явное разграничение выплат и удержаний.

  * `description TEXT` — текстовое основание платежа.

* Поддерживаемые платежные методы: `cash` (Наличные), `kaspi` (Kaspi Bank), `halyk` (Halyk Bank), `oney` (Oney), `card_transfer` (Перевод на карту).



**15.4. Хранимые процедуры:**

* `link_lead_to_seller(p_lead_id, p_seller_phone, p_user_id, p_manager_id, p_assigned_by)`:

  * Статус подключения сразу выставляется в `'подключен'`, генерируется первичное начисление типа `'connection'` в `connection_accruals`.

* `run_maintenance_billing(p_billing_month VARCHAR(7))`:

  * Пакетный биллинг активных подключений. Вычисляет номер месяца сопровождения относительно `maintenance_month_start`.

  * Если номер месяца $< maintenance\_months\_total$, генерирует запись в `connection_accruals` (`accrual_type = 'maintenance'`), переводит статус в `'сопровождение'` и инкрементирует счетчик `maintenance_months_accrued`.

* `get_employee_payroll_sheet(p_employee_id UUID, p_month VARCHAR(7))`:

  * Реализует непрерывный сальдовый метод:

    $$\text{closing\_balance} = \text{opening\_balance} + \text{total\_accrued} - \text{total\_deductions} - \text{total\_paid}$$

  * Возвращает агрегированные суммы и массивы объектов: начисления (подключения и сопровождения), удержания и выплаты с методами перевода.



---



### 16. Спецификация миграции 016 (`016_payouts_isolation_smm_consultant.sql`): Строгая изоляция выплат для ролей SMM и Консультантов



**16.1. Модификация `employee_payouts` и зеркальный алиас `payouts`:**

* Добавлена колонка статуса финансовой проводки: `status VARCHAR(20) NOT NULL DEFAULT 'paid'`.

* Добавлена колонка псевдонима: `employee_id UUID REFERENCES users(user_id) ON DELETE CASCADE`.

* Триггер `sync_payout_employee_id_trigger` автоматически синхронизирует `user_id` и `employee_id` при любых операциях вставки и обновления.

* Создано представление `public.payouts WITH (security_invoker = true)` для зеркальной совместимости запросов клиентов.

* Индексы оптимизации выборки:

  * `idx_employee_payouts_status_user ON employee_payouts(user_id, status)`

  * `idx_employee_payouts_employee_status ON employee_payouts(employee_id, status)`



---



### 17. Спецификация миграции 017 (`017_security_wallet_and_role_permissions.sql`): Рефакторинг Кошелька, блокировка DELETE и ролевая матрица



**17.1. Рефакторинг Кошелька Кыргызстана (`employee_payouts`):**

* Введено строгое ограничение целостности:

  `CHECK (payment_method IN ('mbank', 'odengi', 'bakai', 'abank', 'cash'))`

* Все исторические записи с иностранными кошельками автоматически мигрированы на национальные платежные шлюзы Кыргызской Республики:

  * `mbank` — МБанк

  * `odengi` — О!Деньги

  * `bakai` — Бакай Банк

  * `abank` — АБанк (Айыл Банк)

  * `cash` — Наличка



**17.2. Исключительное право удаления (Admin-Only DELETE RLS):**

* На уровне PostgreSQL RLS удалены все политики с правом удаления для не-администраторских ролей.

* Сгенерированы строгие политики `<table_name>_admin_delete_policy` для таблиц:

  * `employee_payouts`

  * `sellers`

  * `connections`

  * `connection_accruals`

  * `plans`

  * `employee_rates`

  * `payments`

  * `users`

* Физическое удаление данных разрешено исключительно для роли `admin` (`role = 'admin'`). Физическое удаление лидов `leads` по-прежнему заблокировано на уровне базы данных триггером `prevent_lead_delete`.



**17.3. Ролевая матрица доступа к лидам, продавцам и подключениям:**

* **Лиды (`leads`):**

  * `leads_select_policy`: роль `smm` видит абсолютно все лиды системы для обеспечения сквозной аналитики и отслеживания рекламных кампаний. Роль `consultant` видит только свои назначенные лиды (`assigned_to = auth.uid()`).

  * `leads_update_policy`: роль `smm` имеет право изменять лид исключительно в статусах «Открыт» и «Обработан». Попытка редактирования лида в статусе «Назначен», «Подписан» или «Отмена» блокируется с кодом 403 Forbidden.

* **Продавцы (`sellers`) и подключения (`connections`):**

  * `sellers_select_policy`: роль `consultant` видит исключительно закрепленных за собой продавцов со статусом модерации `approved` (`manager_id = auth.uid() AND moderation = 'approved'`).

  * `connections_select_policy`: консультант видит исключительно свои подключения (`manager_id = auth.uid()`).



---



## 18. Спецификация Миграции 019 (`019_fix_payroll_accruals_and_advance.sql`)



### 18.1. Изоляция и синхронизация колонок сотрудника (`employee_payouts`):

* Добавлена колонка `employee_id UUID REFERENCES users(user_id) ON DELETE CASCADE` в таблицу `employee_payouts`.

* Установлен двусторонний триггер `trg_sync_employee_payouts_ids`, автоматически выравнивающий `user_id` и `employee_id` при любых операциях INSERT/UPDATE:

  ```sql

  NEW.employee_id := COALESCE(NEW.employee_id, NEW.user_id);

  NEW.user_id := COALESCE(NEW.user_id, NEW.employee_id);

  ```

* Создано представление `CREATE OR REPLACE VIEW public.payouts AS SELECT * FROM public.employee_payouts;` для обратной совместимости легаси-запросов.



### 18.2. Вид операции «Аванс» (`advance`):

* Ограничение `employee_payouts_operation_type_check` расширено типом `'advance'`.

* Операция `'advance'` автоматически получает знак `'-'` (уменьшает баланс к выплате) и привязана к категории `аванс`.

* Для авансов и выплат поле `payment_method` (`mbank`, `odengi`, `bakai`, `abank`, `cash`) является строго обязательным.



### 18.3. Хранимая процедура пакетного начисления бонусов (`accrue_all_connections_bonuses`):

* Сигнатура: `accrue_all_connections_bonuses(p_settlement_month VARCHAR(7) DEFAULT NULL) RETURNS JSONB`.

* Выполняет транзакционную сверку всех активных подключений с активными продавцами (`sellers.is_active = true`):

  1. Бонусы за подключение (`accrual_connection`, `+`): начисляет недостающие вознаграждения консультантам за текущий месяц создания подключения.

  2. Бонусы за сопровождение (`accrual_maintenance`, `+`): начисляет ежемесячное сопровождение, переводит статус подключения в `'сопровождение'` или `'готов'` при достижении 2-месячного лимита.



### 18.4. Обновленная процедура расчётного листа (`get_employee_payroll_sheet`):

* Сигнатура: `get_employee_payroll_sheet(p_employee_id UUID, p_month VARCHAR(7) DEFAULT NULL) RETURNS JSONB`.

* Возвращает:

  * `opening_balance`: непрерывное входящее сальдо на 1-е число расчетного месяца.

  * `total_accrued`: сумма всех начислений за месяц со знаком `+`.

  * `total_deductions`: сумма всех удержаний, штрафов и авансов за месяц со знаком `-`.

  * `total_paid`: сумма выплат заработной платы за месяц со знаком `-`.

  * `closing_balance`: исходящий остаток (К выплате): `opening_balance + total_accrued - total_deductions - total_paid`.

  * Массивы детальных операций: `accruals`, `deductions_and_advances`, `payouts` (с полями `Дата`, `Месяц`, `Вид операции`, `Сумма`).



---



## 19. Спецификация Миграции 020 (`020_hard_delete_leads_and_unified_accruals.sql`)



### 19.1. Физическое удаление лидов администратором (Hard-Delete Leads):

* Удален безусловный триггер `prevent_lead_delete` и функция `trg_lock_lead_delete()`, запрещавшие физическое удаление лидов.

* Создана функция `check_lead_deletion_permission()` и триггер `trg_check_lead_delete BEFORE DELETE ON leads FOR EACH ROW`:

  * Физическое удаление (`DELETE FROM leads WHERE lead_id = ...`) разрешено исключительно для роли `admin` (`public.get_current_user_role() = 'admin'`).

  * Для любых других ролей (`consultant`, `smm`) или анонимных сессий операция блокируется исключением `Физическое удаление лидов разрешено только администраторам системы. Используйте статус 'Отмена'.`

* Добавлена политика RLS `leads_delete_policy ON leads FOR DELETE TO authenticated USING (public.get_current_user_role() = 'admin')`.



### 19.2. Атомарная хранимая функция пакетного начисления («Начисления»):

* Процедура: `process_unified_connection_accruals(p_settlement_month VARCHAR(7) DEFAULT NULL) RETURNS JSONB`.

* Синоним/алиас: `accrue_all_connections_bonuses(p_settlement_month VARCHAR(7) DEFAULT NULL) RETURNS JSONB`.

* Проверяет каждого подключенного активного продавца (`sellers.is_active = true`):

  1. Первичное подключение (`accrual_connection`): начисляет бонус куратору за месяц подключения (если запись начисления отсутствовала).

  2. Ежемесячное сопровождение (`accrual_maintenance`): начисляет бонус куратору за указанный расчетный месяц (если отсутствовала запись за этот месяц), инкрементирует `maintenance_months_accrued`, переводит статус в `'сопровождение'` или `'готов'`.


---

## 20. Спецификация Миграции 021 (021_unified_accruals_modes_and_connection_cleanup.sql)

### 20.1. Режимы начисления бонусов («Все начисления», «Только подключение», «Только сопровождение»):
* Создана хранимая процедура accrue_connection_bonuses_v2(p_mode VARCHAR DEFAULT 'all', p_settlement_month VARCHAR DEFAULT NULL) RETURNS JSONB.
* Поддерживаемые режимы p_mode:
  * 'all' — одновременный биллинг и первичных бонусов за подключение, и ежемесячных бонусов сопровождения.
  * 'connection' — начисление бонусов только за первичное подключение торговой точки.
  * 'maintenance' — начисление бонусов только за ежемесячное сопровождение подключенных клиентов.
* Обновлена функция process_unified_connection_accruals(p_settlement_month VARCHAR DEFAULT NULL, p_mode VARCHAR DEFAULT 'all') с передачей параметра режима начисления.

### 20.2. Расширение таблицы employee_payouts для единого реестра операций:
* Добавлены колонки:
  * connection_id UUID REFERENCES connections(connection_id) ON DELETE SET NULL
  * seller_phone VARCHAR(50)
  * employee_id UUID REFERENCES users(user_id) ON DELETE CASCADE
  * operation_sign VARCHAR(1) DEFAULT '+'
  * actual_date DATE DEFAULT CURRENT_DATE
  * note TEXT
  * status VARCHAR(20) DEFAULT 'completed'
* Колонка payment_method переведена в NULLABLE (обязательна только для проводок выплат и авансов).
* Проверочное ограничение employee_payouts_operation_type_check расширено для поддержки всех видов операций по ЗП: accrual_connection, accrual_maintenance, salary_base, bonus_other, deduction, fine, payout, advance.

### 20.3. Настройка срока сопровождения (maintenance_months_total):
* Колонка connections.maintenance_months_total (INTEGER DEFAULT 2) доступна для редактирования администратором системы (1, 3, 4 и более месяцев).
* При начислении сопровождения лимит сверяется с индивидуальным значением COALESCE(connections.maintenance_months_total, connections.maintenance_months_limit, 2).

---

## 21. Спецификация Миграции 022 (`022_cross_links_soft_delete_and_payouts_admin_fix.sql`)

### 21.1. Метка удаленных продавцов во внешнем источнике (Soft-Delete `is_deleted_from_source`):
* Добавлена колонка `is_deleted_from_source BOOLEAN NOT NULL DEFAULT false` в таблицу `sellers`.
* Создан индекс `idx_sellers_deleted_from_source ON sellers(is_deleted_from_source)`.
* При синхронизации с API Sotka HQ (`syncSellersFromSotka`), продавцы, отсутствующие в удаленной системе, маркируются `is_deleted_from_source = true`.
* В реестре DataJournal удаленные в источнике продавцы помечаются бейджем «Удален в HQ», администратору предоставляется возможность их безвозвратного удаления (`deleteSellerPermanently`).

### 21.2. Двусторонняя отвязка «Лид ⇄ Продавец» (`unlink_lead_and_seller`):
* Колонка `seller_id UUID REFERENCES sellers(seller_id) ON DELETE SET NULL` в таблице `leads`.
* Создана хранимая процедура `public.unlink_lead_and_seller(p_lead_id UUID) RETURNS JSONB`:
  * Обнуляет поля связи в лиде: `seller_phone = NULL`, `seller_id = NULL`, `linked_at = NULL`.
  * Переводит лид обратно в статус `'Назначен'`.
  * Сбрасывает назначенного куратора у продавца: `manager_id = NULL`.
  * Доступна эндпоинтам `POST /api/v1/leads/[id]/unlink-seller` и `POST /api/v1/sellers/[id]/unlink-lead`.

### 21.3. Выборочное начисление бонусов (`accrue_selected_connections`):
* Создана хранимая процедура `public.accrue_selected_connections(p_connection_ids UUID[], p_mode VARCHAR(20) DEFAULT 'all', p_settlement_month VARCHAR(7) DEFAULT NULL) RETURNS JSONB`.
* Позволяет администратору через мультиселект в реестре «Подключения» пакетно начислять бонусы только по выбранному набору подключений.
* Поддерживает режимы: `'all'`, `'connection_only'`, `'maintenance_only'`.

### 21.4. Исправление RLS-политики видимости выплат для администратора:
* Обновлена политика `employee_payouts_select_policy`:
  * Администраторы и супервайзеры (`public.get_current_user_role() IN ('admin', 'supervisor')`) видят все операции по ЗП без принудительной фильтрации по сотруднику.
  * Консультанты и SMM видят только собственные проводки (`employee_id = get_current_crm_user_id() OR user_id = get_current_crm_user_id()`).
  * **Дефект миграции 022:** Политика ошибочно использовала несуществующую функцию `get_current_user_id()` — **исправлено в миграции 023**.

## 22. Спецификация Миграции 023 (`023_fix_rls_and_sync_accruals_to_payouts.sql`)

### 22.1. Исправление RLS-политики `employee_payouts_select_policy`:
* Удалены устаревшие и конфликтующие политики: `employee_payouts_select_policy`, `employee_payouts_read_policy`, `payouts_select_role_isolated`.
* Пересоздана единая политика `employee_payouts_select_policy` с корректной функцией `get_current_crm_user_id()` (вместо несуществующей `get_current_user_id()`).

### 22.2. Консолидация политики модификации:
* Удалены устаревшие политики `payouts_admin_modify` и `employee_payouts_modify_policy`.
* Создана единая политика `employee_payouts_modify_policy` (FOR ALL) с доступом только для ролей `admin` и `supervisor`.

### 22.3. Backfill: синхронизация `connection_accruals` → `employee_payouts`:
* Вставка недостающих записей из `connection_accruals` в `employee_payouts` для всех начислений, которые были записаны только в промежуточную таблицу `connection_accruals` эндпоинтом `POST /api/v1/connections/accrue-all`, но не попадали в журнал ЗП.
* Маппинг типов: `connection` → `accrual_connection`, `maintenance` → `accrual_maintenance`.
* Дедупликация по `(connection_id, operation_type, settlement_month)`.

## 23. Спецификация Миграции 024 (`024_guaranteed_accruals_and_bonuses_sync.sql`)

### 23.1. Двусторонний триггер синхронизации начислений:
* Триггерная функция `public.fn_sync_conn_accrual_to_employee_payout()` на таблице `connection_accruals`:
  * `AFTER INSERT`: Создает соответствующую строку в `employee_payouts` со знаком `+`, типом `accrual_connection` или `accrual_maintenance`, категорией `'бонус'`, суммой, датой и привязкой к куратору и продавцу.
  * `AFTER UPDATE`: Синхронно обновляет `amount`, `settlement_month`, `actual_date`, `is_paid` в соответствующей строке `employee_payouts`.
  * `AFTER DELETE`: Автоматически удаляет соответствующую проводку из `employee_payouts`.

### 23.2. Каскадная очистка при удалении подключения:
* Триггер `trg_cleanup_connection_payouts` на таблице `connections`:
  * `AFTER DELETE`: При удалении договора подключения автоматически удаляет все непогашенные начисления по нему из `employee_payouts` и `connection_accruals`.

### 23.3. Функция самоисцеления (Self-Healing Backfill):
* Хранимая процедура `public.sync_missing_connection_accruals() RETURNS JSONB`:
  * Проверяет наличие любых несинхронизированных записей в `connection_accruals` и выполняет атомарный перенос в `employee_payouts`.
  * Вызывается автоматически серверным кодом в `app/payouts/actions.ts` при нулевых результатах для администратора.

## 24. Спецификация Миграции 026 (`026_strict_zero_bonuses_until_accrued.sql`)

### 24.1. Добавление колонок и снятие ограничений в `employee_payouts`:
* Таблица `employee_payouts` расширена колонками:
  * `connection_id UUID REFERENCES connections(connection_id) ON DELETE SET NULL`
  * `seller_phone VARCHAR(50)`
  * `operation_sign VARCHAR(1) DEFAULT '+' CHECK (operation_sign IN ('+', '-'))`
  * `actual_date DATE DEFAULT CURRENT_DATE`
  * `note TEXT`
  * `employee_id UUID REFERENCES users(user_id) ON DELETE SET NULL`
  * `status VARCHAR(20) DEFAULT 'completed'`
  * `settlement_month VARCHAR(7)`
* Ограничение `employee_payouts_operation_type_check` обновлено для поддержки всех типов операций: `payout`, `deduction`, `accrual_connection`, `accrual_maintenance`, `salary_base`, `bonus_other`, `advance`, `fine`.

### 24.2. Представление `connections_with_accruals`:
* Вычисляет фактические начисленные бонусы из регистра `employee_payouts`:
  * `bonus_connection_accrued`: $\sum$ проводок `ep.operation_type = 'accrual_connection' AND ep.operation_sign = '+'` по данному подключению (строго `0`, если проводки не было).
  * `bonus_maintenance_accrued`: $\sum$ проводок `ep.operation_type = 'accrual_maintenance' AND ep.operation_sign = '+'` (строго `0`, если проводки не было).
  * `total_bonuses_accrued`: общая сумма начислений со знаком `+`.
  * `maintenance_months_accrued_count`: количество уникальных месяцев сопровождения со знаком `+`.
* Исключает показ плановых ставок тарифа в столбцах бонусов до проведения начислений.

### 24.3. Хранимая процедура `accrue_connection_bonuses_v2`:
* Сигнатура: `public.accrue_connection_bonuses_v2(p_mode VARCHAR(20) DEFAULT 'all', p_settlement_month VARCHAR(7) DEFAULT NULL) RETURNS JSONB`.
* Выполняет пакетное или точечное создание проводок со знаком `+` в `employee_payouts` с дедупликацией по месяцу и типу операции.

## 25. Спецификация Миграции 027 (`027_guaranteed_accruals_with_rates_fallback.sql`)

### 25.1. Таблица справочных ставок `rates`:
* Структура: `id UUID PRIMARY KEY`, `rate_type VARCHAR(50)`, `rate_amount NUMERIC(12, 2)`, `created_at TIMESTAMPTZ`.
* Содержит стандартные ставки: `connection` (500.00 сом), `maintenance` (300.00 сом).

### 25.2. Совместимость алиасов (`id`, `seller_id`):
* Добавлены алиасы `id` и `seller_id` в таблицы `connections`, `sellers` и `employee_payouts` для совместимости процедур и клиентских запросов.
* Колонка `payment_method` в таблице `employee_payouts` переведена в `NULLABLE` с дефолтом `'система'` для поддержки автоматических начислений.

### 25.3. Пересоздание хранимой процедуры `accrue_connection_bonuses_v2`:
* Сигнатура: `public.accrue_connection_bonuses_v2(p_mode VARCHAR(20) DEFAULT 'all', p_settlement_month VARCHAR(7) DEFAULT NULL) RETURNS JSONB`.
* Инварианты:
  * Устранена блокировка по нулевым ставкам: при `connection_fee <= 0` вычисляется ставка по тарифу, из таблицы `rates` или стандартный fallback `500.00 сом`, с сохранением в `connections.connection_fee`.
  * При `maintenance_fee_monthly <= 0` вычисляется ставка по тарифу, из таблицы `rates` или fallback `300.00 сом`, с сохранением в `connections.maintenance_fee_monthly`.
  * Не блокируется начисление при неактивном флаге продавца при наличии куратора: `(s.is_active IS NULL OR s.is_active = true)`.
  * Автоматическая нормализация аргументов: корректно обрабатывает вызов с любым порядком параметров (`mode, month` или `month, mode`).
  * Сквозное создание записей в `employee_payouts` со знаком `+`, привязкой к подключению, продавцу и расчетному месяцу.

---

## 26. Спецификация Миграции 028 (`028_fix_payroll_sheet_accruals_and_source_links.sql`)

### 26.1. Хранимая процедура `get_employee_payroll_sheet`:
* Сигнатура: `public.get_employee_payroll_sheet(p_employee_id UUID, p_month VARCHAR(7) DEFAULT NULL) RETURNS JSONB`.
* Инварианты расчета и классификации:
  * Источник начислений и выплат: таблица `employee_payouts` с объединением `sellers` и `connections` для получения источников сделок.
  * Входящий остаток (`opening_balance`): сальдо всех операций сотрудника (`user_id = p_employee_id OR employee_id = p_employee_id`) за предыдущие месяцы (`COALESCE(settlement_month, accrual_month) < p_month`).
  * Начисления (`accruals`): операции за расчетный месяц со знаком `+` (`operation_sign = '+'` или `operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance')`). Включает `connection_id`, `seller_phone`, `source_name`, `store`, `seller_name`.
  * Удержания и авансы (`deductions` / `deductions_and_advances`): операции за расчетный месяц со знаком `-` (`operation_type IN ('advance', 'deduction', 'fine')` или `payout_category IN ('удержание', 'штраф', 'аванс')`).
  * Выплаты (`payouts`): фактические выплаты за расчетный месяц со знаком `-` (`operation_type = 'payout'` или категория выплаты).
  * Итоговый остаток к выплате (`closing_balance`): `opening_balance + total_accrued - total_deductions - total_paid`.
  * Возвращает полный структурированный JSONB с объектами: `employee`, `employee_id`, `month`, `settlement_month`, `period`, `opening_balance`, `total_accrued`, `total_deductions`, `total_paid`, `closing_balance`, `accruals`, `deductions`, `deductions_and_advances`, `payouts`, `operations`.


---

## 27. Спецификация Миграции 037 (`037_lead_cancel_reason_and_connection_confirmation.sql`)

### 27.1. Лиды: обязательная причина отмены и матрица статусов по ролям
* Колонки `leads.cancel_reason TEXT` и `leads.cancelled_at TIMESTAMPTZ`.
* Триггер `trg_leads_cancel_reason` (BEFORE INSERT OR UPDATE OF status, cancel_reason → `leads_enforce_cancel_reason()`): перевод в «Отмена» без непустой причины завершается ошибкой `P0001` с `HINT = 'cancel_reason_required'`; при переводе проставляется `cancelled_at = now()`; выход из «Отмена» очищает оба поля.
* Политика `leads_update_policy` (USING / WITH CHECK): `admin` — любые лиды и статусы; `smm` — свои (`created_by`) лиды в «Открыт»/«Обработан», целевые статусы «Открыт»/«Обработан»/«Отмена»; `consultant` — свои (`assigned_to`) лиды в «Назначен»/«Подписан»/«Отмена»; `supervisor` — только просмотр (прав на UPDATE нет).
* Правила переходов в приложении (`lib/leads/status-rules.ts`) совпадают с политикой: smm `Открыт ↔ Обработан → Отмена`, consultant `Назначен → Подписан | Отмена`, возврат из «Отмена» — только администратор.

### 27.2. Подключения: подтверждение администратором
* Колонки `connections.confirmation_status VARCHAR(10) NOT NULL DEFAULT 'confirmed'` (CHECK `pending | confirmed | rejected`), `confirmed_by UUID → users`, `confirmed_at TIMESTAMPTZ`, `rejection_reason TEXT`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` (триггер `trg_connections_touch_updated_at`).
* Частичный индекс `idx_connections_confirmation_pending` по `confirmation_status <> 'confirmed'`.
* Backfill: существующие подключения — `confirmed`, `confirmed_at = assigned_at`, `confirmed_by = assigned_by`.
* Представление `connections_with_accruals` пересоздано тем же списком колонок с добавлением в конец: `confirmation_status, confirmed_by, confirmed_at, rejection_reason, updated_at, seller_id`.
* Сценарий «Взять себе»: консультант назначает себя куратором продавца без куратора (`sellers.manager_id = self`, подключение `pending`); начисление за подключение возникает только после подтверждения администратором.

### 27.3. Начисления только по подтвержденным подключениям
* `fn_connection_auto_accrual()` (триггер `trg_connection_auto_accrual`, теперь `AFTER INSERT OR UPDATE OF manager_id, status, confirmation_status`): выходит, если `confirmation_status <> 'confirmed'`; при переходе `pending → confirmed` создает ровно одно начисление `accrual_connection` в `employee_payouts` и строку в `connection_accruals` (защита от дублей сохранена).
* `accrue_connection_bonuses_v2`, `accrue_selected_connections`, `run_maintenance_billing` фильтруют `c.confirmation_status = 'confirmed'`.

### 27.4. `link_lead_to_seller` — единая сигнатура
* Старые перегрузки (4 и 5 аргументов) переименованы в `link_lead_to_seller_legacy_4args` / `link_lead_to_seller_legacy_5args` и лишены прав вызова (`REVOKE ... FROM PUBLIC, anon, authenticated`); актуальная: `public.link_lead_to_seller(p_lead_id UUID, p_seller_phone VARCHAR, p_user_id UUID DEFAULT NULL, p_manager_id UUID DEFAULT NULL, p_assigned_by UUID DEFAULT NULL, p_confirmation_status TEXT DEFAULT 'confirmed')`.
* Создает/обновляет подключение с `confirmation_status/confirmed_by/confirmed_at`; при `pending` отказывает, если у продавца уже другой куратор. Начисление делает триггер 035 (прямых вставок в `employee_payouts` нет). Возвращает `confirmation_status` в JSONB.
* Права: только `service_role` (вызов из серверного кода после проверки роли).

### 27.5. Telegram
* `trg_telegram_on_connection` (`AFTER INSERT OR UPDATE OF manager_id, confirmation_status`): `pending` → всем активным администраторам с привязанным чатом «Подключение ожидает подтверждения»; `pending → confirmed` → консультанту «Подключение подтверждено»; `→ rejected` → консультанту «Подключение отклонено» с причиной; подтвержденные вставки/передача куратору — как в 036.

---

## 28. Спецификация Миграции 038 (`038_telegram_confirmation_and_cascade_cleanup.sql`)

### 28.1. Telegram
* `trg_telegram_on_payout()`: операция `accrual_connection` не создает уведомление (о подключении консультант уже получает сообщение). Остальные виды операций — как в 036.
* `trg_telegram_on_connection()`: подтвержденное подключение (назначение администратором, подтверждение после «Взять себе», передача куратору) приходит консультанту одним сообщением «Подключение подтверждено» (с именем подтвердившего, если это не сам куратор); `pending` — администраторам «Подключение ожидает подтверждения»; `rejected` — консультанту с причиной.
* Модуль «Telegram» (администратор): сводка бота/вебхука, подключения сотрудников (виды уведомлений, отвязка), журнал `telegram_outbox`, повторная отправка, рассылка. API: `GET /api/v1/telegram/admin/overview`, `GET /api/v1/telegram/admin/outbox`, `POST /api/v1/telegram/admin/outbox/[id]/retry`, `DELETE|PATCH /api/v1/telegram/admin/users/[id]/link`.

### 28.2. Каскадная очистка
* `trg_cleanup_connection_payouts` переведен в `BEFORE DELETE ON connections`: начисления куратора (`employee_payouts` с `connection_id` подключения: `accrual_connection`/`accrual_maintenance` и прочие со знаком `+`) и строки `connection_accruals` удаляются до того, как внешний ключ `employee_payouts.connection_id ON DELETE SET NULL` обнулит ссылку (в варианте AFTER очистка не находила записи).
* `trg_seller_cascade_cleanup` (`BEFORE DELETE ON sellers`, `fn_seller_cascade_cleanup()`): лиды продавца отвязываются (`seller_phone = NULL`, «Подписан» → «Назначен»), подключения удаляются (с начислениями по триггеру выше), остатки начислений по `seller_phone` удаляются.
* `trg_seller_manager_removed` (`AFTER UPDATE OF manager_id ON sellers`, `fn_seller_manager_removed()`): снятие куратора (`manager_id → NULL`) удаляет подключения продавца, кроме `rejected` (остаются как история отклонения). Срабатывает для всех путей: снятие в карточке продавца, отвязка лида, удаление подключения.

---

## 29. Спецификация Миграции 039 (`039_tasks_and_connection_plans.sql`)

### 29.1. Задачи сотрудников (`tasks`)
* Колонки: `task_id`, `title`, `description`, `status` (CHECK: Открыт / Назначен / Выполнен / Отложен / Отмена), `priority` (low / normal / high), `assigned_to → users`, `created_by → users`, `due_date DATE`, `completed_at`, `result_note`, `created_at`, `updated_at`.
* Триггер `trg_tasks_before_write`: назначение ответственного из «Открыт» → «Назначен», снятие из «Назначен» → «Открыт»; «Выполнен» фиксирует `completed_at`.
* Триггер `trg_telegram_on_task_assigned` (`AFTER INSERT OR UPDATE OF assigned_to`): уведомление ответственному «Вам назначена задача» / «Вам переназначена задача» (вид `tasks` в `telegram_prefs`; самоназначение не уведомляется).
* RLS: `admin`/`supervisor` — все задачи и любые переходы; остальные видят свои (ответственный или автор), ставят задачи только себе, переназначать не могут (WITH CHECK). Удаление — администратор или автор.
* Правила переходов в приложении: `lib/tasks/rules.ts`. Просрочка — `due_date < сегодня` при незакрытом статусе.

### 29.2. Планы по подключениям (`connection_plans`)
* Колонки: `plan_id`, `scope` (personal / team), `user_id` (NULL для общего), `period_kind` (daily / weekly / monthly / quarterly / half_year / yearly), `period_start`, `period_end` (исключительно), `target_count > 0`, `note`, `created_by`, `created_at`, `updated_at`.
* Уникальность: один план на сотрудника (или общий) за период данного вида (`uq_connection_plans_period`). Повторная постановка через API обновляет цель.
* Факт считается в API (`/api/v1/goals`): подтвержденные подключения (`confirmation_status = confirmed`) с датой назначения куратора (`assigned_at`, пояс Asia/Bishkek) внутри периода; персональные — по `manager_id`, общие — все.
* RLS: `admin`/`supervisor` видят все; `consultant` — общие и свои; пишет только `admin`.
* Нормализация начала периода и подписи: `lib/plans/periods.ts`.

### 29.3. Восстановление пароля через Telegram (`telegram_password_resets`)
* Колонки: `id`, `user_id → users`, `code_hash` (SHA-256 от кода, идентификатора и секрета), `attempts`, `created_at`, `expires_at`, `used_at`. Доступ только `service_role`.
* Логика (`lib/telegram/password-reset.ts`): код из 6 цифр действует 10 минут, не чаще раза в минуту, 5 попыток; запрос со страницы входа (`POST /api/v1/auth/password-reset/request`, нейтральный ответ без раскрытия логина) или командой `/password` в боте; подтверждение `POST /api/v1/auth/password-reset/confirm` меняет пароль через Supabase Auth Admin API и уведомляет сотрудника в Telegram.

---

## 30. Спецификация Миграции 040 (`040_roles_and_permissions.sql`)

### 30.1. Ролевая модель (`roles`, `role_permissions`, `users.role_id`)
* `roles`: `role_id`, `code` (латиница, уникален), `name`, `description`, `base_role user_role` (базовый профиль данных для RLS и статистических RPC), `is_system` (не удаляется), `is_admin` (полный доступ: все права всегда, включая добавленные позже), `sort_order`, `created_at`, `updated_at`.
* `role_permissions (role_id, permission)`: права роли — ключи каталога `lib/auth/permissions-catalog.ts` (вид «модуль.действие»: `leads.menu`, `leads.view_all`, `leads.create`, `leads.status.<Статус>`, `leads.rollback`, `sellers.assign`, `connections.confirm`, `payouts.view_all`, `employees.roles` и т. д.; всего ~75 ключей по 12 модулям).
* Системные роли по умолчанию (редактируемые): **Администратор** (`admin`, `is_admin`, базовый профиль `admin`), **Учредитель** (`founder`, `supervisor`: все меню и просмотр всех данных, задачи, планы), **Консультант** (`consultant`), **СММ** (`smm`). Права созданы из `DEFAULT_ROLE_PERMISSIONS`.
* `users.role_id → roles`. Бэкфилл по enum `users.role` (admin → admin, supervisor → founder, smm → smm, иначе consultant).
* Триггер `trg_users_sync_role` (BEFORE INSERT OR UPDATE OF role, role_id): при назначении роли enum `role` принимает `roles.base_role`; вставка без `role_id` (RPC `create_crm_user`) выводит роль из enum; изменение только enum старым кодом переводит на системную роль этого профиля. `trg_roles_base_role_changed` (AFTER UPDATE OF base_role) переносит новый базовый профиль на сотрудников роли. `trg_roles_guard_delete` запрещает удалять системные роли и роли с сотрудниками.
* Представление `employees` дополнено колонкой `role_id` (в конце).
* Функции: `get_current_user_permissions()` → `TEXT[]` (`{'*'}` для полного доступа), `has_permission(p_key TEXT)` → `BOOLEAN` (SECURITY DEFINER, для `authenticated`/`service_role`).
* RLS: `roles`/`role_permissions` читают все сотрудники, пишет только базовый профиль `admin` (API пишет через `service_role` после проверки права `employees.roles`).
* Семантика области данных: право `<модуль>.view_all` открывает все записи модуля, без него — только свои (назначенные/созданные). Проверки выполняет API (`requirePermission`, `ctx.canViewAll`) и клиент (`useUser().can`); RLS и статистические RPC продолжают работать по базовому профилю `users.role`.
* API ролей: `GET /api/v1/roles` (роли с правами и числом сотрудников), `POST /api/v1/roles`, `PATCH|DELETE /api/v1/roles/[id]`; `GET /api/v1/auth/me` отдает `permissions`, `role_id`, `role_name`, `is_admin`. Защита: нельзя снять `employees.roles` со своей роли; базовый профиль роли с полным доступом всегда `admin`.

### 30.2. Итоги транзакций Sotka HQ (`sellers`)
* `hq_topups_total NUMERIC(14,2)`, `hq_charges_total NUMERIC(14,2)`, `hq_tx_synced_at TIMESTAMPTZ` — суммы пополнений и списаний из детальной карточки организации Sotka HQ. Обновляются при синхронизации реестра (в пределах бюджета времени, сначала давно не обновлявшиеся) и при открытии вкладки «Транзакции Sotka HQ» в карточке продавца. Показываются колонкой «Пополнения / Списания HQ» в реестре продавцов.

---

## 31. Спецификация Миграции 041 (`041_users_last_active_at.sql`)

* `users.last_active_at TIMESTAMPTZ` — последняя активность сотрудника в CRM. Обновляется сервером (`requireAuth`, `lib/auth/check-role.ts`) при любом авторизованном запросе не чаще раза в 5 минут. Показывается в карточке профиля и колонкой «Последняя активность» в реестре сотрудников.
* Представление `employees` дополнено колонкой `last_active_at` (в конце), `security_invoker` и запрет записи сохранены.
* Профиль: каждый сотрудник редактирует всю свою анкету (ФИО, телефон, цвет, адрес и координаты, ИНН, дата рождения, пол, биография); роль, персональные ставки и активность аккаунта — только по правам модуля «Сотрудники» (`updateProfileData`, `app/profile/actions.ts`).

## 32. Спецификация Миграции 042 (`042_connection_maintenance_assignments.sql`)

### 32.1. Разделение «кто подключил» и «кто сопровождает»
* `connections.manager_id` — сотрудник, **подключивший** продавца: получает бонус за подключение (триггер 035). Консультант в карточке продавца (`sellers.manager_id`) — он же.
* Таблица `connection_maintenance_assignments`: `id`, `connection_id → connections` (каскад при удалении), `month_index` (1..24 — номер месяца сопровождения), `user_id → users`, `assigned_by`, `assigned_at`, `status` (`planned` — назначено, ждет начисления; `accrued` — начислено), `accrued_month`, `accrued_at`, `created_at`, `updated_at`; уникальность `(connection_id, month_index)`. Без записи месяц сопровождает подключивший (по умолчанию).
* `connection_maintenance_manager(p_connection_id, p_month_index)` → сотрудник сопровождения месяца (назначение или `manager_id`). `connection_maintenance_mark_accrued(p_connection_id, p_month_index, p_month, p_user_id)` — фиксирует начисление: назначение месяца получает `accrued` (создается, если его не было).
* RPC `accrue_connection_bonuses_v2`, `accrue_selected_connections`, `run_maintenance_billing` (актуальные тела 034/037) начисляют сопровождение сотруднику месяца `N = число уже начисленных месяцев + 1` (для биллинга — разница месяцев от старта сопровождения + 1) и отмечают назначение как начисленное. Основание проводки: «Бонус за сопровождение N мес. (ГГГГ-ММ): …». TypeScript-резерв в `POST /api/v1/connections/batch` (`accrue_selected`) делает то же.
* Триггер `trg_connection_manager_changed` (`AFTER UPDATE OF manager_id`): при смене подключившего неоплаченное начисление за подключение (`employee_payouts.accrual_connection` со статусом не `paid`, `connection_accruals.connection` с `is_paid = false`) переходит новому сотруднику. Уже начисленное сопровождение не меняется.
* Telegram: `trg_telegram_on_maintenance_assigned` (`AFTER INSERT OR UPDATE OF user_id`) — сотруднику «Вам назначено сопровождение» (месяц N из M, расчетный месяц, бонус, кто назначил; вид `connections`; самоназначение не уведомляется). Начисление приходит обычным сообщением о проводке.
* RLS: читают `admin`/`supervisor` — все, сотрудник — свои назначения и назначения по своим подключениям; пишет только `admin` (API пишет сервисной ролью после проверки прав).

### 32.2. API и интерфейс
* `PATCH /api/v1/connections/[id]/staff` (`connections.edit`): `{ manager_id?, maintenance?: [{ month_index, user_id | null }] }`. `manager_id` подтверждает подключение (нужно `connections.confirm`; `pending`/`rejected` → `confirmed`, у отклоненного сбрасываются период и статус), обновляет `sellers.manager_id`. `user_id = null` снимает назначение месяца (сопровождает подключивший); месяцы со статусом `accrued` не меняются (возвращаются в `skipped`).
* `POST /api/v1/connections/batch` действие `assign_staff` (`connections.bulk` + `connections.edit`, с `manager_id` — ещё `connections.confirm`): те же поля для списка подключений.
* `GET /api/v1/connections` и `GET /api/v1/connections/[id]`: `maintenance_assignments[]` (месяц, сотрудник, статус, месяц начисления) и `employees[]` для выбора (при праве `connections.edit`). Область видимости без `connections.view_all`: свои подключения (подключил) и те, где сотрудник назначен на сопровождение (`connectionOwnScopeFilter`, `lib/services/connections.ts`).
* Модуль «Подключения»: колонки «Подключил» и «Сопровождает» (по месяцам, ✓ — начислено, ⌛ — ждет начисления), пункт меню строки «Сотрудники подключения…», массовое действие «Сотрудники (N)», блок «Сопровождает по месяцам» в карточке; окно `ConnectionStaffModal` («Не менять» / «Как у подключившего» / сотрудник).

## 33. Спецификация Миграции 043 (`043_connection_participants.sql`)

### 33.1. Несколько сотрудников в подключении
* Таблица `connection_participants`: `id`, `connection_id → connections` (каскад), `user_id → users`, `added_by`, `added_at`; уникальность `(connection_id, user_id)`. Участники подключения = `connections.manager_id` (основной, он же консультант продавца) + строки таблицы; всего не более трех (ограничение API).
* `connection_participants_of(p_connection_id)` → `UUID[]` (основной первым, далее по порядку добавления). `connection_split_amount(p_total, p_n, p_i)` — доля i из n (копейки не теряются: последняя доля добирает остаток).
* Бонус за подключение делится поровну: `fn_connection_auto_accrual` (подтверждение) создает по проводке на каждого участника («… (доля i/n)»); RPC `accrue_connection_bonuses_v2` / `accrue_selected_connections` в режиме подключения — так же.
* `connection_resync_connection_accruals(p_connection_id)`: пересчет неоплаченных долей по текущему составу (новым участникам — доля, выбывшим — снимается, остальным — новая доля; оплаченные доли не трогаются; если начисления еще нет — ничего не делает). Вызывается триггерами `trg_connection_participants_changed` (INSERT/DELETE в `connection_participants`) и `trg_connection_manager_changed` (смена `manager_id`, заменяет логику 042).
* Telegram: `trg_telegram_on_participant_added` — участнику «Вы добавлены в подключение» (число участников, кто добавил).

### 33.2. Сопровождение несколькими сотрудниками
* `connection_maintenance_assignments`: несколько строк на месяц; уникальность `(connection_id, month_index, user_id)` (`uq_conn_maint_month_user`, старое `uq_connection_maintenance_month` снято). `connection_maintenance_managers(p_connection_id, p_month_index)` → `UUID[]`: назначенные на месяц, иначе все участники подключения; `connection_maintenance_manager` (042) возвращает первого.
* `connection_accruals`: несколько начислений на месяц — по сотруднику; уникальность `(connection_id, accrual_type, settlement_month, employee_id)` (`uq_conn_accrual_employee`, старое `uq_conn_accrual` снято). `fn_sync_conn_accrual_to_employee_payout` сопоставляет проводку журнала ЗП по сотруднику (удаление/изменение строки реестра затрагивает только его долю).
* RPC сопровождения (`accrue_connection_bonuses_v2`, `accrue_selected_connections`, `run_maintenance_billing`) начисляют каждому сопровождающему месяца его долю ставки сопровождения и отмечают назначения `accrued`. Счетчик начисленных месяцев — по уникальным месяцам.

### 33.3. API и интерфейс
* `PATCH /api/v1/connections/[id]/staff`: `{ participants?: uuid[] (1..3, первый — основной), maintenance?: [{ month_index, user_ids: uuid[] (0..3; пустой — все участники) }] }`. Администратор (`connections.edit`, для участников — ещё `connections.confirm`): любой состав, назначение участников подтверждает подключение. Участник подключения (без `connections.edit`): только исключение — состав и наборы месяцев должны быть подмножеством текущих и непустыми; добавлять нельзя. Месяцы со статусом `accrued` не меняются.
* `POST /api/v1/connections/batch` действие `assign_staff`: `payload.participants` / `payload.maintenance[].user_ids` (совместимо: `manager_id`, `user_id`).
* `POST /api/v1/connections/batch` действие `delete_selected` (`connections.bulk` + `connections.delete`): массовое удаление подключений (`deleteConnection`, `lib/services/connections.ts`): консультант у продавца снимается, назначения, участники и начисления подключения удаляются из обоих регистров. Кнопка «Удалить (N)» в панели массовых действий с подтверждением.
* `GET /api/v1/connections`, `GET /api/v1/connections/[id]`: `participants[]`; `maintenance_assignments[]` — несколько записей на месяц. Область видимости без `connections.view_all`: свои (основной), участник, сопровождающий.
* Модуль «Подключения»: колонка «Участники» (доли 1/n), «Сопровождает» (составы по месяцам), окно `ConnectionStaffModal` с выбором до трех сотрудников чипами; режим участника — только снятие. Пункт меню и кнопка в карточке доступны администратору и участникам.
* Модуль «Продавцы»: быстрое действие «Подключить…» (право `sellers.take`, свободный одобренный продавец) открывает `ConnectionStaffModal` в режиме создания: создающий сотрудник — обязательный участник и консультант продавца (исключить себя нельзя), можно добавить до двух коллег и сопровождающих по месяцам (по умолчанию — все участники). `POST /api/v1/sellers/[id]/connect` → `createSellerConnection` (`lib/services/connections.ts`): `assignSellerToManager` (pending, либо confirmed при `connections.confirm`) + `assignConnectionStaff` без подтверждения. Прежний `POST /api/v1/sellers/[id]/take` сохранен.
* Модуль «Продавцы»: поле «Ответственный консультант» (выпадающий список назначения, право `sellers.assign`) убрано — у продавца может быть несколько консультантов. Колонка и поле карточки «Участники подключения» показывают участников текущего подключения (`GET /api/v1/sellers` возвращает `connection.participants[]`); «Подключить…» доступно всем с правом `sellers.take` (администратору — сразу подтвержденное), «Сотрудники подключения…» открывает окно модуля «Подключения» для существующего подключения (администратор — любой состав, участник — исключение).
* Идентификаторы в схемах (участники, сопровождающие, массовые действия сотрудников) проверяются регулярным выражением `PG_UUID_REGEX`, а не строгим `uuid()` zod: учетные записи с нестандартными UUID не отклоняются.

## 34. Спецификация Миграции 044 (`044_telegram_connection_flow.sql`)

### 34.1. Уведомления по подключениям
* До подтверждения участники не уведомляются: `trg_telegram_on_connection` при `confirmation_status = 'pending'` ничего не ставит в очередь; добавление участника (`trg_telegram_on_participant_added`) уведомляет только по подтвержденному подключению.
* Запрос на подтверждение администраторам формирует сервер (`notifyConnectionPendingToAdmins`, `lib/services/connection-notifications.ts`) при создании ожидающего подключения («Подключить…» в продавцах, `POST /api/v1/sellers/[id]/take`, привязка лида консультантом). Получатели — активные сотрудники с привязанным Telegram и правом подтверждать (`roles.is_admin`, право `connections.confirm` или унаследованная роль `admin`). Сообщение «Запрос на подтверждение подключения»: продавец, телефон, магазин, тариф и цена, бонус за подключение и доли, месяц начисления, список участников (основной первым), сопровождение по месяцам с составом, кто создал, одноразовая ссылка подтверждения.
* После подтверждения каждому участнику — «Подключение подтверждено»: продавец, телефон, магазин, тариф, `Начислено: +доля сом (ваша доля 1/n от суммы)`, месяц начисления, кто подтвердил. Сумма берется из проводок `accrual_connection` участника (триггер начисления срабатывает раньше), иначе — расчетная доля `connection_split_amount`. Отклонение — всем участникам с причиной. Смена основного по подтвержденному подключению уведомляет только нового основного.

### 34.2. Одноразовая ссылка подтверждения
* Таблица `telegram_connection_confirmations`: `id`, `connection_id → connections` (каскад), `admin_user_id → users` (каскад), `token_hash` (уникальный, sha256 от токена с серверным секретом), `created_at`, `expires_at` (7 дней), `used_at`. RLS включен, доступ только `service_role`. На каждого администратора — свой токен.
* Ссылка `GET /api/telegram/confirm/[token]` (без входа в CRM): страница с данными подключения и кнопкой «Подтвердить подключение» — переход по ссылке ничего не меняет (предпросмотр ссылок Telegram). `POST` на тот же адрес подтверждает от имени администратора из ссылки (`setConnectionConfirmation`, начисление и уведомления участникам — триггерами) и гасит все ссылки этого подключения (`used_at`). Просроченная, использованная ссылка или уже обработанное подключение — страница с причиной. Отклонение с причиной — только в CRM.
* Адрес ссылки — `NEXT_PUBLIC_APP_URL`, иначе origin запроса; без адреса в сообщении остается подсказка подтвердить в CRM.

### 34.3. Сопровождение — одним сообщением при начислении
* `trg_telegram_on_maintenance_assigned` больше не уведомляет о назначении; `trg_telegram_on_payout` пропускает проводки `accrual_connection` и `accrual_maintenance` (остальные операции ЗП — как прежде).
* После запуска начисления (`POST /api/v1/connections/accrue-all`, `/api/v1/connections/maintenance/billing`, действие `accrue_selected` в `batch`) сервер вызывает `notifyMaintenanceAccruals({ sinceIso })`: по проводкам `accrual_maintenance` со знаком «+», созданным с момента запуска, каждому сотруднику одно сообщение «Сопровождение за ММ.ГГГГ: +итог сом» со строками «продавец (магазин) — сумма сом».

### 34.4. Продавцы: сопровождающие заполняются сразу
* `assignConnectionStaff` (параметр `materializeMaintenance`, по умолчанию включен): при назначении участников месяцы сопровождения без строк или с прежним составом получают явные строки с новым составом (кроме уже начисленных и заданных явно), поэтому после «Подключить…» сопровождающие по месяцам видны сразу, а не «по умолчанию».
