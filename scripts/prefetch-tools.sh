#!/bin/bash
# Pre-fetch the large, immutable files the packaging step downloads, so a flaky or throttled
# github.com asset CDN (504s today) cannot kill the build: curl retries with resume, and every
# file is checksum-verified against the official SHASUMS256.txt (or the sums pinned in
# electron-builder's own source for the tool archives).
#
# What gets fetched depends on the host platform:
#   linux:   electron dist zip, the fpm deb toolchain, the AppImage tools runtime (pinned toolsets.appimage=1.0.3)
#   windows: electron dist zip, the NSIS installer toolchain, the winCodeSign archive
#   macOS:   electron dist zips for both arches (arm64 + x64)
# Files that fail verification are deleted again — electron-builder then falls back to its own
# download, exactly as if this step never ran.
#
# Additionally, when EVERY required dist file for this platform verifies OK, an all-or-nothing
# mirror is assembled under ${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ci-electron-mirror/v<electronVersion>/
# (the dist zips + the official SHASUMS256.txt). CI starts scripts/serve-static.mjs on 127.0.0.1
# for that directory and exports ELECTRON_MIRROR=http://127.0.0.1:8137/ for the packaging step, so
# electron-builder downloads the dist — and validates it against SHASUMS256.txt, which @electron/get
# always fetches fresh, even on cache hits — from loopback instead of the release CDN.
# The mirror is never partial: if anything is missing or failed verification, it is not created and
# electron-builder uses its (seeded) cache or the network as before. Everything served is the
# official artifact, verified moments earlier against the official SHASUMS256.txt; no TLS setting is
# touched anywhere, and the server binds 127.0.0.1 only.
set -u

# The Electron version — NOT the application version (package.json's `version` is the app itself).
# A previous revision of this script used the app version and therefore pre-fetched nothing.
ELECTRON_VERSION="$(node -p "try { require('./node_modules/electron/package.json').version } catch { '' }" 2>/dev/null)"
if ! printf '%s' "$ELECTRON_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  ELECTRON_VERSION="$(node -p "const p=require('./package.json'); ((p.devDependencies||{}).electron || (p.dependencies||{}).electron || '').replace(/^[^0-9]*/, '')" 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+')"
fi
if [ -z "$ELECTRON_VERSION" ]; then
  echo "cannot determine the installed electron version — the dist pre-fetch and the mirror are skipped (tools still checked)"
fi

BINARIES="https://github.com/electron-userland/electron-builder-binaries/releases/download"
CACHE_DIST_SHA=""   # sha256 of the dist URL directory, for the @electron/get cache layout
case "$(uname -s)" in
  Linux)  CACHE_TOOLS="${ELECTRON_BUILDER_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/electron-builder}"; CACHE_DIST="${XDG_CACHE_HOME:-$HOME/.cache}/electron" ;;
  Darwin) CACHE_TOOLS="${ELECTRON_BUILDER_CACHE:-$HOME/Library/Caches/electron-builder}"; CACHE_DIST="$HOME/Library/Caches/electron" ;;
  *)      CACHE_TOOLS="${ELECTRON_BUILDER_CACHE:-$LOCALAPPDATA/electron-builder/Cache}"; CACHE_DIST="$LOCALAPPDATA/electron/Cache" ;;
esac

TMPBASE="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
SHASUMS="$TMPBASE/SHASUMS256-electron.txt"
MIRROR_ROOT="$TMPBASE/ci-electron-mirror"

# which dist zips this platform needs
case "$(uname -s)" in
  Linux)  REQUIRED_ARCHES="linux-x64" ;;
  Darwin) REQUIRED_ARCHES="darwin-x64 darwin-arm64" ;;
  *)      REQUIRED_ARCHES="win32-x64" ;;
esac

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

fetch() { # fetch <url> <dest> [expected-sha256]
  local url="$1" dest="$2" want="${3:-}"
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ]; then
    if [ -n "$want" ] && [ "$(sha256_of "$dest")" = "$want" ]; then echo "cached: $dest"; return 0; fi
  fi
  echo "fetching $(basename "$dest")"
  for attempt in 1 2 3 4 5; do
    curl -fL -C - --retry 8 --retry-delay 4 --retry-all-errors --connect-timeout 20 --max-time 1200 \
      -o "$dest" "$url" && break
    echo "attempt $attempt for $(basename "$dest") failed — resuming"
    sleep 5
  done
  if [ ! -f "$dest" ]; then echo "no file: $dest — leaving it to electron-builder"; return 0; fi
  if [ -n "$want" ] && [ "$(sha256_of "$dest")" != "$want" ]; then
    echo "checksum mismatch for $(basename "$dest") — removing; electron-builder will download it itself"
    rm -f "$dest"
    return 0
  fi
  echo "ok: $(basename "$dest")"
}

