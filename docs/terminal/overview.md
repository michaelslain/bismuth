# Terminal & Agents Graph

This document covers Bismuth's in-app terminal tabs (PTY sessions bridged over WebSocket), the relay plugin that auto-instruments every `claude` invocation inside those tabs, and the agents graph built live from the relay registry. Together these three components form a closed system: you → terminal tab session → subagents, visualised in the "agents" graph mode and scoped entirely to the running app instance.

---

## In-App Terminal Tabs

### Architecture

Each terminal tab is a full PTY session (`bun-pty`) exposed over a WebSocket endpoint (`GET /terminal`). The frontend mounts an xterm.js emulator and connects to that WebSocket; PTY output flows to the browser as raw bytes, keystrokes flow back as framed binary messages.

- **Backend**: `core/src/terminal.ts` — pure session management + `buildPtyEnv`
- **Frontend**: `app/src/Terminal.tsx` — `TerminalTab` Solid component
- **WebSocket path**: `GET /terminal?cols=<n>&rows=<n>` (upgrades via Bun's `server.upgrade`)
- **Default backend port**: `:4321`; the frontend derives `WS_BASE` by replacing `http` → `ws` in `VITE_API_BASE` (or the default `http://localhost:4321`)

### WebSocket Protocol

All messages are binary (`binaryType = "arraybuffer"`). Two frame types:

| Tag byte | Direction | Payload |
|----------|-----------|---------|
| `0x00` | client → server (stdin) | Raw keystrokes as UTF-8 bytes following the tag |
| `0x01` | client → server (resize) | 4 bytes: `cols` + `rows` as little-endian uint16s following the tag |
| *(no tag)* | server → client (stdout) | Raw PTY output bytes — written directly to xterm |

**Example frame builders** (from `Terminal.tsx`):

```ts
// stdin: prefix 0x00 + encoded keystrokes
function stdinFrame(bytes: Uint8Array): Uint8Array {
  const frame = new Uint8Array(1 + bytes.length);
  frame[0] = 0x00;
  frame.set(bytes, 1);
  return frame;
}

// resize: 0x01 + cols/rows as LE uint16
function resizeFrame(cols: number, rows: number): Uint8Array {
  const frame = new Uint8Array(5);
  const view = new DataView(frame.buffer);
  frame[0] = 0x01;
  view.setUint16(1, cols, true);
  view.setUint16(3, rows, true);
  return frame;
}
```

### Session Lifecycle (Backend)

`createTerminalSession` is the main entry point. It:
1. Generates a `randomUUID()` as the session id.
2. Calls `buildPtyEnv` to produce the PTY environment (see below).
3. Spawns the PTY with `bun-pty` `spawn`, using `opts.shell ?? process.env.SHELL ?? "/bin/sh"`.
4. Stores the session in the `sessions` Map.
5. Returns the `Session` object: `{ id, pty, cols, rows }`.

```ts
const session = createTerminalSession({
  cwd: cfg.vault,   // working directory for the shell
  cols: 80,
  rows: 24,
  relayPort: server.port,  // default 4321; used to build CLAUDE_RELAY_URL
  // shell?: overrides process.env.SHELL if provided
});
```

The server upgrades the WebSocket in the same call:
```ts
server.upgrade(req, { data: { sessionId: session.id } as TermWsData });
```

The `websocket` handler on the server:
- **`open`**: subscribes to `pty.onData` (pipes PTY output → `ws.send`) and `pty.onExit` (closes the socket when the shell exits).
- **`message`**: routes tag `0x00` (stdin) or `0x01` (resize) to the PTY.
- **`close`**: disposes listeners, then kills the session after a 3-second grace period to absorb kernel/network races.

Other session management functions:

| Function | Purpose |
|----------|---------|
| `killSession(id)` | Kill the PTY and remove from registry |
| `resizeSession(id, cols, rows)` | Update stored size and call `pty.resize` |
| `getSession(id)` | Look up a session by id |
| `listSessionIds()` | Return all live ids (used by relay pruning) |
| `sessionCount()` | Count of open sessions |

All PTY children are killed synchronously on `process.exit` via a `process.on("exit")` handler, so orphaned shells don't outlive backend restarts or hot-reload cycles.

### WebSocket Origin Policy

The `/terminal` upgrade enforces an origin allowlist:
- No `Origin` header (Tauri webview)
- `localhost` or `127.0.0.1` on any port
- `tauri://` scheme
- `10.x.x.x` on any port

All other origins receive a `403 forbidden origin`.

---

## `buildPtyEnv` — PTY Environment Construction

`buildPtyEnv` is a **pure function** that builds the complete environment for the spawned shell. It is exported separately from session creation so it can be unit-tested independently.

### Signature

```ts
export interface PtyEnvParams {
  base: Record<string, string | undefined>;  // parent process.env (undefined values stripped)
  relayUrl: string;       // e.g. "http://localhost:4321"
  terminalId: string;     // UUID for this tab (becomes CLAUDE_TERMINAL_ID)
  shimAvailable: boolean;  // relay shim files exist (dev repo or bundled) → activate the zsh shim
  realClaude: string | null;  // resolved real `claude` binary, or null (zdotdir resolves from PATH)
  pluginDir: string;      // relay/ dir — OA_RELAY_BUNDLE in the bundle, else ../../relay
  shimDir: string;        // path to relay/shim/
  zdotDir: string;        // path to relay/shim/zdotdir/ (zsh-only init)
}

export function buildPtyEnv(p: PtyEnvParams): Record<string, string>
```

### What it sets

**Always set:**

| Variable | Value |
|----------|-------|
| `TERM` | `"xterm-256color"` |
| `DISABLE_AUTO_UPDATE` | `"true"` — suppresses oh-my-zsh update prompts |
| `DISABLE_UPDATE_PROMPT` | `"true"` |
| `CLAUDE_RELAY_URL` | `p.relayUrl` — where relay hooks POST |
| `CLAUDE_TERMINAL_ID` | `p.terminalId` — session provenance identifier |

**Set when `shimAvailable` (relay present — activates the zsh shim, independent of `realClaude`):**

| Variable | Value |
|----------|-------|
| `BISMUTH_RELAY_PLUGIN` | Path to the relay plugin dir |
| `ZDOTDIR` | `p.zdotDir` — overrides zsh's init dir so the relay zshrc loads |

**Additionally, only when `realClaude` is non-null:**

| Variable | Value |
|----------|-------|
| `BISMUTH_REAL_CLAUDE` | Resolved path to the real `claude` binary |
| `PATH` | `shimDir:${original PATH}` — prepends the shim for non-zsh shells (needs a resolved binary to exec) |

The decoupling matters in the bundled app: the sidecar's minimal launchd `PATH` may not contain the user's `claude`, so `realClaude` is null — but the zdotdir `.zshrc` sources the user's `~/.zshrc` and then resolves `claude` itself (`whence -p claude`), so the relay `claude` function is still defined.

### Relay dir + claude binary resolution

`RELAY_PLUGIN_DIR` is `process.env.OA_RELAY_BUNDLE ?? resolve(import.meta.dir, "..", "..", "relay")` — the Tauri-staged relay resource in the bundle (where `import.meta.dir` is a virtual path), the source `relay/` in dev. `SHIM_AVAILABLE = existsSync(<zdotdir>)`.

`REAL_CLAUDE` is resolved **once at module load** via `whichClaude()` (`core/src/claudeWhich.ts`) — `Bun.which("claude", …)` against a `PATH` augmented with `/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, `~/.local/bin` (so it works from a packaged GUI app's minimal `PATH`). Resolved before the shim dir is on `PATH`, so the shim's `exec` never recurses. Null when not found — see the zdotdir fallback above.

### Gotchas

- `undefined` values in `base` are stripped — no `key=undefined` in the env.
- When `base` has no `PATH` at all and `realClaude` is set, `PATH` is set to `shimDir` only (no trailing `:` that POSIX would interpret as the current directory).
- `buildPtyEnv` is called with `process.env` as `base`, which is the core server's inherited environment — not the user's interactive shell environment.

### Unit test examples

```ts
// ZDOTDIR is set only when claude is found:
expect(buildPtyEnv({ ...ENV_BASE, realClaude: "/usr/local/bin/claude" }).ZDOTDIR)
  .toBe("/repo/relay/shim/zdotdir");
expect(buildPtyEnv({ ...ENV_BASE, realClaude: null }).ZDOTDIR).toBeUndefined();

// Shim prepended to PATH:
expect(buildPtyEnv({ ...ENV_BASE, realClaude: "/usr/local/bin/claude" }).PATH)
  .toBe("/repo/relay/shim:/usr/bin");

// No shim when claude not found:
expect(buildPtyEnv({ ...ENV_BASE, realClaude: null }).PATH).toBe("/usr/bin");

// No trailing colon when base has no PATH:
expect(buildPtyEnv({ ...ENV_BASE, base: {}, realClaude: "/usr/local/bin/claude" }).PATH)
  .toBe("/repo/relay/shim");
```

---

## The Relay Plugin (`relay/`)

### Purpose

The `relay/` workspace is a Claude Code plugin (`--plugin-dir`) loaded **per-session** inside every Bismuth app terminal tab. It has no global install, no daemon, and no slash commands — only four event hooks that POST registration/heartbeat/subagent events to the core server's relay registry.

The relay powers the "agents" graph mode: `you → terminal-tab sessions → subagents`.

### How the plugin loads

1. `terminal.ts` resolves `REAL_CLAUDE` once and computes `RELAY_PLUGIN_DIR` relative to itself (`core/src/terminal.ts → ../../relay`).
2. When a tab opens, `buildPtyEnv` sets:
   - `BISMUTH_REAL_CLAUDE` = the real `claude` binary path
   - `BISMUTH_RELAY_PLUGIN` = the relay plugin dir
   - `ZDOTDIR` = `relay/shim/zdotdir/` (zsh-only override)
   - `PATH` = `relay/shim:${original PATH}` (non-zsh fallback)
3. When the user runs `claude` in the tab:
   - **zsh**: `ZDOTDIR` redirects init to `relay/shim/zdotdir/.zshrc`, which sources `$HOME/.zshenv` → `$HOME/.zshrc` then defines a `claude()` shell function: `command "$BISMUTH_REAL_CLAUDE" --plugin-dir "$BISMUTH_RELAY_PLUGIN" "$@"`. The function survives `.zshrc` re-prepending `PATH`.
   - **other shells**: the PATH shim `relay/shim/claude` is found first and `exec "$BISMUTH_REAL_CLAUDE" --plugin-dir "$BISMUTH_RELAY_PLUGIN" "$@"`.

### The PATH shim (`relay/shim/claude`)

```bash
#!/bin/bash
exec "$BISMUTH_REAL_CLAUDE" --plugin-dir "$BISMUTH_RELAY_PLUGIN" "$@"
```

A plain `exec` — no logic, no recursion risk (the real binary path was resolved before the shim dir entered PATH).

### The zsh init files (`relay/shim/zdotdir/`)

**`.zshenv`** — sourced first by zsh (before `.zshrc`):
```bash
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
```
Loads the user's real `.zshenv` so nothing in their environment is lost.

**`.zshrc`** — sourced for interactive zsh shells:
```bash
export ZDOTDIR="$HOME"                          # restore normal ZDOTDIR immediately
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"
if [[ -n "$BISMUTH_REAL_CLAUDE" && -n "$BISMUTH_RELAY_PLUGIN" ]]; then
  claude() { command "$BISMUTH_REAL_CLAUDE" --plugin-dir "$BISMUTH_RELAY_PLUGIN" "$@"; }
fi
```

Key points:
- `ZDOTDIR` is restored to `$HOME` before sourcing the user's config, so nested shells and any code that checks `ZDOTDIR` behave normally.
- The `claude` shell function is defined **after** the user's `.zshrc` runs, so it wins even if `.zshrc` re-prepends `/usr/local/bin` or similar directories to `PATH`.

### Hook configuration (`relay/hooks/hooks.json`)

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "bun run ${CLAUDE_PLUGIN_ROOT}/bin/session-start-hook.ts" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "bun run ${CLAUDE_PLUGIN_ROOT}/bin/recall-hook.ts" }] }],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "bun run ${CLAUDE_PLUGIN_ROOT}/bin/subagent-start-hook.ts" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "bun run ${CLAUDE_PLUGIN_ROOT}/bin/subagent-stop-hook.ts" }] }]
  }
}
```

The `SessionStart` matcher `"startup|resume|clear|compact"` ensures that `claude --resume` and `claude --continue` sessions also register.

### Hook payloads (confirmed, Claude Code v2.1.165)

| Hook | Relevant fields |
|------|----------------|
| `SessionStart` | `session_id`, `cwd`, `source` |
| `UserPromptSubmit` | `session_id`, `cwd` |
| `SubagentStart` | `session_id` (parent), `agent_id`, `agent_type` |
| `SubagentStop` | `agent_id`, `agent_type`, `last_assistant_message` |

### Hook scripts (`relay/bin/`)

All hooks follow the same pattern: gate on `CLAUDE_TERMINAL_ID`, parse stdin JSON, POST to core.

**`session-start-hook.ts`** — `SessionStart`:
```ts
// Posts to POST /relay/session
await postRelay("/relay/session", { sessionId, terminalId, cwd });
```

**`recall-hook.ts`** — `UserPromptSubmit`:
```ts
// Re-posts the same /relay/session payload — acts as a heartbeat.
// Also self-heals: if SessionStart was missed (e.g. out-of-order), this registers the session.
await postRelay("/relay/session", { sessionId, terminalId, cwd });
```

**`subagent-start-hook.ts`** — `SubagentStart`:
```ts
// Posts to POST /relay/subagent/start
await postRelay("/relay/subagent/start", {
  parentSessionId: input.session_id,
  agentId: input.agent_id,
  agentType: input.agent_type ?? "agent",
});
```

**`subagent-stop-hook.ts`** — `SubagentStop`:
```ts
// Posts to POST /relay/subagent/stop
await postRelay("/relay/subagent/stop", { agentId, lastMessage });
```

### `lib/report.ts` — shared hook infrastructure

All hooks import from `relay/lib/report.ts`:

```ts
// Timeout budget for each POST — hooks never block the user's session.
const BUDGET_MS = 2000;

// Reads the Claude Code hook payload from stdin. Returns {} on empty/invalid JSON.
async function readHookInput(): Promise<HookInput>

// POST best-effort: 2s timeout, all errors swallowed.
async function postRelay(path: string, body: unknown): Promise<void>

// Gate: returns the tab id or undefined if not in a Bismuth terminal.
function terminalId(): string | undefined

// Runs the hook body: always exits 0, swallows all thrown errors.
function runHook(fn: () => Promise<void>): void
```

The `HookInput` interface:
```ts
interface HookInput {
  session_id?: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
  last_assistant_message?: string;
  [k: string]: unknown;
}
```

**Best-effort guarantees:**
- Hooks always exit 0 (never block or fail the user's Claude session).
- Every network error is swallowed.
- Hooks without `CLAUDE_TERMINAL_ID` are no-ops.
- The 2-second `AbortSignal.timeout` prevents any one hook from hanging.

---

## Relay Registry (`core/src/relay.ts`)

An **in-process, in-memory** registry. There is no database, no file on disk, no daemon. The registry lives only while the core server process runs.

### Data types

```ts
interface RelaySession {
  sessionId: string;    // Claude Code session_id
  terminalId: string;   // CLAUDE_TERMINAL_ID (pty session id)
  cwd: string;          // working directory; used as the graph node label
  lastSeen: number;     // ms epoch; bumped on every heartbeat
}

interface RelaySubagent {
  agentId: string;          // SubagentStart agent_id (stable for the subagent's lifetime)
  parentSessionId: string;  // the session that spawned it
  agentType: string;        // e.g. "general-purpose", "Explore", "Plan"
  startedAt: number;
  done: boolean;            // flipped true on SubagentStop
  doneAt?: number;
  lastMessage?: string;     // SubagentStop last_assistant_message
}

interface RelaySnapshot {
  sessions: RelaySession[];
  subagents: RelaySubagent[];
}
```

### Functions

**`registerSession({ sessionId, terminalId, cwd }, now?)`**

Register or heartbeat a session. Behaviours:
- Same `sessionId`, same `terminalId` → bumps `lastSeen`; preserves existing `cwd` if the new one is empty; keeps all subagents. This is the `UserPromptSubmit` (heartbeat) path.
- Different `sessionId`, same `terminalId` → the user re-ran `claude` in the same tab. The old session and all its subagents are dropped before registering the new one.

```ts
// Register a new session
registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "/Users/m/dev/proj" });

// Heartbeat (same sessionId) — cwd "" preserves existing cwd
registerSession({ sessionId: "s1", terminalId: "tab-1", cwd: "" });

// New session in same tab — evicts s1 + its subagents
registerSession({ sessionId: "s2", terminalId: "tab-1", cwd: "/Users/m/dev/proj" });
```

**`endSession(sessionId)`**

Removes the session and all its subagents (called from `POST /relay/session/end`).

**`startSubagent({ parentSessionId, agentId, agentType }, now?)`**

Adds a subagent. The registry does not validate that the parent session exists; orphan subagents are pruned later by `prune()`.

**`stopSubagent({ agentId, lastMessage? }, now?)`**

Marks a subagent `done = true` and records `doneAt`. Unknown ids are silently ignored (missed `SubagentStart` is handled gracefully).

**`prune(liveTerminalIds: Set<string>, now?)`**

Called from `GET /agent-graph` with `new Set(listSessionIds())` — the live pty ids from `terminal.ts`. Drops:
1. Sessions whose `terminalId` is not in `liveTerminalIds` (tab was closed — there is no terminal-close hook, so cleanup happens at read time).
2. Orphaned subagents whose parent session was dropped in step 1.
3. Finished subagents past their TTL (60 seconds).

**`snapshot(now?)`**

Returns the current `RelaySnapshot` (sessions + subagents arrays). Also runs the done-TTL sweep so stale subagents are shed even without a preceding `prune`.

**`resetRelay()`**

Clears all state. Tests only.

### Done-subagent TTL

```ts
const DONE_SUBAGENT_TTL_MS = 60_000; // 60 seconds
```

A subagent that has been marked `done` lingers for 60 seconds before `snapshot`/`prune` removes it, so brief subagents remain visible in the graph for a beat after they complete.

---

## Core Server Relay Endpoints

These routes live in the **read table** in `server.ts` (not `mutatingRoutes`) — they update the agent registry but do not touch the vault, so no cache invalidation or SSE broadcast occurs.

| Route | Body | Behaviour |
|-------|------|-----------|
| `POST /relay/session` | `{ sessionId, terminalId, cwd? }` | `registerSession` |
| `POST /relay/session/end` | `{ sessionId }` | `endSession` |
| `POST /relay/subagent/start` | `{ parentSessionId, agentId, agentType? }` | `startSubagent` |
| `POST /relay/subagent/stop` | `{ agentId, lastMessage? }` | `stopSubagent` |
| `GET /agent-graph` | — | Prune registry, build + return `GraphData` |

All 400 errors from relay endpoints are silently swallowed by the hooks (best-effort).

`GET /agent-graph` is the only route that calls both `prune` (with the live pty set) and `buildAgentGraph`. The frontend polls it while agents mode is active.

---

## Agents Graph (`core/src/agents.ts`)

`buildAgentGraph` is a **pure function** over a `RelaySnapshot` and a set of live terminal ids. It returns a `GraphData` with only session and subagent nodes — the "you" hub and `you → session` edges are injected on the frontend (`app/src/graph/youNode.ts` `withYouAgents`).

### Node ids

| Node type | Id format |
|-----------|-----------|
| Session | `agent:sess:<sessionId>` |
| Subagent | `agent:sub:<agentId>` |

### Node fields

- **`kind`**: always `"agent"`
- **`label`**: for sessions, `basename(cwd)` or the `terminalId` if `cwd` is empty; for subagents, the `agentType` string
- **`state`**: `"awake"` or `"idle"` (see below)
- **`parent`**: set on subagent nodes to the parent session's node id; undefined on root session nodes

### Awake/idle determination

A session is `"awake"` if either:
1. `now - lastSeen <= 10 * 60 * 1000` (10 minutes), **or**
2. It has at least one running (not-done) subagent — a session past its heartbeat window stays awake while an Agent-tool call is executing (since `UserPromptSubmit` doesn't fire mid-turn)

A subagent is `"awake"` if `done === false`, `"idle"` if `done === true`.

### Edges

Each subagent node gets one edge: `{ from: parentSessionNodeId, to: subagentNodeId, kind: "message" }`.

Sessions whose terminal tab is closed (`terminalId` not in `liveTerminalIds`) are dropped. Their subagents are also dropped — no orphan nodes are emitted.

### Example

```ts
const g = buildAgentGraph(
  { sessions: [{ sessionId: "s1", terminalId: "tab-1", cwd: "/Users/m/dev/bismuth", lastSeen: TWO_MIN_AGO }],
    subagents: [{ agentId: "a1", parentSessionId: "s1", agentType: "Explore", startedAt: TWO_MIN_AGO, done: false }] },
  new Set(["tab-1"]),
  NOW,
);
// g.nodes[0]: { id: "agent:sess:s1", label: "bismuth", kind: "agent", state: "awake" }
// g.nodes[1]: { id: "agent:sub:a1", label: "Explore", kind: "agent", state: "awake", parent: "agent:sess:s1" }
// g.edges[0]: { from: "agent:sess:s1", to: "agent:sub:a1", kind: "message" }
```

---

## Frontend Terminal Component (`app/src/Terminal.tsx`)

The `TerminalTab` Solid component mounts an xterm.js emulator and bridges it to the backend WebSocket PTY.

### Key implementation details

- **Font loading**: waits for `Monaspace Xenon` via `document.fonts.load(...)` before constructing xterm, so the grid is sized with the correct font metrics from the start. If the font fails to load, rendering falls back gracefully.
- **Color theming**: reads `--term-bg`/`--term-fg` CSS variables (falling back to `--bg`/`--fg`), then builds a 16-color ANSI palette from the active accent palette via `buildAnsiPalette`. The 240-entry extended ANSI palette (slots 16–255) is tinted toward the accent palette via `buildExtendedAnsi`, with the result memoized per palette key.
- **Custom cursor**: xterm's native cursor is made invisible (`cursor: "rgba(0,0,0,0)"`); a custom `.xterm-custom-cursor` overlay div is positioned using `transform: translate(...)` and updated on `onRender`/`onCursorMove` events. This enables CSS transitions.
- **Click-to-position**: a mousedown/mouseup tracker allows single-point clicks (not drags) on the current prompt row to jump the cursor left or right using `\x1b[C`/`\x1b[D` sequences.
- **Resize**: a `ResizeObserver` on the container div, rAF-debounced to collapse resize bursts (e.g. divider drag). Zero-size containers are ignored.
- **Reconnection**: exponential backoff on WebSocket close (`500ms * 2^attempt`, max 8s). Each reconnection starts a **fresh PTY session** (no session resume). The terminal prints `[reconnecting…]` on disconnect and `[backend unavailable]` on error.
- **Cleanup safety**: `onCleanup` is registered synchronously inside `onMount` before the `document.fonts.load` await, so teardown fires even if the tab is closed while the font is still loading.

### Font stack

```
'Monaspace Xenon', 'FiraCode Nerd Font', 'Symbols Nerd Font',
'MesloLGS NF', 'JetBrainsMono Nerd Font', ui-monospace, 'Menlo', monospace
```

### Settings consumed

| Setting | Effect |
|---------|--------|
| `settings.terminal.fontSize` | xterm `fontSize` |
| `settings.terminal.lineHeight` | xterm `lineHeight` |
| `settings.appearance` (accentPalette) | 16-color + extended ANSI palette |

### Mounting

The component renders a single `<div class="term-host" />` and stays mounted for the tab's lifetime; the parent controls visibility via `display: none`. `TerminalTab` is keyed by `props.id` — one instance per tab id.

---

## Agents Graph Frontend

`GET /agent-graph` is polled by the frontend **only while agents mode is active**, using a change-signature dedup (`agentGraphSig`) to avoid re-settling the force layout when nothing has changed:

```ts
// agentGraphSig hashes node id+label+state+parent and edge endpoints
function agentGraphSig(g: GraphData): string {
  return (
    g.nodes.map((n) => `${n.id}:${n.label}:${n.state ?? ""}:${n.parent ?? ""}`).join("|") +
    "##" +
    g.edges.map((e) => `${e.from}>${e.to}`).join("|")
  );
}
```

The "you" hub and `you → session` edges are injected on the frontend. The `AgentsGraph.tsx` overlay (rendered over the WebGL canvas in agents mode) shows:
- Session count, subagent count, awake/idle breakdown
- An "Organization" picker (Democracy / Republic / Dictatorship) that re-wires communication channels for the visualization — no backend effect

---

## Scope and Constraints

- **App-local only**: the relay registry is in-process in the core server. No cross-machine agents, no persistence across restarts, no messaging between instances.
- **Depth 1**: subagents cannot spawn their own subagents, so the tree is always exactly 2 levels deep (session → subagents).
- **No terminal-close hook**: when a tab closes, sessions are pruned lazily at `GET /agent-graph` read time, not eagerly.
- **Multiple windows**: each Bismuth window runs its own backend (different port). In-tab `claude` sessions report to that window's backend only, because `CLAUDE_RELAY_URL` is set to `http://localhost:<server.port>` at session creation time.
- **Sessions without `CLAUDE_TERMINAL_ID`**: if `claude` is run outside a Bismuth terminal (e.g. in a standalone shell), the relay hook is not loaded at all (requires `--plugin-dir`). Even if somehow loaded, the `CLAUDE_TERMINAL_ID` gate in `lib/report.ts` makes every hook a no-op.

Source: `core/src/terminal.ts`, `app/src/Terminal.tsx`, `relay/hooks/hooks.json`, `relay/bin/session-start-hook.ts`, `relay/bin/recall-hook.ts`, `relay/bin/subagent-start-hook.ts`, `relay/bin/subagent-stop-hook.ts`, `relay/lib/report.ts`, `relay/shim/claude`, `relay/shim/zdotdir/.zshrc`, `relay/shim/zdotdir/.zshenv`, `core/src/relay.ts`, `core/src/agents.ts`, `core/src/server.ts`, `app/src/graph/agentGraphSig.ts`, `app/src/graph/AgentsGraph.tsx`, `core/test/terminal.test.ts`, `core/test/relay.test.ts`, `core/test/agents.test.ts`
