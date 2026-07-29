// core/src/agentBackends/catalog.ts
// The PURE catalog of agent backends — the CLIs Bismuth can drive.
//
// Deliberately zero imports: no Bun APIs, no node:fs, no driver modules. This file is imported by
// the settings schema (which the app bundles for `.settings` autocomplete + lint), by the frontend
// (chat header pickers, capability gating), and by the runtime registry alike, so it must stay
// safe for the browser/iPad bundle where nothing may statically pull in Bun or node:fs (see the
// Mobile / iPad seam in CLAUDE.md). Anything effectful — resolving a binary on PATH, spawning,
// registering MCP — lives in ./registry.ts and the per-surface modules.
//
// Adding a backend = one entry in BACKEND_IDS + one descriptor in BACKENDS here, then wiring
// whichever surfaces it supports. The settings enum, the frontend picker, and the capability
// gating all derive from this file, so none of them need editing per backend.

/** Every backend id this build knows. The source of truth for the `chat.provider` settings enum
 *  and for `BackendId`, so adding a backend is a one-line change here rather than a union edit in
 *  a dozen files. Order matters: it is the display order of the chat header's provider picker.
 *  "codex" drives OpenAI's own `codex` binary directly (chatProviders/codex/, a Bun.spawn subprocess
 *  driver, deliberately not the `@openai/codex-sdk` npm package — see that driver's header) —
 *  distinct from "codex-acp" below, which bridges the SAME CLI through a third-party ACP adapter.
 *  The last six are ACP (Agent Client Protocol) agents — one hand-rolled JSON-RPC driver
 *  (chatProviders/acp/driver.ts) covers all of them; see chatProviders/acp/agents.ts for exactly
 *  what's verified vs guessed per CLI. */
export const BACKEND_IDS = [
  "claude",
  "opencode",
  "codex",
  "cline",
  "gemini",
  "goose",
  "openclaw",
  "claude-code-acp",
  "codex-acp",
] as const;

export type BackendId = (typeof BACKEND_IDS)[number];

/** The default backend for a chat tab that never chose one and a vault with no `chat.provider`. */
export const DEFAULT_BACKEND: BackendId = "claude";

/**
 * How a backend's turn output arrives, which is the only streaming distinction the UI cares about:
 *  - "delta": token-level deltas (Claude Code's stream-json / an SDK query) — prose types out.
 *  - "part":  whole message parts, complete when they arrive (`opencode run --format json`) —
 *             prose appears in paragraph-sized chunks. The driver still emits `assistant-text`
 *             frames; only the granularity differs.
 *  - "final": nothing until the turn ends (a CLI with no streaming output mode at all).
 */
export type StreamingGranularity = "delta" | "part" | "final";

/** Which mechanism reports a backend's sessions into the "agents" graph (core/src/relay.ts):
 *  - "hooks":   the CLI has a real hook/plugin system, so we get sessions AND subagent depth.
 *  - "wrapper": no hook system — the PTY shim wraps the binary and reports session start/end
 *               itself. Correct session nodes, flat tree (no subagents).
 *  - "none":    not represented in the agents graph. */
export type AgentsGraphMode = "hooks" | "wrapper" | "none";

/** How Bismuth registers its MCP server with a backend:
 *  - "cli":    the CLI owns its config format and exposes `<bin> mcp add …` — always preferred.
 *  - "config": we merge into a config file ourselves (structure-preserving; never for TOML).
 *  - "none":   the backend doesn't speak MCP. */
export type McpRegistrationMode = "cli" | "config" | "none";

/** How a vault's memory reaches a backend's session, best mechanism first:
 *  - "hooks":        a pre-prompt hook injects recalled memory per turn (true auto-recall).
 *  - "systemPrompt": a system-prompt flag injects a memory digest once per session.
 *  - "agentsMd":     a managed block in the vault's AGENTS.md-style context file.
 *  - "mcpOnly":      no injection — the model must call the remember/recall/forget MCP tools. */
export type MemoryInjectionMode = "hooks" | "systemPrompt" | "agentsMd" | "mcpOnly";

