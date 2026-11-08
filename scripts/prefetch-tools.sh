#!/bin/bash
# Pre-fetch the large, immutable files the packaging step downloads, so a flaky or throttled
# github.com asset backend (HTTP 504s all day on 2026-11-08) cannot kill the build.
#
# What gets fetched depends on the host platform:
#   linux:   electron dist zip, the fpm deb toolchain, the AppImage tools runtime (pinned toolsets.appimage=1.0.3)
#   windows: electron dist zip, the NSIS installer toolchain, the winCodeSign archive
#   macOS:   electron dist zips for both arches (arm64 + x64)
#
# The trust model — deliberately strict, no shortcuts:
#   * The ONLY acceptable integrity anchor for the Electron dist is an official one, obtained in
#     descending order of preference:
#       1. the release's SHASUMS256.txt (raced on two transports, format-validated);
#       2. the server-side sha256 `digest` GitHub computes for each release asset, served by the
#          releases API (same first-party backend, same bytes the CDN ships) — a minimal
#          checksum file covering exactly the required zips is generated from them;
#     If NEITHER is available, the dist is left unverified: the mirror is NOT built, nothing is
#     seeded into the @electron/get cache, and electron-builder falls back to its own download +
#     validation exactly as if this step never ran. (The build itself is additionally shielded by
#     the checksums pinned in package.json → build.electronDownload, which make electron-builder's
#     validation fully offline; see the commit that introduced them.)
#   * The zips are downloaded in PARALLEL with the checksum race (they do flow through the CDN even
#     while SHASUMS256.txt 504s), but they are staged in a temp directory and are ONLY accepted after
#     their SHA-256 matches the official SHASUMS256.txt. Files that fail verification are deleted.
#   * The tool archives' checksums are pinned inline (from electron-builder's own source).
#
# When everything verifies, two artifacts are produced:
#   1. the @electron/get cache is seeded (<builder cache>/<sha256(dirUrl)>/<file>) — a fallback
#      if the mirror is not used;
#   2. an all-or-nothing loopback mirror under ${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ci-electron-mirror/v<ver>/
#      with the zips and the official SHASUMS256.txt. CI starts scripts/serve-static.mjs on 127.0.0.1
#      and exports ELECTRON_MIRROR=http://127.0.0.1:8137/ for the packaging step, so electron-builder's
#      dist download AND its mandatory fresh SHASUMS256.txt fetch (never cached, even on a full cache
#      hit) are served from loopback. sumchecker re-validates the zip against the same official file.
#      No TLS setting is touched anywhere; the server binds 127.0.0.1 only.
set -u

# ---------- the Electron version — NOT the application version (package.json's `version` is the app itself)
ELECTRON_VERSION="$(node -p "try { require('./node_modules/electron/package.json').version } catch { '' }" 2>/dev/null)"
if ! printf '%s' "$ELECTRON_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  ELECTRON_VERSION="$(node -p "const p=require('./package.json'); ((p.devDependencies||{}).electron || (p.dependencies||{}).electron || '').replace(/^[^0-9]*/, '')" 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+')"
fi
if [ -z "$ELECTRON_VERSION" ]; then
  echo "cannot determine the installed electron version — the dist pre-fetch and the mirror are skipped (tools still checked)"
fi

BINARIES="https://github.com/electron-userland/electron-builder-binaries/releases/download"
case "$(uname -s)" in
  Linux)  CACHE_TOOLS="${ELECTRON_BUILDER_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/electron-builder}"; CACHE_DIST="${XDG_CACHE_HOME:-$HOME/.cache}/electron" ;;
  Darwin) CACHE_TOOLS="${ELECTRON_BUILDER_CACHE:-$HOME/Library/Caches/electron-builder}"; CACHE_DIST="$HOME/Library/Caches/electron" ;;
  *)      CACHE_TOOLS="${ELECTRON_BUILDER_CACHE:-$LOCALAPPDATA/electron-builder/Cache}"; CACHE_DIST="$LOCALAPPDATA/electron/Cache" ;;
esac

TMPBASE="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
SHASUMS="$TMPBASE/SHASUMS256-electron.txt"
MIRROR_ROOT="$TMPBASE/ci-electron-mirror"
STAGE="$TMPBASE/ci-electron-mirror.staging"
# how long (seconds) to keep racing SHASUMS256.txt — it is tiny and single-point, so race hard but bounded
SHASUMS_BUDGET="${PREFETCH_SHASUMS_BUDGET:-420}"

