# Chat providers

A chat provider is the CLI that drives one chat tab: Claude Code, opencode, Codex, or one of the agents that speak the Agent Client Protocol (ACP). Every provider streams the same `ChatFrame` messages over the `/chat` WebSocket, so the chat view renders any of them without provider-specific code.

The catalog of backends and the capability flags that decide which controls render are in [backends.md](backends.md); using chat day to day is in [overview.md](overview.md).

| Provider | Binary | Driver | Conversation lives in |
| --- | --- | --- | --- |
| `claude` | your `claude` | one long-lived Agent SDK `query()` per chat | the SDK session store, shared with terminal sessions |
| `opencode` | your `opencode` | opencode 1: one shared `opencode serve` process, or a per-turn `opencode run` fallback; opencode 2: a per-turn `opencode run` | opencode's own store (`ses_…` ids) |
| `codex` | your `codex` | a `codex exec --json` subprocess per turn | Codex thread ids; no history replay |
| every ACP backend | the agent's own CLI | one shared ACP driver, one subprocess per chat | the agent's own session |

## How does a chat pick its provider?

A chat tab resolves its provider in this order: the tab's own choice, then the `chat.provider` key in `.settings`, then `auto`.

- Per chat. Click the model word in the controls row under the composer and pick a connector in the model dialog's left column (see [the controls row](overview.md#what-does-the-controls-row-do)).
  Switching acts like **new chat** on the other provider: a conversation cannot change drivers mid-stream, so the transcript clears and a fresh session starts. The choice is stored per tab and latched when a session spawns, so a later settings edit cannot flip a live tab to another backend.
- Default for new tabs: `chat.provider` in `.settings` accepts `auto` (the default) or any backend id from the catalog. `auto` runs the first installed backend in picker order, Claude first. A named provider is never swapped for another: if its binary is missing, the chat shows the setup screen.

On the wire, the client's `open`, `user` and `resume` frames carry `provider`. The routing rule: a chat id with a live session stays on its backend (conversation continuity beats a changed field), and only the verbs that create a session honor the requested provider.

## What do opencode chats lack?

