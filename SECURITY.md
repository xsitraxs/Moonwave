# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately: open the repository's **Security** tab → **Report a vulnerability**.

Please include:

- what you found and where (a file, an endpoint, a version);
- how to reproduce it, step by step;
- what it lets someone do;
- a fix, if you have one in mind.

Please keep the details private until a fix is released.

## Scope

- **In scope:** the desktop app in this repository and its server code (`server/`).
- **Out of scope:** SoundCloud and other third-party services. Moonwave has no iOS app.

You may test your own copy of the server; `server/README.md` shows how to run it locally. Do not probe or test a server unless you own it or have explicit authorization. In particular, do not run load or denial-of-service tests, guess passwords or keys, or access other people's data. If you come across someone else's data by accident, stop, do not keep it, and report it privately.

## Supported versions

Only the latest release gets fixes. The app updates itself: Settings → App → Updates.

## Known, accepted risks

These are known and accepted for now, not open bugs.

- **The browser sign-in token is briefly present in process arguments.** The bookmark on soundcloud.com opens `moonwave://signin?token=…`; Windows starts (or hands the link to) the app with that address as a command-line argument, so a local process may read the token before the app stores it. The link is acted on silently only when it carries the one-time state issued for that sign-in attempt; anything else asks the person first. Moving the token off the command line would require a local socket, which is a larger change than the risk justifies today.
- **A locally configured proxy is included in the resulting build.** The public CI, test-build and release workflows deliberately do not provide `proxy.local.json` or `server.local.json`, so official builds contain no project proxy credentials or server address. The source still supports these ignored local configuration files for custom builds. Anyone who builds with `proxy.local.json` embeds its proxy credentials in that binary; treat them as public and do not reuse them for other services. In such a build, selecting `builtin` routes SoundCloud requests through the configured proxy; `auto` does so when the direct connection fails. The proxy is intended to carry SoundCloud traffic only; unrelated hosts are explicitly bypassed or refused by the proxy server.

---

## Безопасность (по-русски)

Нашли уязвимость — не пишите в публичные issues. Сообщите лично: вкладка **Security** → **Report a vulnerability**. Не раскрывайте подробности публично до выпуска исправления.

## Область действия

- **В области действия:** настольное приложение из этого репозитория и его код сервера (`server/`).
- **Вне области действия:** сам SoundCloud и другие сторонние сервисы. У Moonwave нет приложения для iOS.

Проверять свою копию сервера можно — инструкция есть в `server/README.md`. Не проверяйте сервер, если он не ваш и у вас нет явного разрешения. В частности, запрещены нагрузочные тесты и отказ в обслуживании, подбор паролей и ключей, чтение чужих данных. Если случайно увидели чужие данные, прекратите доступ, не сохраняйте их и сообщите об этом лично.

Исправления выходят только в последней версии.

**Известные принятые риски.** Это не открытые баги, а решения, известные и принятые на сегодня:

- **Токен входа через браузер кратковременно виден в аргументах процесса.** Ссылка `moonwave://signin?token=…` приходит в командной строке Windows, и локальный процесс может прочитать её до сохранения токена приложением. Без вопроса принимается только ссылка с одноразовым `state`, выданным этой попыткой входа; в остальных случаях приложение спрашивает подтверждение. Перенос токена с командной строки потребовал бы локального сокета — это более крупное изменение, чем оправдывает риск.
- **Прокси, настроенный для локальной сборки, встраивается в бинарный файл.** Публичные CI-, тестовые и release-сборки намеренно не получают `proxy.local.json` или `server.local.json`, поэтому в официальных версиях нет учётных данных прокси или адреса сервера проекта. Исходный код поддерживает эти игнорируемые файлы для пользовательских сборок. Если собрать приложение с `proxy.local.json`, логин и пароль прокси можно извлечь из бинарного файла; считайте их публичными и не используйте повторно для других сервисов. В такой сборке режим «Встроенный» направляет запросы SoundCloud через указанный прокси, а режим «Авто» делает это, если прямое подключение не работает. Прокси предназначен только для SoundCloud: прочие адреса приложение обходит напрямую, а сервер прокси должен отказывать им.
