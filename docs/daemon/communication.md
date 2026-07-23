# Communication & Hooks

How the daemon's memory reaches your Claude Code sessions (recall/collect hooks), how it coordinates across machines (it doesn't pass messages — it gates on a shared owner file), and what the words "relay", "message", and "owner" actually mean now. The recurring editorial point: **there is no inter-agent or cross-machine message bus in this codebase.** The only multi-device story is file-based single-owner gating; the only thing that crosses *into* your sessions is the vault's memory, injected per-session by the **relay plugin**.

This page describes the *current* in-repo `@bismuth/daemon` model:

- The `relay/` workspace is a tiny Claude Code plugin (hooks only). Recall + collect are its scripts, not the MCP server's, and not global `~/.claude` hooks.
- There is **no `message_bot` MCP tool**. The MCP server exposes `remember`/`recall`/`forget` (memory CRUD), not a way to message the daemon session. The daemon's `sendMessage()` is an in-process call driven by crons/processes, never an MCP surface.

## Recall + collect live in the relay plugin

The two memory hooks ship in the **`relay/` workspace** and load **per-session, only inside Bismuth terminals** — nothing is written to your global `~/.claude/settings.json`:

- `core/src/terminal.ts` spawns each terminal tab's PTY with a PATH shim (`relay/shim/claude`) that makes a bare `claude` run `claude --plugin-dir <relay>`, plus env: `CLAUDE_TERMINAL_ID` (the tab's pty id), `CLAUDE_RELAY_URL` (this app's core server), and — **only when `settings.daemon.enabled` for this vault** — `BISMUTH_MEMORY_DIR` (the vault's `.daemon/memory`).
- The plugin's `hooks/hooks.json` binds the hooks; nothing is installed in `~/.claude`. Outside a Bismuth terminal the plugin isn't even present, and each hook additionally gates on `CLAUDE_TERMINAL_ID` (a cheap belt-and-suspenders guard via `relay/lib/report.ts`).

So memory is recalled into prompts + collected from transcripts **strictly for vault-scoped Bismuth sessions**, never globally. Both hooks are best-effort: they read JSON from stdin, swallow every error, and `exit(0)` within a budget (`runHook` in `lib/report.ts`) so they never block your session.

| Script | Hook event | Memory job (gated on `BISMUTH_MEMORY_DIR`) | Agent-graph job (always) |
| --- | --- | --- | --- |
| `relay/bin/recall-hook.ts` | `UserPromptSubmit` | Recall notes relevant to the prompt → inject as `additionalContext` | `POST /relay/session` (register/heartbeat this session node) |
| `relay/bin/session-end-hook.ts` | `SessionEnd` | Collect the transcript into memory as one auto note (except on `compact`) | `POST /relay/session/end` (drop the node, except on `clear`/`compact`) |

These two scripts each do **two** best-effort jobs concurrently (`Promise.all`): the memory job (this page) and an agent-graph job (the in-app "agents" graph — see [../terminal/overview.md](../terminal/overview.md) and [overview.md](overview.md)). The agent-graph job runs even when the daemon is disabled; the memory job no-ops without `BISMUTH_MEMORY_DIR`.

### `recall-hook.ts` — `UserPromptSubmit` (memory context injection)

Flow (`relay/bin/recall-hook.ts` + `relay/lib/memory.ts`):

1. No `CLAUDE_TERMINAL_ID` → return (not a Bismuth terminal tab).
2. Read stdin; in parallel POST `/relay/session` (heartbeat, 2s budget) **and** — if `BISMUTH_MEMORY_DIR` is set and `prompt` is a string — call `recallContext(dir, prompt)` (800ms budget).
3. `recallContext` runs `searchMemory(prompt, dir)` from `@bismuth/memory` — **pure keyword search, no LLM** (scoring detailed in [memory.md](memory.md)) — racing it against an 800ms timeout so a bloated graph degrades to "no recall" rather than stalling prompt submission. Empty/whitespace prompt or no matches → `null`.
4. On a non-null result, write the `UserPromptSubmit` `additionalContext` payload to stdout:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "<formatted notes>"
  }
}
```

`recallContext` is a thin alias for **`recallMemory(dir, prompt, budgetMs?)`** in `@bismuth/memory` (`memory/src/recall.ts`) — the ONE shared recall implementation. Its `formatRecall()` emits a `# Memories` header, then per note a `## <name> (<type>) [<tags>]` line, the content, and a `Links: [[...]]` line when the note has backlinks.

### The visual chat recalls too (SDK session, no relay plugin)

