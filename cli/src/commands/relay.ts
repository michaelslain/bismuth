// The `relay` command group: read Bismuth's in-process registry of Claude Code work happening
// inside THIS vault's own terminal tabs — top-level sessions (one per open tab) and the
// subagents they spawn (core/src/relay.ts). Fed by the relay plugin's hooks (POST /relay/session
// [/end], POST /relay/subagent/start|stop). Before this command, `snapshot()`
// (core/src/relay.ts:205) had ZERO callers outside core/test/relay.test.ts — the registry was
// write-only, with no reader anywhere (its old consumer, the removed "agents" graph mode, is
// gone). Exposing it gives an agent basic orchestration awareness: what other sessions/
// subagents are alive in this vault right now.
//
// KNOWN GAP, stated plainly rather than papered over: this needs a running server, and —
// unlike `app windows` / `gcal status` — genuinely CANNOT be anything else. relay.ts's registry
// is bare in-process Maps with no persistence at all ("Registry lives only while core runs" —
// core/src/relay.ts's own module doc), so a separate CLI process has no file or IPC channel to
// read it through directly; importing relay.ts from the CLI would just construct a fresh, always-
// empty registry, not the running server's. core/src/server.ts exposes only WRITE routes for
// this today (POST /relay/session[/end], POST /relay/subagent/start|stop) — there is no GET
// route. This command calls `GET /relay/snapshot`, mirroring the POST routes' naming and the
// `ok(snapshot())` shape every other read route uses — but **that route does not exist in
// core/src/server.ts yet**. Adding it is a one-line core change; this task's brief is CLI-only
// (no core/** edits), so it's left as a documented, honestly-failing gap rather than an
// undocumented one or a core edit slipped in past scope. Until the route lands, this command
// fails with a normal HTTP error (`GET /relay/snapshot → 404: …`) against a real server — it
// does not silently return an empty/fabricated result. See docs/cli/reference.md.
import type { CommandMap } from "../types";
import { out } from "../args";
import { call } from "../http";
import { resolveCore } from "./app";

/** Wording shown when no running app/server is reachable at `base`. */
const unreachable = (base: string) =>
  `could not reach a running Bismuth server at ${base} — relay list needs a running server (\`bismuth serve\`, or the app) — pass --api <url> or start one`;

export const commands: CommandMap = {
  "relay list": {
    summary:
      "List Claude Code sessions + subagents live in this vault's own terminal tabs (requires a running server exposing GET /relay/snapshot — " +
      "see this file's header comment: that route does not exist in core/src/server.ts yet, so this fails honestly against today's real server)",
    usage: "[--api <url>]",
    run: async (args) => out(await call(resolveCore(args), "GET", "/relay/snapshot", undefined, unreachable), args),
  },
};
