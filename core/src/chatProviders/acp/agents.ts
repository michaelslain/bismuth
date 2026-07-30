// core/src/chatProviders/acp/agents.ts
// The per-agent ACP spawn table: which binary + flags puts each supported CLI into ACP mode. Pure
// data (no I/O — resolving the binary on PATH and spawning both live in ./driver.ts), so this can
// be read by anything that needs "what agents does the ACP driver know about" without pulling in
// Bun/node:fs (same bundle-safety reason core/src/agentBackends/catalog.ts stays import-free).
//
// Every entry here is verified live against a specific CLI in the ACP research report EXCEPT
// where a comment says otherwise — see the per-entry notes for exactly what's confirmed vs guessed.
import type { BackendId } from "../../agentBackends/catalog";

export interface AcpAgentSpec {
  id: BackendId;
  label: string;
  /** Binary resolved on PATH (via the same augmented lookup claude/opencode use). */
  binary: string;
  args: string[];
  /**
   * Retried ONCE, with these args instead, if the primary spawn's ACP handshake never completes
   * (the process exits before `initialize` responds) — the driver's way of tolerating a CLI flag
   * that's been renamed between versions without hardcoding which spelling the user's install has.
   */
  fallbackArgs?: string[];
  /** True for a protocol ADAPTER (an separately-published package that bridges some other CLI onto
   *  ACP) rather than the agent's own native `--acp`/`acp` mode — see per-entry comments. */
  adapter?: boolean;
}

export const ACP_AGENTS: readonly AcpAgentSpec[] = [
  {
    // Verified directly from the compiled cline binary (`npm pack cline@3.0.47`, `strings`'d the
    // Mach-O executable): commander.js's own option table lists `--acp` ("Run in Agent Client
    // Protocol (ACP) mode for editor integration"), and the bundle's method dispatch table confirms
    // initialize/session-new/session-load/session-prompt/session-cancel/set_model/set_config_option
    // all present.
    id: "cline",
    label: "Cline",
    binary: "cline",
    args: ["--acp"],
  },
  {
    // `--experimental-acp` is the long-documented flag (multiple 2026 sources, incl. a Feb-2026
    // IntelliJ integration walkthrough). Some 2026 sources report a newer stable `--acp` superseding
    // it, but the research could NOT confirm this from Gemini CLI's own changelog (checked v0.53.0's
    // directly — no ACP mention at all) — LOW confidence on which spelling a given install has, so
    // we try the confirmed-documented one FIRST and fall back to the unconfirmed rename only if the
    // process exits before the ACP handshake completes.
    id: "gemini",
    label: "Gemini CLI",
    binary: "gemini",
    args: ["--experimental-acp"],
    fallbackArgs: ["--acp"],
  },
  {
    // goose's own docs (goose-docs.ai) confirm `goose acp` and that it MERGES our session/new
    // mcpServers with its own configured extensions rather than replacing them.
    id: "goose",
    label: "Goose",
    binary: "goose",
    args: ["acp"],
  },
  {
    // Confirmed live (`openclaw --help` / `openclaw acp --help`, v2026.3.23-2): OpenClaw's own label
    // is "Agent Control Protocol" but the wire format is identical Zed ACP (its own docs say `openclaw
    // acp` "speaks ACP over stdio for IDEs"). Puts OpenClaw on the AGENT side of the connection,
    // backed by whatever Gateway/model the user has it configured with.
    id: "openclaw",
    label: "OpenClaw",
    binary: "openclaw",
    args: ["acp"],
  },
  {
    // ADAPTER, not a native agent: this package bridges Claude Code (via Anthropic's own Claude
    // Agent SDK, per its README) onto ACP. Not installed as a global binary by default — spawned
    // on-demand via npx, matching how Zed's own agent_servers config invokes it. Pinned to
    // @agentclientprotocol/sdk@0.14.1 (confirmed from its published deps) — the OLD model-selection
    // shape (NewSessionResponse.models + session/set_model), which is exactly why the driver must
    // branch on detectModelShape rather than assuming the new configOptions shape everywhere.
    id: "claude-code-acp",
    label: "Claude Code (ACP)",
    binary: "npx",
    args: ["-y", "@zed-industries/claude-code-acp"],
    adapter: true,
  },
  {
    // ADAPTER, not a native agent: bridges the Codex CLI's App Server onto ACP (already listed in
    // Zed's own "Codex CLI - ACP Agent" catalog). Also npx-invoked — not assumed to be preinstalled.
    id: "codex-acp",
    label: "Codex (ACP)",
    binary: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp"],
    adapter: true,
  },
];
