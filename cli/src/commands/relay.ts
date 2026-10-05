// The `relay` command group: read Bismuth's in-process registry of Claude Code work happening
// inside THIS vault's own terminal tabs — top-level sessions (one per open tab) and the
// subagents they spawn (core/src/relay.ts). Fed by the relay plugin's hooks (POST /relay/session
// [/end], POST /relay/subagent/start|stop). Before this command, `snapshot()`
// (core/src/relay.ts:205) had ZERO callers outside core/test/relay.test.ts — the registry was
// write-only, with no reader anywhere (its old consumer, the removed "agents" graph mode, is
// gone). Exposing it gives an agent basic orchestration awareness: what other sessions/
// subagents are alive in this vault right now.
//
// This needs a running server, and — unlike `app windows` / `gcal status` — genuinely CANNOT be
// anything else. relay.ts's registry is bare in-process Maps with no persistence at all
// ("Registry lives only while core runs" — core/src/relay.ts's own module doc), so a separate CLI
// process has no file or IPC channel to read it through directly; importing relay.ts from the CLI
// would just construct a fresh, always-empty registry, not the running server's. This command
// calls `GET /relay/snapshot` (core/src/server.ts), mirroring the POST routes' naming and the
// `ok(snapshot())` shape every other read route uses. See docs/cli/reference.md.
import type { CommandMap } from '../types'
import { out } from '../args'
import { call, needsServer, resolveCore } from '../http'
import { agentChannel } from '../../../core/src/visibilityFilter'
import { redactSnapshot, type RelaySnapshot } from '../../../core/src/relay'

const unreachable = needsServer(
    'relay list needs a running server',
)

export const commands: CommandMap = {
    'relay list': {
        summary:
            "List Claude Code sessions + subagents live in this vault's own terminal tabs (requires a running server — " +
            "see this file's header comment for why this cannot be read from a separate CLI process)",
        usage: '[--api <url>]',
        run: async args => {
            const snap = (await call(
                resolveCore(args),
                'GET',
                '/relay/snapshot',
                undefined,
                unreachable,
            )) as RelaySnapshot
            // This CLI always carries the owner token (call() attaches it), so the server hands
            // it the raw snapshot, whose subagent `lastMessage` is free text that can quote
            // hidden notes. An agent gets the same bookkeeping-only projection a non-owner gets.
            out(agentChannel() ? redactSnapshot(snap) : snap, args)
        },
    },
}
