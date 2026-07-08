import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryDir, resolveVaultRoot } from "../src/memory";

// memoryDir() is the ONE gate shared by the memory tools (remember/recall/forget) and the
// daemon-management tools (daemonEnabled() in daemon.ts, which is defined as memoryDir() !=
// null). Row 82: memory tools never appeared because BISMUTH_MEMORY_DIR was ONLY ever set by
// core/src/terminal.ts (an in-app Bismuth terminal tab) or the daemon's own session wiring —
// never for a normal interactive `claude` session (a plain terminal/IDE), even though the
// machine-wide install (bismuthInstall.ts's `claude mcp add -s user`) puts the bismuth MCP in
// EVERY such session. memoryDir() now falls back to resolving the vault itself (BISMUTH_VAULT,
// else cwd walked up to a `.settings` file) and checking that vault's OWN daemon.enabled —
// without weakening the gate to "some vault exists nearby".

const MEM = process.env.BISMUTH_MEMORY_DIR;
const VAULT = process.env.BISMUTH_VAULT;
const CWD = process.cwd();

// Every test starts from a clean slate: no ambient BISMUTH_MEMORY_DIR/BISMUTH_VAULT, cwd in a
// fresh empty (realpath'd, so exact-path assertions below are stable) temp dir — so these can't
// pass/fail depending on the developer's own shell env or invocation directory.
let noVaultDir: string;

beforeEach(() => {
  delete process.env.BISMUTH_MEMORY_DIR;
  delete process.env.BISMUTH_VAULT;
  noVaultDir = realpathSync(mkdtempSync(join(tmpdir(), "bismuth-mcp-memory-test-")));
  process.chdir(noVaultDir);
});

afterEach(() => {
  if (MEM === undefined) delete process.env.BISMUTH_MEMORY_DIR;
  else process.env.BISMUTH_MEMORY_DIR = MEM;
  if (VAULT === undefined) delete process.env.BISMUTH_VAULT;
  else process.env.BISMUTH_VAULT = VAULT;
  process.chdir(CWD);
  rmSync(noVaultDir, { recursive: true, force: true });
});

/** Write a vault's `.settings` with (or without) a top-level `daemon.enabled` key. */
function writeVaultSettings(vault: string, enabled: boolean | undefined): void {
  mkdirSync(vault, { recursive: true });
  const yaml = enabled === undefined ? "appearance:\n  theme: dark\n" : `daemon:\n  enabled: ${enabled}\n`;
  writeFileSync(join(vault, ".settings"), yaml);
}

test("BISMUTH_MEMORY_DIR, when already set, is trusted as-is (no vault/.settings lookup)", () => {
  process.env.BISMUTH_MEMORY_DIR = "/some/arbitrary/dir";
  expect(memoryDir()).toBe("/some/arbitrary/dir");
});

test("no env vars and cwd outside any vault -> resolveVaultRoot/memoryDir are both null", () => {
  expect(resolveVaultRoot()).toBeNull();
  expect(memoryDir()).toBeNull();
});

test("BISMUTH_VAULT + that vault's .settings has daemon.enabled:true -> resolves <vault>/.daemon/memory", () => {
  const vault = join(noVaultDir, "vault");
  writeVaultSettings(vault, true);
  process.env.BISMUTH_VAULT = vault;
  expect(resolveVaultRoot()).toBe(vault);
  expect(memoryDir()).toBe(join(vault, ".daemon", "memory"));
});

test("BISMUTH_VAULT with daemon.enabled:false -> null (the gate is not weakened)", () => {
  const vault = join(noVaultDir, "vault");
  writeVaultSettings(vault, false);
  process.env.BISMUTH_VAULT = vault;
  expect(memoryDir()).toBeNull();
});

test("BISMUTH_VAULT whose .settings has no daemon key at all -> null", () => {
  const vault = join(noVaultDir, "vault");
  writeVaultSettings(vault, undefined);
  process.env.BISMUTH_VAULT = vault;
  expect(memoryDir()).toBeNull();
});

test("BISMUTH_VAULT pointing at a vault with no .settings file -> null", () => {
  const vault = join(noVaultDir, "vault");
  mkdirSync(vault, { recursive: true });
  process.env.BISMUTH_VAULT = vault;
  expect(memoryDir()).toBeNull();
});

test("cwd walked up to a daemon-enabled vault's .settings resolves memoryDir (the machine-wide, non-Bismuth-terminal case)", () => {
  const vault = join(noVaultDir, "vault");
  writeVaultSettings(vault, true);
  const nested = join(vault, "notes", "deep");
  mkdirSync(nested, { recursive: true });
  process.chdir(nested);

  expect(resolveVaultRoot()).toBe(vault);
  expect(memoryDir()).toBe(join(vault, ".daemon", "memory"));
});

test("cwd walked up to a daemon-DISABLED vault -> null, even though a vault is found", () => {
  const vault = join(noVaultDir, "vault");
  writeVaultSettings(vault, false);
  process.chdir(vault);
  expect(resolveVaultRoot()).toBe(vault);
  expect(memoryDir()).toBeNull();
});

test("malformed .settings YAML degrades to null, never throws", () => {
  const vault = join(noVaultDir, "vault");
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, ".settings"), "daemon: [this is not valid yaml");
  process.env.BISMUTH_VAULT = vault;
  expect(() => memoryDir()).not.toThrow();
  expect(memoryDir()).toBeNull();
});

test("BISMUTH_VAULT takes priority over an ambient vault found via cwd", () => {
  const cwdVault = join(noVaultDir, "cwd-vault");
  writeVaultSettings(cwdVault, true);
  process.chdir(cwdVault);

  const explicitVault = join(noVaultDir, "explicit-vault");
  writeVaultSettings(explicitVault, true);
  process.env.BISMUTH_VAULT = explicitVault;

  expect(resolveVaultRoot()).toBe(explicitVault);
  expect(memoryDir()).toBe(join(explicitVault, ".daemon", "memory"));
});
