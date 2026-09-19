# Диагностика ошибки авторизации на Vercel (Invalid API key)

- **Дата:** 20-09-2026 00:52:00
- **Сущность:** Аутентификация в продакшене Vercel (`sotka-crm.vercel.app`)
- **Статус:** Диагностировано, причина локализована, серверный слой защищен

---

## 1. Результат расследования в live-среде

При помощи Chrome DevTools MCP был воспроизведен вход под `admin` / `admin123456` на боевом домене `https://sotka-crm.vercel.app/login`.

Получен ответ от Supabase Auth и PostgREST базы данных:
```text
auth: Invalid API key
db: Invalid API key
url: https://qfsfgthlbjacxyxuvrnr.supabase.co
```

### Причина сбоя
1. В панели управления **Vercel Dashboard → Project Settings → Environment Variables** переменная `NEXT_PUBLIC_SUPABASE_ANON_KEY` содержит **недействительный или поврежденный ключ**.
2. Из-за недействительного API-ключа Supabase отклоняет как `signInWithPassword`, так и последующий запрос к таблице `users` со статусом `Invalid API key`.
3. Код серверного экшена воспринимал отсутствие данных из-за ошибки ключа как отсутствие пользователя в базе и выводил ложное сообщение «Пользователь с таким логином не найден в системе».

---

## 2. Необходимое исправление в Vercel Dashboard

В проекте Vercel (`sotka-crm`):
1. Открыть **Settings → Environment Variables**.
2. Найти переменную `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Установить актуальный рабочий анонимный ключ для проекта `qfsfgthlbjacxyxuvrnr`:
```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2ZndGhsYmphY3h5eHV2cm5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3NDg4MzcsImV4cCI6MjEwNTMyNDgzN30.05XFC-V-bGhtLLeLT3w-WCnBasPX8i1dVcYGkA-ACPo
```
4. Убедиться, что `NEXT_PUBLIC_SUPABASE_URL` установлен как:
```text
https://qfsfgthlbjacxyxuvrnr.supabase.co
```
5. Передеплоить проект (Redeploy) в Vercel Dashboard.

---

## 3. Исправления в кодовой базе

В `app/auth/actions.ts`:
- Добавлен явный перехват ошибки `Invalid API key` с понятным сообщением об ошибке конфигурации хостинга.
- Логика проверки существования пользователя теперь срабатывает строго при `!existError && !existingUser`, исключая ложные сообщения об отсутствии пользователя при сетевых или системных сбоях базы данных.
