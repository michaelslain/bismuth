import { test, expect, afterEach } from "bun:test";
import {
  daemonTools,
  daemonEnabled,
  daemonVaultRoot,
  isDaemonTool,
  daemonCliArgs,
} from "../src/daemon";

// The daemon tools mirror what the former standalone claude-bot MCP exposed (crons,
// processes, the daemon inbox/pages, daemon status + device ownership), restored as
// daemon-GATED tools that bridge the existing `bismuth` CLI. These tests pin the gate
// (they appear ONLY when the daemon is enabled) and the exact CLI invocation each maps to.

const MEM = process.env.BISMUTH_MEMORY_DIR;
const VAULT = process.env.BISMUTH_VAULT;

afterEach(() => {
  // Restore the ambient env so tests don't leak into each other / the wider `bun test` run.
  if (MEM === undefined) delete process.env.BISMUTH_MEMORY_DIR;
  else process.env.BISMUTH_MEMORY_DIR = MEM;
  if (VAULT === undefined) delete process.env.BISMUTH_VAULT;
  else process.env.BISMUTH_VAULT = VAULT;
});

// ── gating ────────────────────────────────────────────────────────────────────

test("daemon tools are gated: hidden without BISMUTH_MEMORY_DIR, shown with it", () => {
  delete process.env.BISMUTH_MEMORY_DIR;
  expect(daemonEnabled()).toBe(false);

  process.env.BISMUTH_MEMORY_DIR = "/vault/.daemon/memory";
  expect(daemonEnabled()).toBe(true);

  // The exact set the server appends when the gate is on.
  expect(daemonTools.map((t) => t.name)).toEqual([
    "daemon_status",
    "daemon_devices",
    "daemon_owner",
    "daemon_list",
    "cron_run",
    "cron_toggle",
    "process_toggle",
    "page_list",
    "page_create",
    "page_resolve",
  ]);
});

test("isDaemonTool recognizes exactly the daemon tools", () => {
  for (const t of daemonTools) expect(isDaemonTool(t.name)).toBe(true);
  expect(isDaemonTool("bismuth_cli")).toBe(false);
  expect(isDaemonTool("remember")).toBe(false);
  expect(isDaemonTool("nope")).toBe(false);
});

test("every daemon tool has a valid object inputSchema (raw JSON Schema, no zod)", () => {
  for (const t of daemonTools) {
    expect(typeof t.name).toBe("string");
    expect(typeof t.description).toBe("string");
    expect(t.inputSchema.type).toBe("object");
  }
});

// ── vault-root derivation ──────────────────────────────────────────────────────

test("daemonVaultRoot derives the vault from BISMUTH_MEMORY_DIR (strips /.daemon/memory)", () => {
  process.env.BISMUTH_MEMORY_DIR = "/Users/me/vault/.daemon/memory";
  delete process.env.BISMUTH_VAULT;
  expect(daemonVaultRoot()).toBe("/Users/me/vault");

  // Trailing slash tolerated.
  process.env.BISMUTH_MEMORY_DIR = "/Users/me/vault/.daemon/memory/";
  expect(daemonVaultRoot()).toBe("/Users/me/vault");
});

test("daemonVaultRoot falls back to BISMUTH_VAULT, else null", () => {
  delete process.env.BISMUTH_MEMORY_DIR;
  process.env.BISMUTH_VAULT = "/explicit/vault";
  expect(daemonVaultRoot()).toBe("/explicit/vault");

  delete process.env.BISMUTH_VAULT;
  expect(daemonVaultRoot()).toBeNull();

  // A memory dir that isn't the .daemon/memory shape falls through to BISMUTH_VAULT.
  process.env.BISMUTH_MEMORY_DIR = "/weird/mem";
  process.env.BISMUTH_VAULT = "/fallback";
  expect(daemonVaultRoot()).toBe("/fallback");
});

// ── name → CLI argv mapping (the bridge to the existing `bismuth` CLI) ───────────

const V = "/vault";

