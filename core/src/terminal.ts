import { spawn as spawnPty } from "bun-pty";
import type { IPty } from "bun-pty";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { whichClaude, whichBinary } from "./claudeWhich";
import { BACKEND_LIST } from "./agentBackends/catalog";
import { prune as relayPrune } from "./relay";

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

// Generic multi-call PATH shim (relay/shim/agent-shim) — the non-zsh equivalent of the per-backend
// zsh functions below. One symlink per resolvable "wrapper"-mode backend is created at module load
// (see buildWrapperShimDir), each pointing here; the script dispatches on its OWN invoked name.
const AGENT_SHIM_SCRIPT = join(SHIM_DIR, "agent-shim");

// --- Per-backend shim specs ---------------------------------------------------------------------
// Generalizes the single hardcoded `claude` shell function into one entry per agent-CLI backend
// (core/src/agentBackends/catalog.ts), so relay/shim/zdotdir/.zshrc can define a shell function per
// entry instead of one hardcoded name, and non-zsh shells get an equivalent PATH-shim entry per
// resolvable "wrapper"-mode backend (see buildWrapperShimDir below).

/** Minimal shape shimSpecsFor needs from a backend descriptor. Deliberately structural (not
 *  importing BackendId/BackendCapabilities) so this stays trivially unit-testable with plain
 *  fixtures, independent of the catalog module's exact shape. */
export interface BackendShimCandidate {
  /** Backend id (e.g. "claude", "opencode") — becomes wrap.ts's `backendId` argv + the relay
   *  registry's `backend` field, so the agents graph can show what's running in a tab. */
  id: string;
  /** Binary/function name to resolve + wrap (BackendDescriptor.binary). */
  binary: string;
  /** BackendCapabilities.agentsGraph — the sole input for whether/how this backend gets wrapped. */
  agentsGraph: "hooks" | "wrapper" | "none";
  /** BackendCapabilities.terminal — a chat-only backend with no terminal surface gets no shim. */
  terminal: boolean;
}

/** One backend's resolved shim wiring — what the zsh init (and, for wrapper-mode backends, the
 *  non-zsh multi-call shim script) needs to decide whether and how to wrap a bare invocation of
 *  `binary`. */
export interface ShimSpec {
  /** Backend id — see {@link BackendShimCandidate.id}. */
  id: string;
  /** Binary/function name (also the PATH-shim symlink's / zsh function's name). */
  binary: string;
  /**
   * Absolute path resolved by the caller's `resolve()` (production: `whichBinary()` against the
   * augmented lookup PATH — see claudeWhich.ts), or null when core couldn't resolve it. The zsh
   * init still gets a shot at it via `whence -p` AFTER the user's rc loads — the same fallback
   * `claude` already relied on (see relay/shim/zdotdir/.zshrc) — so a null realPath here does NOT
   * mean "no function": it means "resolve at shell-init time instead." Non-zsh shells have no such
   * second chance (there is no rc-sourcing step before a PATH shim runs), so a null realPath here
   * means no non-zsh PATH-shim entry for this backend (see buildWrapperShimDir).
   */
  realPath: string | null;
  /** "hooks" → inject the relay plugin directly (today: only claude, `--plugin-dir <relay>`).
   *  "wrapper" → route through relay/bin/wrap.ts for session-start/end telemetry, since a CLI with
   *  no hook system of its own has no other way to appear in the agents graph. */
  mode: "hooks" | "wrapper";
}

/**
 * Whether a "wrapper"-mode backend (BackendCapabilities.agentsGraph === "wrapper" — a CLI with no
 * hook system of its own) gets wrapped through relay/bin/wrap.ts for agents-graph session
 * telemetry. DEFAULT OFF.
 *
 * Wrapping an interactive TUI in an extra process risks signal handling, tty ownership, and
 * exit-code fidelity; the payoff is one node in a graph. That trade is only worth taking once the
 * risk is actually retired, not merely assumed away — and today it isn't: relay/bin/wrap.ts's
 * signal-forwarding + exit-code relay is verified against a STUB child (a bash script trapping
 * SIGINT/SIGTERM, driven with real `kill -INT`/`-TERM` against the wrapper's own pid — see the
 * task notes this shipped with for the exact commands and output), never against a real
 * interactive agent CLI's own tty/signal handling (some TUIs treat Ctrl+C as "cancel this turn",
 * not "exit"), and never inside a real PTY's foreground process-group semantics. A broken terminal
 * tab is far worse than a missing graph node, so this stays off until a human has verified, by
 * hand, that a wrapped backend's signals and exit codes survive under a REAL pty.
 *
 * Flip to `true` here once that hand-verification has happened — shimSpecsFor, wrap.ts, and both
 * consumers (the zsh init + relay/shim/agent-shim) already react correctly the moment this flips.
 * The catalog's per-backend `agentsGraph: "wrapper"` flag remains the OTHER gate: both must agree
 * before a given backend is actually wrapped.
 */
