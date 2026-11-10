// Renders the readme's badges to .github/assets/badges/*.svg. They live in the repository instead of being linked from
// img.shields.io: GitHub's image proxy gives an outside badge a few seconds, and shields often missed that, so the
// readme showed broken images. These are static, so nothing here can go stale except the colours.
// Run once after changing them: npm i --no-save badge-maker && node scripts/make-badges.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { makeBadge } from "badge-maker";

// the icon's night sky and sea (assets/app-icon-small.svg)
const NIGHT = "#0b1240";
const SEA = "#1d8e9b";
const badges = {
  download: { label: "скачать", message: "Moonwave", style: "for-the-badge" },
  windows: { label: "Windows", message: "10 / 11" },
  macos: { label: "macOS", message: "13+" },
  linux: { label: "Linux", message: "AppImage / deb" },
  license: { label: "лицензия", message: "GPL-3.0" },
};

mkdirSync(".github/assets/badges", { recursive: true });
for (const [name, b] of Object.entries(badges)) {
  writeFileSync(`.github/assets/badges/${name}.svg`, makeBadge({ style: "flat-square", labelColor: NIGHT, color: SEA, ...b }));
}
console.log(Object.keys(badges).map((n) => `.github/assets/badges/${n}.svg`).join("\n"));