The relay hooks only fire in **terminal-tab CLI** Claude sessions. The in-app **visual chat** (`core/src/chat.ts`) is an Agent-SDK session that never loads the relay plugin, so it wired recall in-process instead: when the chat session carries a `memoryDir` (daemon enabled), `spawnChatQuery` registers a programmatic `hooks.UserPromptSubmit` on the SDK `query()` that calls the same `recallMemory(memoryDir, prompt)` and returns the same `additionalContext` shape. So both the app's Claude surfaces — terminal tabs and the visual chat — auto-recall from one implementation. (The chat already **collected** transcripts into memory via `captureToMemory`; before this it collected but never recalled — the asymmetry that made memory feel "not auto-injecting" once work moved into the chat.)

### `session-end-hook.ts` — `SessionEnd` (transcript → auto note)

Flow (`relay/bin/session-end-hook.ts` + `collectTranscript()` in `relay/lib/memory.ts`):

1. No `CLAUDE_TERMINAL_ID` → return.
2. Read stdin; `reason = input.reason` (`exit`/`logout`/`clear`/`compact`/…).
3. In parallel: if `BISMUTH_MEMORY_DIR` is set, `transcript_path` is present, **and** `reason !== "compact"`, call `collectTranscript(dir, transcript_path, session_id)`; and (unless `clear`/`compact`) POST `/relay/session/end`. `compact` is skipped because the same logical session continues; `clear` still collects but keeps the graph node (a fresh session re-registers).

`collectTranscript` parses the JSONL transcript **line by line**, keeping only entries where `type === "user" && message.role === "user"`. `extractText` takes string content directly or concatenates `type === "text"` parts. `stripInjectedBlocks` regex-strips host-injected noise: `<system-reminder>`, `<local-command-stdout>`, `<command-(name|message|args)>`, and `<command-stdout>` blocks.

**Skip rules:**

| Rule | Condition | Result |
| --- | --- | --- |
| CRON-SESSION skip | any kept message starts with `CRON_PREFIX = "[Cron: "` | return (no write) |
| TRIVIAL skip | total stripped chars `< MIN_BODY_CHARS = 50` | return (no write) |

The cron skip exists because daemon-fired crons prepend `"[Cron: <name>] "` to their prompts (`daemon/src/daemon/cron.ts`), which would otherwise pollute keyword recall — see [crons-and-processes.md](crons-and-processes.md).

**Body assembly:** each kept message becomes `## message N\n\n<text>`, joined. If the result exceeds `MAX_BODY_CHARS = 8000`, it is truncated to the head 4000 chars + `\n\n... [truncated] ...\n\n` + the tail 4000 chars.

**Note identity:** name `auto-<YYYYMMDD-HHMMSS>-<first 8 chars of sessionId>` (or `unknown` when no session id). The timestamp comes from `new Date()` at collection time. Frontmatter: `type: auto`, `tags: ["auto", "raw", "session"]`, `created`/`updated` = today's date. The write goes through `writeNote(...)` from `@bismuth/memory` against `<vault>/.daemon/memory` — one markdown note per session, into the **memory graph**, never a queue. The daemon's `dream` cron later consolidates these auto notes (see [memory.md](memory.md) and [crons-and-processes.md](crons-and-processes.md)).

### One note format, three writers

The relay collect-hook, the MCP `remember` tool, and the daemon's own writer all delegate to the same `@bismuth/memory` graph and read/write **one note format** against `<vault>/.daemon/memory`. The MCP memory tools (`mcp/src/memory.ts`) are themselves gated on `BISMUTH_MEMORY_DIR` (the MCP child inherits it from the terminal PTY) — they're registered only when the daemon is enabled (`mcp/src/server.ts` appends `memoryTools` only when `memoryDir()` is truthy). Again: these are `remember`/`recall`/`forget`, not `message_bot`.

## Inter-agent / cross-machine messaging: does not exist

**There is no inter-agent message bus, no network message queue, and no device-to-device messaging in this codebase.** What might superficially read as networked agent comms is not:

- **`sendMessage()` (`daemon/src/daemon/session.ts`)** is **not** networked agent-to-agent messaging. It is an in-process wrapper that drives one persistent Claude Agent SDK session **per vault** via `claudeQuery({ ..., options: { resume: <vault session id>, cwd: <vault root>, env: { BISMUTH_MEMORY_DIR }, appendSystemPrompt } })`. Callers are all local and internal: cron firing (`cron.ts`), processes (`process.ts`), and dream consolidation (`memory/dream.ts`). One machine runtime multiplexes every enabled vault; the per-call `cwd`/`env`/`resume`/identity are supplied so concurrent vault sessions never race.
- **The `/relay/*` routes** are local HTTP to *this app's own core server* (`CLAUDE_RELAY_URL`, default `http://localhost:4321`) to feed the in-app agents graph — same-machine, app-local, not device-to-device.

