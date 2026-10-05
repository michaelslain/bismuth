// Commands that reach a RUNNING bismuth server, for capabilities that live in the
// server process's memory and therefore can't be computed by a standalone CLI
// process: any route you want to hit directly (including the relay's in-memory
// registry, via `bismuth api POST /relay/...`). Everything else in the CLI works
// headlessly without a server; this doesn't. API base resolution is `resolveCore`
// (http.ts): --api <url> → BISMUTH_API → CLAUDE_RELAY_URL → the run registry → localhost:4321.
import type { CommandMap } from '../types'
import { flag, positionals, fail, out } from '../args'
import { call, resolveCore } from '../http'
import { cliIsAgentHand, protectedPathHit } from '../../../core/src/visibilityCliGate'

/** The route fetch will actually request, so the agent refusal below tests what the server sees:
 *  dot segments (`./`, `a/../`, `%2e/`), backslashes (the URL parser reads them as `/`), query and
 *  fragment are resolved the way the request URL resolves them, and percent-encoding is decoded.
 *  Re-run until stable so a decoded `..` or a double-encoded `%252e` cannot hide a segment. */
export function apiRoute(path: string): string {
    let cur = path
    for (let i = 0; i < 10; i++) {
        const rest = cur.replace(/^[/\\]+/, '')
        let next = new URL('/' + rest, 'http://x').pathname
        try {
            next = decodeURIComponent(next)
        } catch {}
        if (next === cur) break
        cur = next
    }
    return cur.replace(/^[/\\]+/, '').toLowerCase()
}

export const commands: CommandMap = {
    api: {
        summary:
            'Call any server route directly (for in-memory/server-only capabilities)',
        usage: "<GET|POST|PUT> <path> [--json '<body>'] [--api <url>]",
        run: async args => {
            const [method, path] = positionals(args)
            if (!method || !path)
                fail(
                    "usage: bismuth api <GET|POST|PUT> <path> [--json '<body>']",
                )
            const isAgent = cliIsAgentHand()
            const route = apiRoute(path)
            if (isAgent && route.startsWith('status-bar/trust'))
                fail(
                    'refused: approving a status bar command is the user decision; ask them to click [ allow ] in the bar',
                )
            if (isAgent && /^doctor(\/|$)/.test(route))
                fail(
                    'refused: doctor repairs go through `bismuth doctor` (safe fixes only for agents); the owner applies the rest',
                )
            if (isAgent && protectedPathHit([path, apiRoute(path)]))
                fail(
                    'refused: rule files and process definitions are off-limits to AI sessions',
                )
            // After the specific refusals above, so their more precise messages win.
            if (isAgent && method.toUpperCase() !== 'GET')
                fail(
                    'refused: AI sessions may only GET through `bismuth api`; write files with the file commands',
                )
            const raw = flag(args, 'json')
            let body: unknown
            if (raw !== undefined) {
                try {
                    body = JSON.parse(raw)
                } catch {
                    fail(`--json is not valid JSON: ${raw}`)
                }
            }
            out(
                await call(resolveCore(args), method.toUpperCase(), path, body),
                args,
            )
        },
    },
}
