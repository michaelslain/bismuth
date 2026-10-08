# Terminal tabs and the relay

A terminal tab is a real shell inside Bismuth, opened in your vault directory. When you run `claude` in one, a small plugin (the relay) reports that session and its subagents to the running app, and loads Bismuth's MCP server and memory recall for that session only.

Use a terminal tab when you want Claude Code's full interactive interface next to your notes. For a conversation rendered inside the app, use [chat](../chat/overview.md); to compare the ways an agent reaches your vault, see [connect an agent](../chat/connect-an-agent.md).

```bash
# in an app terminal tab, in your vault
claude
bismuth relay list      # from another tab: the session and its subagents appear
```

## How do I open a terminal?

Run the **Open Terminal** command from the command palette, or press `` Mod+` `` or `Mod+J` (the `terminal` keybinding; rebind it under `keybindings` in `.settings`). The tab starts a login shell in the vault directory, using `$SHELL` (or `/bin/sh` when unset).

- Reload and reconnect. Reloading the window or a network drop keeps the shell running. The tab reattaches to the same process for 30 seconds, with its working directory and environment intact.
- Closing. Closing the tab, or exiting the shell, ends the process. When the shell exits, the tab closes itself, unless the shell died within 750 ms of connecting; then the tab stays open showing `[process exited]` so a startup error stays readable.
- Dropping files. Drag a file from the file tree or the OS onto a terminal to insert its shell-quoted path at the prompt, followed by a space. See [draggables](../overview/draggables.md).
- Opening fast. The app keeps one warm login shell ready, so a new tab shows its prompt immediately.

## What changes when I run `claude` in a terminal tab?

A bare `claude` in an app terminal runs as `claude --plugin-dir <relay>`. The relay plugin loads for that session only, and nothing is installed in `~/.claude`. It does four things:

- Reports the session. The session and any subagents it spawns are registered with the app, and dropped when you exit or close the tab. `bismuth relay list` prints them.
- Provides the MCP server. In a development checkout, `relay/.mcp.json` declares the Bismuth MCP server for the session. The packaged app registers it machine-wide instead ([MCP](../mcp/overview.md)).
- Recalls memory. When the vault's [daemon](../daemon/overview.md) is enabled, the plugin injects relevant memory at session start, on each prompt, and after each batch of tool calls.
- Collects transcripts. With the daemon enabled, a session's transcript is saved into memory as an auto note when the session ends.

The plugin never blocks Claude: every hook has a short timeout, swallows its errors, and exits 0. Outside an app terminal there is no `CLAUDE_TERMINAL_ID`, so `claude` does not load the plugin at all.

`claude` run in a plain shell outside the app is unaffected. The same applies to visibility: a terminal session is you, with full filesystem access, and is not restricted by [visibility](../vault/visibility.md).

## What does the shell see?

Each tab starts with the variables below set on top of your own environment.

| Variable | Value |
|----------|-------|
| `TERM` | `xterm-256color` |
| `CLAUDE_TERMINAL_ID` | This tab's session id; the hooks require it |
| `CLAUDE_RELAY_URL` | This window's backend, such as `http://localhost:4321` |
| `BISMUTH_API` | The same URL, so `bismuth app …` drives this window |
| `BISMUTH_MEMORY_DIR` | The vault's memory directory; set only when the daemon is enabled |
| `DISABLE_AUTO_UPDATE`, `DISABLE_UPDATE_PROMPT` | `true`, which silences oh-my-zsh update prompts |
| `CLAUDE_JOB_DIR`, `CLAUDE_WORKFLOW_ID` | Empty, so a workflow variable from the app's own environment does not leak into your sessions |

Each window runs its own backend on its own port, so a `claude` session reports only to the window whose terminal it runs in.

## Which settings change the terminal?

A terminal's text is the same size and row height as code in a note: [`appearance`](../settings/reference.md#appearance) `editorFontSize` and `monoScale` set its size, and [`editor`](../settings/reference.md#editor) `lineHeight` sets its row height.

