import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { JsonFile } from "./json-file.ts";

interface Doc {
  volume: number;
  name: string;
}

const defaults: Doc = { volume: 1, name: "none" };
const folder = () => mkdtempSync(join(tmpdir(), "moonwave-json-"));

test("a damaged file reads as the defaults, is kept aside, and the next write leaves a valid file", () => {
  const dir = folder();
  const path = join(dir, "settings.json");
  const damaged = '{"volume": 0.5, oops';
  writeFileSync(path, damaged);
  const said: string[] = [];

  const file = new JsonFile<Doc>(path, defaults, 5, (m) => said.push(m));

  assert.deepEqual(file.get(), defaults, "a file that doesn't parse falls back to the defaults");
  const kept = readdirSync(dir).filter((f) => f.startsWith("settings.json.bad-"));
  assert.equal(kept.length, 1, "the damaged file is kept as a .bad- copy");
  assert.equal(readFileSync(join(dir, kept[0]!), "utf8"), damaged, "the copy is byte for byte the old file");
  assert.equal(said.length, 1, "the loss is logged");
  assert.match(said[0]!, /damaged/);

  file.patch({ volume: 0.25 });
  file.flush();

  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { volume: 0.25, name: "none" });
});

test("no file at all is a first run: defaults, no .bad copy, nothing logged", () => {
  const dir = folder();
  const path = join(dir, "settings.json");
  const said: string[] = [];

  const file = new JsonFile<Doc>(path, defaults, 5, (m) => said.push(m));

  assert.deepEqual(file.get(), defaults);
  assert.deepEqual(readdirSync(dir), [], "nothing is written or kept aside before the first change");
  assert.deepEqual(said, []);

  file.patch({ name: "first" });
  file.flush();
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { volume: 1, name: "first" });
});

test("a failed write keeps the change in memory, is logged, and is retried", async () => {
  const dir = folder();
  const path = join(dir, "likes.json");
  const said: string[] = [];
  const file = new JsonFile<Doc>(path, defaults, 5, (m) => said.push(m));
  // a folder where the temporary file goes: writeFileSync fails, as it would on a full or read-only disk
  mkdirSync(`${path}.tmp`);

  file.patch({ volume: 0.1 });
  await sleep(30);

  assert.equal(file.get().volume, 0.1, "the change is still here, not dropped by the failed write");
  assert.ok(
    said.some((m) => /writing .* failed/.test(m)),
    `the failure is logged: ${JSON.stringify(said)}`,
  );
  assert.equal(existsSync(path), false);

  rmSync(`${path}.tmp`, { recursive: true, force: true });
  await sleep(60);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { volume: 0.1, name: "none" }, "the retry writes it once the disk lets it");
  file.flush();
});