Controls that rely on a Claude-only surface are hidden for opencode, not broken. Each is gated by a capability flag in the catalog ([backends.md](backends.md#how-do-controls-know-what-a-backend-can-do)).

- Permission mode select: opencode can raise and answer a live approval request, but its server API has no Default, Plan, Accept edits or Bypass vocabulary, so the mode select stays hidden.
- Effort toggle: opencode models report no effort levels, so the model dialog shows no effort row.
- Cross-session history. The `history` button lists the Claude Code session store. opencode conversations resume per tab but do not appear in that list.
- Slash commands. The `/` popover lists opencode's own command registry instead of Claude's. `/rename` and `/color` work on every provider.
- Context meter. The header shows no context-window usage for opencode.

Streamed markdown, tool chips, thinking sections, the editor-context preamble, queued messages, Stop, reconnect buffering, image attachments and per-turn memory recall work the same on both when opencode runs in server mode.

## Which opencode versions work?

opencode 1 and opencode 2 both run chats. Run `opencode --version` to see which one you have.

- opencode 1 runs in server mode when it can serve: token-by-token streaming, live tool approvals, image attachments and opencode's `/` commands.
- opencode 2 runs every turn in run mode, because its server speaks an API Bismuth's opencode client does not drive. Text and reasoning arrive a whole part at a time, tool permissions are approved automatically (except what your own opencode config denies), and images are refused with an error.
- opencode 2 shows no opencode commands in the `/` popover: its `run` sends a leading `/name` to the model as plain text.
- opencode 2 shows no **Zen Free (rotating)** model, because its model list carries no cost metadata to tell free models from paid ones.
- opencode 2 cannot use the provider manager; connect a provider with `opencode auth login` in a terminal ([opencode providers](opencode-providers.md#what-if-opencode-is-not-installed)).

On either version, a turn that costs nothing shows no cost in its footer.
An opencode 2 chat runs on its own private opencode server, so it shares no config, environment or sandbox with the opencode you run yourself or with another Bismuth window.

## What happens when a provider's CLI is missing?

A missing binary never crashes a chat and never switches to a different backend. `claude` sends the error code `no-claude`, `opencode` sends `no-opencode`, and Codex and the ACP driver send `no-binary` with the binary name.
The chat session maps all of them to one setup screen that names the missing agent and offers any other installed agent and the free agent. The screen is described in [overview.md](overview.md#what-do-i-need-installed).

## How it works

### The routing seam

`core/src/chatProviders/index.ts` is the router.
It resolves a provider with `resolveBackendId(requested, settingsDefault, installed)`, runs the visibility gate (`resolveVisibilityGate`) before any backend spawns, and dispatches each verb (open, send, resume, stop, set model, set effort, permission replies, close) to a `ChatBackend` from `core/src/chatProviders/backends.ts`.
The Claude driver is `core/src/chat.ts`. `sessionSink.ts` holds the sink-buffering and rebind logic every driver shares for reconnects.

### The opencode driver

`core/src/chatProviders/opencode/opencode.ts` prefers server mode and falls back to run mode only when the installed opencode cannot serve. A session's mode is decided once, at creation.
`opencodeCli.ts` reads `opencode --version` once per binary; an opencode 2 never starts a server, so its sessions go straight to run mode.

#### Server mode

- Lifecycle: `opencodeServer.ts` starts one shared server lazily on the first opencode chat: `opencode serve --port 0 --hostname 127.0.0.1` (a random free port) with the same augmented PATH every Bismuth-spawned CLI uses.
  It waits for the `opencode server listening on <url>` banner, then binds `@opencode-ai/sdk`'s typed client to the URL. Every opencode chat and vault shares that one process through a `directory` query parameter on each request.
  It is killed on process exit, and a startup failure resolves `null` so sessions fall back to run mode.
  opencode 2's `serve` prints `server listening on <url>` and serves its API under `/api` behind a printed password; `@opencode-ai/sdk` 1.x drives neither, which is why the version check skips it.
- Spawning. Bismuth uses the SDK's typed client but not its process-spawning helpers, which hardcode a bare `process.env` and cannot take the augmented PATH a Finder-launched app needs.
- Streaming. One subscription to `GET /global/event` serves the whole process and dispatches by opencode session id. Token deltas arrive as a `message.part.delta` event with `{sessionID, messageID, partID, field, delta}`.
- Permissions. A tool call that needs approval raises `permission.asked`, parked as a `permission` frame. `respondPermission` answers with `POST /session/{id}/permissions/{permissionID}` and `{response: "once" | "always" | "reject"}`.
- Types versus the server. The SDK's generated types declare deltas nested in `message.part.updated` and a `permission.updated` event; the running server emits the two shapes above instead. `translateOpencodeServerEvent` therefore reads every event as untyped JSON.
- Images. An image rides a `FilePartInput` with a `data:<mime>;base64,…` url on `session.prompt`.
- Memory. When the daemon is enabled, `session.prompt`'s `system` field carries a fresh recall from the core recall service (mode `prompt`, raced against 1500 ms) on every turn.
- History and resume: `GET /session/{id}/message` is the primary source; `opencode export` is the fallback. Both read the same on-disk store, so a session started in one mode replays in the other.
  On opencode 2 the fallback is `opencode session export`, whose messages are `{type: "user", text}` and `{type: "assistant", content: […]}`; `translateOpencodeExport` reads both shapes.
- Models and commands. They come from `GET /config/providers` and `GET /command`.
- Cost and stop. Cost is read off the turn's `session.prompt()` response (`info.cost`); a zero cost becomes `null`, the run-mode rule too (`opencodeTurnCost`). Stop calls `session.abort()`; the blocked prompt then resolves with `MessageAbortedError`, reported as a clean Stop.

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
- *Credentials.* `opencode auth list` is emitted as an `auth` frame per session open and stored as `authProviders`. No component renders it; credentials are managed in the model dialog ([opencode-providers.md](opencode-providers.md)).
- *Zen Free rotation.* When Zen offers free models (`cost.input === 0 && cost.output === 0` on `opencode/…` ids), the model list gains a virtual **Zen Free (rotating)** entry (`bismuth/zen-free-rotate`).
  Selecting it makes each turn round-robin a real free model (`pickZenFreeModel`); the virtual id never reaches the CLI. An empty roster hides the entry.

#### Managed install

With no `opencode` on the machine, `core/src/freeAgent.ts` can download opencode's official GitHub release (`anomalyco/opencode`) into `~/.bismuth/agents/bin/opencode`, through `GET /agents/free` and `POST /agents/free/install` ([HTTP reference](../api/http-reference.md#free-agent-agentsfree)).
That directory is last on the lookup PATH, so your own opencode always wins and the install is skipped (`already-installed`) when one is found.
The download is hashed while it streams and compared with the sha256 digest GitHub publishes on the release asset; a mismatch, a missing digest or a bad archive aborts the install.

### The Codex driver

`core/src/chatProviders/codex/driver.ts` spawns your `codex` binary with `Bun.spawn`, once per turn, and pumps its NDJSON stdout through the pure translator in `protocol.ts`. It does not use `@openai/codex-sdk` (see [backends.md](backends.md#why-codex-is-driven-without-its-sdk)).
Its lifecycle matches opencode's run mode: a session map keyed by chat id, sink buffering and rebind, a serialized turn queue, tolerant NDJSON parsing (a bad line is skipped), and teardown on process exit.

- Command: `buildCodexExecArgs` builds `codex exec --json [--model <id>] --sandbox workspace-write --cd <vault> --skip-git-repo-check [local-model --config overrides] [--config model_reasoning_effort="<level>"] --config approval_policy="never" [resume <threadId>] [--image <path>]…`.
  The prompt is written to stdin, never argv. A turn that produces no parseable JSON and exits non-zero is retried once with `--experimental-json`, and the spelling that worked is remembered for the session.
- Continuity. The thread id comes from the first `thread.started` event and goes out as a `session` frame. The next turn passes `resume <threadId>`. `historyReplay` and `sessionPicker` are `false`, so a resumed chat continues but shows no past transcript.
- Streaming. Prose arrives in whole-item chunks (`streaming: "part"`), the `result` frame carries `costUsd: null`, and the tab title comes from the first prompt (`titleFromPrompt`).
- Images. Each attachment is written to a temp file under `os.tmpdir()/bismuth-codex-<uuid>/` because `--image` takes a path; the directory is deleted when the turn settles.
- Effort and model: `set_effort` accepts `minimal | low | medium | high | xhigh` and sends it as `model_reasoning_effort`; anything else clears it. Codex has no model-list capability, so the driver emits no `models` frame: the dialog shows `no models reported` and no effort row.
  `set_model` takes a free-form id and passes `--model`.
- Permissions: `codex exec` has no approval channel. The driver runs `--sandbox workspace-write` with `approval_policy="never"`, `permissionPrompts` and `permissionModes` are `false`, and the manifest is one empty static frame.
- Stop kills the in-flight process and clears the queue; the non-zero exit is reported as a deliberate Stop.
- Local model. With `localModel.enabled`, `resolveLocalSpawn('codex', …)` runs at the start of every turn ([local-models.md](local-models.md)).
- Opt-ins. On session open, `settings.codex.writeAgentsMd` writes the managed AGENTS.md block and `settings.codex.installRelayHooks` writes the project-scoped Codex hook files. Both are read fresh per new session and never block it.

### The ACP driver

Every ACP backend shares one hand-rolled [Agent Client Protocol](https://agentclientprotocol.com) driver, `core/src/chatProviders/acp/driver.ts`, instantiated once per agent by `createAcpBackend`.
The pure half (JSON-RPC envelopes, the `session/update` to `ChatFrame` translator, model-shape detection, permission-option mapping) is `acp/protocol.ts`. Unlike opencode run mode and Codex, the agent is one long-lived subprocess per chat, speaking newline-delimited JSON-RPC 2.0 over stdio.

`acp/agents.ts` (`ACP_AGENTS`) is the spawn table: which binary and arguments put each CLI into ACP mode.

| Backend | Spawns | Notes |
| --- | --- | --- |
| `cline` | `cline --acp` | |
| `gemini` | `gemini --experimental-acp` | `fallbackArgs: ['--acp']`, retried once if the process exits before `initialize` answers |
| `goose` | `goose acp` | the only ACP agent with a [local-model](local-models.md) mechanism |
| `openclaw` | `openclaw acp --session agent:main:bismuth-<chatId>` | the per-chat `--session` keeps chats from sharing a key; it takes no per-session MCP servers |
| `hermes` | `hermes acp` | |
| `claude-code-acp` | `npx -y @zed-industries/claude-code-acp` | an adapter, hidden from the picker |
| `codex-acp` | `npx -y @agentclientprotocol/codex-acp` | an adapter, hidden from the picker |

- Handshake: `initialize` (`protocolVersion: 1`; client capabilities declare no `fs` and no `terminal`), then `session/new {cwd, mcpServers}`. A resume calls `session/load`, falling back to `session/resume` on a method-not-found error.
  If the handshake never completes, the chat shows `<label> did not complete the ACP handshake.`
- A turn is one `session/prompt` with a `text` block and one `{type:"image", data, mimeType}` block per attachment.
  `session/update` notifications stream as frames and the `stopReason` response ends the turn: `cancelled` is a clean Stop, `refusal` is reported as `isError`, and `max_tokens` counts as completed. Stop sends `session/cancel` and kills the process after a grace period if the agent never settles.
- Model and effort: `detectModelShape` handles both shapes agents return: `configOptions` with `session/set_config_option`, and `models` with `session/set_model`.
  Effort levels come from the `configOptions` entry with category `thought_level`; an agent without one gets `effortLevels: []`, which hides the toggle.
- Permissions: `session/request_permission` is parked as a `permission` frame and answered through the same permission card. Every other client-side request (`fs/*`, `terminal/*`, elicitation) gets method-not-found. There is no mode picker and no AskUserQuestion equivalent.
- MCP and memory: `mcpServers` carries Bismuth's own `bismuth-mcp` binary from `~/.bismuth/bin/bismuth-mcp` (with `BISMUTH_VAULT`, `BISMUTH_MCP_CHANNEL=chat`, `BISMUTH_AGENT_CHANNEL=chat`, plus `BISMUTH_MEMORY_DIR` when the daemon is enabled).
  It is `[]` when that binary is not installed and for any agent with `supportsSessionMcpServers: false`. Memory reaches these agents only through the MCP tools (`memory: "mcpOnly"`).
- Capabilities are one shared profile, `ACP_SHARED_CAPABILITIES`, plus per-agent overrides.
- Missing binary emits `no-binary` with ``The `<binary>` CLI was not found. Install <label> to use this provider.`` For the two adapters the binary is `npx`.

Source: `core/src/chat.ts`, `core/src/chatProviders/index.ts`, `core/src/chatProviders/backends.ts`, `core/src/chatProviders/sessionSink.ts`, `core/src/chatProviders/opencode/opencode.ts`, `core/src/chatProviders/opencode/opencodeServer.ts`, `core/src/chatProviders/opencode/opencodeCli.ts`, `core/src/chatProviders/opencode/opencodeTranslate.ts`, `core/src/chatProviders/codex/driver.ts`, `core/src/chatProviders/codex/protocol.ts`, `core/src/chatProviders/acp/driver.ts`, `core/src/chatProviders/acp/agents.ts`, `core/src/chatProviders/acp/protocol.ts`, `core/src/freeAgent.ts`, `core/src/agentBackends/catalog.ts`, `app/src/chat/chatProvider.ts`
