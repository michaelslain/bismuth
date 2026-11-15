# Chat providers

A chat provider is the CLI that drives one chat tab: Claude Code, opencode, Codex, or one of the agents that speak the Agent Client Protocol (ACP). Every provider streams the same `ChatFrame` messages over the `/chat` WebSocket, so the chat view renders any of them without provider-specific code.

The catalog of backends and the capability flags that decide which controls render are in [backends.md](backends.md); using chat day to day is in [overview.md](overview.md).

| Provider | Binary | Driver | Conversation lives in |
| --- | --- | --- | --- |
| `claude` | your `claude` | one long-lived Agent SDK `query()` per chat | the SDK session store, shared with terminal sessions |
| `opencode` | your `opencode` | one shared `opencode serve` process (opencode 1 and 2), or a per-turn `opencode run` in a vault that hides notes | opencode's own store (`ses_…` ids) |
| `codex` | your `codex`, or the copy the ChatGPT app bundles | a `codex exec --json` subprocess per turn | Codex's own rollout files under `~/.codex/sessions` |
| every ACP backend | the agent's own CLI | one shared ACP driver, one subprocess per chat | the agent's own session |

## How does a chat pick its provider?

A chat tab resolves its provider in this order: the tab's own choice, then the `chat.provider` key in `.settings`, then `auto`.

- Per chat. Click the model word in the controls row under the composer and pick a connector in the model dialog's left column (see [the controls row](overview.md#what-does-the-controls-row-do)).
  Switching acts like **new chat** on the other provider: a conversation cannot change drivers mid-stream, so the transcript clears and a fresh session starts. The choice is stored per tab and latched when a session spawns, so a later settings edit cannot flip a live tab to another backend.
- Default for new tabs: `chat.provider` in `.settings` accepts `auto` (the default) or any backend id from the catalog. `auto` runs the first installed backend in picker order, Claude first. A named provider is never swapped for another: if its binary is missing, the chat shows the setup screen.

On the wire, the client's `open`, `user` and `resume` frames carry `provider`. The routing rule: a chat id with a live session stays on its backend (conversation continuity beats a changed field), and only the verbs that create a session honor the requested provider.

## What do opencode chats lack?

