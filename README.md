<div align="center">

<img src=".github/assets/icon.png" width="72" alt="" />

# Moonwave

**A SoundCloud player for Windows, macOS and Linux — no ads, lyrics word by word, and friends to listen with.**

<sub>Based on [sc player](https://github.com/waterlilo/sc-player) by waterlil · not affiliated with it</sub>

[Download](../../releases/latest) •
[Features](#features) •
[Install](#install) •
[Good to know](#good-to-know)

[![Latest release](https://img.shields.io/github/v/release/xsitraxs/Moonwave?style=flat-square&label=release&labelColor=111114&color=3a3a41)](../../releases/latest)
[![Downloads](https://img.shields.io/github/downloads/xsitraxs/Moonwave/total?style=flat-square&labelColor=111114&color=3a3a41)](../../releases)
![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-3a3a41?style=flat-square&labelColor=111114)
![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon%20%2F%20Intel-3a3a41?style=flat-square&labelColor=111114)
![Linux](https://img.shields.io/badge/Linux-AppImage%20%2F%20deb-3a3a41?style=flat-square&labelColor=111114)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-3a3a41?style=flat-square&labelColor=111114)](LICENSE)

<br/>

<img src=".github/assets/hero.jpg" alt="Moonwave — the Home page" width="100%" />

</div>

---

## Preview

<div align="center">
  <table>
    <tr>
      <td align="center" width="50%">
        <img src=".github/assets/fullscreen.jpg" alt="The full screen player with the lyrics next to the cover" />
        <br/>
        <sub><b>Lyrics, word by word</b></sub>
      </td>
      <td align="center" width="50%">
        <img src=".github/assets/appearance.jpg" alt="Settings → Appearance with an own interface colour and accent" />
        <br/>
        <sub><b>Make it yours</b></sub>
      </td>
    </tr>
  </table>
</div>

> [!NOTE]
> Moonwave is an unofficial app, not affiliated with SoundCloud. It uses the same interface as soundcloud.com, so it
> needs SoundCloud to be reachable from your network.

---

## Features

**Together**
- **Listening rooms:** invite friends and everyone hears the same track at the same second. Pause is shared; the host
  puts on tracks or a whole playlist, the others suggest theirs; the host can hand the room over, and when the queue
  runs out similar tracks keep it going.
- **Send tracks to friends:** friend codes (no accounts), an Inbox, what your friends are listening to right now, and an
  invite link to send in any messenger.
- **On Home:** what your friends are playing and what people listen to on Moonwave. The shared list is
  pseudonymous and off by default: the app sends a track id only if you turn it on (Settings → Messenger), and the
  running-app count is likewise off until you say yes once, on the first start.

**Lyrics**
- From [Better Lyrics](https://betterlyrics.org) (often timed word by word), its community catalog Unison and
  [LRCLIB](https://lrclib.net); click a line to jump there.
- Words that come without timings can be matched to the song on your computer (Settings → Playback → Lyrics; an
  optional speech model, the sound never leaves your PC). Timings made for another upload are moved to fit this one.
- **Full screen player:** a big cover with a spectrum around it or along the bottom, and the words lighting up as
  they're sung.

**The look**
- Dark glass over a living background that takes the colours of the cover — or the cover itself, your own image, GIF
  or video.
- Your own interface colour and accent, blur, dim, panel opacity; lighter effects for slow PCs.
- **Workshop:** publish your look and install other people's.

**Your music**
- Likes, playlists, albums, stations, history, the feed of people you follow, any public profile; pin playlists and
  profiles to the sidebar.
- **Your own playlists:** make them, add to them, reorder, rename — kept on your computer, no sign-in needed; copy any
  SoundCloud playlist to change it, save the queue as one, export them to a file and back.
- **Bring your playlists over** from Spotify, Yandex Music, YouTube Music and VK Music (or a list of lines): paste a
  link, and every track is looked up on SoundCloud.
- **Honest shuffle** over the whole playlist or all your likes; **autopilot** keeps playing similar tracks.
- **Protected tracks:** when SoundCloud only streams a track with DRM or as a 30-second preview, Moonwave plays
  another upload of the same recording, checked by its sound (marked `ALT`).
- Seek on the waveform, a queue you can drag, crossfade, a 10-band equalizer, output device, sleep timer.

**On your computer**
- Media keys, the system's media controls, tray / menu bar icon, global hotkeys, notifications, start with the system.
- **Windows:** ⏮ ⏯ ⏭ under the taskbar preview.
- **macOS:** the window's own buttons; closing the window keeps the music playing (the Dock icon brings it back).
- Updates itself (Windows installer, Linux AppImage), or tells you a new version is out (macOS, .deb, portable).
  Nothing moves while the window is hidden — only the sound keeps going.

---

## Install

### Windows
1. Download `moonwave-setup-v….exe` (installer) or `moonwave-portable-v….exe` from the [latest release](../../releases/latest).
2. The app isn't code-signed, so Windows may say "Windows protected your PC": click **More info → Run anyway**.

### macOS
Needs **macOS 13 Ventura or newer** (the Electron it's built on no longer runs on macOS 12).

1. Download `moonwave-v…-arm64.dmg` (Apple Silicon: M1 and newer) or `moonwave-v…-x64.dmg` (Intel) from the
   [latest release](../../releases/latest).
2. Open the `.dmg` and drag **Moonwave** into **Applications**.
3. The app isn't signed with a paid Apple certificate, so macOS blocks the first launch ("Moonwave can't be
   opened", or "is damaged"). Open **Terminal** and run this once, then open Moonwave as usual:
   ```bash
   xattr -cr "/Applications/Moonwave.app"
   ```
   (Or, if macOS offers it: **System Settings → Privacy & Security**, scroll down, **Open Anyway** next to Moonwave.)
4. Lyrics auto-sync (the speech model) needs Apple Silicon; everything else works on Intel Macs too.

### Linux
- **AppImage** (any distribution): download `moonwave-v…-x86_64.AppImage`, make it executable
  (`chmod +x moonwave-*.AppImage`) and run it. It adds itself to the app menu and updates itself.
- **Debian / Ubuntu:** download `moonwave-v…-amd64.deb` and install it (`sudo apt install ./moonwave-*.deb`).
- On GNOME the tray icon needs the AppIndicator extension.

### iPhone
Moonwave has no iPhone version. The iPhone app [sc player for iPhone](https://github.com/waterlilo/sc-player-ios)
belongs to the original sc player and is a separate project.

### Sign in
Click **Sign in to SoundCloud** to see your likes and playlists. If the sign-in window says "access temporarily restricted" or "something unexpected happened", use **Sign in with your browser** instead. Without signing in you can still search, listen, make playlists and open any public profile.

New versions install over the old one; your sign-in, settings and playlists stay.

---

## Good to know

- Some tracks are only streamed encrypted (DRM). If no other upload of the same recording exists, the track says
  `SoundCloud only` and opens on soundcloud.com.
- SoundCloud's bot protection doesn't let apps change playlists on SoundCloud, so the playlists you make here are kept
  on your computer (Export them now and then — they don't travel with your SoundCloud account).
- If SoundCloud changes its site, the app shows an error with **Retry**; if that doesn't help, check for a
  [new version](../../releases/latest). Something broken? Settings → Account → **Report a problem**.
- Settings → Network: **Automatic** uses your own connection, and Moonwave's own route to SoundCloud only when
  SoundCloud doesn't open over it. The community guide for SoundCloud in Russia with zapret:
  [«Как починить SoundCloud с помощью zapret»](https://github.com/Flowseal/zapret-discord-youtube/issues/7449)
  (by kkkwkswd).

---

## Thanks

- **[Better Lyrics](https://betterlyrics.org)** — lyrics from Better Lyrics and from Unison, its community catalog
  (sc player, which Moonwave is based on, uses them with the permission of their author). Many of them are timed
  word by word, so the words light up as they are sung. Thank you!
- **[LRCLIB](https://lrclib.net)** — the open lyrics database.
- **[Whisper](https://github.com/openai/whisper)** by OpenAI (MIT) — the speech model that matches plain lyrics to the
  song on your computer.
- **[ggrk52](https://github.com/ggrk52)** — the macOS version.
- **[waterlil](https://github.com/waterlilo)** and the contributors of [sc player](https://github.com/waterlilo/sc-player) — the app Moonwave is built on.
- The zapret guide for SoundCloud by kkkwkswd.

---

## License

Copyright © 2026 waterlil and the contributors.

Moonwave is a modified version of [sc player](https://github.com/waterlilo/sc-player) by waterlil, released under
the [GNU General Public License v3.0](LICENSE). It was forked from sc player 2.3.0 and renamed on 10 November 2026; the
changes since the fork are listed in this repository's history. You may use, study, change and share it, and a changed
version you share must stay open under the same license, with its source.

The name **sc player** and its logo belong to the original app and are not covered by the license (GPL-3.0 section 7e),
so Moonwave uses neither: it has a name and an icon of its own. Moonwave is not made or endorsed by waterlil.

---

<div align="center">
<sub>based on sc player by waterlil · SoundCloud is a trademark of SoundCloud Ltd.</sub>
</div>
