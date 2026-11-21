import assert from "node:assert/strict";
import { test } from "node:test";
import { enterMiniGeometry, type MiniWindowGeometry } from "./mini-window-geometry.ts";

function nativeWindow() {
  const calls: string[] = [];
  let resizable = true;
  let size = [1240, 800];
  let min = [900, 600];
  const win: MiniWindowGeometry = {
    unmaximize: () => { calls.push("unmaximize"); },
    setResizable: (value) => {
      calls.push(`resizable:${value}`);
      resizable = value;
      if (!value) min = [...size]; // Windows locks the current dimensions
    },
    setMaximizable: (value) => { calls.push(`maximizable:${value}`); },
    setMinimumSize: (width, height) => { calls.push("minimum"); min = [width, height]; },
    setSize: (width, height) => {
      calls.push("size");
      if (resizable && width >= min[0]! && height >= min[1]!) size = [width, height];
    },
  };
  return { win, calls, get size() { return size; }, get resizable() { return resizable; } };
}

test("mini window resizes before locking on Windows", () => {
  const fake = nativeWindow();
  enterMiniGeometry(fake.win, false);
  assert.deepEqual(fake.size, [480, 200]);
  assert.equal(fake.resizable, false);
  assert.ok(fake.calls.indexOf("size") < fake.calls.indexOf("resizable:false"));
  assert.equal(fake.calls.includes("unmaximize"), false);
});

test("maximized window is restored before entering mini mode", () => {
  const fake = nativeWindow();
  enterMiniGeometry(fake.win, true);
  assert.equal(fake.calls[0], "unmaximize");
  assert.deepEqual(fake.size, [480, 200]);
});