Controls that rely on a Claude-only surface are hidden for opencode, not broken. Each is gated by a capability flag in the catalog ([backends.md](backends.md#how-do-controls-know-what-a-backend-can-do)).

- Slash commands. The `/` popover lists opencode's own command registry instead of Claude's, with each command's description; opencode commands carry no argument hints. `/rename` and `/color` work on every provider.
- Context meter. The header shows no context-window usage for opencode.

The permission mode select works for opencode. Bypass, the app default, answers every approval itself and shows no card; Accept edits answers file edits and shows a card for anything else; Default and Plan show every approval as a card. opencode has no question card, so the select drives approvals only.

Streamed markdown, tool chips, thinking sections, the editor-context preamble, queued messages, Stop, reconnect buffering, image attachments and per-turn memory recall work the same on both when opencode runs in server mode.

## Which opencode versions work?

opencode 1 and opencode 2 both run chats in server mode: token-by-token streaming, live tool approvals, image attachments, opencode's `/` commands, the **Zen Free (rotating)** model and the [provider manager](opencode-providers.md). Run `opencode --version` to see which one you have.

These behaviours belong to opencode 2:

- Effort. A model that offers reasoning levels shows the same effort row in the model dialog as Claude Code, with exactly the levels that model lists (`low` to `max`, or `none` and `minimal` on some). A model with none shows no row, and opencode 1 models never show one.
  The level you pick applies from the next turn, and a remembered level the new model does not offer runs that model at its default. `none` reads `off` in the effort row: it turns the model's thinking off.
- Agents. opencode's primary agents (`build`, `plan`, and any you define) show as an agent word in the controls row, and Shift+Tab cycles them. The chat sends `{type: 'set_agent', agent}` and the next turn runs under that agent. A chat resumed from an earlier session shows the agent that session ran.
- Default model. A new chat with no remembered pick and no local model runs opencode's own default model, so the header names it and its effort levels apply.
- Refused picks. A `set_model` for a model opencode does not list, or for a cloud model while the [local model](local-models.md) is on, is answered with `{type: 'model-refused', model, current}`; the chat keeps `current`.
- Models by group. The model dialog groups models by where they run: local servers first, then connected cloud providers, then `opencode zen`. While the local model is on, only its models are offered.
- Small context windows. A local model's opening request is sized to its loaded window before it is sent, and a prompt that still does not fit is retried once on a smaller prompt, with no error shown; see [local-models.md](local-models.md#what-happens-when-the-prompt-does-not-fit-the-context-window).
- Denying a tool ends the reply. opencode 2 stops the turn after a declined call, so the chat shows the declined tool and the turn ends without an error.
- A model that cannot be reached ends the turn with opencode's error after three failed attempts. opencode 2 on its own keeps retrying an unreachable provider with a growing delay, which reads as a chat that never answers; an offline local server is the usual cause.

A vault that hides notes from AI runs every opencode turn in run mode instead, on either version ([visibility](../vault/visibility.md)). In run mode text and reasoning arrive a whole part at a time, tool permissions are approved automatically (except what your own opencode config denies), and images are refused with an error.
On opencode 2, run mode also offers no `/` commands and no **Zen Free (rotating)** model. Run mode passes the picked agent as `--agent <name>` but shows no agent word, and opencode 1 sends the agent with each prompt.

On either version, a turn that costs nothing shows no cost in its footer.
Bismuth starts its own opencode server with its own password, so the opencode background service you run yourself never carries a Bismuth chat.

## What happens when a provider's CLI is missing?

A missing binary never crashes a chat and never switches to a different backend. `claude` sends the error code `no-claude`, `opencode` sends `no-opencode`, and Codex and the ACP driver send `no-binary` with the binary name.
The chat session maps all of them to one setup screen that names the missing agent and offers any other installed agent and the free agent. The screen is described in [overview.md](overview.md#what-do-i-need-installed).

## How it works

### The routing seam

`core/src/chatProviders/index.ts` is the router.
It resolves a provider with `resolveBackendId(requested, settingsDefault, installed)`, runs the visibility gate (`resolveVisibilityGate`) before any backend spawns, and dispatches each verb (open, send, resume, stop, set model, set effort, permission replies, close) to a `ChatBackend` from `core/src/chatProviders/backends.ts`.
The Claude driver is `core/src/chat.ts`. `sessionSink.ts` holds the sink-buffering and rebind logic every driver shares for reconnects.

### The opencode driver

`core/src/chatProviders/opencode/opencode.ts` prefers server mode and falls back to run mode when the installed opencode cannot serve or the vault restricts any note. A session's mode is decided once, at creation.
`opencodeCli.ts` reads `opencode --version` once per binary. The major picks the server client (`@opencode-ai/sdk` for opencode 1, `opencodeV2Client.ts` for opencode 2) and the run-mode argv.

#### Server mode

- Lifecycle: `opencodeServer.ts` starts one shared server lazily on the first opencode chat: `opencode serve --port 0 --hostname 127.0.0.1` (a random free port) with the same augmented PATH every Bismuth-spawned CLI uses.
  It waits for the `server listening on <url>` banner (opencode 1 prefixes it with `opencode`), then binds the major's client to the URL. Every opencode chat and vault shares that one process.
  It is killed on process exit, and a startup failure resolves `null` so sessions fall back to run mode. The handle is `{version, client, url}`, and the driver branches on `version`.
  The bullets below describe opencode 1; [server mode on opencode 2](#server-mode-on-opencode-2) lists what differs.
- Spawning. Bismuth uses the SDK's typed client but not its process-spawning helpers, which hardcode a bare `process.env` and cannot take the augmented PATH a Finder-launched app needs.
- Streaming. One subscription to `GET /global/event` serves the whole process and dispatches by opencode session id. Token deltas arrive as a `message.part.delta` event with `{sessionID, messageID, partID, field, delta}`.
- Permissions. A tool call that needs approval raises `permission.asked`, parked as a `permission` frame. `respondPermission` answers with `POST /session/{id}/permissions/{permissionID}` and `{response: "once" | "always" | "reject"}`.
- Types versus the server. The SDK's generated types declare deltas nested in `message.part.updated` and a `permission.updated` event; the running server emits the two shapes above instead. `translateOpencodeServerEvent` therefore reads every event as untyped JSON.
- Images. An image rides a `FilePartInput` with a `data:<mime>;base64,…` url on `session.prompt`.
- System text. `session.prompt`'s `system` field carries `chatInstructions` (the rendering note, `CHAT_LINE_REF_NOTE` when `editor.lineNumbers` is on, and in a vault the daemon's name and the CLI note) on every turn, followed, when the daemon is enabled, by a fresh recall from the core recall service (mode `prompt`, raced against 1500 ms).
- History and resume: `GET /session/{id}/message` is the primary source; `opencode export` is the fallback. Both read the same on-disk store, so a session started in one mode replays in the other.
  On opencode 2 the fallback is `opencode session export`, whose messages are `{type: "user", text}` and `{type: "assistant", content: […]}`; `translateOpencodeExport` reads both shapes.
- Models and commands. They come from `GET /config/providers` and `GET /command`, cached per server: a replaced or restarted server refetches them.
- Cost and stop. Cost is read off the turn's `session.prompt()` response (`info.cost`); a zero cost becomes `null`, the run-mode rule too (`opencodeTurnCost`). Stop calls `session.abort()`; the blocked prompt then resolves with `MessageAbortedError`, reported as a clean Stop.

#### Server mode on opencode 2

opencode 2's `serve` speaks a different HTTP API, which `opencodeV2Client.ts` drives and `opencodeV2Translate.ts` translates:

- Auth. Every route sits under `/api` behind HTTP Basic `opencode:<password>`. `opencodeServer.ts` puts a random password in `OPENCODE_SERVER_PASSWORD` for each spawn; opencode strips that variable from every child it runs.
- Sessions. A session belongs to the directory it was created with (`POST /api/session` with `location.directory`), instead of a `directory` query on every call. Catalog reads take a `location[directory]` query.
- Turns. `POST /api/session/{id}/prompt` queues the message and returns at once. `runTurnServerV2` registers its listener first, posts the prompt (or `POST …/command` for a known `/command`), and ends the turn on `session.execution.succeeded`, `failed` or `interrupted` for that session.
  If the event stream closes, every waiting turn is told (`OPENCODE_STREAM_CLOSED`) and fails with a lost-connection error.
- Streaming. `GET /api/event` carries `{type, data}` with the session in `data.sessionID`. `session.text.delta` and `session.reasoning.delta` stream; their `*.ended` events carry the whole part, and only the unstreamed suffix is emitted.
  A tool chips on `session.tool.called` (its input) and resolves on `session.tool.success` or `session.tool.failed`. `session.step.ended` costs are summed.
- Model, effort and memory. A prompt carries none of them. The model is set per session (`POST …/model`) before a turn whose pick changed.
  A model's effort levels are its variants that set `reasoningEffort` (`effortLevelsFromV2Variants`); `setEffort` stores the pick, and `opencodeV2TurnModel` adds it as the `Model.Ref` variant only when the turn's model lists it, because the server accepts any variant string without an error. No variant means the model's default. The per-turn system text (the rendering note, the line-citation note when line numbers are on, in a vault the daemon's name (`chatPersonaNote.ts`) and the `bismuth` CLI note (`agentCliNote.ts`), then the brain block when the turn's tier carries it, then any recall) rides the session instructions entry `bismuth-memory` (`PUT /api/experimental/session/{id}/instructions/entries/{key}`), written before every turn.
- Images. Each image is a `files` entry with a `data:<mime>;base64,…` uri.
- Permissions. `permission.asked` carries `{id, action, resources}`; a shell ask shows its command line. `respondPermission` posts `{decision: "once" | "always" | "reject"}` to `…/permission/{id}/reply`.
- Permission mode. The injected config asks before every file edit (`edit: ask`), and the chat's permission mode decides which asks the driver answers itself (`opencodeAutoPermission`, set by `setPermissionMode`): `bypassPermissions` answers every ask `once` with no card, `acceptEdits` answers file edits, and `default` and `plan` show each ask as a card.
- No-progress stop. A turn that receives no event from its session for `OPENCODE_NO_PROGRESS_MS` (120 s; 600 s for a local model's first turn in a chat) is interrupted and ends with an error naming the model and the wait. The timer pauses while a permission card waits for an answer or a tool runs.
  After a declined call opencode ends the turn as `interrupted` (reason `shutdown`); a tool failure of type `aborted` marks the turn declined, so it ends without an error.
- Retries. A failing provider call is retried with `session.retry.scheduled`. At attempt `OPENCODE_V2_MAX_ATTEMPTS` the driver interrupts the session and ends the turn with the provider's error.
- Stop, history, erase. Stop is `POST …/interrupt`. History reads every page of `GET /api/session/{id}/message` (oldest first) through the same translator as the CLI export, including a user turn's inline images. A private chat is erased with `DELETE /api/session/{id}`.
- Agents. `GET /api/agent` lists every agent; opencode can answer a directory's first read with an empty list, so an empty answer is read once more. `agentEntriesFromV2` keeps the primaries that are not hidden, in opencode's order, and the `agents` frame carries them beside `models` with `current` (the session's own `agent` from `GET /api/session/{id}` on a resume, else the first). `setAgent` ignores a name that is not in that list. A turn calls `POST …/agent` before its prompt only when the chosen agent differs from the one the session runs.
- Default model. A fresh session with no pick and the local model off adopts `defaultModelFromV2(GET /api/model/default)` as its model.
- Window limits. The default server's `OPENCODE_CONFIG_CONTENT` is built by `opencodeConfigContent` from the local model, the vault's saved servers and the detected windows of loopback models that `GET /api/provider` and `GET /api/model` list from providers Bismuth did not declare (`probeLocalServer` reads each server). A window that differs from the live server's injected limit replaces the server once, after any turn on it settles; a reopen with unchanged windows keeps it. Before a turn on a loopback model, `recheckWindow` reads that model's window again and replaces the server only when it changed. `refreshOpencodeFrames(vault)` rebuilds the config from that vault's settings, so a server saved in `.settings` since the last open shows its models.
- Bismuth MCP. Each profile's injected config declares the installed `~/.bismuth/bin/bismuth-mcp` as opencode's `bismuth` MCP server (`opencodeMcp`, `installedMcpLaunch`), with `codemode: false` so its tools are called directly, and `BISMUTH_VAULT`, `BISMUTH_MCP_CHANNEL=chat`, `BISMUTH_AGENT_CHANNEL=chat`, plus `BISMUTH_MEMORY_DIR` when the chat opened with the daemon on. The `compact` profile declares it too, so a small window keeps the Bismuth tools for about 200 tokens of schema.
- History. `opencodeHistory.ts` lists the vault's opencode sessions (`GET /api/session?directory=…`, child sessions dropped) beside the Claude Code ones in `GET /chat/sessions` and `POST /chat/search`, each row tagged `provider`. An id starting `ses_` replays from opencode, and `POST /chat/delete` hides it for the trash window before `DELETE /api/session/{id}`.
- Tier and compact retry. `runTurnServerV2` picks the turn's tier (`chooseTier`, `opencodeBudget.ts`) before anything is sent, from the share of the model's detected window opencode fills before it compacts (`opencodeUsable`), and runs a `full` turn on the `default` server slot and a `brain` or `lean` turn on the `compact` slot. When a turn short of `lean` fails with a context overflow (`isContextOverflow` on the failed outcome or the retry give-up message, including opencode's `compaction.failed` for an opening request past its compaction threshold) before any frame reached the chat, it runs the same text once on the `compact` slot as `lean`; the `compact` slot is a second server whose config carries the compact profile. Both servers read opencode's one session store, so the retry continues the same session: `dropFailedAttempt` first reverts the session to before the failed attempt's user message (`POST …/revert/stage` with `files: false`, then `…/revert/commit`), so the turn holds one user message and earlier turns stay. A session the compact server does not know is created there and announced with a `session` frame. The model, keyed by `provider/model` and its detected window, is remembered for the process and its later turns run `lean`. A `lean` turn's instructions entry keeps the rendering note and the recall and drops the session-start brain block. The compact profile denies opencode's own `skill` tool, so its instructions name the vault's skills in one line each (`vaultSkillNote`: name, a description cut to 120 characters, the `SKILL.md` path; at most 12) and the model reads a skill's file with its read tool. A compact turn that still overflows ends with `contextOverflowMessage`. opencode 1 server mode shows that message without retrying.
- Run-mode compact retry. Run mode picks the profile from the same tier and retries an overflowed turn by spawning `opencode run` with the compact config. `run` has no revert, so when the failed attempt started the session, the retry runs without `-s` in a new session, announced with a `session` frame, and `opencode session delete` erases the failed one. A later turn's retry continues its session with `-s`, so that session keeps the failed attempt's user message beside the retry's.
- Session titles. A session the driver creates on opencode 2 is named from the first prompt (`titleFromPrompt`) before that prompt is sent: `PATCH /api/session/{id}` for a session made at open, the `title` field of `POST /api/session` for one made mid-turn. A titled session skips opencode's own title generation, a model call that runs ahead of the first turn.
- Model groups and picks. Every `models` entry carries `group` from `modelGroupFor`, with `names` of `local` for the local model and each saved server's name. `setModel` waits for the model fetch in flight, then refuses an id the non-empty list does not hold (the rotate id excepted) or a cloud id while the local model is on.
- Models, commands, credentials. `GET /api/model` (free when the first cost tier is $0 in and out), `GET /api/command`, and `GET /api/integration` for the `auth` frame, so a chat open spawns no CLI.

#### Run mode

Each turn spawns `opencode run --format json --auto [-s ses_…] [-m provider/model] <text>` with the vault as `cwd`, and stdout is NDJSON. Text and reasoning parts arrive whole, `tool_use` events arrive with `state.status` resolved, and `step_finish` accumulates any positive cost.

On opencode 2, `opencodeCliArgs` rewrites every CLI call:

- `--standalone` on `run`, `models`, `auth list` and `session …`. Without it, each call rides one per-user background service (`opencode serve --service`, detached), which keeps the env of whichever client started it. A Bismuth turn's `OPENCODE_CONFIG_CONTENT`, its `chat` stamp and its OS sandbox would then leak into the user's own opencode, or be dropped when the user's service is already up. Tools run inside the server, so a sandbox around the client alone confines nothing.
  With the flag, each call gets a private `serve --stdio` child that inherits the call's env and sandbox and exits with it.
- The message goes on stdin, not argv: opencode 2's `run` shell-quotes an argument containing whitespace, so the model would read the prompt wrapped in literal quotes.
- `export <id>` becomes `session export <id>`. `models --verbose` and `debug config` are skipped: the first does not exist, and the second has no `--standalone` and would start the shared service. `run --command` does not exist either, so the command list is empty.
- opencode 2 emits `step_finish` only after a tool step, so a text-only turn reports no cost.
`--auto` approves every tool permission not denied by your own opencode config, matching the app's Bypass default. Run mode cannot park on a prompt and has no attachment flag, so images are refused with an error.
An error event nests its message under `error.data.message`, and a run that streamed an error still exits 0, so the `result` frame reports `isError` when the exit code was non-zero or an error frame went out.

#### opencode-native surfaces

- *Commands.* Server mode reads the typed `GET /command`; run mode parses `opencode debug config`. Both merge the built-ins `/init` and `/review`. Run mode on opencode 2 offers none.
  A sent turn that leads with a known `/command` runs as `session.command()` (or `opencode run --command` in run mode); an unknown `/word` goes through as prose.
- *Credentials.* The connected providers are emitted as an `auth` frame per session open (`opencode auth list`, or the server's integrations on opencode 2) and stored as `authProviders`. No component renders it; credentials are managed in the model dialog ([opencode-providers.md](opencode-providers.md)).
- *Zen Free rotation.* When Zen offers free models (`cost.input === 0 && cost.output === 0` on `opencode/…` ids), the model list gains a virtual **Zen Free (rotating)** entry (`bismuth/zen-free-rotate`).
  Selecting it makes each turn round-robin a real free model (`pickZenFreeModel`); the virtual id never reaches the CLI. An empty roster hides the entry.

#### Managed install

With no `opencode` on the machine, `core/src/freeAgent.ts` can download opencode's official GitHub release (`anomalyco/opencode`) into `~/.bismuth/agents/bin/opencode`, through `GET /agents/free` and `POST /agents/free/install` ([HTTP reference](../api/http-reference.md#free-agent-agentsfree)).
That directory is last on the lookup PATH, so your own opencode always wins and the install is skipped (`already-installed`) when one is found.
The download is hashed while it streams and compared with the sha256 digest GitHub publishes on the release asset; a mismatch, a missing digest or a bad archive aborts the install.

### The Codex driver

`core/src/chatProviders/codex/driver.ts` spawns your `codex` binary with `Bun.spawn`, once per turn, and pumps its NDJSON stdout through the pure translator in `protocol.ts`. It does not use `@openai/codex-sdk` (see [backends.md](backends.md#why-codex-is-driven-without-its-sdk)).
Its lifecycle matches opencode's run mode: a session map keyed by chat id, sink buffering and rebind, a serialized turn queue, tolerant NDJSON parsing (a bad line is skipped), and teardown on process exit.

- Command: `buildCodexExecArgs` builds `codex exec --json [--model <id>] --sandbox workspace-write --cd <vault> --skip-git-repo-check [local-model --config overrides] [--config model_reasoning_effort="<level>"] --config approval_policy="never" --config developer_instructions="<chatInstructions>" [resume <threadId>] [--image <path>]…`.
  Bismuth's MCP server rides the same command as per-exec overrides, `--config mcp_servers.bismuth.command`, `.args` and `.env.<NAME>` (`buildMcpServers`, the server the ACP driver hands its agents), so a Codex chat reaches the Bismuth tools while `~/.codex/config.toml` is never edited. Nothing is passed when `~/.bismuth/bin/bismuth-mcp` is not installed.
  A `developer_instructions` key in your own `~/.codex/config.toml` is overridden by that flag in a chat turn, without a warning; a Codex terminal tab still reads yours.
  The prompt is written to stdin, never argv. A turn that produces no parseable JSON and exits non-zero is retried once with `--experimental-json`, and the spelling that worked is remembered for the session.
- Continuity. The thread id comes from the first `thread.started` event and goes out as a `session` frame. The next turn passes `resume <threadId>`.
- History. `codexHistory.ts` reads Codex's rollout files (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`, `CODEX_HOME` defaulting to `~/.codex`): the threads whose `session_meta` names the vault as their `cwd` list in `history` and `bismuth chat list`, titled by Codex's `session_index.jsonl` or the first message, and a reopened thread replays its typed messages and replies. Threads Codex spawned as subagents are left out, and so are chats from the Codex desktop app in other folders. A deleted Codex chat can be restored for ten minutes, then `eraseCodexThread` removes its rollout and its rows in Codex's databases. A Codex thread id is a version 7 UUID, which is how history tells it from a Claude Code session id.
- Streaming. Prose arrives in whole-item chunks (`streaming: "part"`), the `result` frame carries `costUsd: null`, and the tab title comes from the first prompt (`titleFromPrompt`).
- Images. Each attachment is written to a temp file under `os.tmpdir()/bismuth-codex-<uuid>/` because `--image` takes a path; the directory is deleted when the turn settles.
- Models and effort. When a session opens, the driver runs `codex debug models` once (`readCodexModels`, 15 s limit) and sends the picker entries as the `models` frame, each with the effort levels the model lists (`low`, `medium`, `high`, `xhigh`, `max`, and `ultra` on some). With the local model on, or a model set in your Codex config, that model is added to the list when the catalog lacks it, with the levels every catalog model shares. If the command fails the frame is not sent and the dialog shows `no models reported`.
  `set_effort` takes a level the selected model lists (any lowercase word before the list is read) and sends it as `model_reasoning_effort`; anything else clears it. `set_model` passes `--model`. While the local model is on, a pick it does not serve is refused with a `model-refused` frame instead of running on another model.
- Notices. A `Model metadata for <model> not found` item, which Codex emits for any model outside its catalog, is dropped in every mode, so the turn does not end as an error. A `Reconnecting... n/m` item is a retry notice, not a failure: only the turn's own `turn.failed` reports an error.
- Permissions: `codex exec` has no approval channel. The driver runs `--sandbox workspace-write` with `approval_policy="never"`, `permissionPrompts` and `permissionModes` are `false`, and the manifest is one empty static frame.
- Stop kills the in-flight process and clears the queue; the non-zero exit is reported as a deliberate Stop.
- Local model. With `localModel.enabled`, `resolveLocalSpawn('codex', …)` runs at the start of every turn ([local-models.md](local-models.md)). It also runs when a chat opens, new or reopened from history, so the controls row names the local model before the first turn.
- Opt-ins. On session open, `settings.codex.writeAgentsMd` writes the managed AGENTS.md block and `settings.codex.installRelayHooks` writes the project-scoped Codex hook files. Both are read fresh per new session and never block it.

### The ACP driver

Every ACP backend shares one hand-rolled [Agent Client Protocol](https://agentclientprotocol.com) driver, `core/src/chatProviders/acp/driver.ts`, instantiated once per agent by `createAcpBackend`.
The pure half (JSON-RPC envelopes, the `session/update` to `ChatFrame` translator, model-shape detection, permission-option mapping) is `acp/protocol.ts`. Unlike opencode run mode and Codex, the agent is one long-lived subprocess per chat, speaking newline-delimited JSON-RPC 2.0 over stdio.

`acp/agents.ts` (`ACP_AGENTS`) is the spawn table: which binary and arguments put each CLI into ACP mode.

| Backend | Spawns | Notes |
| --- | --- | --- |
| `cline` | `cline --acp` | ignores `session/new`'s `mcpServers`, so its Bismuth tool lives in its own settings file |
| `gemini` | `gemini --experimental-acp` | `fallbackArgs: ['--acp']`, retried once if the process exits before `initialize` answers |
| `goose` | `goose acp` | the only ACP agent with a [local-model](local-models.md) mechanism; the only one with a permission picker |
| `openclaw` | `openclaw acp --session agent:main:bismuth-<chatId>` | the per-chat `--session` keeps chats from sharing a key; it takes no per-session MCP servers |
| `hermes` | `hermes acp` | |
| `claude-code-acp` | `npx -y @zed-industries/claude-code-acp` | an adapter, hidden from the picker; its Claude Code child gets the same retry cap as a native chat |
| `codex-acp` | `npx -y @agentclientprotocol/codex-acp` | an adapter, hidden from the picker |

- Handshake: `initialize` (`protocolVersion: 1`; client capabilities declare no `fs` and no `terminal`), then `session/new {cwd, mcpServers}`. A resume calls `session/load`, falling back to `session/resume` on a method-not-found error.
  If the handshake never completes, the chat shows `<label> did not complete the ACP handshake.`
- A turn is one `session/prompt` with a `text` block and one `{type:"image", data, mimeType}` block per attachment. ACP has no system-prompt field, so a session's first prompt from this process leads with a `<bismuth-chat-instructions>` text block holding `chatInstructions` (`acpInstructionBlocks`).
  `session/update` notifications stream as frames and the `stopReason` response ends the turn: `cancelled` is a clean Stop, `refusal` is reported as `isError`, and `max_tokens` counts as completed. Stop sends `session/cancel` and kills the process after a grace period if the agent never settles.
- Model and effort: `detectModelShape` handles both shapes agents return: `configOptions` with `session/set_config_option`, and `models` with `session/set_model`.
  Effort levels come from the `configOptions` entry with category `thought_level`; an agent without one gets `effortLevels: []`, which hides the toggle.
  Config calls (model, effort, mode) run one after another on a per-session chain, and a prompt waits for the chain and for a resume still loading. A model switch re-reads the effort option the reply names, updates that model's levels in the models frame, and sends the chosen effort again, because goose resets effort to the new model's default. A pick the agent cannot serve (goose on a local model it does not list) emits `model-refused`, and while a local model pins the chat the models frame lists the local server's ids.
- Permissions: `session/request_permission` is parked as a `permission` frame and answered through the same permission card. Every other client-side request (`fs/*`, `terminal/*`, elicitation) gets method-not-found. There is no AskUserQuestion equivalent.
  An agent whose approval is a session mode has a mode picker: its spec in `acp/agents.ts` names `askMode` and `autoMode` (Goose `approve` / `auto`, Hermes `default` / `dont_ask`, Codex (ACP) `read-only` / `agent-full-access`). `bypassPermissions` sets the auto mode through `session/set_mode`, every other chat mode sets the ask mode, and the mode is applied when the session starts and on each pick. Claude Code (ACP) sets `passModeNames`: the chat's own mode names (`default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`) are the adapter's session mode ids, sent when the adapter lists them. Every other ACP agent shows no picker.
  OpenClaw's bridge relays only shell-command approvals, so its spec sets `permissionPrompts: false`: the driver has no `respondPermission` and declines a request the bridge still sends.
- Failed turns. An agent that ends a failed model call with a normal stop is read as an error: `emptyTurnIsError` (OpenClaw: no text and no tool call) and `failureTextPrefixes` (Hermes: a reply that starts `API call failed after`, `Billing or credits exhausted` and the like).
- OpenClaw's models. Its ACP session lists no models, so the driver runs `openclaw models list --json` (`modelListCommand`) for the models frame and reads effort from the bridge's `thought_level` option. The `adaptive` level (the gateway's session default) is not offered as an effort level. OpenClaw sends a level as `reasoning_effort` only for a model its config marks `reasoning: true`; for any other model the level is accepted and no request carries it. A model switch the bridge cannot forward emits `model-refused`. The session frame carries the gateway key (`agent:main:bismuth-<chat id>`), and a resumed chat spawns with `--session <that key>` and sends it as `_meta.sessionKey` on `session/load`, so it reopens its own gateway session; a private chat's eraser deletes that same key.
- Gemini's spawn. `GEMINI_CLI_TRUST_WORKSPACE=true` is set so gemini starts Bismuth's MCP server in the vault it was opened on. Gemini retries a failing model up to ten times before the prompt errors; its `general.maxAttempts` setting is read from `~/.gemini/settings.json` or the vault's `.gemini/settings.json` (a system settings file only when root owns it), so a spawn leaves the cap to you. A vault's `.gemini/settings.json` also applies in that vault's gemini chats, including its MCP servers and hooks.
- Silent turns. A turn whose agent sends no message for 120 s ends with an `error` frame naming the agent and the seconds waited, after the driver sends `session/cancel` (`ACP_NO_PROGRESS_MS`, `acpNoProgressMs`). Every `session/update` and permission ask restarts the window, and it restarts instead of firing while a permission card is open or a tool call is unresolved. A chat pinned to a [local model](local-models.md) waits 600 s, since the server may be loading the model. `BISMUTH_ACP_NO_PROGRESS_MS` overrides both.
- Retries. `claude-code-acp` spawns with `CLAUDE_CODE_MAX_RETRIES` capped as a native Claude chat is ([overview.md](overview.md#how-it-works)), your own value winning. An adapter that retries a failing model server and then stops normally (codex-acp's `Reconnecting... n/m` metadata) has its last attempt kept as the turn's error.
- Tool output. A finished tool's text is its `content` blocks, else its `rawOutput` (`toolResultText`): cline sends results as `rawOutput` alone, a string stays as is, an MCP result joins its text parts, and anything else is JSON-stringified.
- Cline's MCP. When `CLINE_DIR` is set, the driver writes the Bismuth server into `<CLINE_DIR>/data/settings/cline_mcp_settings.json` (`ensureClineMcp`), keeping every other server and key; an unreadable file is left untouched. With it unset cline runs against your own `~/.cline`, which a chat never touches; the opt-in registrar (`bismuth install --mcp cline`) is the only writer there.
- MCP and memory: `mcpServers` carries Bismuth's own `bismuth-mcp` binary from `~/.bismuth/bin/bismuth-mcp` (with `BISMUTH_VAULT`, `BISMUTH_MCP_CHANNEL=chat`, `BISMUTH_AGENT_CHANNEL=chat`, plus `BISMUTH_MEMORY_DIR` when the daemon is enabled).
  It is `[]` when that binary is not installed and for any agent with `supportsSessionMcpServers: false`. Memory reaches these agents only through the MCP tools (`memory: "mcpOnly"`).
- Commands: `available_commands_update` refreshes the manifest's `slashCommands`, `commandDetails` from each command's `description`, and `commandHints` from its `input.hint`.
- Capabilities are one shared profile, `ACP_SHARED_CAPABILITIES`, plus per-agent overrides.
- Missing binary emits `no-binary` with ``The `<binary>` CLI was not found. Install <label> to use this provider.`` For the two adapters the binary is `npx`.

Source: `core/src/chat.ts`, `core/src/chatRenderingNote.ts`, `core/src/chatLineRefNote.ts`, `core/src/chatProviders/index.ts`, `core/src/chatProviders/backends.ts`, `core/src/chatProviders/sessionSink.ts`, `core/src/chatProviders/opencode/opencode.ts`, `core/src/chatProviders/opencode/opencodeServer.ts`, `core/src/chatProviders/opencode/opencodeCli.ts`, `core/src/chatProviders/opencode/opencodeTranslate.ts`, `core/src/chatProviders/opencode/opencodeV2Client.ts`, `core/src/chatProviders/opencode/opencodeV2Translate.ts`, `core/src/chatProviders/opencode/opencodeBudget.ts`, `core/src/chatProviders/opencode/opencodeSkills.ts`, `core/src/chatProviders/codex/driver.ts`, `core/src/chatProviders/codex/protocol.ts`, `core/src/chatProviders/codex/models.ts`, `core/src/chatProviders/codex/codexHistory.ts`, `core/src/chatProviders/acp/driver.ts`, `core/src/chatProviders/acp/agents.ts`, `core/src/chatProviders/acp/protocol.ts`, `core/src/freeAgent.ts`, `core/src/agentBackends/catalog.ts`, `core/src/agentBackends/mcpRegistrars.ts`, `app/src/chat/chatProvider.ts`