echo "pre-fetch for electron ${ELECTRON_VERSION:-unknown} (app $(node -p "require('./package.json').version"); tools: $CACHE_TOOLS, dist: $CACHE_DIST)"

# ---------- the Electron distribution zips (verified against the official SHASUMS256.txt)
shasums_ok=0
dist_ok=1
if [ -n "$ELECTRON_VERSION" ]; then
  BASE="https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}"
  if curl -fsSL --retry 12 --retry-delay 3 --retry-all-errors --connect-timeout 20 --max-time 120 \
        -o "$SHASUMS" "$BASE/SHASUMS256.txt"; then
    shasums_ok=1
    # the @electron/get cache folder is the sha256 of the directory URL
    CACHE_DIST_SHA=$(printf '%s' "$BASE" | { command -v sha256sum >/dev/null 2>&1 && sha256sum || shasum -a 256; } | awk '{print $1}')
    for arch in $REQUIRED_ARCHES; do
      file="electron-v${ELECTRON_VERSION}-${arch}.zip"
      want=$(awk -v f="$file" '$2 == f || $2 == "*" f { print $1 }' "$SHASUMS")
      if [ -z "$want" ]; then echo "no checksum recorded for $file — cannot verify; skipping"; dist_ok=0; continue; fi
      dest="$CACHE_DIST/$CACHE_DIST_SHA/$file"
      fetch "$BASE/$file" "$dest" "$want"
      [ -f "$dest" ] || dist_ok=0
    done
  else
    echo "SHASUMS256.txt unavailable — skipping the dist pre-fetch; electron-builder downloads it itself"
    dist_ok=0
  fi
else
  dist_ok=0
fi

# ---------- an all-or-nothing loopback mirror for the dist files (see the header comment)
rm -rf "$MIRROR_ROOT"
mkdir -p "$MIRROR_ROOT/v${ELECTRON_VERSION}"
if [ "$shasums_ok" = 1 ] && [ "$dist_ok" = 1 ]; then
  for arch in $REQUIRED_ARCHES; do
    cp "$CACHE_DIST/$CACHE_DIST_SHA/electron-v${ELECTRON_VERSION}-${arch}.zip" "$MIRROR_ROOT/v${ELECTRON_VERSION}/"
  done
  cp "$SHASUMS" "$MIRROR_ROOT/v${ELECTRON_VERSION}/SHASUMS256.txt"
  : > "$MIRROR_ROOT/READY"
  echo "loopback mirror is READY at $MIRROR_ROOT/v${ELECTRON_VERSION}"
  ls -la "$MIRROR_ROOT/v${ELECTRON_VERSION}"
else
  echo "mirror not built (dist fetch incomplete) — electron-builder will use its seeded cache or the network"
fi

# ---------- the tool archives (checksums pinned in electron-builder's source)
case "$(uname -s)" in
  Linux)
    # fpm builds the .deb; the AppImage target pulls the static runtime (zstd) at toolsets.appimage=1.0.3
    fetch "$BINARIES/fpm@2.1.4/fpm-1.17.0-ruby-3.4.3-linux-amd64.7z" \
      "$CACHE_TOOLS/fpm@2.1.4/fpm-1.17.0-ruby-3.4.3-linux-amd64.7z" \
      44b0ec6025c14ec137f56180e62675c0eae36233cdce53d0953d9c73ced8989f
    fetch "$BINARIES/appimage@1.0.3/appimage-tools-runtime-20251108.tar.gz" \
      "$CACHE_TOOLS/appimage@1.0.3/appimage-tools-runtime-20251108.tar.gz" \
      84021a78ee214ae6fd33a2d62a92ba25542dd10bc86bf117a9b2d0bba44e7665
    ;;
  Darwin)
    : # dmg and zip are made by macOS's own tools; no external archives needed
    ;;
  *)
    # legacy NSIS (default for this project) and the winCodeSign bundle
    fetch "$BINARIES/nsis-3.0.4.1/nsis-3.0.4.1.7z" \
      "$CACHE_TOOLS/nsis-3.0.4.1/nsis-3.0.4.1.7z" \
      9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa
    fetch "$BINARIES/winCodeSign-2.6.0/winCodeSign-2.6.0.7z" \
      "$CACHE_TOOLS/winCodeSign-2.6.0/winCodeSign-2.6.0.7z" \
      cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4
    ;;
esac
