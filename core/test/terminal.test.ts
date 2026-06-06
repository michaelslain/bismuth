import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalSession, killSession, sessionCount, resizeSession, buildPtyEnv } from "../src/terminal";

function tmp() {
  return mkdtempSync(join(tmpdir(), "oa-term-"));
}

const ENV_BASE = { base: { PATH: "/usr/bin" }, relayUrl: "http://localhost:4321", terminalId: "tab-1", pluginDir: "/repo/relay", shimDir: "/repo/relay/shim", zdotDir: "/repo/relay/shim/zdotdir" };

test("buildPtyEnv points ZDOTDIR at the zsh init dir when claude resolves", () => {
  expect(buildPtyEnv({ ...ENV_BASE, realClaude: "/usr/local/bin/claude" }).ZDOTDIR).toBe("/repo/relay/shim/zdotdir");
  expect(buildPtyEnv({ ...ENV_BASE, realClaude: null }).ZDOTDIR).toBeUndefined();
});

test("buildPtyEnv sets relay provenance vars + TERM", () => {
  const env = buildPtyEnv({ ...ENV_BASE, realClaude: null });
  expect(env.TERM).toBe("xterm-256color");
  expect(env.CLAUDE_RELAY_URL).toBe("http://localhost:4321");
  expect(env.CLAUDE_TERMINAL_ID).toBe("tab-1");
});

test("buildPtyEnv prepends the shim to PATH + sets shim vars when claude resolves", () => {
  const env = buildPtyEnv({ ...ENV_BASE, realClaude: "/usr/local/bin/claude" });
  expect(env.BISMUTH_REAL_CLAUDE).toBe("/usr/local/bin/claude");
  expect(env.BISMUTH_RELAY_PLUGIN).toBe("/repo/relay");
  expect(env.PATH).toBe("/repo/relay/shim:/usr/bin");
});

test("buildPtyEnv skips the shim entirely when claude is not resolvable", () => {
  const env = buildPtyEnv({ ...ENV_BASE, realClaude: null });
  expect(env.BISMUTH_REAL_CLAUDE).toBeUndefined();
  expect(env.BISMUTH_RELAY_PLUGIN).toBeUndefined();
  expect(env.PATH).toBe("/usr/bin"); // unchanged
});

test("buildPtyEnv never produces a trailing-colon PATH when base has no PATH", () => {
  const env = buildPtyEnv({ ...ENV_BASE, base: {}, realClaude: "/usr/local/bin/claude" });
  expect(env.PATH).toBe("/repo/relay/shim"); // no trailing ":" (which POSIX reads as cwd)
});

test("buildPtyEnv strips undefined base values", () => {
  const env = buildPtyEnv({ ...ENV_BASE, base: { PATH: "/usr/bin", NOPE: undefined }, realClaude: null });
  expect("NOPE" in env).toBe(false);
});

test("createTerminalSession spawns a shell that echoes stdin to stdout", async () => {
  const cwd = tmp();
  const s = createTerminalSession({ cwd, shell: "/bin/sh", cols: 80, rows: 24 });
  try {
    const out: Buffer[] = [];
    s.pty.onData((d) => out.push(Buffer.from(d)));
    s.pty.write("echo hi-from-test\n");
    // Wait for the echo. Poll up to 2s.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (Buffer.concat(out).toString().includes("hi-from-test")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(Buffer.concat(out).toString()).toContain("hi-from-test");
  } finally {
    killSession(s.id);
  }
});

test("resizeSession updates the PTY winsize and propagates to the shell", async () => {
  const cwd = tmp();
  const s = createTerminalSession({ cwd, shell: "/bin/sh", cols: 80, rows: 24 });
  try {
    const out: Buffer[] = [];
    s.pty.onData((d) => out.push(Buffer.from(d)));
    resizeSession(s.id, 120, 40);
    expect(s.cols).toBe(120);
    expect(s.rows).toBe(40);
    s.pty.write("stty size\n");
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (/\b40\s+120\b/.test(Buffer.concat(out).toString())) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(Buffer.concat(out).toString()).toMatch(/\b40\s+120\b/);
  } finally {
    killSession(s.id);
  }
});

test("killSession removes the session from the registry", () => {
  const cwd = tmp();
  const before = sessionCount();
  const s = createTerminalSession({ cwd, shell: "/bin/sh", cols: 80, rows: 24 });
  try {
    expect(sessionCount()).toBe(before + 1);
  } finally {
    killSession(s.id);
  }
  expect(sessionCount()).toBe(before);
});
