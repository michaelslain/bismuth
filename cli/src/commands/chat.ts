// The `chat` command group: read the owner's own Bismuth chat history (terminal + in-app
// sessions) from the shell. Wraps three OWNER-GATED server routes (core/src/server.ts's
// GET /chat/sessions, GET /chat/session-messages, POST /chat/search) — all three blanket-
// refuse (403) any request whose channel isn't "owner", because a past transcript has no
// single vault path to filter visibility against (see those routes' own comments in
// server.ts) — there is no "safe partial" response to fall back to for a non-owner caller,
// unlike a row/search-hit list. Before this group existed, cli/src/http.ts's call() never
// sent X-Bismuth-Token, so the CLI could never present as "owner" and this content was
// completely unreachable outside the app's own History picker UI.
//
// SECURITY — read before touching this file:
//
// This does NOT widen who can reach chat history. It gives the CLI a valid identity — the
// SAME one the app's own frontend already carries via window.__BISMUTH_OWNER_TOKEN__ — so the
// vault's owner, running `bismuth chat …` at their own shell, gets what they already have a
// legitimate claim to. core/src/server.ts's `requestChannel(req) !== "owner"` checks are
// UNCHANGED by this file.
//
// The agent path stays gated at the CLI-dispatch layer: `chat` is deliberately NOT added to
// core/src/visibilityCliGate.ts's ALWAYS_SAFE_COMMANDS or PATH_SCOPED_COMMANDS, so it falls
// through to the refuse-when-restricted tail (Tier C) alongside `search`/`rows`/`base`/
// `export`/`api` — a restricted vault refuses any `chat` invocation under an agent channel
// (BISMUTH_AGENT_CHANNEL=chat|daemon) before it ever reaches the network (see
// core/test/visibilityCliGate.test.ts).
//
// BUT — and this is the part that must not be mistaken for more than it is — that gate is
// keyed on the VAULT'S restricted-path list (core/src/visibility.ts). A vault that restricts
// NOTHING gives the Tier-C check nothing to refuse, at which point cli/src/http.ts's call()
// will still attach whatever owner token it can read, REGARDLESS of BISMUTH_AGENT_CHANNEL —
// ownerTokenFor() looks the token up by matching the target PORT against the run registry, not
// by checking who is asking. The separation between "the owner at a shell" and "an agent" is
// BISMUTH_AGENT_CHANNEL — an ENVIRONMENT VARIABLE Bismuth stamps whenever IT spawns an agent,
// not a cryptographic boundary; a process that can set/unset its own env can defeat it, same
// as every other Tier-C command already accepts. The 0600 mode on
// ~/.bismuth/run/<vault>.json (runRegistry.ts) stops other USERS of the machine from reading
// the token, not the owner's own unsandboxed processes. The actual hard stop for a
// Bismuth-spawned agent is the OS-sandbox deny-read on that exact path
// (core/src/ownerToken.ts's ownerTokenDenyPath, wired with failIfUnavailable: true into every
// agent spawn) — that is what makes the token unreadable to a sandboxed agent's Bash tool in
// the first place, not this file and not the CLI's env-var gate.
import type { CommandMap } from '../types'
import { flag, positionals, fail, out } from '../args'
import { call } from '../http'
import { resolveCore } from './app'

/** Wording shown when no running core is reachable at `base`. */
const unreachable = (base: string) =>
    `could not reach a running Bismuth server at ${base} — chat history needs a running server (\`bismuth serve\`, or the app) — pass --api <url> or start one`

/** Build a "?a=..&b=.." query string, dropping undefined values. */
function qs(params: Record<string, string | undefined>): string {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params))
        if (v !== undefined) sp.set(k, v)
    const s = sp.toString()
    return s ? `?${s}` : ''
}

export const commands: CommandMap = {
    'chat list': {
        summary:
            'List past chat sessions (terminal + in-app), owner-only (requires a running server + the owner token)',
        usage: '[--scope user|daemon|all] [--api <url>]',
        run: async args => {
            const scope = flag(args, 'scope')
            out(
                await call(
                    resolveCore(args),
                    'GET',
                    `/chat/sessions${qs({ scope })}`,
                    undefined,
                    unreachable,
                ),
                args,
            )
        },
    },
    'chat read': {
        summary:
            "Replay one past session's messages by id, owner-only (requires a running server + the owner token)",
        usage: '<id> [--provider <p>] [--api <url>]',
        run: async args => {
            const [id] = positionals(args)
            if (!id) fail('usage: bismuth chat read <id> [--provider <p>]')
            const provider = flag(args, 'provider')
            out(
                await call(
                    resolveCore(args),
                    'GET',
                    `/chat/session-messages${qs({ id, provider })}`,
                    undefined,
                    unreachable,
                ),
                args,
            )
        },
    },
    'chat search': {
        summary:
            'Search past chat sessions by content, owner-only (requires a running server + the owner token)',
        usage: '<query> [--scope user|daemon|all] [--api <url>]',
        run: async args => {
            const [query] = positionals(args)
            if (!query)
                fail(
                    'usage: bismuth chat search <query> [--scope user|daemon|all]',
                )
            const scope = flag(args, 'scope')
            out(
                await call(
                    resolveCore(args),
                    'POST',
                    '/chat/search',
                    { query, scope },
                    unreachable,
                ),
                args,
            )
        },
    },
}
