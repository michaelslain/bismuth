# Agent backends

A backend is an agent CLI that Bismuth can drive: Claude Code, Codex, opencode, and the agents that speak the Agent Client Protocol (ACP).
Which backends exist and what each can do is data in one catalog that every surface reads: chat, terminal tabs, relay reporting, the daemon, MCP registration and memory injection.

A person choosing a backend, an engineer wondering why a control is missing for one, and anyone adding a backend all start from this catalog.
Per-surface detail lives in [providers.md](providers.md) (chat drivers), [../terminal/overview.md](../terminal/overview.md), [../daemon/overview.md](../daemon/overview.md) and [../mcp/overview.md](../mcp/overview.md).

Run `bismuth backends` for the live version of the table below on your machine. It resolves each binary on the same PATH Bismuth uses, reads version strings, and lists the surfaces each backend supports. It never runs a turn, authenticates, spends money, starts a daemon, or writes config.

```bash
bismuth backends
```

## Which backend should I use?

Use Claude Code unless you have a reason not to. It is the default, the most deeply integrated, and the only backend that covers every surface and can enforce a vault's [visibility](../vault/visibility.md) restrictions.

- No agent installed. The chat setup screen offers the free agent (opencode on free models, no account). See [opencode-providers.md](opencode-providers.md).
- A local model. Claude Code, Codex, opencode and Goose can run against a model on your machine. See [local-models.md](local-models.md).
- Several installed: `chat.provider: auto` (the default) picks the first installed backend in picker order, Claude first. Name a backend in `.settings` to pin it; a named backend is never swapped for another.

## What does each backend support?

Each cell below is the catalog's claim about that CLI.

| Backend | Chat | Terminal | Relay | Daemon | MCP | Memory | Local |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `claude` | delta | yes | hooks, subagents | yes | `mcp add` | hooks | yes |
| `codex` | part | yes | hooks, subagents | yes | `mcp add` | AGENTS.md block | yes |
| `opencode` | delta | yes | none | no | config merge | per-turn system prompt | yes |
| `cline` | ACP | yes | none | no | per-session | MCP tools | no |
| `gemini` | ACP | yes | none | no | per-session | MCP tools | no |
| `goose` | ACP | yes | none | no | per-session | MCP tools | yes |
| `openclaw` | ACP | yes | none | no | none, see below | MCP tools, see below | no |
| `hermes` | ACP | yes | none | no | per-session | MCP tools | no |
| `claude-code-acp` | ACP | yes | none | no | per-session | MCP tools | no |
| `codex-acp` | ACP | yes | none | no | per-session | MCP tools | no |

The Chat column is how the backend streams: `delta` is token by token, `part` is whole message parts, and `ACP` backends stream deltas through the shared ACP driver. The Local column is the `localModel` capability.

Three notes on the table:

- Hidden adapters: `claude-code-acp` and `codex-acp` carry `hidden: true`: they are selectable by id in `.settings` but absent from the connector picker.
  Each bridges an agent that already has a native driver, so offering the adapter beside it reads as a newer choice when it is a third-party bridge fetched by `npx` with fewer capabilities.
- The MCP column is the chat mechanism. Every ACP backend except OpenClaw hands Bismuth's MCP server to the agent per session through ACP's `session/new`, with no config file touched.
  OpenClaw's ACP bridge rejects a non-empty `session/new.mcpServers`, so its chats get neither the MCP tools nor MCP-only memory recall.
- Install-time registration is separate. Bismuth can also write its MCP server into other CLIs' own config so the tools work outside Bismuth chats (see [Surface 5](#surface-5-the-mcp-registration-policy)). OpenClaw's registrar works even though its chat bridge refuses per-session servers.

## How do controls know what a backend can do?

Surfaces ask what a backend can do, never which backend it is. A control renders only when the active backend's capability flag says it exists.

```ts
providerCan(provider, 'permissionModes')   // app/src/chat/chatProvider.ts
can(backendId, 'visibilityGate')           // core/src/agentBackends/catalog.ts
```

