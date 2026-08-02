# Agent backends — the catalog, the capabilities, the six surfaces

Bismuth drives **agent CLIs**. Claude Code is the default and the most deeply integrated, but the
integration is no longer written around it: which CLIs exist, and what each one can do, is **data**
in one catalog that every surface reads.

Start here for the model. Per-surface detail lives in [providers.md](providers.md) (chat),
[../terminal/overview.md](../terminal/overview.md), [../daemon/overview.md](../daemon/overview.md),
and [../mcp/overview.md](../mcp/overview.md).

## The catalog is the single source of truth

`core/src/agentBackends/catalog.ts` holds one `BackendDescriptor` per backend: its id, display
label, the binary to resolve on PATH, an install hint, an optional login command, and a
`BackendCapabilities` object.

That file has **zero imports** by design. It is read by the server's chat router, by the `.settings`
schema, and by the frontend — including the iPad/browser bundle, where nothing may statically pull
in Bun or `node:fs` (see [../mobile/overview.md](../mobile/overview.md)). Anything effectful —
resolving a binary, spawning it, registering MCP — lives elsewhere.

Consequences worth knowing:

- The `chat.provider` enum in `.settings` and its documentation string are **generated** from
  `BACKEND_IDS`. There is no hand-maintained list to drift.
- `BackendId` is derived from that same array, so adding a backend is one array entry plus one
  descriptor — not a union edit across a dozen files.
