# relay/ — Bismuth agent-graph plugin

A tiny Claude Code plugin that reports a terminal-tab Claude Code session — and its
subagents — to Bismuth's **in-app agent graph**. This is NOT a daemon and NOT the old
cross-machine `claude-communicate` relay (that standalone Bun/Tailscale system was
removed when it merged into Bismuth). The relay registry now lives **in core**
(`core/src/relay.ts`); this workspace is only the hook scripts that feed it.

## How it works

1. `core/src/terminal.ts` spawns each terminal tab's pty with per-backend shims (one shell
   function per entry defined by `relay/shim/zdotdir/.zshrc`, generated from
   `BISMUTH_SHIM_SPECS`; `shim/claude` as the non-zsh fallback for `claude` specifically,
   `shim/agent-shim` as its generic multi-call equivalent for other backends) — a bare
   `claude` runs `claude --plugin-dir <this dir>`, plus env: `CLAUDE_TERMINAL_ID` (the tab's
   pty id) and `CLAUDE_RELAY_URL` (this app's core server). So the plugin loads
   **per-session, only inside Bismuth terminals** — nothing is installed in `~/.claude`.
   Other agent-CLI backends (`core/src/agentBackends/catalog.ts`) whose `agentsGraph`
   capability is `"wrapper"` — no hook system of their own — are, when enabled
   (`WRAPPER_REPORTING_ENABLED` in `core/src/terminal.ts`, default OFF), routed through
   `bin/wrap.ts` instead: it runs the real binary with inherited stdio, forwards
   `SIGINT`/`SIGTERM`, and reports session start/end itself. Claude is never wrapped this
   way — it has real hooks (below) and needs none of it.
2. The hooks (`hooks/hooks.json`) fire and POST to core's `/relay/*` routes:
   - `SessionStart` → `bin/session-start-hook.ts` → `POST /relay/session` (register this
     terminal-tab session as a root node).
   - `UserPromptSubmit` → `bin/recall-hook.ts` → `POST /relay/session` (re-posting the same
     endpoint acts as a heartbeat; self-registers if SessionStart was missed, e.g. a resumed
     session — there is no separate `/relay/session/heartbeat` route).
   - `SubagentStart` → `bin/subagent-start-hook.ts` → `POST /relay/subagent/start` (add a
     child node under the spawning session).
   - `SubagentStop` → `bin/subagent-stop-hook.ts` → `POST /relay/subagent/stop`.
   - `SessionEnd` → `bin/session-end-hook.ts` → `POST /relay/session/end` (drop the
     session node when Claude exits, so it doesn't linger until the pane closes; skips
     `clear`/`compact`, which keep the terminal's Claude running).
3. `core/src/relay.ts` holds the registry (sessions + subagents), pruned when a terminal tab
   closes (`terminal.ts`'s `killSession` → `relay.ts`'s `prune`). The frontend "agents" graph
   that used to render it (you → session → subagent) was removed; nothing reads the registry
   today, but it — and these hooks — stay, since `core/src/chat.ts` shares its TTL constants
   and `core/src/agents.ts`'s `ChatAgentSession` type for its own, separate per-chat subagent
   tracking.

All hooks are **best-effort**: they no-op without `CLAUDE_TERMINAL_ID`, swallow every
error, and exit 0 within a budget so they never block the user's session
(`lib/report.ts`).

## Files

```
relay/
  .claude-plugin/plugin.json   # plugin manifest (no `commands` — there are no slash commands)
  .mcp.json                    # declares the bismuth MCP server (dev repo); loaded per-session with the plugin (see docs/mcp/overview.md)
  hooks/hooks.json             # SessionStart / UserPromptSubmit / SubagentStart / SubagentStop / SessionEnd
  bin/                         # the 5 hook scripts + wrap.ts (the generic wrapper-mode session reporter)
  lib/report.ts                # readHookInput + postRelay (best-effort) + runHook + gating — reused by wrap.ts too
  shim/claude                  # PATH shim: exec real claude --plugin-dir <relay> (unchanged, claude-only)
  shim/agent-shim               # generic multi-call PATH shim for other ("wrapper"-mode) backends
  shim/zdotdir/.zshrc           # defines one shell function per BISMUTH_SHIM_SPECS entry (claude + wrapper backends)
  test/wrap.test.ts             # exercises wrap.ts's signal-forwarding + exit-code fidelity + never-wrap-claude guard
  package.json tsconfig.json
```

## Confirmed hook payloads (claude v2.1.165)

- `SessionStart`: `{ session_id, cwd, source }` (matcher includes `resume` so
  `claude --resume`/`--continue` sessions register too).
- `SubagentStart`: `{ session_id (parent), agent_id, agent_type }`.
- `SubagentStop`: `{ agent_id, agent_type, last_assistant_message }`.
- `SessionEnd`: `{ session_id, cwd, reason }` (reason ∈ `clear`/`compact`/`logout`/`exit`/…;
  the hook ignores `clear`/`compact` since the terminal's Claude keeps running).

Subagents cannot spawn subagents, so the tree is exactly 2 levels deep.
