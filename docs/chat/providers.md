# Chat providers (Claude Code / opencode)

> **Scope.** This page is the deep reference for the two **natively driven** providers below. The
> backend model that governs all of them — the catalog, the capability flags that decide which header
> controls render, the other five integration surfaces, and the shared ACP driver that covers
> additional CLIs — is in [backends.md](backends.md). Read that first if you are adding a backend.
>
> Where this page says a control is hidden "for opencode", the mechanism is now a capability flag on
> the backend descriptor, not a provider comparison: `providerCan(provider, "permissionModes")` and
> friends. The *behaviour* described here is unchanged; only what decides it moved.

Each chat tab runs on a **provider** — the CLI that actually drives the conversation. Two are driven
by a bespoke native driver:

| Provider | Binary | Driver | Session model |
| --- | --- | --- | --- |
| `claude` (default) | the user's `claude` | `core/src/chat.ts` — one long-lived Agent-SDK `query()` per chat | SDK session store (unified with terminal sessions) |
| `opencode` | the user's `opencode` (resolved like `claude`, via the augmented `claudeLookupPath`) | `core/src/chatProviders/opencode.ts` — **server mode** (preferred): one persistent `opencode serve` process shared by every opencode chat this core process hosts, owned by `core/src/chatProviders/opencodeServer.ts`; **run mode** (fallback, for an opencode too old to serve): the original `opencode run --format json` subprocess **per turn**, continued with `-s <sessionID>` | opencode's own store (`ses_…` ids; history via the server's typed `GET /session/{id}/message`, or `opencode export` in run mode) |

Both speak the **same `ChatFrame` wire protocol** over the `/chat` WebSocket, so `ChatView` renders either without provider-specific rendering code. The seam is `core/src/chatProviders/index.ts` (the router) + `core/src/chatProviders/opencodeTranslate.ts` (the pure event translation, unit-tested in `core/test/chatProviders/`).

## Picking a provider

- **Per chat**: the header's provider `Select` (next to the model picker). Switching acts like **"New chat" on the other provider** — a conversation can't hop drivers mid-stream, so the transcript clears and a fresh session spawns. The choice is persisted per tab (`bismuth.chat.provider.<tabId>`, a transient localStorage key like the per-chat model) and latched the moment a session spawns, so a later settings edit can't flip a live tab's header away from its backend.
- **Default for new tabs**: the `chat.provider` key in `.settings` (`"claude" | "opencode"`, schema-validated — `core/src/schema/settingsSchema.ts`).

On the wire, the client's `open` / `user` / `resume` frames carry `provider`; the server resolves it with `resolveChatProvider(requested, settingsDefault)` and routes through the router. **Routing rule**: a chatId with a live session anywhere stays on that backend (conversation continuity beats a stale field); only session-creating verbs honor the requested provider.

## How the opencode driver works

opencode ships a genuine HTTP+SSE server (`opencode serve`) alongside its per-turn `run` subcommand. `core/src/chatProviders/opencode.ts` prefers server mode and falls back to the original per-turn subprocess only when the installed opencode can't serve. A session's mode is decided **once**, at creation, and never flips mid-session.

### Server mode (preferred)

Verified live against opencode **1.18.4** + `@opencode-ai/sdk` **1.18.9**:

- **Lifecycle** (`opencodeServer.ts`): the shared server starts lazily on the first opencode chat — `Bun.spawn`s `opencode serve --port 0 --hostname 127.0.0.1` (a random free port, never a fixed one) with the same augmented PATH every Bismuth-spawned CLI uses (`claudeSpawnEnv`), watches stdout for the `opencode server listening on <url>` banner within a timeout, and binds `@opencode-ai/sdk`'s typed `createOpencodeClient({baseUrl})` to it. One server for the whole core process — every opencode chat/vault shares it via a `directory` query param on every request, mirroring the daemon's "one process, many vault brains" shape. Killed on process exit (`process.on("exit")`); never left orphaned. A startup failure (no `serve` subcommand, banner timeout) resolves `null` and every session falls back to run mode instead of breaking the provider.
- **SDK vs. raw HTTP**: uses `@opencode-ai/sdk`'s typed client for the requests Bismuth builds (session create/prompt/command/abort, the permission-response endpoint) — but NOT the SDK's own `createOpencode()`/`createOpencodeServer()` process-spawning helpers, which hardcode `cross-spawn` + bare `process.env` with no way to inject the augmented PATH a Finder-launched bundle needs. See `opencodeServer.ts`'s top-of-file comment for the full reasoning.
- **Real token-level streaming**: the server's global event stream (`GET /global/event`, ONE subscription for the whole process, dispatched to sessions by opencode session id) emits `message.part.delta` events — genuine incremental deltas, not whole-part snapshots. **Verified live drift from the SDK's generated types**: the installed SDK's `types.gen.d.ts` declares deltas as a `delta` field nested inside `message.part.updated`; the real server instead emits a **separate event type**, `message.part.delta`, shaped `{sessionID,messageID,partID,field,delta}`. `translateOpencodeServerEvent` reads every event as untyped JSON for exactly this reason.
- **A genuine permission request/response cycle**: a tool call needing approval raises a `permission.asked` event (again, live-verified to differ from the SDK's documented `permission.updated`/`Permission{type,pattern,title}` shape — the real event is `{id,permission,patterns,metadata,always,tool:{...}}`), parked as a `permission` ChatFrame; `respondPermission` answers it via `POST /session/{id}/permissions/{permissionID}` with `{response:"once"|"always"|"reject"}` — verified live for both an allowed run (the tool executed, output came back) and a denied one (the tool errored with "The user rejected permission to use this specific tool call.").
- **Image attachments**: an image rides a `FilePartInput{type:"file",mime,url:"data:<mime>;base64,..."}` part on `session.prompt`'s body — verified live with a real `POST /session/{id}/message` (HTTP 200) and a vision-capable free model reading real pixel content back, not just assumed from the SDK's types.
- **Per-turn memory injection**: when the vault's daemon is enabled, `session.prompt`'s `system` field carries a FRESH `recallMemory(memoryDir, text)` digest on every turn — a genuine per-call system-prompt override, not a once-per-session digest.
- **History replay + resume**: `GET /session/{id}/message` (typed, no subprocess) replaces `opencode export` as the primary history source — verified live to carry the exact same per-message `{info:{role},parts}` shape, translated by the shared `translateOpencodeSessionMessages`/`translateOpencodeExport` machinery. Falls back to `opencode export` when no server is available; both read the same on-disk session store, so a session started in one mode replays fine in the other.
- **Models + commands**: come off the typed `GET /config/providers` (`modelEntriesFromProviders`) and `GET /command` (`commandEntriesFromApi`) — richer than the run-mode CLI-text scrape (real `cost`/`name` fields, no parsing) and no extra subprocess per session open.
- **Cost**: read off the turn's authoritative `session.prompt()`/`session.command()` response (`info.cost`), not accumulated from step-finish events.
- **Stop**: `abortTurn` calls the server's own `session.abort()` — verified live that the blocked `session.prompt()` call then resolves with `info.error.name === "MessageAbortedError"` (reported as a clean Stop, not a turn failure) rather than hanging or rejecting.

### Run mode (fallback, unchanged from the original per-turn driver)

- Each turn spawns `opencode run --format json --auto [-s ses_…] [-m provider/model] <text>` with `cwd` = the vault. stdout is NDJSON — one event per line: `text`/`reasoning` parts arrive **complete per part** (no streaming), `tool_use` events arrive with `state.status` already resolved, `step_finish` accumulates `cost`.
- `--auto` auto-approves tool permissions not explicitly denied by the user's own opencode config — the same effective posture as the app's Claude default (Bypass). Non-interactive `run` mode has no way to park on a prompt, and has no attachment flag (images are refused with a friendly error).
- Error events nest their real message under `error.data.message` (verified live: a Zen 401) — `opencodeErrorMessage` digs it out shallowest-first. A run that streamed an error event still **exits 0**, so the `result` frame reports `isError` when either the exit code was non-zero **or** an error frame went out.
- Missing binary → a `{ type: "error", code: "no-opencode" }` frame; `ChatView` renders a provider-specific setup screen (install hint + a one-click "Use Claude Code instead" switch). The same screen exists in reverse for a missing `claude` — the provider picker stays usable either way.

## opencode-native surfaces (commands, auth, Zen free rotation)

Three opencode-specific affordances (all pure parts unit-tested in `core/test/chatProviders/opencodeTranslate.test.ts` + `app/src/chatProvider.test.ts`), working in either mode:

- **Command autocomplete** — opencode's command registry rides the manifest, so typing `/` in the composer autocompletes opencode commands exactly like Claude's. Server mode reads it off the typed `GET /command`; run mode parses `opencode debug config`'s resolved `command` key (config-dir commands + `opencode.json(c)` `command` entries + **plugin-registered** commands) — both merged with the built-ins `/init` and `/review` (`withOpencodeBuiltinCommands`). Descriptions ride the manifest's `commandDetails` and show in the "/" popover. A sent turn whose text leads with a **known** `/command` runs as the server's `session.command()` (or `opencode run --command <name> <args>` in run mode); an unknown `/word` flows through as prose.
- **Auth pill** — the header shows the opencode credential state (`opencode auth list`, parsed by `parseOpencodeAuthList`, emitted as an `auth` frame per session open) — a plain CLI spawn, unaffected by which mode a session is running in (verified live it doesn't contend with a running server's sqlite). The popover lists stored providers (name + kind) and gives the login path: `opencode auth login` is an interactive CLI wizard (providers, API keys, **opencode Zen**), so the popover offers **Open terminal** (opens a Bismuth terminal tab via the `bismuth-open-terminal` event) and **Copy command**. After logging in, a new chat / reopen refreshes the pill. Not signed in renders in the danger tint.
- **Zen Free (rotating)** — opencode Zen's free roster is promotional and rotates over time. When Zen currently offers free models (`cost.input === 0 && cost.output === 0` on `opencode/…` ids), the model picker gains a virtual **"Zen Free (rotating)"** entry (`withZenFreeRotate`, id `bismuth/zen-free-rotate`) pinned to the top with a Free badge. Selecting it makes each turn round-robin a REAL free Zen model (`pickZenFreeModel` — turn N runs free model N mod roster size); the virtual id is resolved in the turn dispatcher and never reaches the CLI/server as-is. An empty roster hides the entry (and, if somehow selected, falls back to opencode's own default model).

## Graceful degradation (what opencode sessions still don't have)

Claude-specific surfaces are **hidden, not broken**, for opencode sessions (`providerCan`, `app/src/chatProvider.ts` — see [backends.md](backends.md)):

- **Permission MODE picker** — server mode CAN raise and answer a live permission ask (`permissionPrompts: true`), but there is no verified way to switch a session's permission MODE (no Default/Plan/AcceptEdits/Bypass vocabulary in the server API), so `permissionModes` stays false and the mode-picker Select stays hidden either way.
- **Effort picker** — hides itself: opencode models carry `effortLevels: []` on the `models` frame in either mode.
- **`--chrome` (browser/computer-use) toggle** and the `/chrome` slash suggestion.
- **Session history picker** — it lists the Claude Code SDK store; opencode conversations still resume per tab (see above), they just don't appear in the cross-session picker.
- **Claude's own slash commands** — the manifest instead carries **opencode's** command registry (see above); the provider-agnostic client-side commands (`/rename`, `/color`) are offered on both.
- **Context-window usage pill** — not surfaced; the server does report per-message token counts and each model's context limit, but turning that into an honest occupancy percentage (prompt caching skews raw input-token counts) wasn't done here to avoid shipping a misleading number.

Everything else — streamed markdown prose, tool chips with results, thinking sections, editor-context preambles (`<editor-context>`), queued mid-turn messages, Stop, reconnect buffering with the 30s grace window, per-tab titles, and now image attachments and per-turn memory recall — works identically on both providers when opencode is running in server mode.