Colors follow the active theme: the terminal reads `--term-bg` and `--term-fg` (falling back to `--bg` and `--fg`) and builds the 16-color ANSI palette from the theme's accent palette.
The text cursor is the app-wide cursor ([`appearance`](../settings/reference.md#appearance) `cursorWidth`, `cursorGlideMs`, `cursorBlinkSeconds`). The font stack starts with Monaspace Xenon, then common Nerd Font faces, then the system monospace.

## Why does `claude` not load the plugin in my shell?

- zsh. The app points `ZDOTDIR` at a Bismuth init directory that sources your own `.zshenv`, `.zprofile` and `.zshrc` and then defines a `claude` function. Because the function is defined after your `.zshrc`, it wins even if your `.zshrc` re-prepends `PATH`.
- Other shells. A `claude` shim at the front of `PATH` execs the real binary with `--plugin-dir`. It needs the real `claude` to be found; if Bismuth cannot find one on its search path, a non-zsh tab runs whichever `claude` your shell finds.
- No relay files. If the relay directory is missing, the tab runs your normal login shell with no shim.

## How it works

### The PTY and its WebSocket

Each tab is a `bun-pty` session in `core/src/terminal.ts`, exposed on `GET /terminal?cols=<n>&rows=<n>&termId=<id>` and rendered by xterm.js in `app/src/Terminal.tsx`. The WebSocket carries binary frames:

| Tag byte | Direction | Payload |
|----------|-----------|---------|
| `0x00` | client to server | Raw keystrokes as UTF-8 bytes after the tag |
| `0x01` | client to server | `cols` and `rows` as two little-endian uint16s after the tag |
| none | server to client | Raw PTY output bytes, written straight to xterm |

```ts
// stdin: tag 0x00 + keystroke bytes (app/src/Terminal.tsx)
function stdinFrame(bytes: Uint8Array): Uint8Array {
    const frame = new Uint8Array(1 + bytes.length)
    frame[0] = 0x00
    frame.set(bytes, 1)
    return frame
}
```

The upgrade enforces an origin allow-list: no `Origin` header (the Tauri webview), `localhost` or `127.0.0.1` on any port, the `tauri://` scheme, or a `10.x.x.x` address. Anything else gets `403 forbidden origin`.

### Session lifecycle and reattach

On connect the server reads the client's stable `termId` (its `::term:<uuid>` content id). If `getSessionByTermId` finds a live session, the server cancels any pending kill and pipes to that same PTY.
Otherwise it claims a warm shell with `claimPooledSession` or cold-spawns one with `createTerminalSession`, keyed by `termId`.

On close, the code decides. A clean close (`1000`: the shell exited, or the client disposed the tab) kills the session now. An abnormal close (reload `1001`, drop `1006`) keeps the PTY alive for a grace window, 30 seconds by default (`BISMUTH_TERMINAL_GRACE_MS`).
Every PTY is killed synchronously on process exit, so shells do not outlive a backend restart. `killSession` also calls the relay's `prune` with the live terminal ids, which is how the registry learns a tab closed.

### Output buffering and the warm pool

A session is decoupled from any one socket. One permanent `pty.onData` reader forwards output to the live socket sink when one is attached, and otherwise appends it to a replay buffer capped at 256 KiB (most recent wins).
`attachSink` drains the buffer first and then goes live, so order is preserved. That is why a shell can render its prompt before any client connects and why output during a brief disconnect is not lost.

The warm pool keeps one login shell (`POOL_SIZE`) spawned and rc-loaded ahead of demand. `prewarmPool(cwd, relayPort, memoryDir)` starts it at server start; `claimPooledSession` hands it out, resizes it to the real viewport and refills the pool.
`setPoolMemoryDir` flushes and re-warms idle shells when `settings.daemon.enabled` toggles, because a pooled shell caches its environment at spawn. Unclaimed pooled shells are excluded from `listSessionIds()`, so they never prune the relay registry.

### The PTY environment

`buildPtyEnv` is a pure function from the parent environment to the shell's environment (unit-tested in `core/test/terminal.test.ts`); `undefined` values are dropped.
Beyond the variables in the table above, when the relay files exist (`shimAvailable`) it sets `BISMUTH_RELAY_PLUGIN` and `ZDOTDIR`, and when the real `claude` was resolved it sets `BISMUTH_REAL_CLAUDE` and prepends the shim directory to `PATH`.

The decoupling matters in the packaged app: the sidecar's minimal launchd `PATH` may not contain your `claude`, so the real path can be null. The zsh init then resolves `claude` itself after your `.zshrc` loads (`whence -p claude`), and the function is still defined.

The relay directory is `BISMUTH_RELAY_BUNDLE` in the packaged app and `relay/` in the repo.
The real `claude` is resolved once at module load by `whichClaude()` against a search path augmented with Homebrew, `~/.bun/bin`, `~/.local/bin` and nvm node directories, before the shim directory is on `PATH`, so the shim never recurses.

### Shim specs and per-backend wrapping

`shimSpecsFor(backends, resolve, opts)` turns the backend catalog into the list of binaries the shell wraps.
It skips backends without a terminal surface and backends whose `relayReporting` is `none`; it includes a `wrapper`-mode backend only when `WRAPPER_REPORTING_ENABLED` is true, and never wraps `claude` that way.
A backend whose binary does not resolve still gets a spec with `realPath: null`, and the zsh init retries with `whence -p`.

`serializeShimSpecs` writes the specs to `BISMUTH_SHIM_SPECS` as flat text: ASCII Record Separator (`\x1e`) between records and Unit Separator (`\x1f`) between the fields `id`, `binary`, `realPath` and `mode`.
Those bytes never appear in a path, zsh splits them with `(ps:\x1e:)` flags, and the non-zsh script splits them with `IFS`, so no `jq` or `python` is needed.

The zsh init (`relay/shim/zdotdir/.zshrc`) defines one function per spec. A `hooks` entry runs the real binary with `--plugin-dir "$BISMUTH_RELAY_PLUGIN"`; a `wrapper` entry runs it through `relay/bin/wrap.ts`.
Its sibling files keep your shell normal: `.zshenv` and `.zprofile` re-source yours, since redirecting `ZDOTDIR` would otherwise skip them. The shell starts as a login shell (`loginShellArgs()` returns `-l`), so Homebrew, bun and nvm `PATH` entries from `.zprofile` apply as in a normal terminal.
`.zshrc` restores `ZDOTDIR` to `$HOME` first and repairs `HISTFILE` when macOS's `/etc/zshrc` pointed it at the shim directory.

For non-zsh shells, `relay/shim/claude` is a plain `exec "$BISMUTH_REAL_CLAUDE" --plugin-dir "$BISMUTH_RELAY_PLUGIN" "$@"`, and `relay/shim/agent-shim` is a multi-call script: `buildWrapperShimDir` creates one symlink per resolvable wrapper-mode backend, and the script looks up its own invoked name in `BISMUTH_SHIM_SPECS`.

### How the wrapper reporter works

A backend with `relayReporting: "wrapper"` has no hook system, so the shell runs it through `relay/bin/wrap.ts <backendId> <realBinaryPath> [args…]`.
It posts `POST /relay/session` with the backend id, runs the real binary with inherited stdio so it keeps the tty, forwards `SIGINT` and `SIGTERM` to the child, awaits the exit code (signal termination arrives as `128+N`), reports `/relay/session/end`, and exits with the same code.
`wrap.ts` never reports for `claude`.

`WRAPPER_REPORTING_ENABLED` in `core/src/terminal.ts` is `false`, so wrapping is off. Wrapping an interactive TUI risks signal handling, tty ownership and exit-code fidelity.
`relay/test/wrap.test.ts` verifies the mechanism against a stub binary and a mock relay server, which is not the same as a real agent CLI under a real PTY. The catalog's per-backend `relayReporting` is the other gate; both must agree before a backend is wrapped.

### The relay plugin

The `relay/` workspace is a Claude Code plugin loaded with `--plugin-dir`. It has no daemon and no slash commands, only hooks, declared in `relay/hooks/hooks.json`.
Every hook script in `relay/bin/` follows one pattern, built from `relay/lib/report.ts`: gate on `CLAUDE_TERMINAL_ID`, read the hook payload from stdin, post to core, exit 0.

| Hook | Script | Posts | Memory job (daemon enabled) |
|------|--------|-------|----------------------------|
| `SessionStart` (matcher `startup\|resume\|clear\|compact`) | `session-start-hook.ts` | `POST /relay/session` | `POST /memory/recall`, mode `session-start` |
| `UserPromptSubmit` | `recall-hook.ts` | `POST /relay/session` again, as a heartbeat; it also registers a session whose start was missed | mode `prompt` |
| `PostToolBatch` | `tool-batch-hook.ts` | none | mode `tool`, each tool response capped at 2000 characters; also fires inside subagents |
| `SubagentStart` | `subagent-start-hook.ts` | `POST /relay/subagent/start` | mode `subagent` |
| `SubagentStop` | `subagent-stop-hook.ts` | `POST /relay/subagent/stop` | none |
| `SessionEnd` | `session-end-hook.ts` | `POST /relay/session/end`, skipped on `clear` and `compact` | saves the transcript as an auto note, skipped on `compact` |

Memory work runs only when `BISMUTH_MEMORY_DIR` is set. `relay/lib/recall.ts` sends each recall to core's `POST /memory/recall` with a timeout (1500 ms for prompt, session start and subagent; 700 ms for a tool batch).
Core owns ranking, dedup and settings; the hooks only forward the payload and print `additionalContext`. If core is unreachable, the reply is not 2xx, or the call times out, nothing is printed.

All hooks are best-effort: each post has a 2 second budget (`BUDGET_MS`), every network error is swallowed, and a hook with no `CLAUDE_TERMINAL_ID` is a no-op.

### The relay registry

`core/src/relay.ts` is an in-process, in-memory registry of terminal-tab sessions and their subagents. It has no database and no file; it lives while core runs.

```ts
interface RelaySession { sessionId; terminalId; cwd; backend?; lastSeen }
interface RelaySubagent { agentId; parentSessionId; agentType; workflowId?; startedAt; done; doneAt?; lastMessage? }
```

- `registerSession`: The same `sessionId` and `terminalId` bumps `lastSeen`, keeps an existing `cwd` when the new one is empty, keeps the existing `backend` when the new one is omitted (default `claude`), and keeps subagents.
  A different `sessionId` on the same `terminalId` means you re-ran `claude` in that tab: the old session and its subagents are dropped first.
- `endSession` removes a session and its subagents.
- `startSubagent` adds a subagent without checking the parent exists; `prune` removes orphans. A `workflowId` groups subagents spawned by one workflow.
- `stopSubagent` marks it done; an unknown id is ignored.
- `prune(liveTerminalIds)`, called from `killSession`, drops sessions whose terminal tab has closed, then orphaned subagents, then expired finished ones.
- `snapshot` returns both lists after sweeping expired subagents. `redactSnapshot` drops each subagent's `lastMessage`.

A finished subagent lingers for 8 seconds (`DONE_SUBAGENT_TTL_MS`) so a brief one is still visible for a beat.
A subagent that never reports a stop is presumed finished after 2 hours (`RUNNING_SUBAGENT_MAX_MS`): `SubagentStop` is one best-effort post that Claude Code can itself fail to deliver, and the parent's `Stop` hook is not a turn boundary for background subagents, so nothing cheaper proves one is still alive.
`core/src/chat.ts` imports both constants to sweep a chat's own Task-tool subagents the same way.

### Relay routes

The routes live in `core/src/routes/relay.ts`, in the read table: they update the registry but not the vault, so there is no cache invalidation and no SSE broadcast. Hooks swallow any 400.

| Route | Body | Effect |
|-------|------|--------|
| `POST /relay/session` | `{ sessionId, terminalId, cwd?, backend? }` | `registerSession` |
| `POST /relay/session/end` | `{ sessionId }` | `endSession` |
| `POST /relay/subagent/start` | `{ parentSessionId, agentId, agentType?, workflowId? }` | `startSubagent` |
| `POST /relay/subagent/stop` | `{ agentId, lastMessage? }` | `stopSubagent` |
| `GET /relay/snapshot` | none | Owner requests get the full snapshot; every other caller gets the redacted one |

`GET /relay/snapshot` backs `bismuth relay list`. It redacts `lastMessage` for non-owners because that free text is a subagent's final output and can quote vault content.

### The frontend component

`TerminalTab` in `app/src/Terminal.tsx` mounts an xterm.js emulator, one instance per tab id, and keeps it mounted for the tab's life; the parent hides it with `display: none`.
It waits for the primary font with `document.fonts.load` before constructing xterm, so the grid uses the right metrics, and registers its cleanup before that await so closing a tab mid-load still tears down.

- Theming. The 16-color palette comes from `buildAnsiPalette`; slots 16 to 255 are tinted toward the accent palette by `buildExtendedAnsi`, memoized per palette key.
- Cursor. The native xterm cursor is invisible and an `.xterm-custom-cursor` overlay, positioned by transform on render and cursor-move events, draws the app cursor: an accent bar on the cell's left edge, gliding and blinking from the `appearance.cursor*` settings.
  It hides in the scrollback and while the terminal is unfocused.
- Click to position. A single click (not a drag) on the prompt row sends `\x1b[C` or `\x1b[D` to move the cursor. It is off on the alternate screen buffer, so clicks inside vim, `less` or a full-screen TUI send no stray arrow keys.
- Scroll following. The viewport stays pinned to new output, even while the tab is hidden, until you scroll up into the scrollback.
- Resize. A `ResizeObserver` on the container, debounced to one animation frame, ignores zero-size containers.
- Reconnect. The client passes its `termId`. An abnormal close prints `[reconnecting…]` and retries with exponential backoff (`500ms * 2^attempt`, capped at 8 s). A clean close closes the tab, or prints `[process exited]` when the shell lived under 750 ms.
  A socket error prints `[backend unavailable]`.

### Limits

- The registry is local to one core process: no cross-machine agents, no persistence across restarts, no messaging between instances.
- Subagents cannot spawn subagents, so the tree is two levels deep: session, then subagents.
- A `claude` session outside an app terminal never loads the plugin, and its hooks would no-op without `CLAUDE_TERMINAL_ID` anyway.

Source: `core/src/terminal.ts`, `core/src/relay.ts`, `core/src/routes/relay.ts`, `core/src/claudeWhich.ts`, `app/src/Terminal.tsx`, `relay/hooks/hooks.json`, `relay/bin/`, `relay/lib/report.ts`, `relay/lib/recall.ts`, `relay/shim/claude`, `relay/shim/agent-shim`, `relay/shim/zdotdir/`, `core/src/agentBackends/catalog.ts`, `cli/src/commands/relay.ts`, `core/test/terminal.test.ts`, `core/test/relay.test.ts`, `relay/test/wrap.test.ts`
