// The `docs` command group: the CLI twin of the MCP's bismuth_docs_{list,search,read} tools. Both
// surfaces call the same pure listDocs/searchDocs/readDoc (mcp/src/docs.ts), so a page found one
// way reads identically the other. List and read are headless; search asks a running core for the
// meaning side and keeps keyword results on this process's own docs root.
import { existsSync } from 'node:fs'
import { bismuthHome } from '../../../core/src/bismuthHome'
import { resolve } from 'node:path'
import type { CommandMap } from '../types'
import { flag, positionals, fail, out, optionalVault } from '../args'
import { listDocs, readDoc } from '../../../mcp/src/docs'
import { tryCall } from '../http'
import { coreFor } from '../semantic'
import { docsHybridSearch, type DocsHybridResult } from '../../../core/src/docsHybrid'
import { DOCS_WAIT_MS } from '../../../core/src/docsEmbed'

/** Where the docs live: BISMUTH_DOCS_DIR (the machine-wide install sets it), else the repo's docs/
 *  when this runs from source, else the installer's copy at ~/.bismuth/docs — a compiled binary's
 *  import.meta.dir is virtual, so the repo path simply does not exist there. */
function docsRoot(): string {
    if (process.env.BISMUTH_DOCS_DIR) return process.env.BISMUTH_DOCS_DIR
    const repoDocs = resolve(import.meta.dir, '../../../docs')
    return existsSync(repoDocs) ? repoDocs : bismuthHome('docs')
}

const isDocsHybrid = (v: unknown): v is DocsHybridResult =>
    !!v && Array.isArray((v as { hits?: unknown }).hits) && typeof (v as { mode?: unknown }).mode === 'string'

/** What `bismuth docs search` runs: keyword and meaning blended (core's `docsHybridSearch`). A reachable
 *  running core for the vault answers over POST /docs/search; otherwise the query runs in-process,
 *  which builds the docs index itself when the build can host the model. Every way the meaning side
 *  can be missing yields the keyword list with a `reason`; a core that answers with an error is not an
 *  absent one and fails. */
async function docsQuery(args: string[], query: string, limit: number): Promise<DocsHybridResult> {
    const vault = optionalVault(args)
    const base = vault ? coreFor(args, vault) : undefined
    const opts = { limit, vault, docsRoot: docsRoot() }
    if (base) {
        const r = await tryCall(base, 'POST', '/docs/search', { query, limit }, DOCS_WAIT_MS + 5000)
        if ('timeout' in r) return docsHybridSearch(query, { ...opts, keywordOnly: 'warming' })
        if ('error' in r) return fail(`POST /docs/search → ${r.error}: ${r.message || 'the running server failed the request'}`)
        if ('value' in r && isDocsHybrid(r.value)) {
            // The core answers from its own docs root (the installed copy when it runs from a build), so a
            // keyword answer is redone over this process's root; a blended one already ran on the core's index.
            if (r.value.mode === 'keyword') return docsHybridSearch(query, { ...opts, keywordOnly: r.value.reason ?? 'off' })
            return r.value
        }
    }
    return docsHybridSearch(query, { ...opts, build: true, waitMs: DOCS_WAIT_MS })
}

export const commands: CommandMap = {
    'docs list': {
        summary: 'List every Bismuth doc page as {path, title} (the index — start here)',
        usage: '[--pretty]',
        args: { flags: { pretty: 'bool' } },
        run: args => {
            out(listDocs(docsRoot()), args)
        },
    },
    'docs search': {
        summary: 'Search the docs: keyword and meaning blended when embeddings are on; prints ranked {path, heading, snippet} hits (snippets only, not pages)',
        usage: '<query…> [--limit <n>] [--vault <dir>] [--pretty]',
        args: { positionals: ['query'], flags: { limit: 'value', vault: 'value', api: 'value', pretty: 'bool' } },
        run: async args => {
            const query = positionals(args).join(' ')
            if (!query) fail('usage: bismuth docs search <query…> [--limit <n>]')
            const raw = flag(args, 'limit')
            const limit = raw === undefined ? undefined : Number(raw)
            if (limit !== undefined && !(Number.isFinite(limit) && limit > 0)) fail('--limit must be a positive number')
            const r = await docsQuery(args, query, limit ?? 8)
            if (r.mode === 'keyword' && r.reason) console.error(`meaning search unavailable (${r.reason}): keyword results only`)
            out(r.hits, args)
        },
    },
    'docs read': {
        summary: 'Print one doc page raw, or a single ## section of it',
        usage: '<path> [--section <heading>]',
        args: { positionals: ['path'], flags: { section: 'value' } },
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
