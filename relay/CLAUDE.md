# relay/ — Bismuth agent-graph plugin

A tiny Claude Code plugin that reports a terminal-tab Claude Code session — and its
subagents — to Bismuth's **in-app agent graph**. This is NOT a daemon and NOT the old
cross-machine `claude-communicate` relay (that standalone Bun/Tailscale system was
removed when it merged into Bismuth). The relay registry now lives **in core**
(`core/src/relay.ts`); this workspace is only the hook scripts that feed it.

## How it works

1. `core/src/terminal.ts` spawns each terminal tab's pty with a PATH shim
   (`shim/claude`) that makes a bare `claude` run `claude --plugin-dir <this dir>`, plus
   env: `CLAUDE_TERMINAL_ID` (the tab's pty id) and `CLAUDE_RELAY_URL` (this app's core
   server). So the plugin loads **per-session, only inside Bismuth terminals** — nothing
   is installed in `~/.claude`.
2. The hooks (`hooks/hooks.json`) fire and POST to core's `/relay/*` routes:
   - `SessionStart` → `bin/session-start-hook.ts` → `POST /relay/session` (register this
     terminal-tab session as a root node).
   - `UserPromptSubmit` → `bin/recall-hook.ts` → `POST /relay/session/heartbeat` (keep it
     awake; self-registers if SessionStart was missed, e.g. a resumed session).
   - `SubagentStart` → `bin/subagent-start-hook.ts` → `POST /relay/subagent/start` (add a
     child node under the spawning session).
   - `SubagentStop` → `bin/subagent-stop-hook.ts` → `POST /relay/subagent/stop`.
3. `core/src/agents.ts` builds the graph from the registry; the frontend draws
   you → session → subagent (`app/src/graph/youNode.ts` `withYouAgents`).

All hooks are **best-effort**: they no-op without `CLAUDE_TERMINAL_ID`, swallow every
error, and exit 0 within a budget so they never block the user's session
(`lib/report.ts`).

## Files

```
relay/
  .claude-plugin/plugin.json   # plugin manifest (no `commands` — there are no slash commands)
  hooks/hooks.json             # SessionStart / UserPromptSubmit / SubagentStart / SubagentStop
  bin/                         # the 4 hook scripts (the only live code)
  lib/report.ts                # readHookInput + postRelay (best-effort) + runHook + gating
  shim/claude                  # PATH shim: exec real claude --plugin-dir <relay>
  package.json tsconfig.json
```

## Confirmed hook payloads (claude v2.1.165)

- `SessionStart`: `{ session_id, cwd, source }` (matcher includes `resume` so
  `claude --resume`/`--continue` sessions register too).
- `SubagentStart`: `{ session_id (parent), agent_id, agent_type }`.
- `SubagentStop`: `{ agent_id, agent_type, last_assistant_message }`.

Subagents cannot spawn subagents, so the tree is exactly 2 levels deep.
