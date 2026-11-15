# Agent backends

A backend is an agent CLI that Bismuth can drive: Claude Code, Codex, opencode, and the agents that speak the Agent Client Protocol (ACP).
Which backends exist and what each can do is data in one catalog that every surface reads: chat, terminal tabs, relay reporting, the daemon, MCP registration and memory injection.

A person choosing a backend, an engineer wondering why a control is missing for one, and anyone adding a backend all start from this catalog.
Per-surface detail lives in [providers.md](providers.md) (chat drivers), [../terminal/overview.md](../terminal/overview.md), [../daemon/overview.md](../daemon/overview.md) and [../mcp/overview.md](../mcp/overview.md).

Run `bismuth backends` for the live version of the table below on your machine. It resolves each binary on the same PATH Bismuth uses, reads version strings, and lists the surfaces each backend supports. It never runs a turn, authenticates, spends money, starts a daemon, or writes config.

```bash
bismuth backends
```

Bismuth finds an agent's binary on your `PATH`, then in the usual install directories (Homebrew, `/usr/local/bin`, `~/.bun/bin`, `~/.local/bin`, nvm's Node versions), then in a desktop app that bundles one:

- the `codex` inside the ChatGPT app, at `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`;
- the Claude Code the Claude app downloads, at `~/Library/Application Support/Claude/claude-code/<version>/<build>/claude.app/Contents/MacOS/claude`, newest version first, once its download is complete.

A CLI you installed yourself (npm, Homebrew, the Claude Code installer) wins over a bundled copy, so the Claude app alone is enough to run Claude Code chats.

## Which backend should I use?

Use Claude Code unless you have a reason not to. It is the default, the most deeply integrated, and the only backend that covers every surface and can enforce a vault's [visibility](../vault/visibility.md) restrictions.

- No agent installed. The chat setup screen offers the free agent (opencode on free models, no account). See [opencode-providers.md](opencode-providers.md).
- A local model. Claude Code, Codex, opencode and Goose can run against a model on your machine. See [local-models.md](local-models.md).
- Several installed: `chat.provider: auto` (the default) picks the first installed backend in picker order, Claude first. Name a backend in `.settings` to pin it; a named backend is never swapped for another.

## What does each backend support?

Each cell below is the catalog's claim about that CLI.

