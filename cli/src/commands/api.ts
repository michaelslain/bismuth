// Commands that reach a RUNNING bismuth server, for capabilities that live in the
// server process's memory and therefore can't be computed by a standalone CLI
// process: any route you want to hit directly (including the relay's in-memory
// registry, via `bismuth api POST /relay/...`). Everything else in the CLI works
// headlessly without a server; this doesn't. API base resolution is `resolveCore`
// (http.ts): --api <url> → BISMUTH_API → CLAUDE_RELAY_URL → the run registry → localhost:4321.
import type { CommandMap } from '../types'
import { flag, positionals, fail, out } from '../args'
import { call, resolveCore } from '../http'

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
