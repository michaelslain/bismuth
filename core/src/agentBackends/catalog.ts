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
 *  The last six are ACP (Agent Client Protocol) agents — one hand-rolled JSON-RPC driver
 *  (chatProviders/acp/driver.ts) covers all of them; see chatProviders/acp/agents.ts for exactly
 *  what's verified vs guessed per CLI. */
export const BACKEND_IDS = [
  "claude",
  "opencode",
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
 * opencode — driven by core/src/chatProviders/opencode.ts, one `opencode run --format json`
 * subprocess per turn continued with `-s <sessionID>`. Capability flags below encode exactly the
 * "Graceful degradation" list in docs/chat/providers.md, which until now lived as a single
 * `provider === "claude"` check in the frontend.
 */
const OPENCODE: BackendDescriptor = {
  id: "opencode",
  label: "opencode",
  binary: "opencode",
  installHint: "Install opencode (opencode.ai) to use this provider.",
  loginCommand: "opencode auth login",
  capabilities: {
    chat: true,
    // `opencode run` emits whole text parts, not token deltas.
    streaming: "part",
    resume: true,
    // `opencode export <sessionID>` replays a transcript…
    historyReplay: true,
    // …but there is no cross-session list, so the history picker stays Claude-only.
    sessionPicker: false,
    models: true,
    // opencode models report no effort levels (the models frame carries effortLevels: []).
    effort: false,
    // `opencode run` has no attachment flag.
    images: false,
    // Runs are `--auto`; a non-interactive run can never park on a permission prompt, so it has
    // neither the prompt nor the mode picker.
    permissionPrompts: false,
    permissionModes: false,
    computerUse: false,
    // opencode's own command registry rides the manifest (`opencode debug config` + built-ins).
    slashCommands: true,
    // `opencode auth list` → the header's auth pill.
    auth: true,
    // step_finish carries cost, though free/subscription models report 0.
    cost: true,
    contextUsage: false,
    terminal: true,
    // No session telemetry today: an opencode session does not appear in the agents graph.
    agentsGraph: "none",
    subagents: false,
    daemon: false,
    visibilityGate: false,
    mcp: "config",
    memory: "mcpOnly",
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
  capabilities: ACP_SHARED_CAPABILITIES,
};

/** Codex CLI via `@agentclientprotocol/codex-acp` — an ADAPTER bridging Codex's App Server onto
 *  ACP, already listed in Zed's own agent catalog. Spawned on demand via `npx`. */
const CODEX_ACP: BackendDescriptor = {
  id: "codex-acp",
  label: "Codex (ACP)",
  binary: "npx",
  installHint: "Runs the Codex CLI through its ACP adapter (`npx @agentclientprotocol/codex-acp`) — requires Node/npx and your own Codex/ChatGPT login.",
  capabilities: ACP_SHARED_CAPABILITIES,
};

/** Every backend, keyed by id. */
export const BACKENDS: Record<BackendId, BackendDescriptor> = {
  claude: CLAUDE,
  opencode: OPENCODE,
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
