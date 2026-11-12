// `bismuth summary build|show` (the note layer of the summary layers, core/src/noteSummaries.ts) and
// `bismuth ask` (an answer across digests and notes that walks those layers, core/src/askVault.ts).
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, bool, fail, flag, out, positionals, requireVault } from '../args'
import { hybridQuery } from '../semantic'
import { readNote } from '../../../core/src/files'
import { readSettings } from '../../../core/src/settings'
import { buildDenyPaths, isDeniedPath } from '../../../core/src/visibility'
import { agentDenyEntries } from '../../../core/src/visibilityFilter'
import { buildSummaries, hasSummaries, loadSummaries, summaryPaths } from '../../../core/src/noteSummaries'
import { askVault, gatherAskDocs } from '../../../core/src/askVault'
import { memoryDirFor } from '../../../mcp/src/memory'
import { resolveTier } from '../../../daemon/src/daemon/tier'

const chatProviderOf = async (vault: string): Promise<unknown> =>
    ((await readSettings(vault))?.data?.chat as { provider?: unknown } | undefined)?.provider

const BUILD_HINT = 'bismuth summary build'

export const commands: CommandMap = {
    'summary build': {
        summary:
            'Write a one-line summary and its passages for every note whose text changed since its last summary, on the chat provider (notes hidden from ai are skipped)',
        usage: '[--model <name> | --fast] [--limit n] [--jobs n] [--if-built] [--json]',
        args: {
            flags: {
                model: 'value',
                fast: 'bool',
                limit: 'value',
                jobs: 'value',
                'if-built': 'bool',
                json: 'bool',
                vault: 'value',
                pretty: 'bool',
            },
        },
        run: async args => {
            const vault = requireVault(args)
            // --if-built: the daemon's hourly refresh, a no-op until the owner built summaries once
            if (bool(args, 'if-built') && !hasSummaries(vault)) {
                if (bool(args, 'json')) return out({ skipped: 'not built' }, args)
                return console.log('no summaries built for this vault')
            }
            const jobsRaw = flag(args, 'jobs')
            const jobs = jobsRaw === undefined ? undefined : Number(jobsRaw)
            if (jobs !== undefined && (!Number.isInteger(jobs) || jobs < 1)) fail('--jobs must be a positive whole number')
            const limitRaw = flag(args, 'limit')
            const limit = limitRaw === undefined ? undefined : Number(limitRaw)
            if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) fail('--limit must be a positive whole number')
            const json = bool(args, 'json')
            const paths = await summaryPaths(vault)
            const model = flag(args, 'model')
            const r = await buildSummaries({
                vault,
                paths,
                readText: p => readNote(vault, p),
                chatProvider: await chatProviderOf(vault),
                ...(model ? { model } : {}),
                // --fast: the chat provider's fast tier, as the daemon's crons name it
                ...(bool(args, 'fast') ? { modelFor: (b: string) => resolveTier(b, 'fast', {}).model } : {}),
                ...(limit !== undefined ? { limit } : {}),
                ...(jobs !== undefined ? { concurrency: jobs } : {}),
                onProgress: p => {
                    if (!json) process.stderr.write(`\r${p.done}/${p.total} summarised${p.failed ? `, ${p.failed} failed` : ''}`)
                },
            })
            if (json) return out(r, args)
            if (r.summarised || r.failed) process.stderr.write('\n')
            console.log(
                `${r.summarised} summarised, ${r.unchanged} unchanged${r.failed ? `, ${r.failed} failed (run again to retry)` : ''}${r.removed ? `, ${r.removed} removed` : ''} (${r.backend})`,
            )
        },
    },
    'summary show': {
        summary: "Print a note's summary and the passages it points to as path:line",
        usage: '<path> [--json]',
        args: { positionals: ['path'], flags: { json: 'bool', vault: 'value', pretty: 'bool' } },
        run: async args => {
            const vault = requireVault(args)
            const [path] = positionals(args, [...BOOLEAN_FLAGS, 'json'])
            if (!path) fail('usage: bismuth summary show <path> [--json]')
            if (isDeniedPath(await agentDenyEntries(vault), path)) fail(`${path}: not found`)
            const s = (await loadSummaries(vault)).get(path)
            if (!s) fail(`${path} has no summary yet: ${BUILD_HINT}`)
            let stale = false
            try {
                const { contentHash } = await import('../../../core/src/noteSummaries')
                stale = contentHash(await readNote(vault, path)) !== s.hash
            } catch {
                fail(`${path}: not found`)
            }
            if (bool(args, 'json')) return out({ ...s, stale }, args)
            console.log(s.summary)
            for (const p of s.points) console.log(`${path}:${p.line}  ${p.text}`)
            if (stale) console.error(`the note changed since this summary: ${BUILD_HINT}`)
        },
    },
    ask: {
        summary:
            'Answer a question that spans many notes or a stretch of time, from the digests, memory and notes it reaches, with the passages it rests on',
        usage: '<question> [--limit n] [--model <name>] [--json]',
        args: { positionals: ['question'], flags: { limit: 'value', model: 'value', json: 'bool', vault: 'value', pretty: 'bool', api: 'value' } },
        run: async args => {
            const vault = requireVault(args)
            const [question] = positionals(args, [...BOOLEAN_FLAGS, 'json'])
            if (!question) fail('usage: bismuth ask <question> [--limit n] [--json]')
            const limit = Number(flag(args, 'limit') ?? 10)
            if (!Number.isInteger(limit) || limit < 1) fail('--limit must be a positive whole number')
            const deny = await agentDenyEntries(vault)
            // the same gate as find --ask: a note hidden from ai never reaches a backend
            const aiDeny = await buildDenyPaths(vault, 'chat')
            const allowed = (p: string) => !isDeniedPath(deny, p) && !isDeniedPath(aiDeny, p)
            const hits = await hybridQuery(args, vault, question, deny, limit)
            const docs = await gatherAskDocs({
                vault,
                question,
                now: new Date(),
                memoryDir: memoryDirFor(vault),
                hits: hits.hits.filter(h => h.kind !== 'chat').map(h => h.path),
                allowed,
            })

            const model = flag(args, 'model')
            const r = await askVault({ question, docs, chatProvider: await chatProviderOf(vault), ...(model ? { model } : {}) })
            if (bool(args, 'json')) return out({ ...r, summariesBuilt: hasSummaries(vault) }, args)
            console.log(r.answer)
            if (r.sources.length) {
                console.log('\nsources')
                for (const s of r.sources) console.log(`${s.path}:${s.line}  ${s.text}`)
            }
            if (!hasSummaries(vault)) console.error(`\nsummaries not built: ${BUILD_HINT}`)
        },
    },
}