- An unknown id (a stale localStorage value, a typo in `.settings`, a backend a newer build knows
  and this one doesn't) degrades to the next tier and bottoms out at Claude. It never throws and
  never spawns the wrong binary.

## Capabilities replace per-provider branching

Surfaces ask what a backend *can do*, never which backend it *is*:

```ts
providerCan(provider, "computerUse")      // app/src/chatProvider.ts
can(backendId, "visibilityGate")          // core/src/agentBackends/catalog.ts
```

This replaced a single frontend predicate, `providerSupportsClaudeControls(provider)`, whose body
was literally `provider === "claude"`. It worked for two backends and was actively wrong for a
third: it would have handed every new backend Claude's exact degradation profile whether or not it
applied — hiding thinking-level controls from Cline, which has them, and approval modes from Codex,
which has them too.

The chat header's gated controls each now ask for what they actually need: `computerUse` for the
`--chrome` toggle, `permissionModes` for the mode picker, `sessionPicker` for the history panel.

`sessionPicker` and `resume` are deliberately separate. opencode resumes a conversation per tab but
exposes no cross-session list, so it gets resume without the picker — a distinction the old boolean
could not express.

## The six surfaces

| # | Surface | What a backend must provide |
| --- | --- | --- |
| 1 | **Chat** | A non-interactive turn with machine-readable streaming output, a resumable session id, cwd control |
| 2 | **Terminal** | An interactive TUI that survives in a plain PTY |
| 3 | **Agents graph** | Session-lifecycle telemetry — hooks, a plugin API, or a wrapper that reports |
| 4 | **Daemon** | Headless unattended turns, per-call cwd/env, a resumable session, a persona override |
| 5 | **MCP injection** | A way to register Bismuth's MCP server — ideally per session, else a config file |
| 6 | **Memory injection** | A system-prompt flag, a context-file convention, a pre-prompt hook, or MCP tools |

A backend does not need all six. Each is judged independently: a CLI with no machine-readable output
can still be a perfectly good terminal integration, and a CLI that is a poor chat backend can still
be worth registering MCP with.

### What each backend supports today

Run **`bismuth backends`** for the live version of this table, including which binaries are actually
installed on your machine and their versions. The catalog is a claim about each CLI; that command
tells you what is true here.

| Backend | Chat | Terminal | Agents graph | Daemon | MCP | Memory |
| --- | --- | --- | --- | --- | --- | --- |
| `claude` | ✓ delta | ✓ | hooks (+ subagents) | ✓ | `mcp add` | hooks |
| `codex` | ✓ part | ✓ | hooks (+ subagents) | ✓ | `mcp add` | AGENTS.md block |
| `opencode` | ✓ delta | ✓ | — | — | config merge | per-turn system prompt |
| `cline` | ✓ ACP | ✓ | — | — | `mcp add` | MCP tools |
| `gemini` | ✓ ACP | ✓ | — | — | `mcp add` | MCP tools |
| `goose` | ✓ ACP | ✓ | — | — | config merge | MCP tools |
| `openclaw` | ✓ ACP | ✓ | — | — | `mcp set` | MCP tools |
| `claude-code-acp` * | ✓ ACP | — | — | — | per-session | MCP tools |
| `codex-acp` * | ✓ ACP | — | — | — | per-session | MCP tools |

\* **Hidden from the provider picker** (`hidden: true` in the catalog), still selectable by id. Both
bridge an agent that already has a native driver here, so offering them as peers is a trap: an
npx-fetched third-party adapter with fewer capabilities reads, in a list, as if it were newer. They
remain in the catalog as documentation and as an escape hatch if a native driver ever breaks.

Claude Code and Codex are the only backends covering all six surfaces. Claude Code is the only one
that can enforce the vault visibility gate — see the daemon section below for why that is a
constraint rather than a gap.

Note that Codex is driven by spawning the user's own `codex` binary, **not** via `@openai/codex-sdk`.
That package vendors a platform binary measured at 310MB in `node_modules`, and since it spawns a
fresh subprocess per turn anyway it was only buying typed events — which the driver's own translator
provides. Shipping a second copy of a coding agent the user already has, capable of drifting from the
version they actually run, is the wrong shape for this app.

Beyond the chat backends above, Bismuth can register its MCP server with **ten** CLIs, including ones
it never drives as a chat backend: Codex, Cline, OpenClaw, Gemini, Qwen, Copilot, Amp, Droid, Crush
and Goose. OpenClaw is the clearest example of why that is worth doing on its own — a weak chat
backend (no per-call cwd or system prompt, and its session/subagent hook events are documented as
not yet implemented) whose MCP story is excellent.

### Two industry standards do most of the work

Rather than N bespoke integrations, two cross-agent standards carry most of the load:

- **[Agent Client Protocol](https://agentclientprotocol.com) (ACP)** — JSON-RPC 2.0 over stdio,
  originated by Zed, now under neutral governance with JetBrains as a second adopter. One client
  implementation drives every ACP-speaking agent. It covers surface 1 (streaming text and thinking
  deltas, tool calls with results, resume, cancel, images, a slash-command registry, permission
  requests) and surface 5 *better than any config file can* — `session/new` takes an `mcpServers`
  array, so Bismuth hands the agent its MCP server **per session, with no global config write at
  all**.
- **AGENTS.md** — a near-universal context-file convention (Codex, Cursor, Amp, Droid, opencode;
  Gemini's variant is `GEMINI.md`), which is the broadest-reach mechanism for surface 6.

ACP explicitly does **not** cover surface 3. There is no session-lifecycle notification, and a
subagent invocation is indistinguishable from a slow tool call — confirmed by reading the
`claude-code-acp` adapter's source. The agents graph therefore stays per-backend: native hooks where
a CLI has them, a reporting wrapper where it doesn't.

ACP also has real version skew to absorb: the SDK is at 1.3.0 while currently-shipping adapters pin
0.14.1, and model selection moved from `models` + `session/set_model` to `configOptions` +
`session/set_config_option` in between. A client must detect which shape a `session/new` response
returned and branch.

## Surface 3: how a session reaches the agents graph

Ranked by fidelity. Prefer the highest tier a backend supports:

1. **Native hooks** — full fidelity including subagent depth. Claude Code (the `relay/` plugin) and
   Codex (whose hook set is nearly isomorphic, right down to `SubagentStart`/`SubagentStop`) both
   qualify. Goose and Droid implement a shared "Open Plugins" hooks spec, so one listener shape can
   serve both.
2. **A reporting wrapper** — the PTY shim already wraps the binary, so it can report session start
   and end itself. Correct session nodes, flat tree, no cooperation needed from the CLI.
3. **Session-file tailing** — richer, but attributing a file to a tab is heuristic and it means
   reading private transcripts. Only where tier 1 is absent and the fidelity is genuinely wanted.

PTY output sniffing is deliberately not an option: it breaks on any TUI redraw.

Sessions carry a `backend` field through `POST /relay/session` → `RelaySession.backend` →
`GraphNode.backend`, so the graph can show *what* is running in a tab rather than only that
something is. It is omitted for Claude, so an all-Claude graph serialises exactly as before.

One rule the registry enforces: a heartbeat that omits the backend **keeps the existing one**. The
heartbeat payload carries less than registration does, and losing the field would silently relabel a
Codex tab as Claude mid-session — the same hazard the registry already guards for `cwd`.

## Surface 5: the MCP registration policy

Registering Bismuth's MCP server writes into a config file the user owns, so the rules are strict:

1. **Prefer the CLI's own `mcp add`/`mcp set` subcommand.** The CLI owns its format and can change
   it underneath us.
2. A config-file fallback must be a **structure-preserving merge** — read, parse, set exactly our
   one key, write — so unknown keys and the user's other servers survive. YAML goes through the
   `yaml` Document API. **TOML is never hand-written**: Codex is TOML, so Codex goes through
   `codex mcp add` or not at all.
3. Idempotent and never destructive. A pre-existing `bismuth` entry is replaced only when it points
   into `~/.bismuth` (ours) — the same foreign-file check the CLI symlink already uses.
4. Every edit is recorded, so uninstall reverses only our own changes.

And a policy, not just a mechanism: **only Claude Code auto-registers on boot.** Bismuth is a
Claude-first app, so that is defensible; writing uninvited into someone's Codex, Cursor, or Gemini
config is not. Every other backend requires explicit opt-in.

## Surface 4: the daemon's hard constraint

The daemon runs unattended against the vault, which makes it the one surface with a security
constraint rather than a capability question.

A vault's **visibility gate** ([../vault/visibility.md](../vault/visibility.md)) is enforced by three
Claude-Code-specific mechanisms working together: `managedSettings.permissions.deny`,
`sandbox.filesystem.denyRead`, and `disallowedTools`. The system-prompt appendix that names hidden
notes is explicitly advisory — defence in depth, never the gate.

No other CLI has that triple. So for a vault with **any** hidden note, only the Claude backend may
run the brain. `resolveDaemonBackend` (`daemon/src/daemon/session.ts`) is the pure chokepoint that
enforces this, and every backend selection must pass through it. It degrades to Claude with a logged
reason rather than throwing, because the daemon is always-on and its crons must keep firing.

## The visibility gate is a per-channel capability, not a flag

`capabilities.visibilityGate` used to be a single boolean — "true for exactly one backend" — which
could not say "enforced for chat but not the daemon," "only on macOS," or "only because Bismuth wraps
it, not because the CLI itself enforces anything." All three of those were real design requirements
(opencode's chat channel was wrapped, on macOS only, until an incomplete acceptance run downgraded it
to `none` — see [../vault/visibility.md](../vault/visibility.md#per-backendper-channel-enforcement)
for the current per-backend table — and its daemon channel is refused outright regardless), so the
flag became a per-channel, mechanism-naming value:

```ts
type VisibilityEnforcement = "native" | "wrapper-macos" | "none";
interface VisibilityGateSupport { chat: VisibilityEnforcement; daemon: VisibilityEnforcement }
```

`"native"` means the CLI's own policy layer enforces it (Claude only). `"wrapper-macos"` means
Bismuth wraps the spawned process in an OS-level read-deny sandbox (`agentBackends/sandboxWrapper.ts`)
— a real, additional mechanism for a backend with no native per-path deny of its own, gated on
platform + a `selfSandboxes` precondition (a backend that already applies its own OS sandbox can't be
wrapped in a second one — Seatbelt profiles don't nest). `"none"` means a restricted vault MUST refuse
that backend on that channel rather than run it unprotected.

The full per-backend/per-channel table — which nine backends land where, on which platform, by which
mechanism, and **verified or not** — lives in
[../vault/visibility.md](../vault/visibility.md#per-backendper-channel-enforcement), not here, so
there is exactly one place it can go stale. That page also documents a gap it used to have and no
longer does: the seven non-Claude drivers were each written independently and not one of them checked
visibility, so the catalog said which backends were *supposed* to be refused while the code would
have run some of them ungated. `resolveVisibilityGate` (`core/src/agentBackends/visibilityGate.ts`)
closed it as a single chokepoint the chat router calls before any backend is spawned.

## Adding a backend

1. Add the id to `BACKEND_IDS` and a `BackendDescriptor` to `BACKENDS` in
   `core/src/agentBackends/catalog.ts`. Set capabilities **honestly** — a flag claiming something the
   CLI cannot do surfaces as a broken control, which is worse than a missing one.
2. Chat: implement `ChatBackend` (`core/src/chatProviders/backends.ts`) and register it. If the CLI
   speaks ACP, use the shared ACP driver instead of writing a new one. If it is a per-turn
   subprocess CLI, follow `chatProviders/opencode.ts`, whose lifecycle conventions — session
   registry, sink buffering and rebind, turn queue, exit teardown — are the pattern to copy.
3. Other surfaces: add only what the CLI genuinely supports, and leave the rest `false`.
4. Tests: the event translator must be pure and unit-tested against captured real output. Never
   write a test that spawns a real agent binary — CI has none of them installed.

A missing binary must produce the setup screen, never a crash and never a silent fallback to a
different backend: a user who picked Codex and silently got Claude has been lied to about what ran.

## Verifying a backend, and the failure mode to watch for

Most of these drivers were written on a machine where their CLI was not installed, so
**`bismuth backends`** exists to close the gap between "the catalog claims this works" and "this
answered here". It is deliberately inert — it resolves binaries and reads version strings, never runs
a turn, authenticates, spends money, starts a daemon, or writes config.

The recurring failure mode across this whole feature has been **a signal claiming more than it
knows**, and it has shown up four times:

1. A single `permissionModes` flag covering both approval prompts and the mode picker, so an ACP
   backend rendered a picker whose selections went nowhere. Fixed by splitting the flag.
2. The relay heartbeat omitting `backend`, which would have silently relabelled a Codex tab as
   Claude mid-session. Fixed by preserving the existing value, as the registry already did for `cwd`.
3. `bismuth backends` reporting npm's own version (`11.11.0`) for the npx-invoked ACP adapters,
   behind a confident ✓, because their `binary` is the package runner. Fixed by naming the package
   instead and never claiming a version for an adapter fetched on demand.
4. `@opencode-ai/sdk`'s generated types disagreeing with the running server about both the delta
   event and the permission event. Fixed by reading those events as untyped JSON.
5. `capabilities.visibilityGate` itself, in its original boolean form, had **zero consumers** —
   grepping for anywhere it was read outside the catalog's own declaration returned nothing.
   `resolveDaemonBackend` hardcoded `want === "claude"` instead of reading it. A flag nobody reads is
   the purest form of this failure mode: it costs nothing to set and asserts nothing true. Fixed by
   turning it into the per-channel shape above and making it the thing two real chokepoints
   (`resolveDaemonBackend`, and the chat provider router's `resolveVisibilityGate` — see
   [../vault/visibility.md](../vault/visibility.md#the-chokepoint-and-why-it-lives-in-the-router))
   actually branch on.

The lesson generalises: when a flag, a payload field, or a generated type asserts a capability,
prefer the version of the code that can be wrong *loudly*. A missing control is a small annoyance; a
control that looks present and does nothing costs someone an afternoon.