## What device coordination does exist: single-owner gating

The actual multi-device story is **single-owner gating** through shared on-disk JSON files — the "SHARED INTEGRATION CONTRACT v1" in `daemon/src/lib/owner.ts`. It coordinates **which** device's daemon does work; it does **not** pass messages between devices. All identity/ownership files live at the **machine** level under `MACHINE_DIR` (`BISMUTH_DAEMON_DIR || ~/.bismuth/daemon`, `daemon/src/lib/config.ts`) — NOT per-vault.

### Device identity — `daemon/src/lib/device.ts`

- `getDeviceId()` generates and persists a UUID at `~/.bismuth/daemon/device-id` (atomic tmp + rename), reused across restarts.
- `getDeviceLabel()` returns `os.hostname()`.

### `devices.json` — `daemon/src/lib/owner.ts`

A map `{ "<deviceId>": { label, lastSeenISO } }`. `heartbeatDevice()` upserts this device's entry with a fresh `lastSeenISO` on **every tick**, even when idle or non-owner, so the device stays selectable.

### `owner.json` — `daemon/src/lib/owner.ts`

Shape `{ ownerDeviceId, ownerLabel, updatedAt }`.

- **Absent file = UNCLAIMED** → falls back to legacy single-device behavior.
- `isOwner()` is `true` if `owner.json` is absent, otherwise `ownerDeviceId === thisDeviceId`.
- `setOwnerDevice()` claims ownership but **rejects** if the device has not heartbeated into `devices.json` first.
- `owner.json` is written byte-compatibly with what Bismuth reads — Bismuth is the cross-device coordinator that reads/writes it; the daemon only consults it.

### Owner-gating effect

When this device is not the owner, `sendMessage()` throws immediately (`"This device is not the owner — bot session is idle."`), so crons/processes/dreams on a non-owner device never drive the SDK session. The daemon still heartbeats so it stays selectable. See [lifecycle.md](lifecycle.md) and [crons-and-processes.md](crons-and-processes.md) for the reconcile/firing context.

## Summary

| Claim | Status | Anchor |
| --- | --- | --- |
| Recall + collect are relay-plugin hooks loaded via `claude --plugin-dir <relay>` | EXISTS | `relay/bin/{recall-hook,session-end-hook}.ts`, `terminal.ts` |
| Hooks gate on `CLAUDE_TERMINAL_ID` && `BISMUTH_MEMORY_DIR`; no `~/.claude/settings.json` write | EXISTS | `relay/lib/report.ts`, `relay/lib/memory.ts` |
| `recall` injects via `additionalContext`, `# Memories` header, 800ms budget, keyword search | EXISTS | `recallContext` / `formatNotes` / `searchMemory` |
| `collect` skips `[Cron: ` + `<50`-char sessions, 8000-char truncation, `auto-` note | EXISTS | `CRON_PREFIX`, `MIN_BODY_CHARS`, `collectTranscript` |
| `recall-hook` also POSTs `/relay/session`; `session-end-hook` POSTs `/relay/session/end` | EXISTS | the two hook scripts |
| `message_bot` MCP tool | DOES NOT EXIST (MCP exposes `remember`/`recall`/`forget`) | `mcp/src/{server,memory}.ts` |
| Inter-agent / cross-machine / device-to-device message bus | DOES NOT EXIST | whole-repo |
| `sendMessage()` is an in-process per-vault SDK session, cron/process/dream driven | EXISTS | `daemon/src/daemon/session.ts` |
| Single-owner gating via `devices.json` heartbeat + `owner.json` at `~/.bismuth/daemon` | EXISTS | `daemon/src/lib/{owner,device,config}.ts` |

See the rest of the daemon docs: [overview.md](overview.md), [lifecycle.md](lifecycle.md), [storage.md](storage.md), [crons-and-processes.md](crons-and-processes.md), [memory.md](memory.md), and the docs root [../README.md](../README.md).

Source: `relay/bin/recall-hook.ts`, `relay/bin/session-end-hook.ts`, `relay/lib/memory.ts`, `relay/lib/report.ts`, `daemon/src/daemon/session.ts`, `daemon/src/daemon/cron.ts`, `daemon/src/lib/owner.ts`, `daemon/src/lib/device.ts`, `daemon/src/lib/config.ts`, `memory/src/search.ts`, `memory/src/index.ts`, `mcp/src/memory.ts`, `mcp/src/server.ts`
</content>
</invoke>