case "$(uname -s)" in
  Linux)  REQUIRED_ARCHES="linux-x64" ;;
  Darwin) REQUIRED_ARCHES="darwin-x64 darwin-arm64" ;;
  *)      REQUIRED_ARCHES="win32-x64" ;;
esac

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

fetch() { # fetch <url> <dest> [expected-sha256] — for the tool archives (pinned sums)
  local url="$1" dest="$2" want="${3:-}"
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ]; then
    if [ -n "$want" ] && [ "$(sha256_of "$dest")" = "$want" ]; then echo "cached: $dest"; return 0; fi
  fi
  echo "fetching $(basename "$dest")"
  for attempt in 1 2 3 4 5; do
    curl -fL --retry 6 --retry-delay 4 --retry-all-errors --connect-timeout 20 --max-time 1200 \
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

# the SHASUMS file is trusted only if it looks like one: every non-empty line is exactly
# '<64 lowercase hex><space>[*]<filename>' and each required zip has an entry. (awk length(),
# not an {n} interval — mawk and BSD awk do not support intervals)
valid_shasums() {
  awk 'NF && (length($1) != 64 || $1 !~ /^[0-9a-f]+$/) { bad=1 } END { exit bad+0 }' "$1" || return 1
  for arch in $REQUIRED_ARCHES; do
    grep -qE "^[0-9a-f]{64}[[:space:]]+\*?electron-v${ELECTRON_VERSION}-${arch}\.zip$" "$1" || return 1
  done
  return 0
}

echo "pre-fetch for electron ${ELECTRON_VERSION:-unknown} (app $(node -p "require('./package.json').version"); tools: $CACHE_TOOLS, dist: $CACHE_DIST)"

# ---------- the Electron distribution zips

rm -f "$SHASUMS" "$SHASUMS.tmp"
rm -rf "$STAGE"
mkdir -p "$STAGE"