/**
 * What a backend can do, so no surface has to branch on a backend ID.
 *
 * This replaces the old `providerSupportsClaudeControls(provider) => provider === "claude"` in
 * app/src/chatProvider.ts, which silently gave every future backend Claude's exact degradation
 * profile whether or not it was true (Cline has thinking levels; Codex has approval modes).
 * A control renders iff the ACTIVE backend's flag says it exists.
 */
export interface BackendCapabilities {
  // --- chat -------------------------------------------------------------------------------
  /** Can drive a chat tab at all. False = terminal-only backend (no machine-readable output). */
  chat: boolean;
  streaming: StreamingGranularity;
  /** A past session can be continued (a resume flag keyed by the backend's own session id). */
  resume: boolean;
  /** A past session's transcript can be replayed as frames (populates a reopened tab). */
  historyReplay: boolean;
  /** Past sessions can be ENUMERATED for the cross-session history picker. Distinct from
   *  `resume`: opencode resumes per tab but exposes no cross-session list. */
  sessionPicker: boolean;
  /** A model list can be fetched, so the header's model picker has options. */
  models: boolean;
  /** Reasoning-effort levels are selectable (the header's Effort picker). */
  effort: boolean;
  /** Image attachments can ride a turn. */
  images: boolean;
  /**
   * The backend can raise a live approval request mid-turn (a `permission` ChatFrame the user
   * answers). Claude Code does this through the SDK's canUseTool; an ACP agent does it through
   * `session/request_permission`.
   *
   * Deliberately SEPARATE from {@link permissionModes}: these were one flag, and conflating them
   * produced exactly the defect this split fixes — an ACP backend that can prompt for approval but
   * has no mode picker rendered a picker that silently did nothing.
   */
  permissionPrompts: boolean;
  /**
   * A permission-MODE picker is drivable — the header's "default / acceptEdits / bypassPermissions"
   * Select, pushed to the live session with `set_permission_mode`. Requires the backend to accept a
   * mode change, which is narrower than merely being able to ask for approval.
   */
  permissionModes: boolean;
  /** Browser/computer-use (`--chrome`). */
  computerUse: boolean;
  /** A slash-command registry rides the manifest for the composer's "/" autocomplete. */
  slashCommands: boolean;
  /** Credential state can be read for the header's auth pill. */
  auth: boolean;
  /** Per-turn cost is reported. */
  cost: boolean;
  /** Context-window usage is reported (the header's context pill). */
  contextUsage: boolean;

  // --- the other surfaces -----------------------------------------------------------------
  /** Has an interactive TUI worth hosting in a terminal tab. */
  terminal: boolean;
  agentsGraph: AgentsGraphMode;
  /** Reports subagents, so the agents graph gets depth-1 children. */
  subagents: boolean;
  /** Can run a vault's daemon brain (unattended, resumable, headless). */
  daemon: boolean;
  /**
   * Can enforce the vault's per-note VISIBILITY GATE (docs/vault/visibility.md).
   *
   * True only for Claude Code today: the gate needs `managedSettings.permissions.deny` +
   * `sandbox.filesystem.denyRead` + `disallowedTools` together (daemon/src/daemon/session.ts
   * buildQueryOptions). The system-prompt appendix is advisory only and explicitly NOT the gate,
   * so a backend without this flag MUST be refused as a daemon backend for a vault that has any
   * hidden notes — otherwise a real security boundary silently becomes a suggestion.
   */
  visibilityGate: boolean;
  mcp: McpRegistrationMode;
  memory: MemoryInjectionMode;
}

/** A backend's static identity + capabilities. Effectful wiring lives in ./registry.ts. */
export interface BackendDescriptor {
  id: BackendId;
  /** Display name in the header picker / settings docs. */
  label: string;
  /** Binary name to resolve on PATH (the augmented lookup path — see core/src/claudeWhich.ts). */
  binary: string;
  /** Shown on the chat setup screen when the binary is missing. */
  installHint: string;
  /** The CLI's own interactive login command, offered by the auth pill. Undefined = the backend
   *  manages login itself and there is nothing useful to tell the user to run. */
  loginCommand?: string;
  /**
   * Omit this backend from the chat header's provider picker, while keeping it fully selectable by
   * id (a hand-edited `.settings`, or a per-tab key that already names it).
   *
   * For the ACP ADAPTER entries whose underlying agent also has a native driver here. Offering
   * "Claude Code (ACP)" beside "Claude Code" is a trap: it is strictly worse — a third-party bridge
   * fetched by npx at runtime, with fewer capabilities — yet reads in a list as if it were newer or
   * better. Same for "Codex (ACP)" now that native Codex exists. They stay in the catalog because
   * the specs are useful documentation and a real escape hatch if a native driver ever breaks; they
   * just should not be offered as a peer choice.
   */
  hidden?: boolean;
  capabilities: BackendCapabilities;
}

