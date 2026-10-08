# Communication & Hooks

Covers how the daemon's memory reaches your Claude Code sessions (recall/collect hooks), how it coordinates across machines (it gates on a shared owner file rather than passing messages), and what "relay", "message", and "owner" mean in this codebase. **There is no inter-agent or cross-machine message bus in this codebase.** The only multi-device mechanism is file-based single-owner gating; the only thing that crosses *into* your sessions is the vault's memory, injected per-session by the **relay plugin**.

The current in-repo `@bismuth/daemon` model:

- The `relay/` workspace is a tiny Claude Code plugin (hooks only). Recall + collect are its scripts, not the MCP server's, and not global `~/.claude` hooks.
- There is **no `message_bot` MCP tool**. The MCP server exposes `remember`/`recall`/`forget` (memory CRUD), not a way to message the daemon session. The daemon's `sendMessage()` is an in-process call driven by crons/processes, never an MCP surface.

## Recall + collect live in the relay plugin

The memory hooks ship in the **`relay/` workspace** and load **per-session, only inside Bismuth terminals** — nothing is written to your global `~/.claude/settings.json`:

- `core/src/terminal.ts` spawns each terminal tab's PTY with a PATH shim (`relay/shim/claude`) that makes a bare `claude` run `claude --plugin-dir <relay>`, plus env: `CLAUDE_TERMINAL_ID` (the tab's pty id), `CLAUDE_RELAY_URL` (this app's core server), and — **only when `settings.daemon.enabled` for this vault** — `BISMUTH_MEMORY_DIR` (the vault's `.daemon/memory`).
- The plugin's `hooks/hooks.json` binds the hooks; nothing is installed in `~/.claude`. Outside a Bismuth terminal the plugin isn't even present, and each hook additionally gates on `CLAUDE_TERMINAL_ID` (a cheap belt-and-suspenders guard via `relay/lib/report.ts`).

So memory is recalled into prompts + collected from transcripts **strictly for vault-scoped Bismuth sessions**, never globally. All hooks are best-effort: they read JSON from stdin, swallow every error, and `exit(0)` within a budget (`hook` in `lib/report.ts`) so they never block your session.

| Script | Hook event | Memory job (gated on `BISMUTH_MEMORY_DIR`) | Agent-graph job (always) |
| --- | --- | --- | --- |
| `relay/bin/session-start-hook.ts` | `SessionStart` | `POST /memory/recall` `mode: session-start` → inject as `additionalContext` | `POST /relay/session` (register this session node) |
| `relay/bin/recall-hook.ts` | `UserPromptSubmit` | `POST /memory/recall` `mode: prompt` → inject as `additionalContext` | `POST /relay/session` (register/heartbeat this session node) |
| `relay/bin/tool-batch-hook.ts` | `PostToolBatch` | `POST /memory/recall` `mode: tool` with the batch's tool calls → inject as `additionalContext` | none |
| `relay/bin/subagent-start-hook.ts` | `SubagentStart` | `POST /memory/recall` `mode: subagent` → inject as `additionalContext` | `POST /relay/subagent/start` (add the child node) |
| `relay/bin/session-end-hook.ts` | `SessionEnd` | Collect the transcript into memory as one auto note (except on `compact`) | `POST /relay/session/end` (drop the node, except on `clear`/`compact`) |

Each hook script runs its jobs concurrently (`Promise.all`; PostToolBatch has no registry job): the memory job (this page) and an agent-graph job (the in-app "agents" graph — see [../terminal/overview.md](../terminal/overview.md) and [overview.md](overview.md)). The agent-graph job runs even when the daemon is disabled; the memory job no-ops without `BISMUTH_MEMORY_DIR`.

### Recall injection points — all four call core

Four hooks inject memory, each by `POST`ing to core's `/memory/recall` (`relay/lib/recall.ts`'s `requestRecall`, against `CLAUDE_RELAY_URL`) and printing the reply:

| Hook event | `mode` | Request carries | Timeout |
| --- | --- | --- | --- |
| `SessionStart` (`startup\|resume\|clear\|compact`) | `session-start` | `sessionId`, `source`, `transcriptPath` | 1500ms |
| `UserPromptSubmit` | `prompt` | `sessionId`, `prompt`, `transcriptPath` (+ `agentId` when present) | 1500ms |
| `PostToolBatch` (all tools) | `tool` | `sessionId`, `toolCalls` (each `tool_response` capped at 2000 chars), `agentId` inside a subagent | 700ms |
| `SubagentStart` | `subagent` | `sessionId` (parent), `agentId`, `transcriptPath` | 1500ms |

Flow, common to all four (`relay/bin/*-hook.ts`):

1. No `CLAUDE_TERMINAL_ID` → return (not a Bismuth terminal tab).
2. Read stdin; run the registry POST (`/relay/session`, `/relay/subagent/start`) and — only if `BISMUTH_MEMORY_DIR` is set — `requestRecall(...)` concurrently. `PostToolBatch` has no registry job.
3. **Core owns ranking, dedup and settings**; the hooks only forward the payload. There is no in-hook fallback ranker: core unreachable, a non-2xx reply, a bad body or a timeout means `requestRecall` returns `null` and the hook prints nothing.
4. On a non-null context, print exactly one JSON object, with `hookEventName` set to the firing event:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "<context from core>"
  }
}
```

The request/response types (`RecallRequest`, `RecallResponse`) are redeclared in `relay/lib/recall.ts` because relay must not import core.

### The semantic channel (`core/src/memoryEmbed.ts`)

Ranking is BM25 first; when `daemon.recall.semantic` is true (the default) core also scores notes by meaning with **bge-small-en-v1.5, quantized (`q8`)**, run by `onnxruntime-node` through `@huggingface/transformers`, and `rankNotes` fuses the top cosines in additively. `semantic: false` means the model is never loaded. The iPad in-process backend never imports any of it (lexical only). The compiled `bismuth serve` CLI is BM25-only too: the embed worker runs only in the core sidecar, which is recognised by `BISMUTH_CORE_SIDECAR=1` on a binary whose exec name starts with `bismuth-core`. The semantic query text is capped at 1000 characters (`SEMANTIC_QUERY_CHARS`). In tool mode, at 12 or more notes, evidence is strict: a semantic-only hit never injects, since a cosine is only a bonus on top of lexical evidence.

- **A child process, lazy.** Core boot imports nothing of the model (`core/test/memoryEmbed.test.ts` pins that the static import graph of `server.ts` never reaches `transformers`). The model lives in a separate process (`core/src/embedWorker.ts`), spawned by the first semantic query: in dev `bun run embedWorker.ts`, in the bundled app the sidecar binary re-executed with `--bismuth-embed-worker` (`embedWorkerBoot.ts`, the first import of `server.ts`, turns that process into the worker). Requests are newline-delimited JSON on its stdin/stdout, vectors as base64. That first query, being past the budget, is answered by BM25 alone while the child warms.
- **Budget.** A query that throws or takes longer than 250 ms (a cold load, a download) gets BM25 for that request; the work continues in the background so the next query finds the model warm. A failed load, or a child that dies twice in a row, is not retried for an exponential backoff (30 s, 60 s, 120 s ... capped at 1 h, reset by a success), and a failed vector run does not re-arm itself: nothing retries until the next real sync; a request the child leaves unanswered for 30 s kills it and falls back.
- **Idle exit.** After 10 minutes with no embed (`BISMUTH_RECALL_IDLE_MS` overrides, in ms) core ends the child, so the OS takes back everything the model held. (Disposing the model inside core was measured and does not lower RSS on macOS.) The next query respawns it, ~110 ms of model load from the disk cache plus process start. The child also exits when its stdin closes, so a core that is killed outright leaves no orphan.
- **Vectors.** One `vectors.json` per memory dir under `~/.bismuth/cache/recall/<sha1(memoryDir)>/`, keyed by `noteHash`. Only notes whose hash changed are re-embedded, throttled to one run per 2 s; a restart embeds nothing already stored. Each note embeds name + description + tags + the first 1000 chars of the body; queries get bge's instruction prefix, documents do not. A reply that used the channel carries `"semantic": true`.
- **Model files.** `Xenova/bge-small-en-v1.5` `model_quantized.onnx` (~33 MB) downloads on first use into `~/.bismuth/models`. Offline with no cache, recall stays lexical.
- **Compiled sidecar.** `app/scripts/build-core-sidecar.ts` builds through the `Bun.build` API with three patches (stub `sharp`; a literal `require('onnxruntime-node')`; load the native binding from an `ort/` dir) and stages `onnxruntime_binding.node` plus `libonnxruntime*.dylib` as the `resources/ort` Tauri resource (~45 MB per platform; darwin-arm64 verified, the others untested). The binding is searched at `$BISMUTH_ORT_DIR`, `<sidecar dir>/ort`, then `Resources/resources/ort`.

**Measured machine cost** (Apple arm64, bun 1.4.0, q8, threads capped at 2; 140 notes of ~1.4 KB, `BISMUTH_RECALL_IDLE_MS=3000`):

| | |
| --- | --- |
| core RSS before the first semantic query | ~150 MB (dev) |
| child RSS while loaded and indexing 140 notes | 260-280 MB (dev 262-278, bundled sidecar 282; the child also evaluates the sidecar's own code) |
| core RSS while the child is loaded | +4 to +11 MB |
| after idle: child | **gone** (pid absent, checked at 5.5 s with a 3 s idle) |
| after idle: core RSS vs before first query | +17 to +22 MB, against +11 to +13 MB for the same traffic with `semantic: false`, so the feature itself costs core under 10 MB |
| first query (spawn + load) | ~260 ms, past the 250 ms budget: answered by BM25 while the child warms |
| query after an idle exit (respawn, vectors already on disk) | 126-161 ms, semantic |
| warm `/memory/recall` | 4-5 ms (one embed ~1.8 ms) |
| 140-note index (one run, once per change) | ~4 s |
| core exit | child gone with it (SIGTERM, or stdin closing after SIGKILL) |

### The visual chat recalls too (SDK session, no relay plugin)

The relay hooks only fire in **terminal-tab CLI** Claude sessions. The in-app **visual chat** (`core/src/chat.ts`) is an Agent-SDK session that never loads the relay plugin, so it wired recall in-process instead: when the chat session carries a `memoryDir` (daemon enabled), `spawnChatQuery` registers a programmatic `hooks.UserPromptSubmit` on the SDK `query()` that calls the same recall service (`recallServiceFor(...)`, raced through `recallWithin(svc, req, ms)`) and returns the same `additionalContext` shape. So both the app's Claude surfaces — terminal tabs and the visual chat — auto-recall from one implementation. (The chat already **collected** transcripts into memory via `captureToMemory`; before this it collected but never recalled — the asymmetry that made memory feel "not auto-injecting" once work moved into the chat.)

### `session-end-hook.ts` — `SessionEnd` (transcript → auto note)

Flow (`relay/bin/session-end-hook.ts` + `collectTranscript()` in `relay/lib/memory.ts`):

1. No `CLAUDE_TERMINAL_ID` → return.
2. Read stdin; `reason = input.reason` (`exit`/`logout`/`clear`/`compact`/…).
3. In parallel: if `BISMUTH_MEMORY_DIR` is set, `transcript_path` is present, **and** `reason !== "compact"`, call `collectTranscript(dir, transcript_path, session_id)`; and (unless `clear`/`compact`) POST `/relay/session/end`. `compact` is skipped because the same logical session continues; `clear` still collects but keeps the graph node (a fresh session re-registers).

`collectTranscript` reads the JSONL transcript **line by line** (each line best-effort `JSON.parse`d; a malformed line is skipped, not fatal) and hands the parsed entries straight to **`buildAutoNoteBody`** in `@bismuth/memory`'s `memory/src/transcript.ts` — pure, unit-tested, and shared with core's visual-chat capture, so `relay/lib/memory.ts` itself does no parsing anymore. The output is a **paired-turn** markdown body, not a flat list of user messages:

- **`extractTurns`** walks the entry stream and pairs BOTH sides of the conversation into logical turns: a `user` entry carrying real top-level text (after stripping, below) starts a new `Turn { user, claude }`; every subsequent `assistant` text block appends to that same turn's `claude` side until the next real user turn. A tool-result carrier is a `user`-role envelope whose content is entirely `tool_result` blocks — `extractText` drops those, so it has no top-level text and never opens a false turn boundary. That is what collapses an exchange with N tool round-trips into **one** turn instead of N fragments. Adjacent byte-identical assistant chunks (stream replays) are deduped.
- **`extractText`** keeps only `type: 'text'` content (string content is taken directly) — `tool_use`/`tool_result`/`thinking` blocks are always dropped, so file dumps, bash output, and diffs never reach memory.
- **`stripInjectedBlocks`** regex-strips machine-injected context before a message counts as real user text: `<system-reminder>…</system-reminder>`, `<editor-context>…</editor-context>`, the `<bismuth-memory>` recall envelope this same pipeline injects (so a recalled note is never re-collected into memory — no recall→collect→recall amplification), and, for back-compat, a legacy bare `# Memories` block from a transcript captured before that envelope existed.
- **`clampMessage`** head-truncates any single message over `PER_MESSAGE_CHARS = 1500` chars (`+ ' […]'`) — keeps the substance of long reasoning while stopping one code-dump answer from dominating the note.
- **`renderTurns`** renders the paired turns as the markdown `dream` consumes: each turn becomes a `## Turn N` block with a `**You:** <text>` line (if `user` is non-empty) and/or a `**Claude:** <text>` line (if `claude` is non-empty).