const WRAPPER_REPORTING_ENABLED = false;

/**
 * Pure: which backends get a shim (a shell function in zsh; a PATH-shim entry elsewhere) and how.
 * The sole input for intent is each backend's `agentsGraph`:
 *  - "hooks"   → inject the relay plugin directly (claude today).
 *  - "wrapper" → route through relay/bin/wrap.ts — but ONLY when `wrapperReportingEnabled`; when
 *    false, a "wrapper" backend is treated exactly like "none" (no spec, no function, no PATH
 *    entry — zero behavior change from before this feature existed). See WRAPPER_REPORTING_ENABLED.
 *  - "none"    → no shim at all; the backend resolves via the shell's ordinary PATH, untouched.
 *
 * `resolve` abstracts binary lookup (production: `whichBinary()`) so this stays pure and
 * unit-testable with a stub. A backend `resolve` can't find still gets a spec entry with
 * `realPath: null` — dropping it entirely would lose the zsh init's only signal that "there IS a
 * backend here, please retry via `whence -p`", regressing exactly the fallback claude relies on
 * today. Never emits a "wrapper" entry for claude, even if the catalog were ever misconfigured to
 * claim one — see relay/bin/wrap.ts's header for why Claude Code must never be wrapped.
 */
export function shimSpecsFor(
  backends: readonly BackendShimCandidate[],
  resolve: (binary: string) => string | null,
  opts: { wrapperReportingEnabled: boolean },
): ShimSpec[] {
  const specs: ShimSpec[] = [];
  for (const b of backends) {
    if (!b.terminal) continue;
    if (b.agentsGraph === "none") continue;
    if (b.agentsGraph === "wrapper" && (!opts.wrapperReportingEnabled || b.id === "claude")) continue;
    specs.push({ id: b.id, binary: b.binary, realPath: resolve(b.binary), mode: b.agentsGraph });
  }
  return specs;
}

// ASCII Unit Separator / Record Separator — reserved by the ASCII standard for exactly this
// purpose (delimiting fields/records in plain text) and, for that reason, never legitimately typed
// into a filesystem path by any installer/shell a user would use to get an agent CLI onto PATH.
// Chosen over a printable delimiter (":", ",", "|", …) precisely because those DO occasionally
// occur in real paths/URLs/flags; these two effectively never do. zsh splits on them directly —
// `${(ps:\x1e:)str}` / `${(ps:\x1f:)str}`, where the `p` flag makes zsh recognize the `\x1e`/`\x1f`
// escapes in the delimiter literal — with no `jq`/`python` dependency (see
// relay/shim/zdotdir/.zshrc + relay/shim/agent-shim, which parses the same format with plain `IFS`
// word-splitting).
export const SHIM_RECORD_SEP = "\x1e";
export const SHIM_FIELD_SEP = "\x1f";

/** Serialize shim specs into BISMUTH_SHIM_SPECS's wire format: SHIM_FIELD_SEP-joined fields
 *  (id, binary, realPath-or-empty, mode) per record, SHIM_RECORD_SEP-joined records. Pure. */
export function serializeShimSpecs(specs: readonly ShimSpec[]): string {
  return specs.map((s) => [s.id, s.binary, s.realPath ?? "", s.mode].join(SHIM_FIELD_SEP)).join(SHIM_RECORD_SEP);
}

/** Every backend this build knows, reduced to what shimSpecsFor needs — built once from the
 *  (read-only, owned by the concurrent backends task) catalog. */
const BACKEND_SHIM_CANDIDATES: BackendShimCandidate[] = BACKEND_LIST.map((b) => ({
  id: b.id,
  binary: b.binary,
  agentsGraph: b.capabilities.agentsGraph,
  terminal: b.capabilities.terminal,
}));

/** Resolved once at module load (mirrors REAL_CLAUDE's "resolved once" pattern) — includes claude
 *  itself (mode "hooks"), so the zsh init's per-backend loop replaces its old single hardcoded
 *  `claude()` definition with one generated from this same data, claude included. */
