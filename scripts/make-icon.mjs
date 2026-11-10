// Renders Moonwave's icons. The app icon (assets/app-icon.png, 1024×1024 with its rounded corners already clear) becomes
// build/icon.png, 512×512, which electron-builder turns into the Windows .ico and the macOS .icns; the window, taskbar
// and tray use a 256 px copy (resources/icon.png). The title bar draws assets/app-icon-small.svg, the same picture in
// flat shapes, because the painted icon turns to mush at 20 px. Run: node scripts/make-icon.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

mkdirSync("build", { recursive: true });
await sharp("assets/app-icon.png").resize(512, 512, { kernel: "lanczos3" }).png().toFile("build/icon.png");
// the window and the tray (bundled with main)
mkdirSync("resources", { recursive: true });
await sharp("assets/app-icon.png").resize(256, 256, { kernel: "lanczos3" }).png().toFile("resources/icon.png");
console.log("build/icon.png, resources/icon.png");

// the macOS menu bar: a black-on-clear "template" (macOS colours it), 16 pt and its @2x
await sharp("assets/tray-template.svg", { density: 600 }).resize(16, 16).png().toFile("resources/trayTemplate.png");
await sharp("assets/tray-template.svg", { density: 1200 }).resize(32, 32).png().toFile("resources/trayTemplate@2x.png");
console.log("resources/trayTemplate.png, @2x");

// the taskbar thumbnail buttons (⏮ ⏯ ⏭), 16 px and 32 px for scaled displays
for (const name of ["play", "pause", "next", "previous"]) {
  await sharp(`assets/thumbar/${name}.svg`, { density: 600 }).resize(16, 16).png().toFile(`resources/thumb-${name}.png`);
  await sharp(`assets/thumbar/${name}.svg`, { density: 1200 }).resize(32, 32).png().toFile(`resources/thumb-${name}@2x.png`);
}
console.log("resources/thumb-*.png");
