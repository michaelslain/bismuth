# Communication & Hooks

How claude-bot talks to Claude Code (hooks), how it coordinates across machines (it doesn't pass messages — it gates on a shared owner file), and what the names "message", "queue", and "port" actually mean in the code. The recurring editorial point: **there is no inter-agent or cross-machine messaging in this codebase.** The only multi-agent story is file-based single-owner gating; the only cross-device actor that writes the coordination files is Bismuth, not claude-bot.

## Hooks

claude-bot ships two Claude Code hook scripts in `bin/`, each bound to a distinct hook event. They are **registered programmatically** by the MCP server at startup (`server.ts`) — not via a plugin manifest and not via a static shipped `settings.json`. Both scripts run top-level on import (no exported entry function required to fire), read JSON from stdin, and are written to never block the host session: every body is wrapped in try/catch that logs to stderr and `exit(0)`.

| Script | Hook event | Effect |
| --- | --- | --- |
| `bin/recall-hook.ts` | `UserPromptSubmit` | Injects matching memory notes into prompt context |
| `bin/collect-hook.ts` | `SessionEnd` | Writes the session transcript to the memory graph as one auto-note |
| `bin/forget-cron-auto-notes.ts` | — (one-shot CLI utility, **not a hook**) | Backfill cleanup of cron-polluted auto-notes |

### `bin/recall-hook.ts` — `UserPromptSubmit` (memory context injection)

Runs on import as a top-level script (no exported function). Flow:

1. Read JSON from stdin, extract `.prompt`.
2. Empty prompt → `exit(0)` with no output.
3. Call `searchMemory(prompt)` (from `memory/search.ts`) — pure keyword search, **no LLM** (see [memory.md](memory.md) for `searchMemory`'s scoring).
4. Zero notes → `exit(0)` with no output.
5. Otherwise format via `formatNotes()` and write a payload to stdout.

The output payload declares its own event name and uses Claude Code's `additionalContext` splice point:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "<formatted notes>"
  }
}
```

The `additionalContext` field is what Claude Code splices into the prompt context. `formatNotes()` emits a `# Claude Bot Memories` header, then per note a `## <name> (<type>) [<tags>]` line, the content, and a `Links: [[...]]` line.

**Error handling:** the whole body is wrapped in try/catch; on any error it logs to stderr and `exit(0)` — it never blocks the prompt.

