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
  /**
   * False for an agent whose ACP session/new REJECTS a non-empty `mcpServers` array outright rather
   * than silently ignoring or merging it — driver.ts's createSession must send `[]` instead of its
   * usual buildMcpServers(cwd, memoryDir) result for such an agent. Omitted (undefined) means
   * "supported", matching every entry below except openclaw (see its own comment for the citation).
   * A per-session Bismuth MCP server (the "Surface 5" comment atop driver.ts) is simply unavailable
   * for an agent with this set to false — not a bug, a real protocol constraint on that agent's side.
   */
  supportsSessionMcpServers?: boolean;
  /**
   * Extra argv appended AFTER `args`, computed from the chat id — for an agent whose spawn needs a
   * value only available per-chat (currently only openclaw's `--session`, see its own comment for
   * why a STATIC session key is unsafe, not just unfair). driver.ts's createSession calls this with
   * its own `chatId` parameter (already in scope there — see the call site) and spreads the result
   * onto argv. Omitted for every other agent: they get an isolated `acp:<uuid>` session per chat for
   * free from the CLI's own default, so no per-chat argv is needed.
   */
  sessionKeyArgs?: (chatId: string) => string[];
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
    //
    // `sessionKeyArgs` (a per-CHAT `--session`) is REQUIRED, not cosmetic — confirmed live
    // (offline-testing openclaw task) that the plain `openclaw acp` invocation (no --session) is
    // BROKEN for every fresh turn, independent of mocking: `session/new` succeeds, but the FIRST
    // `session/prompt` always fails with `ACP_SESSION_INIT_FAILED: ACP metadata is missing for
    // agent:main:acp:<uuid>...`. Root cause, read directly from the installed package
    // (~/`openclaw`'s `dist/acp-cli-BQ740PFm.js`'s `AcpGatewayAgent.newSession`, and
    // `dist/session-key-DAhnzjyr.js`'s `isAcpSessionKey`): when no `--session`/`_meta.sessionKey` is
    // given, the ACP bridge's OWN default session-key naming is `acp:<uuid>` — which collides with a
    // COMPLETELY UNRELATED OpenClaw feature that also uses the literal `acp:` session-name prefix as
    // a reserved marker (its own outbound multi-agent "spawn an external ACP-speaking sub-agent"
    // mechanism, `docs/tools/acp-agents.md`, driven by the `/acp spawn` slash command — nothing to do
    // with Bismuth or with `openclaw acp` the bridge command). `dist/manager-Bw8JrihM.js`'s
    // `AcpSessionManager.resolveSession` treats ANY session key whose name matches `isAcpSessionKey`
    // (starts with `acp:`) as "must already be spawn-bound", and the bridge's own default session
    // never goes through that spawn step — so a plain `openclaw acp` can never complete a single
    // turn on a fresh Gateway, for any user, mock or real. Any OTHER session name sidesteps the
    // collision and works normally (confirmed live for both `agent:main:main` — openclaw's own
    // documented example, `docs/cli/acp.md` — and an arbitrary custom label): the embedded agent
    // runtime auto-provisions itself the first time a non-"acp:"-prefixed session name is used.
    //
    // MUST BE PER-CHAT, NOT A FIXED CONSTANT — this was shipped as a static `agent:main:bismuth`
    // once and reverted after review: a fixed session key means every Bismuth chat/tab against
    // openclaw resolves to the SAME Gateway session, which is not merely "less isolated" but an
    // active cross-chat content leak — reproduced live (capture-server test, see
    // openclawMocked.test.ts's isolation test below): chat A's own text arrives INSIDE chat B's
    // first-ever upstream request the moment B is a brand-new, never-before-seen chat id, and the
    // merged transcript persists across a Gateway restart because it's the SAME on-disk Gateway
    // session state a real user's `~/.openclaw` would carry indefinitely. `agent:main:bismuth-
    // <chatId>` (via `sessionKeyArgs` below) gives each Bismuth chat its OWN Gateway session key,
    // closing the leak while still avoiding the `acp:` prefix collision above (a chat id never
    // starts with `acp:` in this codebase).
    //
    // `supportsSessionMcpServers: false` — a SECOND real bug found alongside the session-key one
    // above, confirmed live: on any machine where Bismuth's own MCP tools are installed
    // (`~/.bismuth/bin/bismuth-mcp` exists — true for every user of the bundled app, per
    // bismuthInstall.ts), driver.ts's createSession ordinarily sends a non-empty `mcpServers` array
    // on `session/new` (buildMcpServers above). OpenClaw's ACP bridge explicitly REJECTS this:
    // `dist/acp-cli-BQ740PFm.js`'s `AcpGatewayAgent.assertSupportedSessionSetup` throws "ACP bridge
    // mode does not support per-session MCP servers. Configure MCP on the OpenClaw gateway or agent
    // instead." the moment `mcpServers.length > 0` — confirmed live via a raw JSON-RPC session/new
    // carrying one mcpServers entry, which came back `{code:-32603,message:"Internal error",
    // data:{details:"ACP bridge mode does not support per-session MCP servers..."}}` (the outer
    // "Internal error" is openclaw's own JSON-RPC transport flattening ANY thrown error to -32603;
    // the real reason only survives in `error.data.details`, which driver.ts's AcpRpcError does not
    // currently surface — see driver.ts's handleInbound). Without this flag, EVERY Bismuth chat
    // against openclaw on a machine with the MCP tools installed would fail its first turn exactly
    // like the session-key bug did. The real, load-bearing fix is in driver.ts's createSession
    // (checks this flag and sends `[]` for openclaw); this flag is the per-agent declaration driving
    // it. Consequence, stated plainly rather than hidden: openclaw chats get NO Bismuth MCP access
    // (no bismuth_cli/docs/memory tools) — openclaw's own docs point at a DIFFERENT mechanism for
    // this ("Configure MCP on the OpenClaw gateway or agent instead", the user's own openclaw
    // config), which Bismuth cannot drive per-session and does not attempt to.
    id: "openclaw",
    label: "OpenClaw",
    binary: "openclaw",
    args: ["acp"],
    sessionKeyArgs: (chatId) => ["--session", `agent:main:bismuth-${chatId}`],
    supportsSessionMcpServers: false,
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