**Skip rules** (in `buildAutoNoteBody`):

| Rule | Condition | Result |
| --- | --- | --- |
| CRON-SESSION skip | any turn's `user` text starts with `CRON_PREFIX = "[Cron: "` | return (no write) |
| TRIVIAL skip | summed `user.length + claude.length` across all turns `< MIN_BODY_CHARS = 50` | return (no write) |

The cron skip exists because daemon-fired crons prepend `"[Cron: <name>] "` to their prompts (`daemon/src/daemon/cron.ts`), which would otherwise pollute keyword recall — see [crons-and-processes.md](crons-and-processes.md). Summing both `user` and `claude` chars for the trivial check matters: a one-word "continue" prompt that made Claude do real work is NOT trivial.

**Body assembly:** `trimToBudget` enforces the whole-body budget `MAX_BODY_CHARS = 12000` **turn-aware** — it never splits a turn, unlike a naive head/tail character slice that could bisect a paired turn and corrupt attribution. When the summed turn sizes (`user.length + claude.length + 32` overhead per turn, for the headers/labels) exceed the budget, it keeps whole turns from the front and back — alternating front-then-back (openings set context, endings carry conclusions) — until the next turn on either side would blow the budget, drops every turn left in the middle, and splices in one `_(N turns omitted)_` marker turn in their place.

