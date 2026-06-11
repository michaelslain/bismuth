import { spawn as spawnPty } from "bun-pty";
import type { IPty } from "bun-pty";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { whichClaude } from "./claudeWhich";

export interface Session {
  id: string;
  /**
   * Stable client-side terminal id (the `::term:<uuid>` content id). Lets a
   * reconnecting/reloading client REATTACH to the same live PTY instead of
   * silently spawning a fresh shell — see getSessionByTermId + the grace timer.
   */
  termId?: string;
  pty: IPty;
  cols: number;
  rows: number;
  /** Pending delayed-kill after a non-clean disconnect; cancelled on reattach. */
  graceTimer?: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, Session>();
// termId → session id, so a reconnect with the same client term id finds its PTY.
const byTermId = new Map<string, string>();

// The relay plugin dir (relay/) and its PATH shim. In dev it's resolved relative to this
// source file (core/src/terminal.ts → ../../relay); in the bundled app the compiled
// sidecar sets OA_RELAY_BUNDLE to the Tauri-staged relay resource (import.meta.dir is a
// virtual path there, so the source-relative path wouldn't exist). REAL_CLAUDE is
// resolved ONCE here using an augmented PATH so the shim can exec it without recursing;
// null when `claude` isn't found (the zdotdir init then resolves it from the user's
// rc-loaded PATH).
const RELAY_PLUGIN_DIR = process.env.OA_RELAY_BUNDLE ?? resolve(import.meta.dir, "..", "..", "relay");
const SHIM_DIR = join(RELAY_PLUGIN_DIR, "shim");
// zsh init dir: ZDOTDIR points here so we can define a `claude` shell function AFTER the
// user's .zshrc loads — robust against a .zshrc that re-prepends PATH (which shadows a
// plain PATH shim). zsh-only; other shells fall back to the PATH shim.
const ZDOTDIR_DIR = join(SHIM_DIR, "zdotdir");
// Resolve `claude` once via the augmented lookup PATH (so it works from a packaged GUI
// app's minimal PATH). Resolved BEFORE the shim dir is on PATH, so the shim's exec never
// recurses. Null when not found — the zdotdir init then resolves it from the rc-loaded PATH.
const REAL_CLAUDE = whichClaude();

// Activate the relay shim only when its files are actually present — the dev repo, or the
// bundled app via OA_RELAY_BUNDLE (the staged relay resource). If absent, skip it so the
// tab still runs the user's normal login shell (oh-my-zsh, their PATH, their `claude`)
// rather than pointing ZDOTDIR at a nonexistent dir.
const SHIM_AVAILABLE = existsSync(ZDOTDIR_DIR);

export interface PtyEnvParams {
  base: Record<string, string | undefined>;
  /** Base URL of this app's core server — where the relay hooks POST. */
  relayUrl: string;
  /** This tab's id; flows to the session's hooks as CLAUDE_TERMINAL_ID (provenance). */
  terminalId: string;
  /** Whether the relay shim files exist (dev repo or bundled). When true, the zsh shim activates. */
  shimAvailable: boolean;
  /** Resolved real `claude` binary, or null — the zdotdir init resolves it from PATH when null. */
  realClaude: string | null;
  pluginDir: string;
  shimDir: string;
  /** zsh init dir (ZDOTDIR) that defines the `claude` function; zsh-only. */
  zdotDir: string;
}

/**
 * Build the PTY environment: the parent env (undefined values stripped) + TERM, plus
 * the relay provenance vars (CLAUDE_RELAY_URL, CLAUDE_TERMINAL_ID). When the relay shim
 * is available, point ZDOTDIR at our zsh init (sources the user's rc, then defines a
 * `claude` function loading the relay plugin) — independent of whether a real `claude`
 * was pre-resolved (the init falls back to PATH). A resolved `claude` additionally enables
 * BISMUTH_REAL_CLAUDE + the non-zsh PATH shim. Pure.
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
  if (p.shimAvailable) {
    // zsh: load our init dir, which sources the user's rc then defines a `claude` function
    // (un-shadowable by PATH ordering) that loads the relay plugin. Works even without a
    // pre-resolved binary — the zdotdir .zshrc resolves `claude` from the rc-loaded PATH.
    env.BISMUTH_RELAY_PLUGIN = p.pluginDir;
    env.ZDOTDIR = p.zdotDir;
    if (p.realClaude) {
      env.BISMUTH_REAL_CLAUDE = p.realClaude;
      // Fallback for non-zsh shells: prepend the PATH shim (avoid a trailing empty PATH
      // element, which POSIX reads as cwd). Needs a resolved binary to exec.
      env.PATH = env.PATH ? `${p.shimDir}:${env.PATH}` : p.shimDir;
    }
  }
  return env;
}

/**
 * Args to launch the shell as a LOGIN shell (`-l`). A login shell runs the full startup
 * chain a normal terminal does — `/etc/zprofile` (→ macOS `path_helper`) and the user's
 * `~/.zprofile`/`~/.zlogin`, where Homebrew (`brew shellenv`), bun, and nvm typically put
 * their PATH entries. Without `-l` the embedded terminal is a NON-login shell that only
 * sees `~/.zshrc`, so those tools resolve in a normal terminal but not here — especially
 * under the bundled app's minimal launchd PATH, which provides no fallback. `-l` is the
 * login flag across zsh/bash/sh/fish; interactivity is auto-detected from the PTY's tty.
 * (zsh additionally needs the shim `.zprofile` to re-source the user's, since ZDOTDIR is
 * redirected — see relay/shim/zdotdir/.zprofile.)
 */
export function loginShellArgs(): string[] {
  return ["-l"];
}

export function createTerminalSession(opts: {
  cwd: string;
  shell?: string;
  cols: number;
  rows: number;
  /** Core server port the in-tab Claude sessions report to (defaults to 4321). */
  relayPort?: number;
  /** Stable client term id to key this session under, enabling reattach. */
  termId?: string;
}): Session {
  const shell = opts.shell ?? process.env.SHELL ?? "/bin/sh";
  const id = randomUUID();

  const env = buildPtyEnv({
    base: process.env,
    relayUrl: `http://localhost:${opts.relayPort ?? 4321}`,
    terminalId: id,
    shimAvailable: SHIM_AVAILABLE,
    realClaude: REAL_CLAUDE,
    pluginDir: RELAY_PLUGIN_DIR,
    shimDir: SHIM_DIR,
    zdotDir: ZDOTDIR_DIR,
  });

  const pty = spawnPty(shell, loginShellArgs(), {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env,
  });

  const session: Session = { id, termId: opts.termId, pty, cols: opts.cols, rows: opts.rows };
  sessions.set(id, session);
  if (opts.termId) byTermId.set(opts.termId, id);
  return session;
}

/** Find a live session by its stable client term id (for reattach on reconnect). */
export function getSessionByTermId(termId: string): Session | undefined {
  const id = byTermId.get(termId);
  return id ? sessions.get(id) : undefined;
}

/**
 * Schedule a delayed kill (the post-disconnect grace window). A reconnecting
 * client that reattaches via getSessionByTermId calls cancelSessionKill to keep
 * its PTY alive. Replaces any pending timer.
 */
export function scheduleSessionKill(id: string, ms: number): void {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.graceTimer);
  s.graceTimer = setTimeout(() => killSession(id), ms);
}

/** Cancel a pending delayed kill — the client reattached within the grace window. */
export function cancelSessionKill(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.graceTimer);
  s.graceTimer = undefined;
}

export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.graceTimer);
  if (s.termId && byTermId.get(s.termId) === id) byTermId.delete(s.termId);
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
