import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { findWallpaperIn, previewOf } from "./steam-wallpaper-core.ts";

/** A workshop library folder is made by hand in a temp dir; nothing here touches Steam or Electron. */
function library(setup: (dir: string, root: string) => void) {
  const lib = mkdtempSync(join(tmpdir(), "we-lib-"));
  const root = join(lib, "steamapps", "workshop", "content", "431960", "777000111");
  mkdirSync(root, { recursive: true });
  setup(root, lib);
  const deps = { libraries: async () => [lib], allowImport: (p: string) => `scbg://import/test/${basename(p)}` };
  return { lib, deps, cleanup: () => rmSync(lib, { recursive: true, force: true }) };
}

const project = (dir: string, data: unknown) => writeFileSync(join(dir, "project.json"), typeof data === "string" ? data : JSON.stringify(data));

test("a scene with a preview in project.json is offered as an image", async () => {
  const { deps, cleanup } = library((dir) => {
    project(dir, { type: "scene", file: "scene.json", title: "Night City", preview: "preview.gif" });
    writeFileSync(join(dir, "scene.pkg"), Buffer.alloc(1024));
    writeFileSync(join(dir, "preview.gif"), Buffer.alloc(4096));
  });
  try {
    const found = await findWallpaperIn("777000111", deps);
    assert.equal(found.found, true);
    if (found.found) {
      assert.equal(found.kind, "image");
      assert.equal(found.title, "Night City");
      assert.ok(found.url.startsWith("scbg://import/test/preview.gif"));
    }
  } finally {
    cleanup();
  }
});

test("a web wallpaper without one falls back to a preview.* in the folder", async () => {
  const { deps, cleanup } = library((dir) => {
    project(dir, { type: "web", file: "index.html", title: "Web one" });
    writeFileSync(join(dir, "index.html"), "<html></html>");
    writeFileSync(join(dir, "preview.webp"), Buffer.alloc(2048));
  });
  try {
    const found = await findWallpaperIn("777000111", deps);
    assert.equal(found.found, true);
    if (found.found) assert.equal(found.kind, "image");
  } finally {
    cleanup();
  }
});

test("a scene whose preview is a bmp (not a background format) is refused as no-preview", async () => {
  const { deps, cleanup } = library((dir) => {
    project(dir, { type: "scene", file: "scene.json", title: "Bmp scene", preview: "preview.bmp" });
    writeFileSync(join(dir, "scene.pkg"), Buffer.alloc(1024));
    writeFileSync(join(dir, "preview.bmp"), Buffer.alloc(2048));
  });
  try {
    const found = await findWallpaperIn("777000111", deps);
    assert.deepEqual(found, { found: false, id: "777000111", reason: "no-preview" });
  } finally {
    cleanup();
  }
});

test("a preview escaping the workshop folder is never used", async () => {
  const { lib, deps, cleanup } = library((dir) => {
    project(dir, { type: "scene", file: "scene.json", preview: "../../secret.png" });
    // the escape target exists on disk, it just isn't the item's own file
    writeFileSync(join(dir, "..", "..", "secret.png"), Buffer.alloc(8));
  });
  try {
    const root = join(lib, "steamapps", "workshop", "content", "431960", "777000111");
    assert.equal(previewOf(root, "../../secret.png"), null);
    const found = await findWallpaperIn("777000111", deps);
    assert.deepEqual(found, { found: false, id: "777000111", reason: "no-preview" });
  } finally {
    cleanup();
  }
});

test("a video wallpaper still resolves like before, tagged kind video", async () => {
  const { deps, cleanup } = library((dir) => {
    project(dir, { type: "video", file: "wall.mp4", title: "Video one" });
    writeFileSync(join(dir, "wall.mp4"), Buffer.alloc(3 * 1024 * 1024));
  });
  try {
    const found = await findWallpaperIn("777000111", deps);
    assert.equal(found.found, true);
    if (found.found) {
      assert.equal(found.kind, "video");
      assert.equal(found.sizeMb, 3);
    }
  } finally {
    cleanup();
  }
});

test("an application wallpaper is refused as not-video; a broken project.json is skipped as missing", async () => {
  const appWallpaper = library((dir) => project(dir, { type: "application", file: "wall.exe", title: "App" }));
  try {
    assert.deepEqual(await findWallpaperIn("777000111", appWallpaper.deps), { found: false, id: "777000111", reason: "not-video" });
  } finally {
    appWallpaper.cleanup();
  }
  const broken = library((dir) => project(dir, "{ not json"));
  try {
    assert.deepEqual(await findWallpaperIn("777000111", broken.deps), { found: false, id: "777000111", reason: "missing" });
  } finally {
    broken.cleanup();
  }
});
