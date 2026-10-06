// The `docs` command group: the CLI twin of the MCP's bismuth_docs_{list,search,read} tools. Both
// surfaces call the same pure listDocs/searchDocs/readDoc (mcp/src/docs.ts), so a page found one
// way reads identically the other. Headless — no vault, no server.
import { existsSync } from 'node:fs'
import { bismuthHome } from '../../../core/src/bismuthHome'
import { resolve } from 'node:path'
import type { CommandMap } from '../types'
import { flag, positionals, fail, out } from '../args'
import { listDocs, searchDocs, readDoc } from '../../../mcp/src/docs'

/** Where the docs live: BISMUTH_DOCS_DIR (the machine-wide install sets it), else the repo's docs/
 *  when this runs from source, else the installer's copy at ~/.bismuth/docs — a compiled binary's
 *  import.meta.dir is virtual, so the repo path simply does not exist there. */
function docsRoot(): string {
    if (process.env.BISMUTH_DOCS_DIR) return process.env.BISMUTH_DOCS_DIR
    const repoDocs = resolve(import.meta.dir, '../../../docs')
    return existsSync(repoDocs) ? repoDocs : bismuthHome('docs')
}

export const commands: CommandMap = {
    'docs list': {
        summary: 'List every Bismuth doc page as {path, title} (the index — start here)',
        usage: '[--pretty]',
        run: args => {
            out(listDocs(docsRoot()), args)
        },
    },
    'docs search': {
        summary: 'Search the docs; prints ranked {path, heading, snippet} hits (snippets only, not pages)',
        usage: '<query…> [--limit <n>] [--pretty]',
        run: args => {
            const query = positionals(args).join(' ')
            if (!query) fail('usage: bismuth docs search <query…> [--limit <n>]')
            const raw = flag(args, 'limit')
            const limit = raw === undefined ? undefined : Number(raw)
            if (limit !== undefined && !(Number.isFinite(limit) && limit > 0)) fail('--limit must be a positive number')
            out(searchDocs(docsRoot(), query, limit), args)
        },
    },
    'docs read': {
        summary: 'Print one doc page raw, or a single ## section of it',
        usage: '<path> [--section <heading>]',
        run: args => {
            const [path] = positionals(args)
            if (!path) fail('usage: bismuth docs read <path> [--section <heading>]')
            try {
                out(readDoc(docsRoot(), path, flag(args, 'section')))
            } catch (e) {
                fail(e instanceof Error ? e.message : String(e))
            }
        },
    },
}