/**
 * Claude Code — the default backend, driven by core/src/chat.ts through a long-lived Agent-SDK
 * `query()` per chat. The only backend that supports every surface, and (importantly) the only one
 * that can enforce the vault visibility gate.
 */
const CLAUDE: BackendDescriptor = {
  id: "claude",
  label: "Claude Code",
  binary: "claude",
  installHint: "Install Claude Code (claude.com/claude-code) and run `claude` once to log in.",
  capabilities: {
    chat: true,
    streaming: "delta",
    resume: true,
    historyReplay: true,
    sessionPicker: true,
    models: true,
    effort: true,
    images: true,
    // canUseTool raises the approval request; the header's mode Select pushes a mode change.
    permissionPrompts: true,
    permissionModes: true,
    computerUse: true,
    slashCommands: true,
    // The claude CLI manages its own login and surfaces failures as turn errors — there is no
    // credential list to show, so the header pill stays hidden rather than showing a fake state.
    auth: false,
    cost: true,
    contextUsage: true,
    terminal: true,
    agentsGraph: "hooks",
    subagents: true,
    daemon: true,
    visibilityGate: true,
    mcp: "cli",
    memory: "hooks",
  },
};

/**
 * opencode — driven by core/src/chatProviders/opencode.ts. PREFERS one persistent `opencode serve`
 * process shared across every opencode chat (chatProviders/opencodeServer.ts), falling back to the
 * original one `opencode run --format json` subprocess per turn when the installed opencode can't
 * serve (see opencodeServer.ts's startup-banner detection). Capability flags below assume server
 * mode, which is what any currently-shipping opencode install gets — a fallback to run mode degrades
 * the LIVE session to run mode's narrower behavior at runtime without lying about what this build
 * can do when server mode IS available, the same way Claude's flags assume a logged-in `claude`
 * rather than caveating every flag for a logged-out one.
 *
 * Every flag flipped from the original per-turn-subprocess-only profile below was independently
 * verified live against opencode 1.18.4 + @opencode-ai/sdk 1.18.9 (see opencode.ts/opencodeServer.ts/
 * opencodeTranslate.ts's top-of-file notes for the exact requests/responses observed) — not inferred
 * from the SDK's generated types alone, which were confirmed to have real drift from live behavior
 * (see opencodeServer.ts's top-of-file note on "permission.asked" vs the documented
 * "permission.updated", and the separate "message.part.delta" event type).
 */
