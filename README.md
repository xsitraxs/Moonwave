<div align="center">

<img src=".github/assets/icon.png" width="80" alt="" />

# Moonwave

**Плеер SoundCloud для Windows, macOS и Linux: без рекламы, с текстами песен и своим оформлением.**

<sub>Основан на [sc player](https://github.com/waterlilo/sc-player) от waterlil · не связан с ним · [English below](#english)</sub>

<br/>

<a href="https://github.com/xsitraxs/Moonwave/releases/latest"><img src=".github/assets/badges/download.svg" alt="Скачать Moonwave" height="28" /></a>

<img src=".github/assets/badges/windows.svg" alt="Windows 10 / 11" />
<img src=".github/assets/badges/macos.svg" alt="macOS 13+" />
<img src=".github/assets/badges/linux.svg" alt="Linux: AppImage / deb" />
<a href="LICENSE"><img src=".github/assets/badges/license.svg" alt="Лицензия GPL-3.0" /></a>

[Возможности](#возможности) •
[Установка](#установка) •
[Переход с sc player](#переход-с-sc-player) •
[Полезно знать](#полезно-знать) •
[Скоро](#скоро)

<br/>

<img src=".github/assets/hero.jpg" alt="Moonwave — главная страница" width="100%" />

</div>

<table>
  <tr>
    <td align="center" width="50%">
      <img src=".github/assets/fullscreen.jpg" alt="Полноэкранный плеер с текстом песни рядом с обложкой" />
      <br/>
      <sub><b>Полноэкранный плеер с текстом</b></sub>
    </td>
    <td align="center" width="50%">
      <img src=".github/assets/appearance.jpg" alt="Настройки → Внешний вид: свой цвет интерфейса и акцент" />
      <br/>
      <sub><b>Свой цвет, фон и стекло</b></sub>
    </td>
  </tr>
</table>

> [!NOTE]
> Moonwave — неофициальное приложение, SoundCloud его не делал и не поддерживает. Оно работает через тот же интерфейс,
> что и soundcloud.com, поэтому SoundCloud должен открываться в вашей сети (в России — через zapret или VPN, см.
> [Полезно знать](#полезно-знать)).

---

## Возможности

**Музыка**
- Лайки, плейлисты, альбомы, станции, история, лента подписок, любой открытый профиль. Плейлисты и профили можно
  закрепить в боковой панели.
- **Свои плейлисты** — создавайте, переставляйте, переименовывайте. Хранятся на компьютере и работают даже без входа.
  Любой плейлист SoundCloud можно скопировать к себе, очередь — сохранить, всё — выгрузить в файл и загрузить обратно.
- **Перенос плейлистов** из Spotify, Яндекс Музыки, YouTube Music и VK Музыки (или просто списка строк): вставьте
  ссылку, и каждый трек найдётся на SoundCloud.
- **Честное перемешивание** по всему плейлисту или всем лайкам, **автопилот** — похожие треки после очереди.
- **Защищённые треки:** если SoundCloud отдаёт трек только с DRM или 30-секундным отрывком, Moonwave включает другую
  загрузку той же записи, сверив её по звуку (метка `ALT`).
- Перемотка по волне, очередь с перетаскиванием, кроссфейд, 10-полосный эквалайзер, выбор устройства вывода, таймер сна.
- **Музыка с компьютера:** свои файлы прямо рядом с треками SoundCloud.

**Тексты песен**
- Из [Better Lyrics](https://betterlyrics.org) (часто с разметкой по словам), его каталога Unison и
  [LRCLIB](https://lrclib.net). Нажмите на строку — песня перемотается туда.
- Текст без таймингов можно подогнать под песню прямо на компьютере (Настройки → Тексты): модель
  распознавания речи скачивается по желанию, звук никуда не отправляется.
- **Полноэкранный плеер:** большая обложка, спектр вокруг неё или внизу и слова, которые загораются по мере пения.

**Оформление**
- Тёмное стекло поверх живого фона в цветах обложки — или сама обложка, ваша картинка, GIF или видео.
- Свой цвет интерфейса и акцент, размытие, затемнение, плотность панелей; облегчённые эффекты для слабых ПК.

**На компьютере**
- Медиаклавиши, системные элементы управления, значок в трее и в строке меню, глобальные горячие клавиши,
  уведомления, автозапуск.
- **Windows:** кнопки ⏮ ⏯ ⏭ под превью на панели задач. **macOS:** закрытие окна не останавливает музыку.
- Обновляется сам (установщик Windows, AppImage на Linux) или сообщает о новой версии (macOS, .deb, portable).
  Пока окно скрыто, ничего не рисуется — играет только звук.

### Чем отличается от sc player
- Своё имя, иконка и свои обновления из этого репозитория.
- Исправлен вылет при запуске на свежих сборках Windows 11 (`0x80000003`, песочница аудио и GPU).
- Усиленная защита: разрешения страниц по белому списку, Electron fuses и проверка целостности ASAR, вход через
  браузер с проверкой состояния, `SHA256SUMS.txt` и подтверждение происхождения у каждого релиза.
- Счётчики использования по умолчанию выключены.

---

## Установка

### Windows
1. Скачайте `moonwave-setup-v….exe` (установщик) или `moonwave-portable-v….exe` (без установки) из
   [последнего релиза](../../releases/latest).
2. Приложение не подписано сертификатом, поэтому Windows может показать «Система Windows защитила ваш компьютер»:
   нажмите **Подробнее → Выполнить в любом случае**.

### macOS
Нужна **macOS 13 Ventura или новее**.

1. Скачайте `moonwave-v…-arm64.dmg` (Apple Silicon: M1 и новее) или `moonwave-v…-x64.dmg` (Intel) из
   [последнего релиза](../../releases/latest).
2. Откройте `.dmg` и перетащите **Moonwave** в **Программы**.
3. Приложение не подписано платным сертификатом Apple, поэтому первый запуск macOS заблокирует («не удаётся открыть»
   или «повреждено»). Откройте **Терминал**, выполните один раз и запускайте как обычно:
   ```bash
   xattr -cr "/Applications/Moonwave.app"
   ```
   (Или **Системные настройки → Конфиденциальность и безопасность → Всё равно открыть**.)
4. Подгонка текстов под песню работает только на Apple Silicon; всё остальное — и на Intel.

### Linux
- **AppImage** (любой дистрибутив): скачайте `moonwave-v…-x86_64.AppImage`, сделайте исполняемым
  (`chmod +x moonwave-*.AppImage`) и запустите. Он сам добавится в меню приложений и будет обновляться.
- **Debian / Ubuntu:** скачайте `moonwave-v…-amd64.deb` и установите (`sudo apt install ./moonwave-*.deb`).
- В GNOME для значка в трее нужно расширение AppIndicator.

### Вход
Нажмите **Войти**, чтобы видеть свои лайки и плейлисты. Если окно входа пишет «доступ временно
ограничен» или «что-то пошло не так», выберите **Войти через браузер**. Без входа можно искать, слушать, делать свои
плейлисты и открывать любые профили.

Новые версии ставятся поверх старой: вход, настройки и плейлисты остаются.

> iPhone-версии у Moonwave нет.

---

## Переход с sc player

Moonwave ставится **отдельным приложением**, рядом со старым sc player.

- При первом запуске Moonwave **копирует** настройки, лайки, свои плейлисты, тексты и фоны из папки sc player. Старая
  папка не трогается, так что sc player продолжит работать, пока вы его не удалите.
- **Windows:** вход в SoundCloud переносится тоже.
- **macOS и Linux:** войдите в SoundCloud заново — системный ключ шифрования привязан к имени приложения.
- Закладку «Moonwave sign-in» для входа через браузер создайте заново, ссылки `scplayer://` больше не открываются.
- Файлы плейлистов, выгруженные из sc player, загружаются в Moonwave как есть.
- Когда убедились, что всё на месте, удалите sc player обычным способом.

---

## Полезно знать

- **SoundCloud в России.** Moonwave ходит в SoundCloud через ваше подключение, своего обхода блокировки пока нет
  (см. [Скоро](#скоро)). Работает с zapret или VPN; гайд сообщества:
  [«Как починить SoundCloud с помощью zapret»](https://github.com/Flowseal/zapret-discord-youtube/issues/7449)
  (от kkkwkswd).
- Некоторые треки SoundCloud отдаёт только в зашифрованном виде (DRM). Если другой загрузки той же записи нет, у трека
  будет пометка `SoundCloud only`, и он откроется на soundcloud.com.
- Защита SoundCloud от ботов не даёт приложениям менять плейлисты на самом SoundCloud, поэтому свои плейлисты хранятся
  на компьютере. Время от времени выгружайте их в файл (Плейлисты → Экспорт): они не переезжают вместе с аккаунтом.
- Если SoundCloud что-то поменял у себя, приложение покажет ошибку с кнопкой **Повторить**; если не помогло — проверьте
  [новую версию](../../releases/latest).
- Что-то сломалось? Настройки → О программе → **Сообщить о проблеме** соберёт отчёт, или откройте
  [issue](../../issues).

---

## Скоро

Эти части уже есть в коде, но им нужен сервер Moonwave, а его пока нет. В текущих сборках они скрыты:

- **Комнаты** — слушать с друзьями один трек в одну секунду.
- **Входящие** — коды друзей, отправка треков, что друзья слушают сейчас, ссылки-приглашения.
- **«Слушают в Moonwave»** на главной.
- **Мастерская** — публиковать своё оформление и ставить чужое.
- **Облачный бэкап** — лайки, плейлисты и тексты на новом компьютере по ключу переноса.
- **Встроенный обход блокировки** SoundCloud — без zapret и VPN.
- **Тексты от сообщества** — предлагать свои тексты для треков.
- **Статус «Слушает Moonwave» в Discord.**

Как поднять свой сервер — в [server/README.md](server/README.md).

---

## Благодарности

- **[waterlil](https://github.com/waterlilo)** и участники [sc player](https://github.com/waterlilo/sc-player) —
  приложение, на котором построен Moonwave.
- **[Better Lyrics](https://betterlyrics.org)** — тексты из Better Lyrics и его каталога Unison (sc player использует их
  с разрешения автора), многие размечены по словам.
- **[LRCLIB](https://lrclib.net)** — открытая база текстов.
- **[Whisper](https://github.com/openai/whisper)** от OpenAI (MIT) — модель, которая подгоняет текст под песню.
- **[ggrk52](https://github.com/ggrk52)** — версия для macOS.
- **kkkwkswd** — гайд по zapret для SoundCloud.

---

## Лицензия

Copyright © 2026 waterlil and the contributors.

Moonwave — изменённая версия [sc player](https://github.com/waterlilo/sc-player) от waterlil, распространяется по
лицензии [GNU GPL v3.0](LICENSE). Форк сделан от sc player 2.3.0 и переименован 10 ноября 2026 года; все изменения
видны в истории этого репозитория. Программу можно использовать, изучать, менять и распространять, а изменённая версия
должна оставаться открытой под той же лицензией, вместе с исходным кодом.

Имя **sc player** и его логотип принадлежат оригинальному приложению и не входят в лицензию (GPL-3.0, раздел 7e),
поэтому Moonwave не использует ни то, ни другое. Moonwave не создан и не одобрен waterlil.

---

## English

**Moonwave** is a SoundCloud player for Windows, macOS and Linux — no ads, synced lyrics, your own look. It is a
modified version of [sc player](https://github.com/waterlilo/sc-player) by waterlil (GPL-3.0), not affiliated with it
or with SoundCloud.

- **Music:** likes, playlists, albums, stations, history, your feed; local playlists kept on your computer; import from
  Spotify, Yandex Music, YouTube Music and VK; honest shuffle and autopilot; DRM-only tracks replaced by another upload
  of the same recording; crossfade, 10-band EQ, output device, sleep timer; your own audio files.
- **Lyrics** from Better Lyrics, Unison and LRCLIB, often word by word; plain lyrics can be synced on your computer.
- **Look:** dark glass over a living background, your own colour and accent; a full screen player with a spectrum.
- **Desktop:** media keys, tray, global hotkeys, notifications, self-updating installer and AppImage.

**Install:** grab the file for your system from the [latest release](../../releases/latest) — `moonwave-setup-v….exe`
(Windows), `moonwave-v…-arm64.dmg` / `-x64.dmg` (macOS 13+; run `xattr -cr "/Applications/Moonwave.app"` once, the
app isn't notarized), `moonwave-v…-x86_64.AppImage` or `-amd64.deb` (Linux). On Windows, click **More info → Run
anyway** if SmartScreen warns.

**Coming from sc player:** Moonwave installs next to it and copies its settings, likes and playlists on the first
start (on macOS and Linux you sign in to SoundCloud again). Remove sc player once everything is there.

**Not yet:** listening rooms, the Inbox, the Workshop, cloud backup, the built-in route to SoundCloud and Discord
presence need a Moonwave server, which doesn't exist yet — they are hidden in current builds.

**License:** GPL-3.0 — Copyright © 2026 waterlil and the contributors. The name *sc player* and its logo belong to the
original app (GPL-3.0 §7e) and are not used here.

---

<div align="center">
<sub>основан на sc player от waterlil · SoundCloud — товарный знак SoundCloud Ltd.</sub>
</div>