**Naming caveat:** the design spec/plan refer to this as `bin/memory-hook.ts`. The shipped file is `bin/recall-hook.ts`, and `server.ts` actively migrates the old name away at registration time (see [Hook registration](#hook-registration-serverts-startup) below).

### `bin/collect-hook.ts` — `SessionEnd` (transcript → auto-note)

Bound to `SessionEnd`. Input shape `SessionEndInput { session_id?, transcript_path? }`. (This hook was moved from `UserPromptSubmit` to `SessionEnd`; `server.ts` migrates the stale registration.) It writes into the **memory graph** — `writeNote(...)` under `getMemoryDir()`, one markdown note per session — not into any queue.

Entry point `processTranscript(rawTranscript, sessionId, options)`:

- `extractUserMessages` parses the transcript file **line by line as JSON**, keeping only entries where `type === "user" && message.role === "user"`.
- `extractText` pulls string content directly, or concatenates the `type === "text"` parts.
- `stripInjectedBlocks` regex-strips host-injected noise: `<system-reminder>`, `<local-command-stdout>`, `<command-name|message|args>`, and `<command-stdout>` blocks.

**Skip rules:**

| Rule | Condition | Result |
| --- | --- | --- |
| CRON-SESSION skip | any message starts with `CRON_PREFIX = "[Cron: "` | `{ written: false, reason: "cron" }` |
| TRIVIAL skip | total stripped chars `< MIN_BODY_CHARS = 50` | `{ written: false, reason: "trivial" }` |

The cron skip exists because daemon-fired crons prepend `"[Cron: <name>] "` to their messages, which would otherwise pollute keyword recall (see [crons-and-processes.md](crons-and-processes.md)).

**Body assembly:** each kept message becomes `## message N\n\n<text>`, joined together. If the result exceeds `MAX_BODY_CHARS = 8000`, it is truncated to the head 4000 chars + `\n\n... [truncated] ...\n\n` + the tail 4000 chars.

**Note identity:** name `auto-<YYYYMMDD-HHMMSS>-<first 8 chars of sessionId>`. The timestamp comes from the session, making the name deterministic and the write **idempotent** — re-running the same session produces the same file, not a duplicate. Frontmatter: `type: auto`, `tags: ["auto", "raw", "session"]`, `created`/`updated` = today.

**CLI guard (`import.meta.main`):** read stdin, parse `SessionEndInput`, `exit(0)` if no `transcript_path`, otherwise read the file and call `processTranscript`. All errors → stderr + `exit(0)`.

### `bin/forget-cron-auto-notes.ts` — cleanup utility (not a hook)

`forgetCronAutoNotes(dir)` is a one-shot backfill/migration that cleans up cron-polluted notes left over from before `collect-hook` had its cron-skip guard. It:

- Scans the **root only** — skips subfolders and any name containing `"/"`.
- Considers only names starting with `auto-`.
- Reads each and `deleteNote()`s those whose **content** contains `"[Cron: "`.
- Returns `{ forgot, kept }`; the CLI block prints a summary.

It is idempotent and never touches non-`auto-` files, even if they mention `[Cron:`.

### Hook registration (`server.ts` startup)

Registration is **imperative**, performed in the server's "Start" path against the user's **global** `~/.claude/settings.json` (tolerating a missing file):

1. Ensure `hooks.UserPromptSubmit` and `hooks.SessionEnd` arrays exist.
2. **Migration cleanup:** strip `memory-hook.ts` and `collect-hook.ts` from `UserPromptSubmit`, then drop any now-empty entries.
3. Idempotently add `recall-hook.ts` to `UserPromptSubmit` and `collect-hook.ts` to `SessionEnd` if absent — commands of the form `bun run <abs path to bin/...>`.
4. Always write the merged settings back.

Failures are caught and logged, and are non-fatal — a failed hook write never stops the server from starting. See [install.md](install.md) for the surrounding install/boot sequence.

## Inter-agent / cross-machine messaging: does not exist

**There is no inter-agent messaging, no relay, no envoy, no cross-machine communication, no network message queue, and no device-to-device messaging in this codebase.** A whole-repo search for `relay`, `envoy`, `handoff`, `cross-machine`, `inter-agent`, `message queue`, and `device-to-device` finds none of it.

Three things superficially read as networked agent comms but are not:

- **`sendMessage()` (`daemon/session.ts`)** is **not** networked agent-to-agent messaging. It is an in-process wrapper that routes one local message into the single persistent Claude Code agent SDK session via `query({ resume: sessionId })`. All callers are local: the `message_bot` MCP tool, cron firing (`daemon/cron.ts`), the daemon boot greeting (`daemon/index.ts`), and dreaming (`memory/dream.ts`). This is the "all roads lead to one session" hub — single-process, single-machine.
- **`message_bot` MCP tool** lets a Claude Code *session* talk to the *bot's* persistent session **on the same machine** via `sendMessage`. It is local IPC through MCP (see [mcp.md](mcp.md)), not cross-machine.
- **The only "queue" in the codebase** is a per-file **serial write queue** in `daemon/cron.ts` — a mutex serializing concurrent file writes. It has nothing to do with messaging.

## What device coordination does exist: single-owner gating

The actual multi-device story is **multi-device single-owner gating** through shared on-disk JSON files — the "SHARED INTEGRATION CONTRACT v1" documented in `lib/owner.ts`. It coordinates **which** daemon does work; it does **not** pass messages between devices.

### Device identity — `lib/device.ts`

- `getDeviceId()` generates and persists a UUID at `~/.claude-bot/device-id` (atomic tmp + rename), reused across restarts.
- `getDeviceLabel()` returns `os.hostname()`.

### `devices.json` — `lib/owner.ts`

A map `{ "<deviceId>": { label, lastSeenISO } }`. `heartbeatDevice()` upserts this device's entry with a fresh `lastSeenISO` on **every tick**, even when idle or non-owner, so the device always stays selectable.

### `owner.json` — `lib/owner.ts`

Shape `{ ownerDeviceId, ownerLabel, updatedAt }`.

- **Absent file = unclaimed** → falls back to legacy single-device behavior.
- `isOwner()` is `true` if `owner.json` is absent, otherwise `ownerDeviceId === thisDeviceId`.
- `setOwnerDevice()` claims ownership but **rejects** if the device has not heartbeated into `devices.json` first.
- A code comment notes `owner.json` is written **byte-compatibly with what Bismuth reads** — i.e. an *external* coordinator (Bismuth) is the cross-device actor, not claude-bot itself.

### Owner-gating wiring (the coordination effect)

| Site | Behavior when non-owner |
| --- | --- |
| `daemon/index.ts` | Idles, heartbeating only |
| `daemon/cron.ts` | Every tick heartbeats then gates — non-owner never fires |
| `daemon/process.ts` | Reads state but does not start/stop |
| `daemon/session.ts` | `sendMessage` is gated on `isOwner()` |

### MCP surface

`device_info`, `device_list`, and `set_owner_device` tools expose this layer (see [mcp.md](mcp.md)).

## "Trigger ports" — local file-based control, not network ports

Despite the name "port," these are **on-disk trigger-file directories**, not TCP ports and not inter-agent messages:

- **Cron trigger port** (`cron.ts`: `requestCronRun` / `processTriggers`) fires a run.
- **Process trigger port** (`process.ts`: `requestProcessRun` / `processProcessTriggers`) reconciles a process to its on-disk `enabled` flag.

Both are owner-gated (a non-owner consumes the trigger without acting) and unlink-first. This is a **same-machine, filesystem-mediated control channel** between an external installer/orchestrator (e.g. Bismuth) and the daemon — "external tool pokes the daemon via files," not agent-to-agent comms. Full mechanics in [crons-and-processes.md](crons-and-processes.md). The cross-device coordinator that reads/writes `owner.json` is Bismuth — see [../daemon/overview.md](../daemon/overview.md).

## Summary

| Claim | Status | Anchor |
| --- | --- | --- |
| `recall-hook` binds `UserPromptSubmit`, injects memory via `additionalContext` | EXISTS | `bin/recall-hook.ts` |
| `collect-hook` binds `SessionEnd`, writes one auto-note per session | EXISTS | `bin/collect-hook.ts` → `processTranscript` |
| `collect-hook` skips cron sessions and `<50`-char sessions | EXISTS | `CRON_PREFIX`, `MIN_BODY_CHARS` |
| `forget-cron-auto-notes` cleanup utility | EXISTS (not a hook) | `bin/forget-cron-auto-notes.ts` → `forgetCronAutoNotes` |
| Hooks registered imperatively into `~/.claude/settings.json` at MCP startup | EXISTS | `server.ts` (Start) |
| Inter-agent / cross-machine / relay / envoy / device-to-device messaging | DOES NOT EXIST | whole-repo search finds none |
| Network message queue | DOES NOT EXIST (only a serial file-write mutex) | `daemon/cron.ts` |
| Single-owner multi-device gating via `devices.json` heartbeat + `owner.json` | EXISTS | `lib/owner.ts`, `lib/device.ts` |
| File-based trigger ports (local, owner-gated) | EXISTS | `cron.ts`, `process.ts` |
| External cross-device coordinator is Bismuth reading `owner.json` | EXISTS (integration contract) | `lib/owner.ts` comment, [../daemon/overview.md](../daemon/overview.md) |

Source: bin/recall-hook.ts, bin/collect-hook.ts, bin/forget-cron-auto-notes.ts, server.ts, daemon/session.ts, daemon/cron.ts, daemon/process.ts, daemon/index.ts, lib/owner.ts, lib/device.ts, memory/search.ts, memory/dream.ts