The chat controls each ask for what they need: `permissionModes` for the permission-mode select and `sessionPicker` for the `history` button (both in the [controls row](overview.md#what-does-the-controls-row-do)), and the model list and effort toggle in the model dialog come from the `models` frame.
The flags are separate where the behaviors differ:

- `permissionPrompts` means the backend can raise a live approval request. `permissionModes` means a mode picker is drivable. An ACP backend can prompt but has no mode to switch, so the picker stays hidden.
- `sessionPicker` and `resume` are separate. opencode resumes a conversation per tab but exposes no cross-session list, so it gets resume without the picker.
- `computerUse` gates no control. `core/src/chat.ts` reads it only to pass `--chrome` when it spawns a Claude Code session.

## What are the six surfaces?

A backend does not need all six; each is judged independently. A CLI with no machine-readable output can still be a good terminal integration, and a poor chat backend can still be worth registering MCP with.

| # | Surface | What a backend must provide |
| --- | --- | --- |
| 1 | Chat | A non-interactive turn with machine-readable streaming output, a resumable session id, cwd control |
| 2 | Terminal | An interactive TUI that survives in a plain PTY |
| 3 | Relay reporting | Session-lifecycle telemetry: hooks, a plugin API, or a wrapper that reports |
| 4 | Daemon | Headless unattended turns, per-call cwd and env, a resumable session, a persona channel |
| 5 | MCP injection | A way to register Bismuth's MCP server, per session if possible, else a config file |
| 6 | Memory injection | A system-prompt flag, a context-file convention, a pre-prompt hook, or MCP tools |

Claude Code and Codex cover all six. Claude Code is the only backend that can enforce the vault visibility gate (see [Surface 4](#surface-4-the-daemons-hard-constraint)).

## Why Codex is driven without its SDK

Bismuth spawns your own `codex` binary rather than using `@openai/codex-sdk`. That package vendors a platform binary of several hundred megabytes in `node_modules`, and since it spawns a fresh subprocess per turn anyway it would only buy typed events, which the driver's own translator provides.
Shipping a second copy of a coding agent you already have, able to drift from the version you run, is the wrong shape for this app. The driver is described in [providers.md](providers.md#the-codex-driver).

## How do I add a backend?

1. Add the id to `BACKEND_IDS` and a `BackendDescriptor` to `BACKENDS` in `core/src/agentBackends/catalog.ts`. Set capabilities honestly: a flag claiming something the CLI cannot do surfaces as a broken control, which is worse than a missing one.
2. For chat, implement `ChatBackend` (`core/src/chatProviders/backends.ts`) and register it. If the CLI speaks ACP, add a spec to the shared ACP driver instead of writing a new one.
   If it is a per-turn subprocess CLI, follow `chatProviders/opencode/opencode.ts`, whose session registry, sink buffering and rebind, turn queue and exit teardown are the pattern to copy.
3. For the other surfaces, add only what the CLI genuinely supports and leave the rest `false`.
4. Test the event translator as a pure function against captured real output. Never write a test that spawns a real agent binary; CI has none installed.

A missing binary must never crash and never silently fall back to a different backend: a user who picked Codex and silently got Claude has been lied to about what ran.
Every driver emits an error code for it (`no-claude`, `no-opencode`, or `no-binary` with the binary name), and the chat session maps all three to the same backend-neutral setup screen, so a new driver gets that screen by emitting `no-binary`.

## How it works

### The catalog

`core/src/agentBackends/catalog.ts` holds one `BackendDescriptor` per backend: id, display label, the binary to resolve on PATH, an install hint, an optional login command, and a `BackendCapabilities` object. The file has zero imports by design.
The server's chat router, the `.settings` schema and the frontend all read it, including the iPad and browser bundle where nothing may statically pull in Bun or `node:fs` ([mobile](../mobile/overview.md)). Anything effectful (resolving a binary, spawning it, registering MCP) lives elsewhere.

- The `chat.provider` enum in `.settings` and its documentation string are generated from `BACKEND_IDS`, and `BackendId` derives from the same array. Adding a backend is one array entry plus one descriptor.
- An unknown id (a stale stored value, a typo, a backend a newer build knows) degrades to the next tier and bottoms out at Claude. It never throws and never spawns the wrong binary.
- The one non-backend value is `auto` (`AUTO_PROVIDER`). `resolveBackendId(requested, fallback, installed)` resolves an `auto` fallback to the first installed backend in `AUTO_ORDER`, the picker-visible backends in catalog order (`resolveAutoProvider`), else Claude.
  `GET /agents/free` reports the same order as `backends: {id, label, installed}[]`. The app keeps it in `app/src/chat/agentAvailability.ts` and resolves a tab with `resolveChatProvider(choice, setting, installed)`: a per-tab choice, then a `.settings` backend id, then `auto`.
  An `auto` chat does not spawn until that read lands (a failed read, such as on mobile, falls back to Claude), and with nothing installed it shows the setup screen without spawning.

### Two standards carry most of the work

- [Agent Client Protocol](https://agentclientprotocol.com) (ACP) is JSON-RPC 2.0 over stdio, originated by Zed and now under neutral governance. One client drives every ACP-speaking agent.
  It covers surface 1 (text and thinking deltas, tool calls with results, resume, cancel, images, a slash-command registry, permission requests) and surface 5 better than any config file can: `session/new` takes an `mcpServers` array, so Bismuth hands the agent its MCP server per session with no global config write.
- AGENTS.md is a near-universal context-file convention (Codex, Cursor, Amp, Droid, opencode; Gemini's variant is `GEMINI.md`), the broadest-reach mechanism for surface 6.

ACP does not cover surface 3: it has no session-lifecycle notification, and a subagent call is indistinguishable from a slow tool call. Relay reporting therefore stays per-backend.
ACP also has version skew to absorb: model selection exists as `models` with `session/set_model` and as `configOptions` with `session/set_config_option`, and a client must detect which shape a `session/new` response returned.

### Surface 3: how a session reaches the relay registry

`relayReporting` decides how a backend's terminal sessions reach the registry in `core/src/relay.ts`. `core/src/terminal.ts`'s `shimSpecsFor` reads it to decide whether the PTY shim wraps the backend's binary, and `chat.ts` consumes the registry for per-chat subagent tracking.
Prefer the highest tier a backend supports:

1. Native hooks. Full fidelity including subagent depth. Claude Code (the `relay/` plugin) and Codex (whose hook set is nearly the same, down to `SubagentStart` and `SubagentStop`) are the only backends with `relayReporting: "hooks"`.
   Every ACP backend reports `"none"`, because ACP gives a listener nothing to hook into.
2. A reporting wrapper. The PTY shim already wraps the binary, so it can report session start and end itself: correct session nodes, a flat tree, no cooperation from the CLI. This path is off by default (see [terminal/overview.md](../terminal/overview.md#how-the-wrapper-reporter-works)).
3. Session-file tailing. Richer, but attributing a file to a tab is heuristic and it means reading private transcripts. Use it only where tier 1 is absent and the fidelity is wanted.

PTY output sniffing is not an option: it breaks on any TUI redraw.

Sessions carry a `backend` field through `POST /relay/session` into `RelaySession.backend`, so a snapshot shows what is running in a tab. It defaults to `claude` when a reporter omits it.
A heartbeat that omits the backend keeps the existing one: the heartbeat payload carries less than registration, and losing the field would relabel a Codex tab as Claude mid-session. The registry applies the same rule to `cwd`.

### Surface 5: the MCP registration policy

Surface 5 has two mechanisms. The per-session one is what every ACP chat backend uses (`session/new.mcpServers`, no config file).
The install-time one is `core/src/agentBackends/mcpRegistrars.ts`, which registers Bismuth's MCP server with a CLI's own config so the CLI has it everywhere, not only inside a Bismuth chat.
Both can apply to one backend; only the install-time one writes into a config file you own, so its rules are strict:

1. Prefer the CLI's own `mcp add` or `mcp set` subcommand. The CLI owns its format and can change it.
2. A config-file fallback is a structure-preserving merge: read, parse, set exactly one key, write, so unknown keys and your other servers survive. YAML goes through the `yaml` Document API. TOML is never hand-written: Codex is TOML, so Codex goes through `codex mcp add` or not at all.
3. Registration is idempotent and never destructive. A pre-existing `bismuth` entry is replaced only when it points into `~/.bismuth`.
4. Every edit is recorded, so uninstall reverses only Bismuth's own changes.

Only Claude Code registers automatically (`claude mcp add -s user`, run by the installer on app start). Every other CLI is opt-in: list it in `mcp.registerWith` in `.settings`, or run `bismuth install --mcp <cli>` (or `--mcp all`). A registrar exists for CLIs Bismuth never drives as a chat backend.
OpenClaw shows why that is worth doing on its own: a weak chat backend whose MCP story is excellent.

### Surface 4: the daemon's hard constraint

The daemon runs unattended against the vault, which makes it the one surface with a security constraint rather than a capability question.

A vault's [visibility gate](../vault/visibility.md) is enforced by three Claude Code mechanisms working together: `managedSettings.permissions.deny`, `sandbox.filesystem.denyRead` and `disallowedTools`.
The system-prompt appendix that names hidden notes is advisory, defence in depth and never the gate.

No other CLI has that combination. So for a vault with any hidden note, only the Claude backend may run the brain. `resolveDaemonBackend` (`daemon/src/daemon/session.ts`) is the pure chokepoint that enforces this, and every backend selection passes through it.
It degrades to Claude with a logged reason rather than throwing, because the daemon is always on and its crons must keep firing.

The persona is a per-backend channel too.
Every daemon backend gets the same persona text (`You are <name>.` plus the vault's `identity.md` body, plus the advisory deny-list appendix when notes are hidden) through its own channel, declared in `DAEMON_PERSONA_CHANNELS` (`daemon/src/daemon/persona.ts`).
Claude appends it through `systemPrompt: { type: 'preset', preset: 'claude_code', append }`; Codex receives `--config developer_instructions=<persona>` on every `codex exec` call. A backend with no declared channel cannot run as a daemon, and `sendMessage` refuses it.
The AGENTS.md block (`settings.codex.writeAgentsMd`) is optional and is not the daemon's persona channel.

### The visibility gate is per channel

`capabilities.visibilityGate` is a per-channel, mechanism-naming value, because a single boolean cannot say "enforced for chat but not the daemon", "only on macOS", or "only because Bismuth wraps the process":

```ts
type VisibilityEnforcement = 'native' | 'wrapper-macos' | 'none'
interface VisibilityGateSupport { chat: VisibilityEnforcement; daemon: VisibilityEnforcement }
```

`native` means the CLI's own policy layer enforces it (Claude only).
`wrapper-macos` means Bismuth wraps the spawned process in an OS-level read-deny sandbox (`agentBackends/sandboxWrapper.ts`), gated on platform and on a `selfSandboxes` precondition: a backend that already applies its own OS sandbox cannot be wrapped in a second one, because Seatbelt profiles do not nest.
`none` means a restricted vault must refuse that backend on that channel rather than run it unprotected.

The full per-backend, per-channel table (which backends land where, on which platform, by which mechanism, verified or not) lives in [../vault/visibility.md](../vault/visibility.md#per-backendper-channel-enforcement), so there is one place for it to go stale.
`resolveVisibilityGate` (`core/src/agentBackends/visibilityGate.ts`) is the single chokepoint the chat router calls before any backend spawns.

### Why a capability must be able to be wrong loudly

A flag, a payload field or a generated type that asserts a capability should fail visibly when it is wrong. A missing control is a small annoyance; a control that looks present and does nothing costs an afternoon. The rules below come from that.

- Split flags that conflate: `permissionPrompts` and `permissionModes` are separate so a backend that can prompt but has no mode picker does not render a picker whose selections go nowhere.
- Preserve what a partial payload omits. A relay heartbeat without `backend` keeps the existing value.
- Never claim a version you did not read: `bismuth backends` names the package for an `npx`-fetched adapter and shows no version for it, because the package runner's own version says nothing about the bridge.
- Do not trust generated types over the running server: opencode's SDK types disagree with its server on the delta and permission events, so those events are read as untyped JSON.
- A flag nobody reads asserts nothing: `visibilityGate` has real consumers: `resolveDaemonBackend` and the chat router's `resolveVisibilityGate` branch on it.

Source: `core/src/agentBackends/catalog.ts`, `core/src/agentBackends/visibilityGate.ts`, `core/src/agentBackends/sandboxWrapper.ts`, `core/src/agentBackends/mcpRegistrars.ts`, `core/src/bismuthInstall.ts`, `core/src/chatProviders/index.ts`, `core/src/chatProviders/backends.ts`, `core/src/terminal.ts`, `core/src/relay.ts`, `daemon/src/daemon/session.ts`, `daemon/src/daemon/persona.ts`, `app/src/chat/chatProvider.ts`, `app/src/chat/agentAvailability.ts`, `cli/src/commands/backends.ts`