test("machine-level tools map to daemon status/devices/owner (no --vault needed)", () => {
  expect(daemonCliArgs("daemon_status", {}, V)).toEqual(["daemon", "status", "--pretty"]);
  expect(daemonCliArgs("daemon_devices", {}, V)).toEqual(["daemon", "devices", "--pretty"]);
  // owner: read vs claim
  expect(daemonCliArgs("daemon_owner", {}, V)).toEqual(["daemon", "owner", "--pretty"]);
  expect(daemonCliArgs("daemon_owner", { device: "dev-1" }, V)).toEqual([
    "daemon", "owner", "dev-1", "--pretty",
  ]);
});

test("daemon_list maps to the vault's daemon graph (crons + processes)", () => {
  expect(daemonCliArgs("daemon_list", {}, V)).toEqual([
    "daemon", "graph", "--vault", V, "--pretty",
  ]);
});

test("cron tools map to daemon cron run / toggle", () => {
  expect(daemonCliArgs("cron_run", { name: "dream" }, V)).toEqual([
    "daemon", "cron", "run", "dream", "--vault", V,
  ]);
  // enable (default) vs disable
  expect(daemonCliArgs("cron_toggle", { name: "dream" }, V)).toEqual([
    "daemon", "cron", "toggle", "dream", "--vault", V,
  ]);
  expect(daemonCliArgs("cron_toggle", { name: "dream", enabled: false }, V)).toEqual([
    "daemon", "cron", "toggle", "dream", "--vault", V, "--off",
  ]);
  // enabled:true is the default → no --off
  expect(daemonCliArgs("cron_toggle", { name: "dream", enabled: true }, V)).toEqual([
    "daemon", "cron", "toggle", "dream", "--vault", V,
  ]);
});

test("process_toggle maps to daemon process toggle", () => {
  expect(daemonCliArgs("process_toggle", { name: "watcher" }, V)).toEqual([
    "daemon", "process", "toggle", "watcher", "--vault", V,
  ]);
  expect(daemonCliArgs("process_toggle", { name: "watcher", enabled: false }, V)).toEqual([
    "daemon", "process", "toggle", "watcher", "--vault", V, "--off",
  ]);
});

test("page tools map to page list / create / resolve", () => {
  expect(daemonCliArgs("page_list", {}, V)).toEqual(["page", "list", "--vault", V, "--pretty"]);

  // minimal create
  expect(daemonCliArgs("page_create", { slug: "hello" }, V)).toEqual([
    "page", "create", "hello", "--vault", V, "--pretty",
  ]);

  // full create — actions array is JSON-stringified for the CLI's --actions '<json>'
  const actions = [{ id: "ok", label: "Approve", prompt: "do it" }];
  expect(
    daemonCliArgs(
      "page_create",
      { slug: "hi", title: "Hi", body: "body", actions, source: "cron:x", deliver_at: "2026-01-01T00:00:00Z" },
      V,
    ),
  ).toEqual([
    "page", "create", "hi", "--vault", V,
    "--title", "Hi",
    "--body", "body",
    "--actions", JSON.stringify(actions),
    "--source", "cron:x",
    "--deliver-at", "2026-01-01T00:00:00Z",
    "--pretty",
  ]);

  // an already-stringified actions value is passed through unchanged
  expect(daemonCliArgs("page_create", { slug: "s", actions: "[]" }, V)).toEqual([
    "page", "create", "s", "--vault", V, "--actions", "[]", "--pretty",
  ]);

  expect(daemonCliArgs("page_resolve", { path: ".daemon/pages/x.md", action: "ok" }, V)).toEqual([
    "page", "resolve", ".daemon/pages/x.md", "ok", "--vault", V, "--pretty",
  ]);
});

// ── validation ──────────────────────────────────────────────────────────────────

test("a missing required arg throws (server turns it into an isError result)", () => {
  expect(() => daemonCliArgs("cron_run", {}, V)).toThrow("'name' is required");
  expect(() => daemonCliArgs("cron_toggle", {}, V)).toThrow("'name' is required");
  expect(() => daemonCliArgs("process_toggle", {}, V)).toThrow("'name' is required");
  expect(() => daemonCliArgs("page_create", {}, V)).toThrow("'slug' is required");
  expect(() => daemonCliArgs("page_resolve", { path: "x" }, V)).toThrow("'action' is required");
  expect(() => daemonCliArgs("nope", {}, V)).toThrow("unknown daemon tool");
});
