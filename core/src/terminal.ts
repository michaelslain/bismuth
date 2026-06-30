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
  /**
   * Output routing. A single permanent `pty.onData` (stored as `dataSub`) feeds
   * every chunk to `sink` when a live socket is attached, otherwise into the capped
   * `buffer` for replay on (re)attach. This buys two things:
   *   1. A pre-warmed POOL shell renders its prompt before any client connects — the
   *      buffer holds it, and `attachSink` replays it the instant a tab attaches, so
   *      the prompt appears immediately instead of after a fresh login-shell rc load.
   *   2. Output produced while a tab is briefly disconnected (reload / network blip,
   *      during the reattach grace window) is buffered and replayed, not lost.
   */
  buffer: string[];
  bufferedBytes: number;
  sink: ((d: string) => void) | null;
  dataSub?: { dispose(): void };
  /** Pool-only: fires if a still-unclaimed warm shell dies (e.g. rc error) so we drop it. */
  poolExitSub?: { dispose(): void };
  /** True while this session is an unclaimed member of the warm pool (not a real tab). */
  pooled?: boolean;
}

const sessions = new Map<string, Session>();
// termId → session id, so a reconnect with the same client term id finds its PTY.
const byTermId = new Map<string, string>();

// Cap the replay buffer so a runaway process producing output while detached (e.g. a
// `yes` loop during a reconnect) can't grow it without bound. We keep the most RECENT
// output (trim from the front) since that's the live tail a reattaching client needs.
const MAX_BUFFER_BYTES = 256 * 1024;

function pushBuffer(s: Session, d: string): void {
  s.buffer.push(d);
  s.bufferedBytes += d.length;
  while (s.bufferedBytes > MAX_BUFFER_BYTES && s.buffer.length > 1) {
    s.bufferedBytes -= s.buffer.shift()!.length;
  }
}

// The relay plugin dir (relay/) and its PATH shim. In dev it's resolved relative to this
// source file (core/src/terminal.ts → ../../relay); in the bundled app the compiled
// sidecar sets BISMUTH_RELAY_BUNDLE to the Tauri-staged relay resource (import.meta.dir is a
// virtual path there, so the source-relative path wouldn't exist). REAL_CLAUDE is
// resolved ONCE here using an augmented PATH so the shim can exec it without recursing;
// null when `claude` isn't found (the zdotdir init then resolves it from the user's
// rc-loaded PATH).
const RELAY_PLUGIN_DIR = process.env.BISMUTH_RELAY_BUNDLE ?? resolve(import.meta.dir, "..", "..", "relay");
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
// bundled app via BISMUTH_RELAY_BUNDLE (the staged relay resource). If absent, skip it so the
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
  /** This vault's .daemon/memory dir, injected as BISMUTH_MEMORY_DIR when the daemon is
   *  enabled. Its presence is the gate: the relay recall/collect hooks + the memory MCP
   *  tools target this dir, and no-op when it's absent (daemon off / non-Bismuth session). */
  memoryDir?: string;
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
  // Scope memory injection to Bismuth sessions, gated on the daemon: presence of this var
  // is the gate (recall/collect hooks + memory MCP tools no-op without it). The caller only
  // sets memoryDir when settings.daemon.enabled, so "off" simply omits it.
  if (p.memoryDir) env.BISMUTH_MEMORY_DIR = p.memoryDir;
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

interface SpawnOpts {
  cwd: string;
  shell?: string;
  cols: number;
  rows: number;
  /** Core server port the in-tab Claude sessions report to (defaults to 4321). */
  relayPort?: number;
  /** Stable client term id to key this session under, enabling reattach. */
  termId?: string;
  /** This vault's .daemon/memory dir when the daemon is enabled (gates memory injection). */
  memoryDir?: string;
}

/** Spawn a login shell and register it as a buffering Session (no live socket yet). */
function spawnSession(opts: SpawnOpts): Session {
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
    memoryDir: opts.memoryDir,
  });

  const pty = spawnPty(shell, loginShellArgs(), {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env,
  });

  const session: Session = {
    id,
    termId: opts.termId,
    pty,
    cols: opts.cols,
    rows: opts.rows,
    buffer: [],
    bufferedBytes: 0,
    sink: null,
  };
  // One permanent reader for the PTY's whole life: route to the live socket sink when
  // attached, else accumulate (capped) for replay. Disposed in killSession.
  session.dataSub = pty.onData((d: string) => {
    if (session.sink) session.sink(d);
    else pushBuffer(session, d);
  });
  sessions.set(id, session);
  if (opts.termId) byTermId.set(opts.termId, id);
  return session;
}

