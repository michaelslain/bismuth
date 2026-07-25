import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeRunRecord,
  readRunRecords,
  deleteRunRecord,
  resolveRunRegistryBase,
  runKey,
} from "../src/runRegistry";

// A pid that's essentially guaranteed to be free (mirrors core/test/daemon.test.ts's convention).
const DEAD_PID = 2147483646;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bismuth-run-"));
  process.env.BISMUTH_RUN_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.BISMUTH_RUN_DIR;
});

// readRunRecords now filters dead pids (see the liveness-filter tests below), so every test of the
// write/read/resolve MECHANICS (independent of that filter) uses this test process's own pid — the
// one pid guaranteed alive for the test's duration — rather than an arbitrary small int.
const PID = process.pid;

test("write then read a record", () => {
  writeRunRecord({ port: 4322, vault: "/v/one", pid: PID });
  const recs = readRunRecords();
  expect(recs).toHaveLength(1);
  expect(recs[0]).toEqual({ port: 4322, vault: "/v/one", pid: PID });
});

test("re-writing the same vault overwrites its record (stable filename)", () => {
  writeRunRecord({ port: 1, vault: "/v/one", pid: PID });
  writeRunRecord({ port: 2, vault: "/v/one", pid: PID });
  const recs = readRunRecords();
  expect(recs).toHaveLength(1);
  expect(recs[0].port).toBe(2);
  expect(runKey("/v/one")).toBe(Buffer.from("/v/one").toString("base64url"));
});

test("resolveRunRegistryBase: by vault, single-match, ambiguous", () => {
  expect(resolveRunRegistryBase()).toBeUndefined(); // none
  writeRunRecord({ port: 4322, vault: "/v/one", pid: PID });
  expect(resolveRunRegistryBase()).toBe("http://localhost:4322"); // single → that one
  expect(resolveRunRegistryBase("/v/one")).toBe("http://localhost:4322");
  expect(resolveRunRegistryBase("/v/missing")).toBeUndefined();
  writeRunRecord({ port: 4323, vault: "/v/two", pid: PID });
  expect(resolveRunRegistryBase()).toBeUndefined(); // ambiguous, no vault
  expect(resolveRunRegistryBase("/v/two")).toBe("http://localhost:4323"); // exact still resolves
});

test("delete removes a record", () => {
  writeRunRecord({ port: 1, vault: "/v/one", pid: PID });
  deleteRunRecord("/v/one");
  expect(readRunRecords()).toHaveLength(0);
});

test("missing dir + malformed files are tolerated (never throws)", () => {
  delete process.env.BISMUTH_RUN_DIR;
  process.env.BISMUTH_RUN_DIR = join(dir, "does-not-exist");
  expect(readRunRecords()).toEqual([]);
});

test("a zero-record dir reads as an empty list without throwing", () => {
  expect(readRunRecords()).toEqual([]);
});

test("a malformed JSON file is skipped without throwing, and a truly empty registry still works", () => {
  writeFileSync(join(dir, "broken.json"), "not json{{{");
  expect(() => readRunRecords()).not.toThrow();
  expect(readRunRecords()).toEqual([]);
});

test("readRunRecords filters a dead-pid record and prunes it from disk", () => {
  writeRunRecord({ port: 4322, vault: "/v/one", pid: DEAD_PID });
  expect(readRunRecords()).toEqual([]);
  // Pruned opportunistically — the file is gone, not just filtered from the return value.
  expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toEqual([]);
});

test("readRunRecords keeps a record with a live pid", () => {
  writeRunRecord({ port: 4322, vault: "/v/one", pid: process.pid });
  const recs = readRunRecords();
  expect(recs).toHaveLength(1);
  expect(recs[0]).toEqual({ port: 4322, vault: "/v/one", pid: process.pid });
});

test("readRunRecords filters a temp-path vault (leaked by a killed test server) and prunes it", () => {
  const tempVault = mkdtempSync(join(tmpdir(), "bismuth-vault-"));
  try {
    writeRunRecord({ port: 4322, vault: tempVault, pid: process.pid }); // pid alive, but vault is a temp dir
    expect(readRunRecords()).toEqual([]);
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toEqual([]);
  } finally {
    rmSync(tempVault, { recursive: true, force: true });
  }
});

test("readRunRecords keeps a live-pid, real-path record alongside pruning a dead one", () => {
  writeRunRecord({ port: 1, vault: "/v/dead", pid: DEAD_PID });
  writeRunRecord({ port: 2, vault: "/v/alive", pid: process.pid });
  const recs = readRunRecords();
  expect(recs).toEqual([{ port: 2, vault: "/v/alive", pid: process.pid }]);
});

test("a malformed-shape record (wrong field types) is skipped without being pruned from disk", () => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "weird.json"), JSON.stringify({ port: "not-a-number", vault: 123 }));
  expect(readRunRecords()).toEqual([]);
  // Conservative: an unrecognized shape is left alone rather than deleted.
  expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toContain("weird.json");
});