if [ -n "$ELECTRON_VERSION" ]; then
  BASE="https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}"

  # 1) start the zip downloads in the background — they do flow even while the checksum file 504s
  zip_pids=""
  for arch in $REQUIRED_ARCHES; do
    ( for attempt in 1 2 3 4 5 6; do
        curl -fL --retry 4 --retry-delay 2 --retry-all-errors --connect-timeout 20 --max-time 900 \
          -o "$STAGE/electron-v${ELECTRON_VERSION}-${arch}.zip" "$BASE/electron-v${ELECTRON_VERSION}-${arch}.zip" && exit 0
        echo "zip attempt $attempt for $arch failed — resuming"
        sleep 3
      done
      exit 1 ) &
    zip_pids="$zip_pids $!"
  done

  # 2) race SHASUMS256.txt — the single-point-of-failure file; try the CDN and (with a token) the asset API
  ASSET_ID=""
  if [ -n "${GH_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
    ASSET_ID="$(gh api "repos/electron/electron/releases/tags/v${ELECTRON_VERSION}" --jq '.assets[] | select(.name=="SHASUMS256.txt") | .id' 2>/dev/null || true)"
    echo "SHASUMS256.txt asset id: ${ASSET_ID:-unavailable}"
  fi
  shasums_deadline=$((SECONDS + SHASUMS_BUDGET))
  tries=0
  while [ "$SECONDS" -lt "$shasums_deadline" ] && [ ! -s "$SHASUMS" ]; do
    tries=$((tries + 1))
    # the release asset, straight from github.com — accepted only if it passes format validation
    if curl -fsSL --connect-timeout 10 --max-time 30 --retry 0 -o "$SHASUMS.tmp" "$BASE/SHASUMS256.txt" 2>/dev/null \
      && [ -s "$SHASUMS.tmp" ] && valid_shasums "$SHASUMS.tmp"; then
      mv "$SHASUMS.tmp" "$SHASUMS" && break
    fi
    # the same official asset via the release-assets API — second, independent transport (needs a token)
    if [ -n "$ASSET_ID" ]; then
      if gh api -H "Accept: application/octet-stream" "repos/electron/electron/releases/assets/$ASSET_ID" > "$SHASUMS.tmp" 2>/dev/null \
        && [ -s "$SHASUMS.tmp" ] && valid_shasums "$SHASUMS.tmp"; then
        mv "$SHASUMS.tmp" "$SHASUMS" && break
      fi
    fi
    rm -f "$SHASUMS.tmp"
    sleep 2
  done
  echo "SHASUMS256.txt: ${tries} attempt(s), $([ -f "$SHASUMS" ] && echo fetched || echo 'NOT FETCHED')"

  # 3) collect the zip downloads
  for pid in $zip_pids; do
    wait "$pid" || echo "a zip download did not finish — that arch will be left to electron-builder"
  done

  # 4) verify and stage only what matches the official checksums
  CACHE_DIST_SHA=""
  if [ ! -f "$SHASUMS" ] && [ -n "${GH_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
    # fallback anchor: GitHub computes a sha256 digest for every release asset server-side and the
    # releases API serves it; build a minimal checksum file from the assets (same first-party bytes).
    GEN_SUMS="$TMPBASE/SHASUMS256-generated.txt"
    if gh api "repos/electron/electron/releases/tags/v${ELECTRON_VERSION}" --jq '.assets[] | select(.digest != null) | (.digest | sub("^sha256:"; "")) + " *" + .name' > "$GEN_SUMS" 2>/dev/null \
      && [ -s "$GEN_SUMS" ] && valid_shasums "$GEN_SUMS"; then
      SHASUMS="$GEN_SUMS"
      echo "integrity anchor: server-side asset digests via the releases API"
    else
      rm -f "$GEN_SUMS"
      echo "no integrity anchor available (SHASUMS256.txt unreachable and the asset digests unusable) — dist stays unverified"
    fi
  fi
  if [ -f "$SHASUMS" ]; then
    CACHE_DIST_SHA=$(printf '%s' "$BASE" | { command -v sha256sum >/dev/null 2>&1 && sha256sum || shasum -a 256; } | awk '{print $1}')
  fi
  rm -rf "$MIRROR_ROOT"
  mkdir -p "$MIRROR_ROOT/v${ELECTRON_VERSION}"
  mirror_ok=1
  for arch in $REQUIRED_ARCHES; do
    file="electron-v${ELECTRON_VERSION}-${arch}.zip"
    want=""
    if [ -n "$CACHE_DIST_SHA" ]; then want=$(awk -v f="$file" '$2 == f || $2 == "*" f { print $1 }' "$SHASUMS"); fi
    src="$STAGE/$file"
    if [ -n "$want" ] && [ -f "$src" ] && [ "$(sha256_of "$src")" = "$want" ]; then
      mkdir -p "$CACHE_DIST/$CACHE_DIST_SHA"
      cp "$src" "$CACHE_DIST/$CACHE_DIST_SHA/$file"
      cp "$src" "$MIRROR_ROOT/v${ELECTRON_VERSION}/$file"
      echo "ok: $file"
    else
      if [ -f "$src" ]; then echo "unverified: $file — removing"; rm -f "$src"; else echo "missing: $file"; fi
      mirror_ok=0
    fi
  done

  if [ "$mirror_ok" = 1 ] && [ -f "$SHASUMS" ]; then
    cp "$SHASUMS" "$MIRROR_ROOT/v${ELECTRON_VERSION}/SHASUMS256.txt"
    : > "$MIRROR_ROOT/READY"
    echo "loopback mirror is READY at $MIRROR_ROOT/v${ELECTRON_VERSION}"
    ls -la "$MIRROR_ROOT/v${ELECTRON_VERSION}"
  else
    rm -rf "$MIRROR_ROOT"
    echo "mirror not built (dist unverified or incomplete) — electron-builder will use the network, as before"
  fi
  rm -rf "$STAGE"
else
  echo "dist pre-fetch skipped (no electron version)"
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

# the icon conversion toolset (Windows exe icon, ICNS/PNG conversion wherever electron-builder needs it) — the
# release that serves icons-bundle.tar.gz, pinned checksum from electron-builder's toolsets/icons.js; without it
# packaging dies AFTER the electron step with a 504 on this file
fetch "$BINARIES/icons@1.1.0/icons-bundle.tar.gz" \
  "$CACHE_TOOLS/icons@1.1.0/icons-bundle.tar.gz" \
  2241c9501aa5ddd19317956449f50a1bc311df2c34058aae9bf8bfe62081eaec