const OPENCODE: BackendDescriptor = {
  id: "opencode",
  label: "opencode",
  binary: "opencode",
  installHint: "Install opencode (opencode.ai) to use this provider.",
  loginCommand: "opencode auth login",
  capabilities: {
    chat: true,
    // Server mode streams real token-level deltas — verified live: `message.part.delta` events with
    // {partID,field:"text",delta} arrived incrementally for a real turn (run mode's `opencode run`
    // still only emits whole text parts per part, but that's now the fallback path, not the norm).
    streaming: "delta",
    resume: true,
    // Server mode replays via `GET /session/{id}/message` (typed, no export subprocess); run mode
    // still falls back to `opencode export <sessionID>` — either way a transcript replays.
    historyReplay: true,
    // …but there is still no cross-session list, so the history picker stays Claude-only.
    sessionPicker: false,
    models: true,
    // opencode models report no effort levels (the models frame carries effortLevels: []) in EITHER
    // mode — server mode's config.providers() has no per-model effort field either.
    effort: false,
    // Server mode accepts a real attachment: verified live with an actual POST — a FilePartInput
    // {type:"file",mime,url:"data:image/png;base64,..."} was accepted (HTTP 200) and a vision-capable
    // free model (opencode/mimo-v2.5-free) read genuine pixel content back. Run mode still has no
    // attachment flag and refuses images with a friendly error (opencode.ts's dispatchTurn).
    images: true,
    // Server mode raises a real approval request mid-turn and answers it: verified live for BOTH
    // allow ("once", the tool ran) and deny ("reject", the tool errored with the model seeing "The
    // user rejected permission..."). Run mode's `--auto` still can't park on a prompt at all — a
    // session that falls back to run mode simply never raises a `permission` frame, same as before.
    permissionPrompts: true,
    // NOT raised: no verified way to switch a live session's permission MODE (there is no
    // Default/Plan/AcceptEdits/Bypass vocabulary in the server API — only per-permission-kind
    // ask/allow/deny rules in config, which is a different axis). Raising this without a real
    // set_permission_mode-equivalent would render a picker whose selections silently do nothing —
    // exactly the ACP `permissionModes` defect this flag split exists to prevent (see
    // ACP_SHARED_CAPABILITIES's comment above).
    permissionModes: false,
    computerUse: false,
    // opencode's own command registry rides the manifest — server mode reads it off the typed
    // `GET /command`; run mode still parses `opencode debug config`.
    slashCommands: true,
    // `opencode auth list` → the header's auth pill (a plain CLI spawn, unaffected by which mode a
    // session is running in — verified live it doesn't contend with a running server's sqlite).
    auth: true,
    // Server mode reads the turn's authoritative cost off session.prompt()'s response (info.cost);
    // run mode still accumulates step_finish's cost. Free/subscription models report 0 either way.
    cost: true,
    contextUsage: false,
    terminal: true,
    // No session telemetry: an opencode session still does not appear in the agents graph. Server
    // mode's session.children()/session lifecycle events COULD feed this, but wiring it into
    // core/src/relay.ts's registry is a separate surface this task didn't build — raising this flag
    // without that wiring would be exactly the "claims something that doesn't work" trap the task
    // brief warns against, so it stays false until that integration exists.
    agentsGraph: "none",
    subagents: false,
    daemon: false,
    visibilityGate: false,
    // Server mode COULD register MCP dynamically per session (POST /mcp, no config file) instead of
    // a static config-file merge — not wired up here (out of scope for this backend-upgrade task);
    // the mechanism stays "config" until that's built.
    mcp: "config",
    // Server mode injects a FRESH recalled-memory digest EVERY turn via session.prompt's `system`
    // field (recallMemory(memoryDir, text) — the same recall Claude's UserPromptSubmit hook uses),
    // verified as a genuine per-call override by the SDK's own request shape. "systemPrompt" is the
    // closest existing enum value (a system-prompt-flag injection) — note it's actually PER-TURN
    // here, strictly better than the "once per session" the enum's own doc comment describes for
    // the daemon's spawn-fixed appendSystemPrompt. Run mode still has no such hook and stays
    // MCP-tool-only for memory.
    memory: "systemPrompt",
  },
};

