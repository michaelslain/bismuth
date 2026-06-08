import { spawn as spawnPty } from "bun-pty";
import type { IPty } from "bun-pty";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export interface Session {
  id: string;
  pty: IPty;
  cols: number;
  rows: number;
}

const sessions = new Map<string, Session>();

// The relay plugin dir (relay/) and its PATH shim, resolved relative to this source
// file (core/src/terminal.ts → ../../relay). REAL_CLAUDE is resolved ONCE here using
// the core process's PATH — which never contains the shim dir — so the shim can exec
// it without recursing. Null when `claude` isn't on PATH (e.g. a minimal GUI-app
// PATH); then we skip the shim and a tab just runs a plain shell (provenance env is
// still set, so an explicit `claude --plugin-dir` still reports in).
const RELAY_PLUGIN_DIR = resolve(import.meta.dir, "..", "..", "relay");
const SHIM_DIR = join(RELAY_PLUGIN_DIR, "shim");
// zsh init dir: ZDOTDIR points here so we can define a `claude` shell function AFTER the
// user's .zshrc loads — robust against a .zshrc that re-prepends PATH (which shadows a
// plain PATH shim). zsh-only; other shells fall back to the PATH shim.
const ZDOTDIR_DIR = join(SHIM_DIR, "zdotdir");
// Resolve `claude` once, with PATH augmented by common install dirs so the shim still
// works when the core process inherited a minimal PATH (e.g. a packaged GUI app launched
// by launchd: /usr/bin:/bin:/usr/sbin:/sbin). Resolved BEFORE the shim dir is on PATH, so
// the shim's exec never recurses into itself.
const CLAUDE_LOOKUP_PATH = [
  process.env.PATH,
  "/opt/homebrew/bin",
  "/usr/local/bin",
  join(homedir(), ".bun", "bin"),
  join(homedir(), ".local", "bin"),
].filter(Boolean).join(":");
const REAL_CLAUDE = Bun.which("claude", { PATH: CLAUDE_LOOKUP_PATH });

// In a compiled sidecar binary (the bundled app), import.meta.dir is a virtual path, so
// relay/ — the shim + zdotdir — isn't on disk (only claude-bot is shipped as a resource).
// Detect that and skip the shim entirely. Otherwise we'd point ZDOTDIR at a nonexistent
// dir and the tab would lose the user's ~/.zshrc (no oh-my-zsh, no user PATH — so even
// their own `claude` vanishes). When skipped, a tab is a plain login shell that loads the
// user's normal rc. The shim only ever activates in the dev repo, where relay/ exists.
const SHIM_AVAILABLE = existsSync(ZDOTDIR_DIR);

export interface PtyEnvParams {
  base: Record<string, string | undefined>;
  /** Base URL of this app's core server — where the relay hooks POST. */
  relayUrl: string;
  /** This tab's id; flows to the session's hooks as CLAUDE_TERMINAL_ID (provenance). */
  terminalId: string;
  /** Resolved real `claude` binary, or null to skip the shim. */
  realClaude: string | null;
  pluginDir: string;
  shimDir: string;
  /** zsh init dir (ZDOTDIR) that defines the `claude` function; zsh-only. */
  zdotDir: string;
}

/**
 * Build the PTY environment: the parent env (undefined values stripped) + TERM, plus
 * the relay provenance vars (CLAUDE_RELAY_URL, CLAUDE_TERMINAL_ID). When `claude` is
 * resolvable, also prepend the PATH shim so a bare `claude` in the tab transparently
 * loads the relay plugin (`--plugin-dir`) — per-session, no global install. Pure.
 */
export function buildPtyEnv(p: PtyEnvParams): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.base)) if (v !== undefined) env[k] = v;
  env.TERM = "xterm-256color";
  // Suppress oh-my-zsh's blocking "Would you like to update? [Y/n]" prompt — an embedded
  // app terminal shouldn't nag at startup, and the prompt eats the first keystrokes.
  env.DISABLE_AUTO_UPDATE = "true";
  env.DISABLE_UPDATE_PROMPT = "true";
  env.CLAUDE_RELAY_URL = p.relayUrl;
  env.CLAUDE_TERMINAL_ID = p.terminalId;
  if (p.realClaude) {
    env.BISMUTH_REAL_CLAUDE = p.realClaude;
    env.BISMUTH_RELAY_PLUGIN = p.pluginDir;
    // zsh: load our init (which sources the user's rc, then defines a `claude` function
    // that can't be shadowed by PATH ordering). Harmless for non-zsh shells.
    env.ZDOTDIR = p.zdotDir;
    // Fallback for non-zsh shells: prepend the shim dir (avoid a trailing empty PATH
    // element, which POSIX reads as cwd).
    env.PATH = env.PATH ? `${p.shimDir}:${env.PATH}` : p.shimDir;
  }
  return env;
}

export function createTerminalSession(opts: {
  cwd: string;
  shell?: string;
  cols: number;
  rows: number;
  /** Core server port the in-tab Claude sessions report to (defaults to 4321). */
  relayPort?: number;
}): Session {
  const shell = opts.shell ?? process.env.SHELL ?? "/bin/sh";
  const id = randomUUID();

  const env = buildPtyEnv({
    base: process.env,
    relayUrl: `http://localhost:${opts.relayPort ?? 4321}`,
    terminalId: id,
    realClaude: SHIM_AVAILABLE ? REAL_CLAUDE : null,
    pluginDir: RELAY_PLUGIN_DIR,
    shimDir: SHIM_DIR,
    zdotDir: ZDOTDIR_DIR,
  });

  const pty = spawnPty(shell, [], {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env,
  });

  const session: Session = { id, pty, cols: opts.cols, rows: opts.rows };
  sessions.set(id, session);
  return session;
}

export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.pty.kill();
  } catch {
    // already dead
  }
  sessions.delete(id);
}

export function sessionCount(): number {
  return sessions.size;
}

export function listSessionIds(): string[] {
  return Array.from(sessions.keys());
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const s = sessions.get(id);
  if (!s) return;
  s.cols = cols;
  s.rows = rows;
  try {
    s.pty.resize(cols, rows);
  } catch {
    // dead
  }
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

// Kill all PTY children synchronously on process exit so orphaned shells don't
// outlive backend restarts (covers SIGTERM from the dev runner and hot-reload).
process.on("exit", () => {
  for (const id of listSessionIds()) {
    killSession(id);
  }
});