const SHIM_SPECS: ShimSpec[] = shimSpecsFor(BACKEND_SHIM_CANDIDATES, whichBinary, {
  wrapperReportingEnabled: WRAPPER_REPORTING_ENABLED,
});

/**
 * Create (once, at module load) a temp dir holding one symlink per resolvable "wrapper"-mode
 * backend, each pointing at the generic multi-call shim script (relay/shim/agent-shim) — the
 * non-zsh equivalent of the per-backend zsh functions. Returns undefined when there's nothing to
 * wire up (today, always: WRAPPER_REPORTING_ENABLED is false, so `specs` never contains a resolved
 * "wrapper" entry). Best-effort: any fs failure degrades to "no wrapper shim dir" rather than
 * breaking terminal spawning — mirrors ensurePool's try/catch discipline below.
 */
function buildWrapperShimDir(specs: readonly ShimSpec[]): string | undefined {
  const wrapperEntries = specs.filter((s) => s.mode === "wrapper" && s.realPath);
  if (!wrapperEntries.length) return undefined;
  try {
    const dir = mkdtempSync(join(tmpdir(), "bismuth-agent-shim-"));
    for (const s of wrapperEntries) symlinkSync(AGENT_SHIM_SCRIPT, join(dir, s.binary));
    return dir;
  } catch {
    return undefined;
  }
}