export function createTerminalSession(opts: SpawnOpts): Session {
  return spawnSession(opts);
}

/**
 * Attach a live socket sink, draining any buffered output FIRST so the client sees the
 * pre-warmed prompt (or output produced while it was disconnected) before live bytes —
 * order preserved because buffered bytes are flushed before `sink` goes live.
 */
export function attachSink(id: string, send: (d: string) => void): void {
  const s = sessions.get(id);
  if (!s) return;
  if (s.buffer.length) {
    send(s.buffer.join(""));
    s.buffer = [];
    s.bufferedBytes = 0;
  }
  s.sink = send;
}

/** Detach the live socket; output resumes buffering (capped) for a later reattach. */
export function detachSink(id: string): void {
  const s = sessions.get(id);
  if (s) s.sink = null;
}

// --- Warm pool ---------------------------------------------------------------------
// Keep one login shell spawned-and-rc-loaded ahead of demand so opening a terminal tab
// shows its prompt instantly instead of waiting on the (often 100s-of-ms) shell startup
// chain. A claimed shell is replaced asynchronously, so a warm one is always ready.
const POOL_SIZE = 1;
const pool: Session[] = [];
let poolCwd: string | undefined;
let poolRelayPort: number | undefined;
let poolMemoryDir: string | undefined;

function ensurePool(): void {
  if (poolCwd === undefined) return; // not initialized — no pre-warming
  while (pool.length < POOL_SIZE) {
    let s: Session;
    try {
      // 80×24 is provisional; the claiming client resizes on attach and the shell reflows.
      s = spawnSession({ cwd: poolCwd, cols: 80, rows: 24, relayPort: poolRelayPort, memoryDir: poolMemoryDir });
    } catch {
      return; // spawn failed (e.g. no shell) — cold spawn on demand still works; don't loop
    }
    s.pooled = true;
    s.poolExitSub = s.pty.onExit(() => {
      const i = pool.indexOf(s);
      if (i >= 0) pool.splice(i, 1);
      killSession(s.id);
      ensurePool(); // a warm shell died before use (bad rc?) — try to replace it
    });
    pool.push(s);
  }
}

/** Start (and keep) the warm pool. Idempotent; safe to call once at server start. */
export function prewarmPool(cwd: string, relayPort?: number, memoryDir?: string): void {
  poolCwd = cwd;
  poolRelayPort = relayPort;
  poolMemoryDir = memoryDir;
  ensurePool();
}

/** Re-bake the warm pool's injected memory dir when settings.daemon.enabled toggles. Pooled
 *  shells cache their env at spawn, so flush the idle ones (POOL_SIZE is 1 — cheap) and
 *  re-warm, so a newly enabled/disabled daemon takes effect for the next claimed tab. */
export function setPoolMemoryDir(memoryDir: string | undefined): void {
  if (memoryDir === poolMemoryDir) return;
  poolMemoryDir = memoryDir;
  for (const s of pool.splice(0)) {
    s.poolExitSub?.dispose();
    s.poolExitSub = undefined;
    killSession(s.id);
  }
  ensurePool();
}

/**
 * Hand out a pre-warmed session (or undefined if the pool is empty), keying it to the
 * client's term id and resizing it to the real viewport, then refill the pool. Its
 * already-rendered prompt sits in the buffer and is replayed by attachSink on ws open.
 */
export function claimPooledSession(opts: { termId?: string; cols: number; rows: number }): Session | undefined {
  const s = pool.shift();
  if (!s) return undefined;
  s.pooled = false;
  s.poolExitSub?.dispose();
  s.poolExitSub = undefined;
  if (opts.termId) {
    s.termId = opts.termId;
    byTermId.set(opts.termId, s.id);
  }
  resizeSession(s.id, opts.cols, opts.rows);
  ensurePool(); // spawn a replacement so the next tab is also instant
  return s;
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
  s.dataSub?.dispose();
  s.poolExitSub?.dispose();
  const pi = pool.indexOf(s);
  if (pi >= 0) pool.splice(pi, 1);
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

// Only sessions that back a real terminal tab — unclaimed warm-pool shells are not tabs,
// so they must not appear in the live-pty set that prunes the "agents" relay registry.
export function listSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id, s] of sessions) if (!s.pooled) ids.push(id);
  return ids;
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
// outlive backend restarts (covers SIGTERM from the dev runner and hot-reload). Uses
// the full sessions map — not listSessionIds, which omits unclaimed warm-pool shells
// that still need killing here.
process.on("exit", () => {
  for (const id of Array.from(sessions.keys())) {
    killSession(id);
  }
});