/**
 * OpenAI Codex — driven by core/src/chatProviders/codex/, which spawns the user's OWN `codex`
 * binary directly (`codex exec --json`/`--experimental-json` via Bun.spawn), NOT the
 * `@openai/codex-sdk` npm package. That SDK was evaluated and dropped: reading its compiled source
 * showed `Thread.runStreamed()` spawns a FRESH `codex exec` subprocess per turn anyway (no
 * lifecycle win over driving the CLI ourselves), it has no per-session MCP field, and — the
 * decisive issue — its own binary resolution has NO PATH lookup, instead resolving a BUNDLED
 * platform binary (~310MB on disk) unless given an override. Every other backend here drives the
 * user's own installed CLI through the same augmented-PATH `whichBinary()`; see
 * chatProviders/codex/driver.ts's file header for the full writeup, including the resulting
 * `--json`/`--experimental-json` flag-spelling fallback.
 *
 * Architecturally closer to opencode than to Claude either way: one subprocess per turn, continued
 * turn-to-turn via `codex exec resume <threadId>` rather than a persistent connection.
 *
 * Capability rationale (every flag below is either directly evidenced by the CLI's own `--help`/
 * documented JSONL event shapes (`codex exec --json`), or explicitly a "no" because the research
 * found nothing to back a "yes" — see docs/chat/backends.md and this backend's own driver comments):
 *  - streaming: "part" — item.started/updated/completed carry whole (cumulative) text per item,
 *    not token-level deltas; the driver diffs cumulative text into a delta so the UI still streams,
 *    but the underlying granularity is item-sized, same tier as opencode.
 *  - effort: true — `--config model_reasoning_effort=…` is a real, stable 5-value enum
 *    (minimal/low/medium/high/xhigh) — unlike model ids, this doesn't churn.
 *  - models: FALSE — no `codex models`/model-list subcommand exists (confirmed: an open GitHub
 *    feature request, still unresolved at research time), so there is nothing honest to populate a
 *    picker from. Model ids are still settable as a free-form string via setModel (no UI surfaces
 *    it without the picker).
 *  - images: true — `--image <path>` is a real CLI flag; the driver writes each attachment's
 *    base64 payload to a temp file (the flag takes a path, not raw bytes) and cleans it up after
 *    the turn.
 *  - permissionPrompts/permissionModes: false — `codex exec` is fundamentally non-interactive; the
 *    JSONL event union has no approval-request event to park as a live permission frame, and the
 *    driver runs `--config approval_policy="never"` explicitly.
 *  - auth/cost/contextUsage: false — no credential-list command evidenced; the turn-completion
 *    event carries token COUNTS but no dollar cost, and no per-model max-context figure is
 *    available to compute a percentage from without a guessed price/context table.
 *  - historyReplay/sessionPicker: false — no transcript-export or session-list command was
 *    confirmed (the `~/.codex/sessions` rollout JSONL could in principle be tailed, but its exact
 *    shape was only medium-confidence-verified — see chatProviders/codex/driver.ts — so this stays
 *    honest at false rather than populating a picker/replay from an unverified format).
 *  - agentsGraph: "hooks", subagents: true — Codex's hook system is (per the research) nearly
 *    isomorphic to Claude Code's, including SubagentStart/SubagentStop with real agent_id/agent_type
 *    — see agentBackends/codexHooks.ts's project-scoped `.codex/hooks.json` generator.
 *  - daemon: true, visibilityGate: FALSE — a Codex daemon backend exists
 *    (daemon/src/daemon/codexSession.ts, also a direct subprocess driver — no SDK there either,
 *    which matters even more for a workspace that compiles to a standalone binary), but it can
 *    only ever be SELECTED for a vault with zero hidden notes: resolveDaemonBackend
 *    (daemon/src/daemon/session.ts) is the one chokepoint that enforces this and refuses Codex
 *    (degrading to Claude) the moment any note is hidden, because Codex has no equivalent of
 *    Claude's managedSettings/sandbox/disallowedTools triple.
 *  - mcp: "cli" — `codex mcp add` already exists (agentBackends/mcpRegistrars.ts, pre-existing —
 *    not duplicated here).
 *  - memory: "agentsMd" — no system-prompt flag exists on `codex exec`; a managed block in the
 *    vault's AGENTS.md is Codex's designed channel for this (agentBackends/agentsMd.ts, shared with
 *    any future AGENTS.md-convention backend), opt-in via `settings.codex.writeAgentsMd`.
 */
const CODEX: BackendDescriptor = {
  id: "codex",
  label: "OpenAI Codex",
  binary: "codex",
  installHint: "Install the Codex CLI (`npm i -g @openai/codex`, or see developers.openai.com/codex) and run `codex` once to log in.",
  capabilities: {
    chat: true,
    streaming: "part",
    resume: true,
    historyReplay: false,
    sessionPicker: false,
    models: false,
    effort: true,
    images: true,
    permissionPrompts: false,
    permissionModes: false,
    computerUse: false,
    slashCommands: false,
    auth: false,
    cost: false,
    contextUsage: false,
    terminal: true,
    agentsGraph: "hooks",
    subagents: true,
    daemon: true,
    visibilityGate: false,
    mcp: "cli",
    memory: "agentsMd",
  },
};

