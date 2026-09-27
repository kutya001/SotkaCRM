# План: Мобильная оптимизация DataJournal (Icon-Only Toolbar и устранение дублирования поиска)

**Дата и время:** 27-09-2026 11:04:02  
**Целевые компоненты:** `components/ui/DataJournal.tsx`, `components/layout/MobileHeader.tsx`, `app/leads/page.tsx`, `app/sellers/page.tsx`, `app/connections/page.tsx`, `app/employees/page.tsx`, `app/payouts/page.tsx`.

---

## 1. Проблематика и архитектурные цели

1. **Дублирование поля поиска на мобильных устройствах:**
   - В текущем интерфейсе на мобильных экранах под шапкой отображается полноразмерное поле поиска (`Поиск по всем полям...` высотой 44px), несмотря на то, что `MobileHeader` уже содержит кнопку и поле поиска.
   - Это поле занимает ценное вертикальное пространство первого экрана и сдвигает контент реестра.
   - **Решение:** Скрыть локальное поле поиска в тулбаре на экранах `< md` (`hidden md:flex`), синхронизировать чтение строки поиска из URL (`searchParams.get('q') || searchParams.get('search')`) и пропса `externalSearchQuery`.

2. **Перегрузка и перенос тулбара управления на мобильных экранах:**
   - На экранах `< 768px` кнопки тулбара (`customActions`, `groupBy`, `filter`, `columns`, `viewMode`, `reset`) содержат текстовые лейблы и паддинги, из-за чего контейнер ломается на 2-3 строки, занимая до 120-150px по высоте.
   - **Решение:** Внедрить адаптивный режим **Icon-Only Toolbar** для мобильных устройств:
     - Все кнопки управления на экранах `< md` принимают квадратную форму `h-9 w-9 p-0 rounded-xl` с центрированной иконкой Lucide React.
     - Текстовые метки скрываются (`hidden md:inline`).
     - Группировка (`groupBy`): на мобильных отображается как кнопка `<Layers className="w-4 h-4" />` с акцентной синей точкой-индикатором при активности и выпадающим поповером выбора поля.
     - Фильтры карточного режима: кнопка `<Filter className="w-4 h-4" />` с бейджем количества активных фильтров.
     - Настройка колонок: кнопка `<SlidersHorizontal className="w-4 h-4" />` (замена `<Table2>` на `<SlidersHorizontal>` для однозначности).
     - Переключатель вида: компактный блок `h-9` с кнопками `<Table2 />` и `<LayoutGrid />`.
     - Контейнер тулбара: строгий однострочный `flex items-center justify-between gap-1.5 w-full overflow-x-auto no-scrollbar py-1.5 px-2.5 sm:px-3`.

3. **Горизонтальная прокрутка табов:**
   - Проверить и оптимизировать контейнер табов `tabs`: плавный горизонтальный скролл без полосы прокрутки (`overflow-x-auto no-scrollbar whitespace-nowrap`).

---

## 2. Пошаговый план внедрения

1. **`components/ui/DataJournal.tsx`:**
   - Импортировать `useSearchParams` из `next/navigation` и `SlidersHorizontal` из `lucide-react`.
   - Добавить чтение параметра поиска из URL: `urlSearchQuery = searchParams?.get('q') || searchParams?.get('search') || ''`.
   - Обновить `effectiveSearch`: `externalSearchQuery !== undefined ? externalSearchQuery : (urlSearchQuery || searchQuery)`.
   - В тулбаре (для обоих режимов `viewMode === 'table'` и `viewMode === 'cards'`):
     - Обернуть поле поиска в `hidden md:flex`.
     - Реализовать мобильный триггер группировки: кнопка `<Layers className="w-4 h-4" />` с выпадающим меню, если экран мобильный, либо адаптивный блок.
     - Преобразовать кнопку «Фильтры» в карточном режиме: на мобильных `h-9 w-9 p-0 flex items-center justify-center`, на десктопе с текстом и шевроном.
     - Преобразовать кнопку «Колонки»: иконка `SlidersHorizontal`, на мобильных `h-9 w-9 p-0 flex items-center justify-center`.
     - Преобразовать переключатель видов: компактный контейнер `h-9 p-0.5`.
     - Кнопка сброса фильтров: на мобильных компактная `h-9 w-9 p-0` с бейджем или иконкой сброса.
     - Внешний контейнер тулбара: убрать лишние отступы на мобильных, исключить вертикальный перенос (`flex items-center justify-between gap-1.5 sm:gap-2.5`).

2. **Модули страниц (`app/leads`, `app/sellers`, `app/connections`, `app/employees`, `app/payouts`):**
   - Проверить кастомные кнопки в `customActions` (`leadActions`, `sellerActions`, `connectionActions`, `payoutActions`):
     - Убедиться, что на мобильных устройствах кнопки компактны (`h-9 w-9 p-0 md:h-11 md:w-auto md:px-3.5` или `h-9 px-2.5 md:h-11 md:px-3.5`) и текст скрыт (`hidden md:inline` или `hidden sm:inline`).
   - Проверить проброс поиска и отсутствие конфликтов.

3. **Верификация и тестирование:**
   - Проверить отсутствие ошибок компиляции TypeScript: `npx tsc --noEmit`.
   - Проверить сборку проекта: `npm run build`.
   - Составить отчет верификации в `.antigravity/results/`.