| Backend | Chat | Terminal | Relay | Daemon | MCP | Memory | Local | Models | Permission modes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claude` | delta | yes | hooks, subagents | yes | `mcp add` | hooks | yes | yes | yes |
| `codex` | part | yes | hooks, subagents | yes | `mcp add` | AGENTS.md block | yes | yes | no |
| `opencode` | delta | yes | none | no | config merge | per-turn system prompt | yes | yes | yes |
| `cline` | ACP | yes | none | no | per-session | MCP tools | no | yes | no |
| `gemini` | ACP | yes | none | no | per-session | MCP tools | no | yes | no |
| `goose` | ACP | yes | none | no | per-session | MCP tools | yes | yes | yes |
| `openclaw` | ACP | yes | none | no | none, see below | MCP tools, see below | no | yes | no |
| `hermes` | ACP | yes | none | no | per-session | MCP tools | no | yes | yes |
| `claude-code-acp` | ACP | yes | none | no | per-session | MCP tools | no | yes | yes |
| `codex-acp` | ACP | yes | none | no | per-session | MCP tools | no | yes | yes |

The Chat column is how the backend streams: `delta` is token by token, `part` is whole message parts, and `ACP` backends stream deltas through the shared ACP driver. The Local column is the `localModel` capability.
The Models column is the `models` capability: the backend sends a models frame for the model dialog (Codex reads it from `codex debug models`). The Permission modes column is the `permissionModes` capability: the controls row shows the mode picker. opencode answers approvals per mode, and Goose, Hermes, Codex (ACP) and Claude Code (ACP) map the mode onto the agent's own session modes ([providers.md](providers.md#the-acp-driver)); the other backends show no picker. OpenClaw's bridge asks only before a shell command, never before a write, so it has no `permissionPrompts` and no approval card.
opencode streams deltas in server mode on opencode 1 and 2, and whole parts in run mode ([which opencode versions work](providers.md#which-opencode-versions-work)).

Three notes on the table:

- Hidden adapters: `claude-code-acp` and `codex-acp` carry `hidden: true`: they are selectable by id in `.settings` but absent from the connector picker.
  Each bridges an agent that already has a native driver, so offering the adapter beside it reads as a newer choice when it is a third-party bridge fetched by `npx` with fewer capabilities.
- The MCP column is the chat mechanism. Every ACP backend except OpenClaw hands Bismuth's MCP server to the agent per session through ACP's `session/new`, with no config file touched.
  OpenClaw's ACP bridge rejects a non-empty `session/new.mcpServers`, so its chats get neither the MCP tools nor MCP-only memory recall.
  Cline accepts the array and ignores it, so its Bismuth tool comes from its own settings file: the opt-in registrar writes `~/.cline`, and a chat writes it only inside a `CLINE_DIR` that is set (the benchmark and tests set it). A chat never edits your own `~/.cline`.
- Install-time registration is separate. Bismuth can also write its MCP server into other CLIs' own config so the tools work outside Bismuth chats (see [Surface 5](#surface-5-the-mcp-registration-policy)). OpenClaw's registrar works even though its chat bridge refuses per-session servers.

## How do controls know what a backend can do?

Surfaces ask what a backend can do, never which backend it is. A control renders only when the active backend's capability flag says it exists.

```ts
providerCan(provider, 'permissionModes')   // app/src/chat/chatProvider.ts
can(backendId, 'visibilityGate')           // core/src/agentBackends/catalog.ts
```

The chat controls each ask for what they need: `permissionModes` for the permission-mode select and `sessionPicker` for the `history` button (both in the [controls row](overview.md#what-does-the-controls-row-do)), and the model list and effort toggle in the model dialog come from the `models` frame.
The flags are separate where the behaviors differ:

- `permissionPrompts` means the backend can raise a live approval request. `permissionModes` means a mode picker is drivable, so the backend implements `setPermissionMode`. An ACP backend can prompt but has no mode to switch, so the picker stays hidden, except for an agent whose approval is a session mode (Goose, Hermes, Codex (ACP), Claude Code (ACP)). OpenClaw has neither: `permissionPrompts` is `false`.
- `agents` means the backend has selectable primary agents (opencode's `build` and `plan`). The chat shows an agent word and Shift+Tab cycles it; the backend implements `setAgent` exactly when the flag is set, and `catalogParity.test.ts` pins the pair.
- `sessionPicker` and `resume` are separate: an ACP backend resumes a conversation per tab but exposes no cross-session list, so it gets resume without the picker. A backend's `sessionPicker` is `true` exactly when `CHAT_HISTORY_SOURCES` (`core/src/chatProviders/chatHistorySources.ts`) lists its chats; Claude Code, opencode and Codex do.
- Every chat backend sends the same standing instructions (`chatInstructions.ts`: the rendering note, the line-citation note, and in a vault the daemon's name and the `bismuth` CLI note), each through its own channel. `core/test/chatProviders/backendContract.test.ts` checks every backend in the catalog for those instructions, for Bismuth's MCP when it speaks MCP, for a history source matching `sessionPicker`, and for window sizing when it runs local models; a backend added to the catalog fails it until it is wired.
- `midTurnMessages` decides where a message sent during a reply waits. Claude Code reads it into the running turn, so the client sends it at once; every other backend runs one turn per message, so the client holds it until the turn's `done`.
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
5. Run the backend benchmark against the mock model server and fix every `fail` and `gap` it reports ([How do I check a backend works end to end?](#how-do-i-check-a-backend-works-end-to-end)). It runs the real CLI, so it covers what step 4 cannot.

A missing binary must never crash and never silently fall back to a different backend: a user who picked Codex and silently got Claude has been lied to about what ran.
Every driver emits an error code for it (`no-claude`, `no-opencode`, or `no-binary` with the binary name), and the chat session maps all three to the same backend-neutral setup screen, so a new driver gets that screen by emitting `no-binary`.

## How do I check a backend works end to end?

Run the backend benchmark. It drives the real installed CLI of each chat backend through Bismuth's production chat router, runs every scenario in a fresh seeded vault, and scores each backend against a reference.
It checks plumbing, never model quality. A new backend should pass it under the mock model before it ships.

```bash
bun bench/backendBench.ts --target opencode@mock --scenario reply
```

A target is `<backend>@<source>`. The source is where the model's answers come from:

| Source | Label | What answers |
| --- | --- | --- |
| mock | `opencode@mock` | A mock model server answering from scenario fixtures. No account, no real model call. The vault's local model points at it, so the backend sizes its opening from the window the mock reports (the way LM Studio reports a loaded window). |
| local | `opencode@lmstudio:<model>`, `opencode@ollama:<model>` | A model already loaded in LM Studio or ollama, reached through a proxy that records every request. The benchmark loads, unloads and pulls nothing. |
| cloud | `claude@cloud`, `claude@cloud:<model>` | The backend's own login. This spends real model calls. |

`--target` takes a comma-separated list of labels. `--all` runs every installed chat backend against the sources `--source` names (default `mock,local`).
A backend whose CLI is not installed gets `skip` in every cell.

| Flag | Effect |
| --- | --- |
| `--target <label,...>` | Run these rows. |
| `--all` | Run every installed chat backend for each source in `--source`. |
| `--source <list>` | `mock`, `local`, `cloud`; default `mock,local`. |
| `--suite <name,...>` | Run only these suites; default every suite. |
| `--scenario <id,...>` | Run only these scenario ids. An unknown id lists the known ones. |
| `--reference <label>` | The row every other row is scored against; default `claude@mock`. |
| `--home real\|clean` | `real` (default) keeps your `HOME` and the CLIs' own configs. `clean` gives each scenario a throwaway home and XDG directories, so your logins and settings cannot affect the result. |
| `--out <dir>` | Where the report files go; default `.claude/bench/backends`. |
| `--json` | Print the report as JSON on stdout instead of the markdown matrix. |

The benchmark needs no `package.json` script. It prints progress to stderr, the matrix to stdout, and writes a timestamped `.json` and `.md` report into `--out`. It exits 0 when the run completed, whatever the verdicts, and 2 for bad usage.

### What does it check?

The `parity` suite covers what a chat does, in the order a person meets it:

- a one-line turn, streaming in pieces, and a Bismuth tool call whose result reaches the chat;
- the first model request carrying the rendering note, the daemon's name, the `bismuth` CLI note, the vault's skills and the Bismuth tool;
- a model server error arriving as a readable error, then a working next turn, and a title frame;
- write permissions allowed and denied, stop, and a message sent during a turn;
- model, agent and effort switching;
- resume, history replay, and a kept chat appearing in `bismuth chat list` and the history picker;
- a private chat gone from the backend's own store once closed;
- small context windows and compaction.

### How do I read a verdict?

Each cell is one scenario on one target, and holds one verdict:

| Verdict | Meaning | Scored |
| --- | --- | --- |
| `pass` | The scenario's checks held. | Yes |
| `fail` | A check did not hold, the scenario threw, or the target's worker process died before reaching it. The detail line says what was observed. | Yes |
| `gap` | The reference can do this and this backend's catalog entry says it cannot. | Yes, as a miss |
| `skip` | Not measurable here: the CLI is not installed, the model's requests are not visible (cloud), or the scenario has no mock fixture. | No |
| `timeout` | The scenario produced no result within its time limit. | Yes |

The report scores each target per suite. A target's parity is the share of the scenarios the reference passes that the target also passes. The reference row itself shows `-`.

The `small-window` and `compaction` scenarios set the mock's window and need a backend that can run on a local model, so they score `gap` for a backend without the `localModel` capability.

A `gap` is not always a defect: it follows the catalog's capability flags, so it is right when the catalog is right ([How do controls know what a backend can do?](#how-do-controls-know-what-a-backend-can-do)). A `fail` on a capability the catalog claims means the flag or the driver is wrong.

### How do I add a scenario?

Add a file to `bench/backendBench/scenarios/` that default-exports an array of scenarios. The runner loads every file in that directory, so a new suite needs nothing else. Scenario ids are kebab-case and unique across suites.

## How it works

### The catalog

`core/src/agentBackends/catalog.ts` holds one `BackendDescriptor` per backend: id, display label, the binary to resolve on PATH, an install hint, an optional login command, and a `BackendCapabilities` object. The file has zero imports by design.
The binary resolves through `whichBinary` (`core/src/claudeWhich.ts`), against `claudeLookupPath`: your `PATH`, the install directories, then `appBundledBinDirs()`. The daemon keeps its own copy of the list (`daemon/src/lib/childEnv.ts`), and the first-run intro's `detect_agents` Tauri command searches the same directories.
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
In a vault that restricts any note, `disallowedTools` holds `Grep` and `Glob` and nothing else, in the daemon and in the chat. The `bismuth_cli` MCP tool stays available, because it runs through the same CLI visibility gate as `bismuth` in the session's own shell.
The system-prompt appendix that names hidden notes is advisory, defence in depth and never the gate.

No other CLI has that combination. So for a vault with any hidden note, only the Claude backend may run the brain. `resolveDaemonBackend` (`daemon/src/daemon/session.ts`) is the pure chokepoint that enforces this, and every backend selection passes through it.
It degrades to Claude with a logged reason rather than throwing, because the daemon is always on and its crons must keep firing.

The persona is a per-backend channel too.
Every daemon backend gets the same persona text (`You are <name>.`, the vault's `identity.md` body, the `AGENT_CLI_NOTE` paragraph that names the `bismuth` CLI as the way into Bismuth, and the advisory deny-list appendix when notes are hidden) through its own channel, declared in `DAEMON_PERSONA_CHANNELS` (`daemon/src/daemon/persona.ts`).
Claude appends it through `systemPrompt: { type: 'preset', preset: 'claude_code', append }`; Codex receives `--config developer_instructions=<persona>` on every `codex exec` call. A backend with no declared channel cannot run as a daemon, and `sendMessage` refuses it.
The AGENTS.md block (`settings.codex.writeAgentsMd`) is optional and is not the daemon's persona channel. It names the `bismuth` CLI as the way in, and points to `bismuth docs read` for the bases authoring and Obsidian conversion guides.

A Claude daemon session and a Claude chat both reach the CLI from their shell: the spawn env sets `CLAUDE_ENV_FILE` to `~/.bismuth/agent-env.sh`, which puts `~/.bismuth/bin` on the Bash tool's `PATH`, plus `BISMUTH_VAULT` and `BISMUTH_CLI` (`agentShellEnv` in `core/src/agentEnvFile.ts`).

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

### How the backend benchmark runs

`bench/backendBench.ts` is the CLI. For each target it spawns one worker process, so a backend's environment and crashes stay its own, and the workers print one `CELL <json>` line per finished scenario. Workers run in parallel, up to the free cores and memory; workers against the same local model server run one at a time.
For every scenario the runner (`bench/backendBench/run.ts`) seeds a fresh vault (`vault.ts`), starts a model server for mock and local targets (`mock.ts`), opens a chat through the production router (`driver.ts`), and closes everything afterwards. A watchdog turns a hung scenario into `timeout`.
The model server records every request, so a scenario can read what the backend sent the model, and it can answer as a server with a small context window.
In mock mode, a backend points at the mock server through its own environment variables or config (`targetEnv` in `targets.ts`, built on `backendMockEnv` in `core/test/support/backendEnv.ts`). A backend with no mapping there fails its cells rather than reach its real provider. Hermes reads a throwaway `HERMES_HOME/config.yaml`, Codex a custom provider, and Cline a throwaway `CLINE_DIR` holding its provider settings, the mock's window and Bismuth's MCP server.
`report.ts` scores the cells and renders the matrix. `types.ts` holds every shape and the verdict definitions. The `parity` scenarios live in `bench/backendBench/parity/` (`turn.ts`, `control.ts`, `session.ts`, with shared `applies` helpers in `gates.ts`) and `scenarios/parity.ts` loads them as the `parity` suite.

Source: `core/src/agentBackends/catalog.ts`, `core/src/agentBackends/visibilityGate.ts`, `core/src/agentBackends/sandboxWrapper.ts`, `core/src/agentBackends/mcpRegistrars.ts`, `core/src/bismuthInstall.ts`, `core/src/chatProviders/index.ts`, `core/src/chatProviders/backends.ts`, `core/src/terminal.ts`, `core/src/relay.ts`, `daemon/src/daemon/session.ts`, `daemon/src/daemon/persona.ts`, `core/src/agentEnvFile.ts`, `core/src/agentCliNote.ts`, `app/src/chat/chatProvider.ts`, `app/src/chat/agentAvailability.ts`, `cli/src/commands/backends.ts`, `core/src/claudeWhich.ts`, `bench/backendBench.ts`, `bench/backendBench/run.ts`, `bench/backendBench/types.ts`, `bench/backendBench/targets.ts`, `bench/backendBench/mock.ts`, `bench/backendBench/driver.ts`, `bench/backendBench/vault.ts`, `bench/backendBench/report.ts`, `bench/backendBench/scenarios/parity.ts`, `bench/backendBench/parity/`