**Note identity:** name `auto-<YYYYMMDD-HHMMSS>-<first 8 chars of sessionId>` (or `unknown` when no session id). The timestamp comes from `new Date()` at collection time. Frontmatter: `type: auto`, `tags: ["auto", "raw", "session"]`, `created`/`updated` = today's date. The write goes through `writeNote(...)` from `@bismuth/memory` against `<vault>/.daemon/memory` — one markdown note per session, into the **memory graph**, never a queue. The daemon's `dream` cron later consolidates these auto notes (see [memory.md](memory.md) and [crons-and-processes.md](crons-and-processes.md)).

### One note format, three writers

The relay collect-hook, the MCP `remember` tool, and the daemon's own writer all delegate to the same `@bismuth/memory` graph and read/write **one note format** against `<vault>/.daemon/memory`. The MCP memory tools (`mcp/src/memory.ts`) are themselves gated on `BISMUTH_MEMORY_DIR` (the MCP child inherits it from the terminal PTY) — they're registered only when the daemon is enabled (`mcp/src/server.ts` appends `memoryTools` only when `memoryDir()` is truthy). Again: these are `remember`/`recall`/`forget`, not `message_bot`.

## Inter-agent / cross-machine messaging: does not exist

**There is no inter-agent message bus, no network message queue, and no device-to-device messaging in this codebase.** What might superficially read as networked agent comms is not:

- **`sendMessage()` (`daemon/src/daemon/session.ts`)** is **not** networked agent-to-agent messaging. It is an in-process wrapper that drives one persistent Claude Agent SDK session **per vault** via `claudeQuery({ ..., options: { resume: <vault session id>, cwd: <vault root>, env: { BISMUTH_MEMORY_DIR }, systemPrompt: { type: 'preset', preset: 'claude_code', append: persona } } })`. Callers are all local and internal: cron firing (`cron.ts`), processes (`process.ts`), and dream consolidation (the `dream` cron, seeded from `daemon/src/daemon/defaultCrons.ts`). One machine runtime multiplexes every enabled vault; the per-call `cwd`/`env`/`resume`/identity are supplied so concurrent vault sessions never race.
- **The `/relay/*` routes** are local HTTP to *this app's own core server* (`CLAUDE_RELAY_URL`, default `http://localhost:4321`) to feed the in-process relay registry (`core/src/relay.ts`, read by `bismuth relay list` and chat subagent tracking; the old agents graph mode is gone) — same-machine, app-local, not device-to-device.

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
- `owner.json` is written byte-compatibly with what Bismuth reads — Bismuth is the cross-device coordinator that reads/writes it; the daemon only consults it.

### Owner-gating effect

When this device is not the owner, `sendMessage()` throws immediately (`"This device is not the owner — bot session is idle."`), so crons/processes/dreams on a non-owner device never drive the SDK session. The daemon still heartbeats so it stays selectable. See [lifecycle.md](lifecycle.md) and [crons-and-processes.md](crons-and-processes.md) for the reconcile/firing context.

## Summary

| Claim | Status | Anchor |
| --- | --- | --- |
| Recall + collect are relay-plugin hooks loaded via `claude --plugin-dir <relay>` | EXISTS | `relay/bin/*-hook.ts`, `terminal.ts` |
| Hooks gate on `CLAUDE_TERMINAL_ID` && `BISMUTH_MEMORY_DIR`; no `~/.claude/settings.json` write | EXISTS | `relay/lib/report.ts`, `relay/lib/memory.ts` |
| Four hooks (`SessionStart`, `UserPromptSubmit`, `PostToolBatch`, `SubagentStart`) inject via `additionalContext` from core's `POST /memory/recall`; no in-hook fallback | EXISTS | `relay/lib/recall.ts` |
| `collect` pairs user+assistant into `## Turn N` blocks, skips `[Cron: ` + `<50`-char sessions, 12000-char turn-aware truncation, `auto-` note | EXISTS | `CRON_PREFIX`, `MIN_BODY_CHARS`, `MAX_BODY_CHARS`, `extractTurns`, `renderTurns`, `trimToBudget`, `collectTranscript` |
| `recall-hook`/`session-start-hook` also POST `/relay/session`; `subagent-start-hook` POSTs `/relay/subagent/start`; `session-end-hook` POSTs `/relay/session/end` | EXISTS | the hook scripts |
| `message_bot` MCP tool | DOES NOT EXIST (MCP exposes `remember`/`recall`/`forget`) | `mcp/src/{server,memory}.ts` |
| Inter-agent / cross-machine / device-to-device message bus | DOES NOT EXIST | whole-repo |
| `sendMessage()` is an in-process per-vault SDK session, cron/process/dream driven | EXISTS | `daemon/src/daemon/session.ts` |
| Single-owner gating via `devices.json` heartbeat + `owner.json` at `~/.bismuth/daemon` | EXISTS | `daemon/src/lib/{owner,device,config}.ts` |

See the rest of the daemon docs: [overview.md](overview.md), [lifecycle.md](lifecycle.md), [storage.md](storage.md), [crons-and-processes.md](crons-and-processes.md), [memory.md](memory.md), and the docs root [../README.md](../README.md).

Source: `core/src/memoryEmbed.ts`, `relay/bin/recall-hook.ts`, `relay/bin/session-start-hook.ts`, `relay/bin/tool-batch-hook.ts`, `relay/bin/subagent-start-hook.ts`, `relay/lib/recall.ts`, `relay/bin/session-end-hook.ts`, `relay/lib/memory.ts`, `relay/lib/report.ts`, `memory/src/transcript.ts`, `daemon/src/daemon/session.ts`, `daemon/src/daemon/cron.ts`, `daemon/src/lib/owner.ts`, `daemon/src/lib/device.ts`, `daemon/src/lib/config.ts`, `memory/src/search.ts`, `memory/src/index.ts`, `mcp/src/memory.ts`, `mcp/src/server.ts`
</content>
</invoke>
