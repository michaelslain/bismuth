import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeRunRecord,
  readRunRecords,
  deleteRunRecord,
  resolveRunRegistryBase,
  runKey,
} from "../src/runRegistry";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bismuth-run-"));
  process.env.BISMUTH_RUN_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.BISMUTH_RUN_DIR;
});

test("write then read a record", () => {
  writeRunRecord({ port: 4322, vault: "/v/one", pid: 111 });
  const recs = readRunRecords();
  expect(recs).toHaveLength(1);
  expect(recs[0]).toEqual({ port: 4322, vault: "/v/one", pid: 111 });
});

test("re-writing the same vault overwrites its record (stable filename)", () => {
  writeRunRecord({ port: 1, vault: "/v/one", pid: 1 });
  writeRunRecord({ port: 2, vault: "/v/one", pid: 2 });
  const recs = readRunRecords();
  expect(recs).toHaveLength(1);
  expect(recs[0].port).toBe(2);
  expect(runKey("/v/one")).toBe(Buffer.from("/v/one").toString("base64url"));
});

test("resolveRunRegistryBase: by vault, single-match, ambiguous", () => {
  expect(resolveRunRegistryBase()).toBeUndefined(); // none
  writeRunRecord({ port: 4322, vault: "/v/one", pid: 1 });
  expect(resolveRunRegistryBase()).toBe("http://localhost:4322"); // single → that one
  expect(resolveRunRegistryBase("/v/one")).toBe("http://localhost:4322");
  expect(resolveRunRegistryBase("/v/missing")).toBeUndefined();
  writeRunRecord({ port: 4323, vault: "/v/two", pid: 2 });
  expect(resolveRunRegistryBase()).toBeUndefined(); // ambiguous, no vault
  expect(resolveRunRegistryBase("/v/two")).toBe("http://localhost:4323"); // exact still resolves
});

test("delete removes a record", () => {
  writeRunRecord({ port: 1, vault: "/v/one", pid: 1 });
  deleteRunRecord("/v/one");
  expect(readRunRecords()).toHaveLength(0);
});

test("missing dir + malformed files are tolerated (never throws)", () => {
  delete process.env.BISMUTH_RUN_DIR;
  process.env.BISMUTH_RUN_DIR = join(dir, "does-not-exist");
  expect(readRunRecords()).toEqual([]);
});
