// Search + replace command group for the `bismuth` CLI.
// Wraps core's searchVault (ranked full-text search) and replaceInVault
// (vault-wide find-and-replace). Mutating commands call core directly — the
// app's file watcher picks up the writes live.
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, bool, fail, flag, out, positionals, requireVault } from '../args'
import { hybridQuery, type SearchHit } from '../semantic'
import { searchVault, type SearchOpts } from '../../../core/src/search'
import { replaceInVault } from '../../../core/src/replace'
import { readNote } from '../../../core/src/files'
import { readSettings } from '../../../core/src/settings'
import { buildDenyPaths } from '../../../core/src/visibility'
import { commitVault, snapshotMessage } from '../../../core/src/backup'
import {
    agentDenyEntries,
    filterByPath,
    isDeniedPath,
} from '../../../core/src/visibilityFilter'

/** Build SearchOpts from the shared --regex/--case/--word boolean flags. */
function buildOpts(args: string[]): SearchOpts {
    return {
        regex: bool(args, 'regex'),
        caseSensitive: bool(args, 'case'),
        wholeWord: bool(args, 'word'),
    }
}

/** The left column of a search line: a note's path as is, `a.pdf p.4`, `a.png (image)`, or
 *  `chat <date> <session-id>`. */
export function semanticLabel(h: SearchHit): string {
    if (h.kind === 'chat') return `chat ${h.date ?? ''} ${h.session ?? ''}`.replace(/ {2,}/g, ' ').trim()
    if (h.kind === 'pdf') return h.page ? `${h.path} p.${h.page}` : h.path
    if (h.kind === 'image') return `${h.path} (image)`
    return h.path
}

/** Every literal occurrence of `query` in `text` (case-folded unless `caseSensitive`). */
export function literalMatches(
    text: string,
    query: string,
    caseSensitive: boolean,
): { from: number; to: number }[] {
    if (!query) return []
    const hay = caseSensitive ? text : text.toLowerCase()
    const needle = caseSensitive ? query : query.toLowerCase()
    if (hay.length !== text.length) return [] // a case fold that changed length cannot map back
    const out: { from: number; to: number }[] = []
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
        out.push({ from: i, to: i + needle.length })
    }
    return out
}

/** `line:col` (1-based) of offset `at`, and that line's text. */
function lineOf(text: string, at: number): { line: number; col: number; text: string } {
    const start = text.lastIndexOf('\n', at - 1) + 1
    let end = text.indexOf('\n', at)
    if (end < 0) end = text.length
    let line = 1
    for (let i = 0; i < start; i++) if (text[i] === '\n') line++
    return { line, col: at - start + 1, text: text.slice(start, end) }
}

export const commands: CommandMap = {
    find: {
        summary:
            'Find a query in one note: literal matches, or the passages ai picks when none match (--ai asks ai at once, --ask answers it as a question)',
        usage: '<path> <query> [--ai] [--ask] [--case] [--json]',
        run: async args => {
            const vault = requireVault(args)
            const [path, query] = positionals(args, [...BOOLEAN_FLAGS, 'ai', 'ask', 'json'])
            if (!path || !query) fail('usage: bismuth find <path> <query> [--ai] [--ask] [--case] [--json]')
            if (isDeniedPath(await agentDenyEntries(vault), path)) fail(`${path}: not found`)
            const text = await readNote(vault, path)
            const ask = bool(args, 'ask')
            let ai = ask || bool(args, 'ai')
            let matches = ai ? [] : literalMatches(text, query, bool(args, 'case'))
            let answer: string | undefined
            if (!matches.length) {
                // the same gate as POST /find-ai: a note hidden from ai never reaches a backend
                if (isDeniedPath(await buildDenyPaths(vault, 'chat'), path)) fail(`${path} is hidden from ai`)
                const chatProvider = ((await readSettings(vault))?.data?.chat as { provider?: unknown } | undefined)
                    ?.provider
                const { findAi, findAiNoun } = await import('../../../core/src/findAi')
                const r = await findAi({ query, text, ask, chatProvider, noun: findAiNoun(path) })
                matches = r.matches
                answer = r.answer
                ai = true
            }
            const rows = matches.map(m => ({ ...m, ...lineOf(text, m.from), match: text.slice(m.from, m.to), ai }))
            if (bool(args, 'json')) return out(ask ? { answer, passages: rows } : rows, args)
            if (answer !== undefined) console.log(answer + (rows.length ? '\n' : ''))
            if (!rows.length) {
                if (!ask) console.error(ai ? 'ai found nothing' : 'no results')
                return
            }
            for (const r of rows) console.log(`${r.line}:${r.col}  ${r.ai ? 'ai  ' : ''}${r.text}`)
        },
    },
    search: {
        summary: 'Search the vault for a query: keyword and meaning blended when embeddings are on',
        usage: '<query> [--limit n] [--json] [--regex] [--case] [--word]',
        run: async args => {
            const vault = requireVault(args)
            const literal = bool(args, 'regex') || bool(args, 'case') || bool(args, 'word')
            // `--semantic` is accepted and ignored: older agent prompts still pass it.
            const [query] = positionals(args, [...BOOLEAN_FLAGS, 'semantic', 'json'])
            // Fail closed: agentDenyEntries throws when visibility cannot be determined, and that
            // propagates so the CLI exits non-zero. [] is the owner.
            const entries = await agentDenyEntries(vault)
            if (!literal) {
                if (!query) fail('usage: bismuth search <query> [--limit n] [--json]')
                const limit = Number(flag(args, 'limit') ?? 10)
                if (!Number.isInteger(limit) || limit < 1) fail('--limit must be a positive whole number')
                const r = await hybridQuery(args, vault, query, entries, limit)
                if (r.mode === 'keyword' && r.reason)
                    console.error(`meaning search unavailable (${r.reason}): keyword results only`)
                if (bool(args, 'json')) return out(r.hits, args)
                for (const h of r.hits) console.log(`${semanticLabel(h)}  ${h.score.toFixed(3)}  ${h.excerpt}`)
                return
            }
            const results = await searchVault(
                vault,
                query ?? '',
                buildOpts(args),
            )
            // searchVault returns every match (no cap) and the index is shared with the server
            // across channels, so the filter belongs on its result, before anything else
            // (sorting, limiting) a caller might add.
            out(
                filterByPath(results, entries, h => h.path),
                args,
            )
        },
    },
    replace: {
        summary:
            'Replace a query with a replacement across the vault (or one note with --scope)',
        usage: '<query> <replacement> [--scope <path>] [--no-snapshot] [--regex] [--case] [--word]',
        run: async args => {
            const vault = requireVault(args)
            const [query, replacement] = positionals(args)
            const scope = flag(args, 'scope') ?? 'vault'
            // Before the snapshot, so an undeterminable vault fails before anything is written.
            const entries = await agentDenyEntries(vault)
            if (!bool(args, 'no-snapshot')) {
                // Best-effort, matching POST /replace's pre-replace snapshot: a vault that isn't a git
                // repo yet (or any other git failure) must not block the replace itself.
                try {
                    await commitVault(vault, snapshotMessage())
                } catch (e) {
                    console.error(
                        `warning: snapshot failed, proceeding without an undo point: ${(e as Error).message}`,
                    )
                }
            }
            const result = await replaceInVault(
                vault,
                query ?? '',
                replacement ?? '',
                buildOpts(args),
                scope,
                // An agent never rewrites (or names in the report) a restricted note.
                entries.length > 0
                    ? { skip: rel => isDeniedPath(entries, rel) }
                    : undefined,
            )
            out(result, args)
        },
    },
}