/**
 * Every ACP agent shares ONE capability profile — verified against the ACP research report backing
 * chatProviders/acp/: per-turn deltas + thinking + tool calls-with-results + resume + cancel +
 * images + slash commands all ride the same session/update stream, and session/new.mcpServers gives
 * every one of them per-session MCP injection with zero global config file (mcp: "cli" here really
 * means "the driver builds the mcpServers array itself" — there's no `<bin> mcp add` involved, but
 * it's the same "no config-file surgery" story the mcp:"cli" flag exists to signal for Claude).
 *
 * Capabilities NOT claimed, and why:
 *  - historyReplay/sessionPicker: false — ACP has no transcript-export or cross-session-list method
 *    (confirmed absent in the research report). Claiming either would populate a history picker /
 *    reopened tab with nothing.
 *  - cost/contextUsage: false for EVERY agent here, not just the two 0.14.1-pinned adapters — the
 *    research report confirms usage_update (which carries both) is an SDK ~1.x-only session/update
 *    kind, and cline (native, not an adapter) was independently confirmed to use the OLDER
 *    model-selection shape too; gemini/goose/openclaw's exact pinned SDK version was never verified
 *    live, so claiming cost/contextUsage there would be a guess this driver cannot back — false
 *    across the board is the honest default until a specific agent is verified to emit it.
 *  - computerUse: false — no `--chrome`-equivalent capability exists in the verified ACP surface.
 *  - agentsGraph/subagents/daemon/visibilityGate: false — Surface 3/4 dead ends per the research
 *    report (no session-lifecycle telemetry, no systemPrompt field for the daemon's persona
 *    injection, and visibilityGate specifically requires Claude Code's own
 *    managedSettings/sandbox/disallowedTools trio, which no ACP agent exposes).
 *
 *  - effort: true — the driver implements session/set_config_option for a "thought_level" category
 *    option (see driver.ts setEffort).
 *  - permissionPrompts: true, permissionModes: FALSE. The driver parks session/request_permission as
 *    a live `permission` frame, so approval prompts work; but there is no ACP-verified equivalent of
 *    Claude's permission-MODE picker, and `setPermissionMode` is deliberately not implemented. These
 *    started as ONE flag set to `true`, which rendered a mode picker whose selections silently went
 *    nowhere — a capability claiming something the backend cannot do, which is worse than a missing
 *    control. Splitting the flag is the fix. (ACP does define session/set_mode with `modes` on the
 *    session/new result; wiring that up is the way to make this `true` honestly, later.)
 *  - respondQuestion is likewise unimplemented — ACP has no AskUserQuestion equivalent — but no
 *    capability advertises it, so nothing renders for it.
 */
const ACP_SHARED_CAPABILITIES: BackendCapabilities = {
  chat: true,
  streaming: "delta",
  resume: true,
  historyReplay: false,
  sessionPicker: false,
  models: true,
  effort: true,
  images: true,
  permissionPrompts: true,
  permissionModes: false,
  computerUse: false,
  slashCommands: true,
  auth: false,
  cost: false,
  contextUsage: false,
  terminal: true,
  agentsGraph: "none",
  subagents: false,
  daemon: false,
  visibilityGate: false,
  mcp: "cli",
  memory: "mcpOnly",
};

/** Cline — native ACP support (`cline --acp`), verified directly from the compiled binary. */
const CLINE: BackendDescriptor = {
  id: "cline",
  label: "Cline",
  binary: "cline",
  installHint: "Install Cline (cline.bot) — Bismuth spawns `cline --acp` automatically when you pick this provider.",
  capabilities: ACP_SHARED_CAPABILITIES,
};

/** Gemini CLI — `gemini --experimental-acp` (long-documented flag; a newer stable `--acp` spelling
 *  is unconfirmed, so the driver tries the documented one first and falls back once — see
 *  chatProviders/acp/agents.ts). */
const GEMINI: BackendDescriptor = {
  id: "gemini",
  label: "Gemini CLI",
  binary: "gemini",
  installHint: "Install the Gemini CLI (`npm i -g @google/gemini-cli`) to use this provider.",
  capabilities: ACP_SHARED_CAPABILITIES,
};

/** Goose — `goose acp`; Goose's own docs confirm it MERGES our session/new mcpServers with its own
 *  configured extensions rather than replacing them. */