const WRAPPER_SHIM_DIR = buildWrapperShimDir(SHIM_SPECS);

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
  /**
   * Per-backend shim specs — claude (mode "hooks") plus any resolvable "wrapper"-mode backends,
   * built once at module load by shimSpecsFor() over agentBackends/catalog.ts's BACKEND_LIST (see
   * SHIM_SPECS). Serialized into BISMUTH_SHIM_SPECS so the zsh init (relay/shim/zdotdir/.zshrc)
   * defines one shell function per entry, replacing the old single hardcoded `claude` function.
   * Omitted/empty → no BISMUTH_SHIM_SPECS is set at all, and the zsh init's own `whence -p`
   * fallback is the only resolution path left (unchanged from before this field existed).
   */
  shimSpecs?: ShimSpec[];
  /**
   * PATH dir holding a symlink-per-wrapper-backend to relay/shim/agent-shim — the non-zsh
   * equivalent of the wrapper-mode zsh functions (see buildWrapperShimDir). Undefined/omitted when
   * there's nothing to wire up (including always, today: WRAPPER_REPORTING_ENABLED defaults false).
   * Only prepended to PATH when `shimSpecs` actually contains a resolved wrapper-mode entry —
   * otherwise an empty dir would be added to PATH for no reason.
   */
  wrapperShimDir?: string;
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
  // Neutralize the HOST's Claude-Code workflow provenance so it never leaks into a terminal tab.
  // When Bismuth is itself launched from inside a Claude Code session (the standard dev flow:
  // `bun run dev` in a Claude terminal), the parent env carries CLAUDE_JOB_DIR / CLAUDE_WORKFLOW_ID.
  // These reach the tab's Claude session and get read by the relay's SubagentStart hook
  // (report.ts `workflowId()`), which then tags EVERY ordinary subagent spawned in the tab with the
  // app's phantom workflow key — so instead of clean per-session `you → session → subagent` children,
  // the agents graph lumps all subagents into a bogus cross-session workflow lane (Bug #107).
  // We must OVERRIDE with "" rather than `delete` these keys: bun-pty MERGES the process's C-level
  // `environ` UNDER this object, so a deleted key still leaks the parent's value — an explicit empty
  // value is what actually clears it (and the relay treats an empty key as "no workflow"). A tab's
  // Claude session is NOT part of the host's workflow; a real workflow orchestration run INSIDE the
  // tab exports these itself after spawn, so it is unaffected.
  env.CLAUDE_JOB_DIR = "";
  env.CLAUDE_WORKFLOW_ID = "";
  env.TERM = "xterm-256color";
  // Suppress oh-my-zsh's blocking "Would you like to update? [Y/n]" prompt — an embedded
  // app terminal shouldn't nag at startup, and the prompt eats the first keystrokes.
  env.DISABLE_AUTO_UPDATE = "true";
  env.DISABLE_UPDATE_PROMPT = "true";
  env.CLAUDE_RELAY_URL = p.relayUrl;
  env.CLAUDE_TERMINAL_ID = p.terminalId;
  // Point the `bismuth` CLI (and, through it, the bismuth MCP) at THIS app's core, dynamic port
  // and all — so `bismuth app …` run from inside a tab drives the right window with no run-registry
  // lookup. The relay URL IS this core's base (see spawnSession). The `app` CLI group reads
  // BISMUTH_API first (then CLAUDE_RELAY_URL, then the run-registry, then :4321).
  env.BISMUTH_API = p.relayUrl;
  // Scope memory injection to Bismuth sessions, gated on the daemon: presence of this var
  // is the gate (recall/collect hooks + memory MCP tools no-op without it). The caller only
  // sets memoryDir when settings.daemon.enabled, so "off" simply omits it.
  if (p.memoryDir) env.BISMUTH_MEMORY_DIR = p.memoryDir;
  // Deliberately NOT stamped here: BISMUTH_AGENT_CHANNEL (core/src/visibilityCliGate.ts's
  // CLI-dispatch gate). A terminal tab is the OWNER's own interactive shell — the same threat model
  // that keeps visibility from restricting "your own interactive terminal Claude sessions"
  // (docs/vault/visibility.md) applies here verbatim: whoever is typing in this PTY is the vault
  // owner, not an agent Bismuth spawned on its own, so a `bismuth` invocation from inside it must
  // stay ungated. Do not "fix" this by adding the var — that would lock the owner out of their own
  // terminal's CLI.

  if (p.shimAvailable) {
    // zsh: load our init dir, which sources the user's rc then defines a `claude` function
    // (un-shadowable by PATH ordering) that loads the relay plugin. Works even without a
    // pre-resolved binary — the zdotdir .zshrc resolves `claude` from the rc-loaded PATH.
    env.BISMUTH_RELAY_PLUGIN = p.pluginDir;
    env.ZDOTDIR = p.zdotDir;
    // Data-driven shim specs (claude + any enabled wrapper-mode backends) for the zsh init's
    // per-backend loop — see shimSpecsFor/serializeShimSpecs above. Omitted when there's nothing
    // to describe, so an old-shaped caller (no shimSpecs passed) produces byte-identical env to
    // before this field existed.
    if (p.shimSpecs && p.shimSpecs.length) env.BISMUTH_SHIM_SPECS = serializeShimSpecs(p.shimSpecs);
    if (p.realClaude) {
      env.BISMUTH_REAL_CLAUDE = p.realClaude;
      // Fallback for non-zsh shells: prepend the PATH shim (avoid a trailing empty PATH
      // element, which POSIX reads as cwd). Needs a resolved binary to exec.
      env.PATH = env.PATH ? `${p.shimDir}:${env.PATH}` : p.shimDir;
    }
    // Non-zsh equivalent for wrapper-mode backends: prepend the per-backend symlink dir, but only
    // when it actually holds a resolved wrapper entry (an empty/absent dir has nothing to add).
    if (p.wrapperShimDir && p.shimSpecs?.some((s) => s.mode === "wrapper" && s.realPath)) {
      env.PATH = env.PATH ? `${p.wrapperShimDir}:${env.PATH}` : p.wrapperShimDir;
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
    shimSpecs: SHIM_SPECS,
    wrapperShimDir: WRAPPER_SHIM_DIR,
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
    // Replay as bounded pieces, not one up-to-256KB join: a single WS frame is ONE
    // uninterruptible xterm write()/parse on the client (its WriteBuffer only yields to the
    // renderer BETWEEN write chunks), so a giant replay stalled the UI for its whole duration
    // ("terminal laggy, then fine"). ~16KB pieces split only at original PTY-chunk boundaries
    // keep the byte stream identical to live streaming (no surrogate/UTF-8 splits) while
    // letting the client time-slice. Deliberately SYNCHRONOUS — an async yield here would let
    // concurrent pty onData interleave while s.sink is still null and reorder output.
    const TARGET = 16 * 1024;
    let acc = "";
    for (const chunk of s.buffer) {
      acc += chunk;
      if (acc.length >= TARGET) { send(acc); acc = ""; }
    }
    if (acc) send(acc);
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
  // A tab closing is exactly the event the relay registry has no hook for (see relay.ts's
  // `prune` doc comment) — without this, a closed-tab session (and its whole subagent subtree)
  // and any subagent past its done-TTL/backstop age would linger in the registry forever, since
  // nothing else reads/prunes it now that the old GET /agent-graph poll is gone.
  relayPrune(new Set(listSessionIds()));
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
