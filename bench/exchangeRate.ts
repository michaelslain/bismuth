// Measure the exchange rate between a saved fetch and an injected item, from the user's own logs.
//   bun bench/exchangeRate.ts --vault <dir> --replay <replay dir> [--logs <claude project dir>] [--out <file>]
// lambda = (tokens one fetch of a labelled item costs the agent) / (tokens one injected item costs),
// i.e. how many injected items one saved fetch pays for. The logs and the vault are only read.
//   chars/token the median over tool results of 500+ characters of (characters / new input tokens the next
//               assistant message reports, less the previous message's output tokens)
//   fetch cost  per labelled fetch (a tool call whose input names a vault file or docs page): its result's
//               characters over chars/token (a result with no text: the turn's measured new tokens), plus
//               the call's own characters over chars/token, plus the turn it took: the mean output tokens
//               of an assistant message in the same logs, shared among the labelled calls of that message
//   item cost   the characters of a source entry as `packSources` renders it, over chars/token
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Glob } from 'bun'
import { encodeProjectDir } from '../memory/src/sessionHistory'
import { packSources } from '../core/src/sourcePack'
import type { SourceHit } from '../core/src/semanticSources'
import { labelsOfToolUse } from './recallReplayCases'

/** How many injected items one saved fetch pays for. */
export const exchangeRate = (fetchTokens: number, itemTokens: number): number => (itemTokens > 0 ? fetchTokens / itemTokens : Number.NaN)

/** The characters of one source entry as `packSources` renders it: its `- ` line, without the lead line and heading the block shares. */
export const entryChars = (hit: SourceHit, vault: string): number =>
    (packSources([hit], 'prompt', 1e9, vault).text ?? '').split('\n').filter(l => l.startsWith('- ')).join('\n').length

type Usage = { output_tokens?: number; input_tokens?: number; cache_creation_input_tokens?: number }
type Block = { type?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown }
type Entry = { type?: string; isSidechain?: boolean; message?: { id?: string; usage?: Usage; content?: unknown } }

const resultChars = (c: unknown): number => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((a: number, b: { text?: string }) => a + (typeof b?.text === 'string' ? b.text.length : 0), 0) : 0)

export type FetchSample = { tokens: number; callTokens: number; turnShare: number }

/** One session log's assistant turns (main thread, one per message id) and its labelled fetches. */
export function sessionFetches(text: string, vault: string, files: ReadonlySet<string>) {
    const entries: Entry[] = []
    for (const l of text.split('\n'))
        if (l)
            try {
                entries.push(JSON.parse(l))
            } catch {}
    const main = entries.filter(e => !e.isSidechain)
    const turnOut = new Map<string, number>()
    for (const e of main) if (e.type === 'assistant' && e.message?.id) turnOut.set(e.message.id, e.message.usage?.output_tokens ?? 0)
    const samples: { callChars: number; resultChars: number; turnResultTokens: number; turnResultChars: number; shareOfTurn: number; callsInTurn: number }[] = []
    const ratio: { chars: number; tokens: number }[] = []
    const seen = new Set<string>()
    for (let i = 0; i < main.length; i++) {
        const a = main[i]!
        if (a.type !== 'assistant' || !a.message?.id) continue
        if (main[i - 1]?.type === 'assistant' && main[i - 1]!.message?.id === a.message.id) continue
        // the whole message: its content blocks are spread over consecutive entries with one id
        const blocks: Block[] = []
        let j = i
        while (main[j]?.type === 'assistant' && main[j]!.message?.id === a.message.id) {
            const c = main[j]!.message!.content
            if (Array.isArray(c)) blocks.push(...(c as Block[]))
            j++
        }
        const uses = blocks.filter(b => b.type === 'tool_use' && b.id)
        if (!uses.length) continue
        // the user entry carrying the results, then the next assistant message
        const resultsEntry = main[j]
        const next = main.slice(j).find(e => e.type === 'assistant' && e.message?.id && e.message.id !== a.message!.id)
        const rc = resultsEntry?.type === 'user' && Array.isArray(resultsEntry.message?.content) ? (resultsEntry.message!.content as Block[]) : []
        const charsOf = new Map(rc.filter(b => b.type === 'tool_result' && b.tool_use_id).map(b => [b.tool_use_id!, resultChars(b.content)]))
        const totalChars = [...charsOf.values()].reduce((x, y) => x + y, 0)
        const u = next?.message?.usage
        const newTokens = u ? (u.cache_creation_input_tokens ?? 0) + (u.input_tokens ?? 0) - (turnOut.get(a.message.id) ?? 0) : NaN
        const usable = Number.isFinite(newTokens) && newTokens > 0 && totalChars > 0
        if (usable && uses.length === 1) ratio.push({ chars: totalChars, tokens: newTokens })
        const labelled = uses.filter(b => labelsOfToolUse(b, vault, files).length > 0)
        for (const b of labelled) {
            const labels = labelsOfToolUse(b, vault, files).filter(l => !seen.has(l))
            if (!labels.length) continue
            labels.forEach(l => seen.add(l))
            samples.push({
                callChars: JSON.stringify(b.input ?? {}).length,
                resultChars: charsOf.get(b.id!) ?? 0,
                turnResultTokens: usable ? newTokens : Number.NaN,
                turnResultChars: totalChars,
                shareOfTurn: 1 / labelled.length,
                callsInTurn: labelled.length,
            })
        }
    }
    return { samples, ratio, turns: [...turnOut.values()] }
}

