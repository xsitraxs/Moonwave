# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.
Report it privately: open the repository's **Security** tab → **Report a vulnerability**.

Please include:

- what you found and where (a file, an endpoint, a version);
- how to reproduce it, step by step;
- what it lets someone do;
- a fix, if you have one in mind.

You will get an answer within a few days. Please keep the details private until a fix is released.

## Scope

- **In scope:** the desktop app in this repository and its server code (`server/`).
- **Out of scope:** SoundCloud itself and other third-party services; the iOS app, which has its own repository: [waterlilo/sc-player-ios](https://github.com/waterlilo/sc-player-ios).

You are welcome to test your own copy of the server; `server/README.md` shows how to run it locally.
Please **do not test the live server** (`*.sslip.io`): real people use it. The following are forbidden there:

- load or denial-of-service tests;
- guessing passwords or keys;
- reading other people's data.

If you come across someone else's data by accident, please stop, do not keep it, and report it.

## Supported versions

Only the latest release gets fixes. The app updates itself: Settings → App → Updates.

## Known, accepted risks

These are known and accepted for now, not open bugs. They are listed so that nobody reports them twice, and so that a
future version knows where to look first.

- **The browser sign-in's token is in the process arguments while it is passed.** The bookmark on soundcloud.com opens
  `scplayer://signin?token=…`; Windows starts (or hands the link to) the app with that address as a command-line
  argument, so any local process can read the token there for the moment before the app stores it. The link itself is
  only acted on silently when it carries the one-time state the app handed out for that sign-in (see
  `src/main/soundcloud/browser-signin.ts`); anything else asks the person first. Moving the token off the command line
  would mean a local socket, which is a bigger change than the risk justifies today.
- **The built-in proxy's credentials are inside every build.** `proxy.local.json` (host, user, password and secret) is
  compiled into the app, so anyone who takes an installer apart can read them and use the proxy. They are one shared
  account, not a per-person one; rotating them means a new build, and they should be rotated if a build leaks beyond
  the people it was given to. Do not treat the proxy as a secret channel: it only masks the traffic it carries.

---

## Безопасность (по-русски)

Нашли уязвимость — не пишите в публичные issues. Сообщите лично: вкладка **Security** → **Report a vulnerability**.

- Свою копию сервера проверять можно, `server/README.md` объясняет, как её поднять.
- Боевой сервер не трогайте: без нагрузочных тестов, без подбора паролей и ключей, без чужих данных.
- Исправления выходят только в последней версии.

**Известные принятые риски.** Это не баги, а решения, известные и принятые на сегодня:

- **Токен входа через браузер виден в аргументах процесса** на время передачи: ссылка `scplayer://signin?token=…`
  приходит в командной строке, и любой локальный процесс может прочитать её до того, как приложение сохранит токен.
  Без вопроса такая ссылка принимается, только если несёт одноразовый state, выданный этой попыткой входа.
- **Учётные данные встроенного прокси есть в каждой сборке** (`proxy.local.json` компилируется внутрь): их можно
  достать из установщика и пользоваться прокси. Это один общий аккаунт, а не личный; при утечке сборки его меняют
  новой сборкой. Прокси не делает трафик секретным — он лишь скрывает, куда он идёт.
