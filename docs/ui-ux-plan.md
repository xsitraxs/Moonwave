# План улучшения UI/UX — Moonwave

Чек-лист поэтапного развития интерфейса и пользовательского опыта Moonwave. Задачи разбиты на 4 фазы с привязкой к текущим файлам проекта.

---

## Фаза 1. Скорость отклика и плавность

Цель — ускорить холодный старт окна и убрать лишние перерисовки во время воспроизведения.

### 1.1. Ленивая загрузка экранов и тяжёлых оверлеев
**Файлы:** `src/renderer/src/App.tsx`, `src/renderer/src/components/ui/States.tsx`

- [x] Обернуть редко открываемые экраны (`Dj`, `Workshop`, `Import`, `Settings`, `Inbox`, `Profile`, `Track`, `Playlist`, `Library`) в `React.lazy`.
- [x] Обернуть тяжёлые модалки и оверлеи (`HotkeysModal`, `RoomSheet`, `SendSheet`, `NowPlaying`) в `React.lazy`.
- [x] Добавить аккуратный `Suspense`-фоллбек в стиле `States.tsx`, чтобы переходы не мигали.
- [x] Оставить синхронными только базовый каркас (`Home`, `Sidebar`, `PlayerBar`, `TitleBar`).

### 1.2. Изоляция частых ререндеров в `NowPlaying` и `PlayerBar`
**Файлы:** `src/renderer/src/components/player/NowPlaying.tsx`, `src/renderer/src/components/player/LyricsPanel.tsx`, `src/renderer/src/components/studio/PlayerBar.tsx`

- [x] Изолировать `SweepLines`, `Elapsed`, `Waveform` и прогресс-бар в мемоизированные подкомпоненты с точечными селекторами Zustand (`currentTime` только там, где реально нужно время).
- [x] Проверить, что `LivingBackdrop`, `Halo` и кнопки управления не ререндерятся на каждом тике прогресса.

---

## Фаза 2. Навигация и быстрый доступ

Цель — сделать доступ ко всем возможностям приложения (DJ, Workshop, Rooms, Import, Local, Settings) мгновенным, в 1–2 действия.

### 2.1. Command Palette (`Ctrl+P`)
**Файлы:** `src/renderer/src/components/studio/CommandPalette.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/lib/keys.ts`, `src/renderer/src/state/ui.ts`

- [x] Реализовать модалку быстрого поиска и команд по `Ctrl+P` (чтобы не конфликтовать с `Ctrl+K` поиска в `TitleBar`).
- [x] Добавить мгновенный переход на любой экран (`Home`, `Likes`, `Feed`, `DJ`, `Workshop`, `Local`, `Import`, `Settings` и т.д.).
- [x] Добавить быстрые действия: «Очередь», «Слушать вместе», «Мини-плеер», «Горячие клавиши», «Play/Pause», «Следующий трек».
- [x] Добавить быстрый поиск по плейлистам, истории и локальным трекам.
- [x] Добавить шорткат `Ctrl+P` в `HotkeysModal.tsx`.

### 2.2. Структурирование и поиск в `Settings`
**Файлы:** `src/renderer/src/screens/Settings.tsx`

- [x] Добавить строку поиска по настройкам вверху экрана (фильтрация по заголовкам и ключевым словам на RU/EN с мгновенным переходом в нужную вкладку).
- [x] Вкладки уже есть (*Воспроизведение*, *Внешний вид*, *Приложение*, *Скрытые*, *Друзья*, *Сеть*, *Аккаунт*).

### 2.3. Улучшение работы с очередью (`Queue`)
**Файлы:** `src/renderer/src/components/studio/Queue.tsx`, `src/renderer/src/components/ui/Toast.tsx`, `src/renderer/src/state/ui.ts`

- [x] Добавить drag-and-drop перестановку треков в очереди с чётким визуальным индикатором места вставки и видимой иконкой `grip` при наведении.
- [x] Добавить кнопку «Очистить очередь» с возможностью отмены (Undo / «Восстановить» через `Toast`).
- [x] Кнопка «Сохранить очередь как плейлист» (уже есть).
- [x] Визуальное разделение очереди на секции (Сейчас играет, Далее, DJ, Автопилот).

---

## Фаза 3. Визуальная полировка и микро-взаимодействия

### 3.1. Единая система состояний (Empty / Loading / Error)
**Файлы:** `src/renderer/src/components/ui/States.tsx`, экраны `Likes`, `Feed`, `Playlists`

- [x] Добавить переиспользуемые скелетоны (`TrackListSkeleton`, `CardGridSkeleton`) в `States.tsx` и заменить текстовый `<Loading />` в `Likes`, `Feed`, `Playlists`.

### 3.2. Интерактивные уведомления (`Toast`) с действием
**Файлы:** `src/renderer/src/components/ui/Toast.tsx`

- [x] Добавить поддержку action-кнопки в `Toast` («Восстановить» при очистке очереди и для будущих действий).
- [x] Тосты не перекрывают `PlayerBar` (в один момент показывается один актуальный тост, `pointer-events-auto` только при наличии кнопки).

### 3.3. Полировка `NowPlaying` и `LyricsPanel`
**Файлы:** `src/renderer/src/components/player/NowPlaying.tsx`, `src/renderer/src/components/player/LyricsPanel.tsx`

- [x] Клик по любой строке синхронизированного текста → перемотка на эту строку (hover-подсветка и `cursor-pointer`).
- [x] Кнопка «К текущей строке» при ручном скролле текста, чтобы автоскролл не боролся с пользователем.

---

## Фаза 4. Доступность (a11y), клавиатура и предсказуемость

### 4.1. Полная навигация с клавиатуры и видимый фокус
**Файлы:** `src/renderer/src/styles/globals.css`, `src/renderer/src/components/studio/CommandPalette.tsx`, `HotkeysModal.tsx`

- [x] Единый стиль `:focus-visible` (уже настроен в `globals.css` и `studio-shell.css`).
- [x] Focus trap и возврат фокуса в `CommandPalette` (как в `HotkeysModal`) + закрытие по `Esc`.

### 4.2. Индикация сетевых и аудио-проблем в контексте
**Файлы:** `src/renderer/src/components/studio/TitleBar.tsx`, `src/renderer/src/components/player/SkipNotice.tsx`

- [x] Индикатор офлайна в `TitleBar` (`<Status />`) сделан кликабельным — по клику сразу открывает `Settings → Сеть`.

---

## Рекомендуемый порядок внедрения (спринты)

1. **Спринт 1 (быстрый профит):** `1.1` (`React.lazy` в `App.tsx`) + `2.2` (поиск и разделы в `Settings.tsx`).
2. **Спринт 2 (главная UX-фича):** `2.1` (`CommandPalette` по `Ctrl+P`) + `3.2` (`Toast` с Undo/Action).
3. **Спринт 3 (сердце плеера):** `1.2` (оптимизация `NowPlaying`/`LyricsPanel`) + `2.3` (доработка `Queue`) + `3.3` (полировка текстов и адаптивности).
4. **Спринт 4 (полировка):** `3.1` (скелетоны и Empty States) + `4.1` (клавиатура и a11y) + `4.2` (индикация сети/аудио).