const GOOSE: BackendDescriptor = {
  id: "goose",
  label: "Goose",
  binary: "goose",
  installHint: "Install Goose (goose-docs.ai) to use this provider.",
  capabilities: ACP_SHARED_CAPABILITIES,
};

/** OpenClaw — `openclaw acp`. Confirmed identical wire format to Zed's ACP (OpenClaw's own docs:
 *  "speaks ACP over stdio for IDEs"); the session runs against whatever Gateway/model the user has
 *  OpenClaw configured with. */
const OPENCLAW: BackendDescriptor = {
  id: "openclaw",
  label: "OpenClaw",
  binary: "openclaw",
  installHint: "Install OpenClaw to use this provider — it runs against your own configured Gateway/model.",
  capabilities: ACP_SHARED_CAPABILITIES,
};

/** Claude Code via Zed's `@zed-industries/claude-code-acp` adapter — an ADAPTER, not native ACP
 *  support (built on the Claude Agent SDK). Spawned on demand via `npx`; pinned to
 *  `@agentclientprotocol/sdk@0.14.1`, the OLD model-selection shape (driver.ts branches on this via
 *  detectModelShape). Distinct from the "claude" backend above, which drives `claude` directly
 *  through the Agent SDK with no ACP in between. */
const CLAUDE_CODE_ACP: BackendDescriptor = {
  id: "claude-code-acp",
  label: "Claude Code (ACP)",
  binary: "npx",
  installHint: "Runs Claude Code through Zed's ACP adapter (`npx @zed-industries/claude-code-acp`) — requires Node/npx and your own Claude Code login.",
  // Hidden from the picker: the native driver above supersedes this bridge. See `hidden`.
  hidden: true,
  capabilities: ACP_SHARED_CAPABILITIES,
};

/** Codex CLI via `@agentclientprotocol/codex-acp` — an ADAPTER bridging Codex's App Server onto
 *  ACP, already listed in Zed's own agent catalog. Spawned on demand via `npx`. */
const CODEX_ACP: BackendDescriptor = {
  id: "codex-acp",
  label: "Codex (ACP)",
  binary: "npx",
  installHint: "Runs the Codex CLI through its ACP adapter (`npx @agentclientprotocol/codex-acp`) — requires Node/npx and your own Codex/ChatGPT login.",
  // Hidden from the picker: the native driver above supersedes this bridge. See `hidden`.
  hidden: true,
  capabilities: ACP_SHARED_CAPABILITIES,
};

/** Every backend, keyed by id. */
export const BACKENDS: Record<BackendId, BackendDescriptor> = {
  claude: CLAUDE,
  opencode: OPENCODE,
  codex: CODEX,
  cline: CLINE,
  gemini: GEMINI,
  goose: GOOSE,
  openclaw: OPENCLAW,
  "claude-code-acp": CLAUDE_CODE_ACP,
  "codex-acp": CODEX_ACP,
};

/** In BACKEND_IDS order — the display order of the provider picker. */
export const BACKEND_LIST: readonly BackendDescriptor[] = BACKEND_IDS.map((id) => BACKENDS[id]);

/** Type guard for an untrusted id (a stale localStorage value, a wire field, a `.settings` typo). */
export function isBackendId(v: unknown): v is BackendId {
  return typeof v === "string" && (BACKEND_IDS as readonly string[]).includes(v);
}

/**
 * Pure: resolve which backend to use. `requested` is what the client sent on the wire; `fallback`
 * is the vault's `chat.provider` setting. Anything unrecognized (absent, a typo, a backend a newer
 * build knows and this one doesn't) degrades to the next tier, bottoming out at Claude — so garbage
 * input can never spawn the wrong binary or throw.
 */
export function resolveBackendId(requested: unknown, fallback?: unknown): BackendId {
  if (isBackendId(requested)) return requested;
  if (isBackendId(fallback)) return fallback;
  return DEFAULT_BACKEND;
}

/** A backend's descriptor, or the default's — never undefined, so callers need no null branch. */
export function backendOf(id: unknown): BackendDescriptor {
  return BACKENDS[resolveBackendId(id)];
}

/** Shorthand for capability checks: `can(id, "images")`. */
export function can<K extends keyof BackendCapabilities>(id: unknown, cap: K): BackendCapabilities[K] {
  return backendOf(id).capabilities[cap];
}
