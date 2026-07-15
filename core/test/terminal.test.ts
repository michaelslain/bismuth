import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalSession, killSession, sessionCount, resizeSession, buildPtyEnv, loginShellArgs } from "../src/terminal";

function tmp() {
  return mkdtempSync(join(tmpdir(), "bismuth-term-"));
}

const ENV_BASE = { base: { PATH: "/usr/bin" }, relayUrl: "http://localhost:4321", terminalId: "tab-1", shimAvailable: true, pluginDir: "/repo/relay", shimDir: "/repo/relay/shim", zdotDir: "/repo/relay/shim/zdotdir" };

test("buildPtyEnv points ZDOTDIR at the zsh init dir whenever the shim is available", () => {
  expect(buildPtyEnv({ ...ENV_BASE, realClaude: "/usr/local/bin/claude" }).ZDOTDIR).toBe("/repo/relay/shim/zdotdir");
  // Decoupled from realClaude: the zdotdir init resolves `claude` from PATH when it's null.
  expect(buildPtyEnv({ ...ENV_BASE, realClaude: null }).ZDOTDIR).toBe("/repo/relay/shim/zdotdir");
  expect(buildPtyEnv({ ...ENV_BASE, shimAvailable: false, realClaude: null }).ZDOTDIR).toBeUndefined();
});

test("buildPtyEnv sets relay provenance vars + TERM", () => {
  const env = buildPtyEnv({ ...ENV_BASE, realClaude: null });
  expect(env.TERM).toBe("xterm-256color");
  expect(env.CLAUDE_RELAY_URL).toBe("http://localhost:4321");
  expect(env.CLAUDE_TERMINAL_ID).toBe("tab-1");
});

test("buildPtyEnv sets BISMUTH_API to this core's URL so in-tab `bismuth app` targets the right window", () => {
  const env = buildPtyEnv({ ...ENV_BASE, relayUrl: "http://localhost:4399", realClaude: null });
  expect(env.BISMUTH_API).toBe("http://localhost:4399");
});

test("buildPtyEnv injects BISMUTH_MEMORY_DIR only when a memoryDir is given (the daemon gate)", () => {
  // Off (daemon disabled / not passed) → no injection, so memory hooks + MCP tools no-op.
  expect(buildPtyEnv({ ...ENV_BASE, realClaude: null }).BISMUTH_MEMORY_DIR).toBeUndefined();
  // On → the active vault's memory dir is injected, scoping recall/collect to this session.
  expect(buildPtyEnv({ ...ENV_BASE, realClaude: null, memoryDir: "/vault/.daemon/memory" }).BISMUTH_MEMORY_DIR)
    .toBe("/vault/.daemon/memory");
});

test("buildPtyEnv prepends the shim to PATH + sets BISMUTH_REAL_CLAUDE when claude resolves", () => {
  const env = buildPtyEnv({ ...ENV_BASE, realClaude: "/usr/local/bin/claude" });
  expect(env.BISMUTH_REAL_CLAUDE).toBe("/usr/local/bin/claude");
  expect(env.BISMUTH_RELAY_PLUGIN).toBe("/repo/relay");
  expect(env.PATH).toBe("/repo/relay/shim:/usr/bin");
});

test("buildPtyEnv activates the zsh shim without a resolved claude (no REAL_CLAUDE, PATH unchanged)", () => {
  const env = buildPtyEnv({ ...ENV_BASE, realClaude: null });
  expect(env.BISMUTH_RELAY_PLUGIN).toBe("/repo/relay");
  expect(env.ZDOTDIR).toBe("/repo/relay/shim/zdotdir");
  expect(env.BISMUTH_REAL_CLAUDE).toBeUndefined();
  expect(env.PATH).toBe("/usr/bin"); // PATH shim only added when a binary is resolved
});

test("buildPtyEnv skips the shim entirely when relay is not available", () => {
  const env = buildPtyEnv({ ...ENV_BASE, shimAvailable: false, realClaude: "/usr/local/bin/claude" });
  expect(env.BISMUTH_RELAY_PLUGIN).toBeUndefined();
  expect(env.ZDOTDIR).toBeUndefined();
  expect(env.BISMUTH_REAL_CLAUDE).toBeUndefined();
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

test("buildPtyEnv neutralizes the host's Claude-Code workflow provenance (Bug #107)", () => {
  // If Bismuth is launched from inside a Claude session, CLAUDE_JOB_DIR / CLAUDE_WORKFLOW_ID are in
  // the parent env. They MUST NOT reach a terminal tab, or the relay's SubagentStart hook
  // (workflowId()) mis-tags every ordinary subagent with the app's phantom workflow, garbling the
  // agents graph. They're overridden with "" (not deleted): bun-pty merges the C-level environ under
  // this object, so only an explicit empty value actually clears the parent's — the relay reads ""
  // as "no workflow".
  const env = buildPtyEnv({
    ...ENV_BASE,
    base: { PATH: "/usr/bin", CLAUDE_JOB_DIR: "/Users/x/.claude/jobs/abcd1234", CLAUDE_WORKFLOW_ID: "wf-9" },
    realClaude: null,
  });
  expect(env.CLAUDE_JOB_DIR).toBe("");
  expect(env.CLAUDE_WORKFLOW_ID).toBe("");
  expect(env.PATH).toBe("/usr/bin"); // unrelated base vars are untouched
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

test("loginShellArgs launches a login shell", () => {
  expect(loginShellArgs()).toEqual(["-l"]);
});

// The embedded terminal must see the same PATH a normal login terminal does — including
// entries set in ~/.zprofile (Homebrew/bun/nvm). This exercises the REAL shipped shim
// files (relay/shim/zdotdir/{.zshenv,.zprofile,.zshrc}) with a login zsh and a temp HOME
// whose only PATH entry lives in .zprofile, proving the shim re-sources it.
const SHIM_ZDOTDIR = join(import.meta.dir, "..", "..", "relay", "shim", "zdotdir");
const HAS_ZSH = existsSync("/bin/zsh");
test.if(HAS_ZSH && existsSync(SHIM_ZDOTDIR))(
  "login shell + shim .zprofile loads PATH set in the user's ~/.zprofile",
  async () => {
    const home = tmp();
    writeFileSync(join(home, ".zprofile"), 'export PATH="/MARKER_ZPROFILE_BIN:$PATH"\n');
    const proc = Bun.spawn(["/bin/zsh", ...loginShellArgs(), "-i", "-c", "echo $PATH"], {
      env: { HOME: home, ZDOTDIR: SHIM_ZDOTDIR, PATH: "/usr/bin:/bin", TERM: "dumb" },
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(out).toContain("/MARKER_ZPROFILE_BIN");
  },
);
