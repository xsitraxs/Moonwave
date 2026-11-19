# Motion в Moonwave

**Главное правило: анимация объясняет изменение, а не развлекает.**
Для каждого перехода ниже должна выполняться формула «Без него пользователю было бы труднее понять, что…». Если её не удаётся закончить без «стало красивее» — изменение остаётся мгновенным.

* **Состояние** — то, что видно до и после: атрибуты (`data-queue`), `inert`, фокус, `aria-pressed` / `aria-expanded`. **Анимация** — только пиксели между этими двумя состояниями и никогда не источник истины.
* **Декорация** (зерно, облака, кипящие контуры, `--accent` шагами, `LivingBackdrop`, пауза при `data-activity` / `data-quality`) живёт отдельно и под интерфейсные токены не переводится.

---

## 1. Токены и единый источник правды

Канонические токены заданы в `:root` в `src/renderer/src/styles/globals.css`:

* `--motion-fast: 90ms` — отклик: цвет, прозрачность, поповеры и меню у курсора, закрытие оверлеев.
* `--motion-base: 160ms` — смена состояния интерфейса: открытие панелей, диалогов, тостов, экранов.
* `--motion-slow: 240ms` — перемещение целого слоя: полноэкранный плеер `NowPlaying` и переезд сцены.
* `--motion-drag: 0ms` — ручной драг и перемотка без сглаживания.
* `--motion-progress: 300ms` — сглаживание рывковых прогресс-баров импорта/сжатия.
* `--motion-ease-enter: cubic-bezier(0.16, 1, 0.3, 1)` — появление.
* `--motion-ease-exit: cubic-bezier(0.4, 0, 1, 1)` — исчезновение.
* `--motion-ease-move: cubic-bezier(0.4, 0, 0.2, 1)` — перенос и линейные свойства.
* `--motion-shift: 8px` — сдвиг появляющегося/уходящего слоя (`0px` в reduced motion).

В `globals.css` заведены Tailwind-утилиты `@utility`: `motion-color`, `motion-enter`, `motion-enter-fast`, `motion-exit`, `motion-move`, `motion-progress` (задают только `transition-duration` и `transition-timing-function`, чтобы композироваться с `transition-colors` / `transition-opacity` / `transition-[width]`).

В TSX числа длительностей и кривых не дублируются: `src/renderer/src/lib/motion.ts` читает токены из `getComputedStyle(document.documentElement)` с учётом единиц (`ms` и `s`) и сбрасывает кэш на событие `change` у `(prefers-reduced-motion: reduce)`:

* `enter()` — `--motion-base` + `--motion-ease-enter` (панели, диалоги, тосты, смена экрана)
* `enterFast()` — `--motion-fast` + `--motion-ease-enter` (меню и поповеры у курсора)
* `exit()` — `--motion-fast` + `--motion-ease-exit` (любое закрытие)
* `move()` — `--motion-base` + `--motion-ease-move`
* `slowMove()` — `--motion-slow` + `--motion-ease-move` (полноэкранный плеер и сдвиг сцены)

Единственный `spring` в приложении — `ExpandingTitle` (разворот обрезанного названия трека).

---

## 2. Контракты

### 2.1 Открытие и закрытие очереди (`state/ui.ts`, `App.tsx`, `components/studio/Queue.tsx`, `styles/studio-shell.css`)

* Три фазы `queuePhase` в `useUi`: `"open" | "closing" | "closed"` (`data-queue` на `.s-shell`).
* `<StudioQueue />` смонтирован постоянно; при `data-queue="closed"` скрыт через `display: none`, при открытии из `closed` стартует от `@starting-style`.
* При закрытии (`closeSideQueue`):
  1. Если фокус внутри `.s-queue`, он синхронно возвращается на `[data-queue-toggle]` до выставления `inert`.
  2. `sideQueue` становится `false` (`aria-pressed="false"`, `aria-expanded="false"`, `inert={!sideQueue || fullOpen}` в том же кадре).
  3. Фаза переходит в `"closing"` на время `queueExitMs()` (`--motion-fast`), удерживая колонку сетки до конца ухода панели, а затем переходит в `"closed"`.
  4. Повторное открытие (`openSideQueue`) в любой фазе отменяет таймер и сразу переводит панель в `"open"`.
* Все места открытия (`toggleSideQueue`, `openSideQueue`, `RoomSheet`, `Invites`, кнопка комнаты в `StudioPlayerBar`) работают только через методы стора. В `StudioQueue` поддержано закрытие по `Escape`.

### 2.2 Прерывания и отсутствие анимации

* Состояние, `inert`, фокус и `aria`-атрибуты меняются в кадре действия; `transitionend` для корректности состояний не используется.
* Задержки (`delay`) при смене состояний не применяются.
* Кнопки (`.s-pp`, `.home-play`, `MarkerButton`, `PaperButton`, `PlayButton`, `Chip`, цветовые пресеты) не используют hover-`scale` и `hover:rotate`.
* Удаление одного трека из очереди, смена трека, переключение play/pause, перемотка по `Waveform` и изменение размеров при драге не анимируются.

### 2.3 `prefers-reduced-motion: reduce`

* На корне приложения стоит `<MotionConfig reducedMotion="user">`.
* В `@media (prefers-reduced-motion: reduce)` все длительности токенов обнулены до `0s`, кривые — `linear`, `--motion-shift: 0px`, отключены `transition` для `.now-playing.resting`, `--accent`, фоновых переходов и анимации `.s-eq` / `.social-eq` / `.np-skel`.
* В `closeSideQueue()` при reduced motion фаза сразу становится `"closed"` без `"closing"` и таймера.
* Автоскролл строк текста в `NowPlaying.tsx` и `LyricsPanel.tsx` при `useReducedMotion()` использует `behavior: "instant"`.
