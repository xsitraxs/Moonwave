# Как помочь Moonwave

Спасибо, что заглянули. Ниже — как собрать проект, что проверить перед pull request и чего мы просим не делать.
English version: [below](#contributing-to-moonwave).

## Прежде чем начать

- **Ошибки и идеи** — через [Issues](https://github.com/xsitraxs/Moonwave/issues). Чем точнее шаги, версия
  (Настройки → Приложение) и платформа, тем быстрее разберёмся. Журнал для отчёта: Настройки → Диагностика → Логи.
- **Уязвимости** — не в публичный issue, а приватно: вкладка **Security** → **Report a vulnerability**
  (см. [SECURITY.md](SECURITY.md)).
- Moonwave распространяется по **GPL-3.0**. Отправляя изменение, вы соглашаетесь, что оно выходит под той же
  лицензией.

## Что нужно

**Node.js 24 или новее** (`.nvmrc` закрепляет 24) и npm. Для `npm run dev` нужен рабочий стол: приложение —
Electron.

```bash
git clone https://github.com/xsitraxs/Moonwave.git
cd Moonwave
npm install
```

## Как устроен репозиторий

| Путь | Что там |
|---|---|
| `src/main/` | главный процесс Electron: окно, настройки (`store/`), SoundCloud, локальная библиотека, бэкап, комнаты |
| `src/preload/` | мост IPC между окном и главным процессом |
| `src/renderer/` | интерфейс на React: экраны, плеер (`audio/`, `state/`), тексты |
| `src/shared/` | типы и контракт IPC, общие для обеих сторон; санитайзер CSS тем (его копия живёт на сервере, parity-тест следит за совпадением) |
| `server/api/` | сервер: мессенджер треков, мастерская тем, комнаты. Без зависимостей — Node 24 сам запускает TypeScript |
| `scripts/` | сборка и проверки: `dist`, `scan-dist`, `verify-dist`, тесты этих скриптов |
| `.github/workflows/` | CI: тесты, типы, lint, сборка, упаковка, проверка запуска, сканирование на секреты |

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | приложение с горячей перезагрузкой |
| `npm test` | юнит-тесты приложения и скриптов (`src/**/*.test.ts`, `scripts/**/*.test.mjs`) |
| `npm run test:server` | юнит-тесты сервера (`server/api/test/*.test.ts`) |
| `npm run typecheck` | типы главного процесса и интерфейса |
| `npm run typecheck:server` | типы сервера |
| `npm run lint` | ESLint |
| `npm run build` | `typecheck` + сборка в `out/` |

Сервер отдельно:

```bash
cd server/api
DATA_DIR=./data-dev node src/main.ts     # API на http://127.0.0.1:8080
node test/smoke.ts                       # весь API по работающему серверу
node test/rooms-live.ts                  # комнаты: поднимает и останавливает свой сервер
```

## Перед pull request

Прогоните то же, что прогоняет CI (`.github/workflows/ci.yml`):

```bash
npm test
npm run test:server
npm run typecheck
npm run typecheck:server
npm run lint
```

Если менялись сборка или упаковка — ещё `npm run build` и `node scripts/scan-dist.mjs`.

## Тесты

- Тесты лежат рядом с кодом: `*.test.ts` в `src/` и `scripts/*.test.mjs`. Фреймворка нет — `node --test`.
- Для сервера — `server/api/test/*.test.ts`; сквозные `smoke.ts` и `rooms-live.ts` запускаются отдельно (CI делает
  это своими шагами).
- Файлы тестов Node исполняет **как есть, стирая только типы**. Поэтому в модуле, который импортирует тест, нельзя
  использовать то, что требует компиляции: `enum`, `namespace`, свойства-параметры конструктора
  (`constructor(private readonly path: string)`) — заводите обычные поля.
- Хороший тест падает до исправления и проходит после. Если поведение меняется намеренно — обновите тест и
  объясните это в pull request.

## Стиль

- TypeScript в strict-режиме, ESLint без предупреждений. `npm run lint` должен быть чистым.
- Комментарии и сообщения коммитов — по-английски, как в остальном коде; текст интерфейса — в
  `src/renderer/src/i18n/ru.ts` и `en.ts`, оба языка сразу.
- Один коммит — одна законченная правка. Сообщение: короткая строка в повелительном наклонении с областью впереди
  (`store: keep a damaged file aside`), подробности — в теле, если они нужны.
- Новые зависимости — только с внятным обоснованием: приложение и сервер сознательно обходятся малым числом пакетов.

## Чего не делать

- **Не коммитьте секреты и локальные настройки**: `.env`, `proxy.local.json`, `server.local.json`, `settings.json`,
  ключи, базы. Они в `.gitignore` не просто так; сборку проверяет `scripts/scan-dist.mjs`.
- **Не меняйте формат бэкапа** (`SCB1` в `src/main/backup-crypto.ts`) без совместимости со старыми копиями: тест
  держит образец, сделанный прежней версией.
- **Не трогайте собранное** (`out/`, `dist/`) и `package-lock.json` вручную.
- **Не расширяйте права**: сервер и приложение намеренно строги к тому, что принимают (URL, размеры, CSS тем).

## Pull request

1. Форк или ветка от `main`, небольшой и посвящённый одной теме.
2. В описании — что и зачем, как проверить, на что это влияет; ссылка на issue, если он есть.
3. Зелёный CI. Если проверка падает по делу — поправьте код, а не проверку.
4. Изменение поведения — отразите в `README.md` или `server/README.md`.

---

# Contributing to Moonwave

Thanks for stopping by. Here is how to build the project, what to run before a pull request, and what we ask you not
to do. Русская версия — [выше](#как-помочь-moonwave).

## Before you start

- **Bugs and ideas** — through [Issues](https://github.com/xsitraxs/Moonwave/issues). Exact steps, the version
  (Settings → App) and the platform help most. The log to attach: Settings → Diagnostics → Logs.
- **Vulnerabilities** — never a public issue: the **Security** tab → **Report a vulnerability** (see
  [SECURITY.md](SECURITY.md)).
- Moonwave is **GPL-3.0**. By sending a change you agree it ships under the same license.

## What you need

**Node.js 24 or newer** (`.nvmrc` pins 24) and npm. `npm run dev` needs a desktop session — the app is Electron.

```bash
git clone https://github.com/xsitraxs/Moonwave.git
cd Moonwave
npm install
```

## How the repository is laid out

| Path | What lives there |
|---|---|
| `src/main/` | the Electron main process: window, settings (`store/`), SoundCloud, the local library, backups, rooms |
| `src/preload/` | the IPC bridge between the window and the main process |
| `src/renderer/` | the React interface: screens, the player (`audio/`, `state/`), lyrics |
| `src/shared/` | types and the IPC contract both sides use; the themes' CSS sanitiser (the server keeps a copy, a parity test keeps them equal) |
| `server/api/` | the server: track messenger, theme workshop, listening rooms. No dependencies — Node 24 runs the TypeScript |
| `scripts/` | build and checks: `dist`, `scan-dist`, `verify-dist`, and their tests |
| `.github/workflows/` | CI: tests, types, lint, build, packaging, a real app launch, secret scanning |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | the app with hot reload |
| `npm test` | unit tests of the app and the scripts (`src/**/*.test.ts`, `scripts/**/*.test.mjs`) |
| `npm run test:server` | the server's unit tests (`server/api/test/*.test.ts`) |
| `npm run typecheck` | types of the main process and the interface |
| `npm run typecheck:server` | the server's types |
| `npm run lint` | ESLint |
| `npm run build` | `typecheck` plus an electron-vite build into `out/` |

The server on its own:

```bash
cd server/api
DATA_DIR=./data-dev node src/main.ts     # the API on http://127.0.0.1:8080
node test/smoke.ts                       # the whole API against a running server
node test/rooms-live.ts                  # listening rooms: starts and stops its own server
```

## Before a pull request

Run what CI runs (`.github/workflows/ci.yml`):

```bash
npm test
npm run test:server
npm run typecheck
npm run typecheck:server
npm run lint
```

If the build or packaging changed, also `npm run build` and `node scripts/scan-dist.mjs`.

## Tests

- Tests sit next to the code: `*.test.ts` under `src/` and `scripts/*.test.mjs`. There is no framework — `node --test`.
- For the server — `server/api/test/*.test.ts`; the end-to-end `smoke.ts` and `rooms-live.ts` run as their own steps in
  CI.
- Node runs those files **as they are, stripping only the types**. A module a test imports must therefore avoid
  anything that needs compiling: `enum`, `namespace`, constructor parameter properties
  (`constructor(private readonly path: string)`) — use plain fields.
- A good test fails before the fix and passes after. When behaviour changes on purpose, update the test and say why in
  the pull request.

## Style

- TypeScript in strict mode, ESLint with no warnings: `npm run lint` must be clean.
- Comments and commit messages in English, like the rest of the code; interface text in both
  `src/renderer/src/i18n/ru.ts` and `en.ts` at once.
- One commit, one finished change. The subject is a short imperative line with the area first
  (`store: keep a damaged file aside`); details go in the body when they matter.
- New dependencies only with a clear reason: the app and the server deliberately get by with few packages.

## What not to do

- **Never commit secrets or local settings**: `.env`, `proxy.local.json`, `server.local.json`, `settings.json`, keys,
  databases. They are in `.gitignore` for a reason, and `scripts/scan-dist.mjs` checks builds for them.
- **Don't change the backup format** (`SCB1` in `src/main/backup-crypto.ts`) without keeping old copies readable: a
  test holds a sample made by an earlier version.
- **Don't edit build output** (`out/`, `dist/`) or `package-lock.json` by hand.
- **Don't widen what is accepted**: the server and the app are deliberately strict (URLs, sizes, theme CSS).

## Pull requests

1. A fork or a branch off `main`, small and about one thing.
2. Describe what and why, how to check it, and what it affects; link the issue if there is one.
3. Green CI. If a check fails for a real reason, fix the code, not the check.
4. A behaviour change belongs in `README.md` or `server/README.md` too.