if (import.meta.main) {
    const argv = process.argv.slice(2)
    const flag = (n: string) => {
        const i = argv.indexOf(n)
        return i >= 0 ? argv[i + 1] : undefined
    }
    const vaultArg = flag('--vault')
    const replay = flag('--replay')
    if (!vaultArg || !replay) {
        console.error('usage: bun bench/exchangeRate.ts --vault <dir> --replay <replay dir> [--logs <dir>] [--out <file>]')
        process.exit(2)
    }
    const vault = resolve(vaultArg)
    const logs = flag('--logs') ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects', encodeProjectDir(vault))
    const files = new Set<string>()
    for (const g of ['**/*.md', '**/*.pdf', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp'])
        for (const f of new Glob(g).scanSync({ cwd: vault, dot: false })) files.add(f)

    const fetches: ReturnType<typeof sessionFetches>['samples'] = []
    const ratio: { chars: number; tokens: number }[] = []
    const turns: number[] = []
    for (const name of readdirSync(logs).filter(f => f.endsWith('.jsonl'))) {
        const s = sessionFetches(readFileSync(join(logs, name), 'utf8'), vault, files)
        fetches.push(...s.samples)
        ratio.push(...s.ratio)
        turns.push(...s.turns)
    }
    // median of per-result characters per token over text results of at least 500 characters: robust to the
    // turns whose usage also carries a cache refill or an image
    const ratios = ratio.filter(r => r.chars >= 500).map(r => r.chars / r.tokens).sort((a, b) => a - b)
    const charsPerToken = ratios[Math.floor(ratios.length / 2)]!
    const meanTurn = turns.reduce((a, b) => a + b, 0) / turns.length
    // result tokens: the turn's measured new tokens shared by characters; where the turn has no usable
    // measurement, the result's characters over the logs' characters per token
    const perFetch = fetches.map(f => {
        // a text result is its characters over the median characters per token; a result with no text (an
        // image or a PDF page read as a block) is the turn's measured new tokens
        const result = f.resultChars > 0 ? f.resultChars / charsPerToken : Number.isFinite(f.turnResultTokens) ? f.turnResultTokens * f.shareOfTurn : 0
        const call = f.callChars / charsPerToken
        const turn = (meanTurn * f.shareOfTurn)
        return { result, call, turn, total: result + call + turn }
    })
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
    const fetchTokens = mean(perFetch.map(p => p.total))

    // an injected item: a source entry as recall renders it, over the replay's candidates
    const cases = readFileSync(join(resolve(replay), 'cases.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { candItems: { key: string; text: string }[] })
    const itemChars: number[] = []
    const byKind: Record<string, number[]> = {}
    for (const c of cases)
        for (const it of c.candItems) {
            const kind = it.key.slice(0, it.key.indexOf(':'))
            const id = it.key.slice(kind.length + 1)
            const nl = it.text.indexOf('\n')
            const hit = { kind, id, score: 0, excerpt: kind === 'docs' || nl < 0 ? it.text : it.text.slice(nl + 1), title: kind === 'docs' || kind === 'note' ? it.text.slice(0, nl < 0 ? it.text.length : nl) : undefined, hash: '' } as unknown as SourceHit
            const len = entryChars(hit, vault)
            itemChars.push(len)
            ;(byKind[kind] ??= []).push(len)
        }
    const itemTokens = mean(itemChars) / charsPerToken
    const result = {
        labelledFetches: fetches.length,
        assistantTurns: turns.length,
        charsPerToken,
        meanOutputTokensPerTurn: meanTurn,
        fetch: { resultTokens: mean(perFetch.map(p => p.result)), callTokens: mean(perFetch.map(p => p.call)), turnTokens: mean(perFetch.map(p => p.turn)), total: fetchTokens },
        item: { candidates: itemChars.length, meanChars: mean(itemChars), tokens: itemTokens, meanCharsByKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, mean(v)])) },
        lambda: exchangeRate(fetchTokens, itemTokens),
        // sensitivity: the same fetch without the turn share, and with the median result
        lambdaWithoutTurn: exchangeRate(mean(perFetch.map(p => p.result + p.call)), itemTokens),
        medianFetchTokens: [...perFetch.map(p => p.total)].sort((a, b) => a - b)[Math.floor(perFetch.length / 2)],
    }
    console.log(JSON.stringify(result, null, 2))
    const outFile = flag('--out')
    if (outFile) writeFileSync(resolve(outFile), JSON.stringify(result, null, 2) + '\n')
    process.exit(0)
}
