// Public training corpus for the general embedder fine-tune: note-like text from Common Pile datasets
// whose rows are CC0, public domain or CC BY, so the tuned weights can ship. No vault text is read.
//   bun bench/embedCorpus.ts --out <dir> [--passages 10000] [--sources libretexts,arxiv_abstracts,oercommons] [--seed 7]
// bench/embedCorpus.py streams each dataset over HTTP (never a full download) in the venv at
// `BISMUTH_FT_VENV` (default `~/.cache/bismuth-finetune/venv`). Rows whose license fails `allowedLicense`
// are dropped here. Each kept document is cut the way the vault index cuts a note (`embedTexts`), passages
// under 200 characters and link or symbol soup are dropped, and at most 3 passages per document are kept.
// The passage target is split equally between sources; a source that runs out hands its shortfall to the
// others. Writes `<out>/chunks.jsonl` (ChunkRows read by `bench/finetuneEmbed.ts queries` and `train`) and
// `<out>/sources.json` (counts per source and license, plus the attribution list CC BY asks for).
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { embedTexts } from '../core/src/memoryEmbed'
import { fnv1a, foldOf, shuffled, type ChunkRow } from './finetuneEmbed'

export type CorpusDoc = { source: string; id: string; license: string; title: string; url?: string; text: string }
export type PublicChunkRow = ChunkRow & { source: string; license: string }
export type SourcesReport = {
    sources: { name: string; dataset: string; docs: number; passages: number; licenses: Record<string, number> }[]
    attribution: { source: string; title: string; url?: string; license: string }[]
}

const DATASETS: Record<string, string> = {
    libretexts: 'common-pile/libretexts',
    arxiv_abstracts: 'common-pile/arxiv_abstracts',
    oercommons: 'common-pile/oercommons',
}
// share of each shard's rows the streamer keeps; arxiv's 4 shards run in date order, so a sparse sample of each reaches four eras instead of one
const FRACTION: Record<string, number> = { arxiv_abstracts: 0.02 }
const MIN_CHARS = 200
const PER_DOC = 3

/** CC0, public domain and CC BY of any version pass; share-alike, non-commercial, no-derivatives,
 *  empty and unknown strings do not. Reads the SPDX-ish forms (`cc-by-4.0`) and the Common Pile's long
 *  forms (`Creative Commons - Attribution - https://…/licenses/by/4.0/`) alike. Pure. */
export function allowedLicense(raw: string): boolean {
    const s = raw.toLowerCase()
    const tokens = s.split(/[^a-z0-9]+/).filter(Boolean)
    const squashed = tokens.join('')
    if (tokens.some(t => t === 'sa' || t === 'nc' || t === 'nd' || t === 'nonderivative')) return false
    if (/sharealike|noncommercial|noderiv|nonderiv/.test(squashed)) return false
    if (/cc0|publicdomain|creativecommonszero/.test(squashed) || tokens.includes('pdm')) return true
    const i = tokens.indexOf('cc')
    if (i >= 0 && tokens[i + 1] === 'by') return true
    if (s.includes('/licenses/by/')) return true
    return tokens.includes('attribution')
}

/** A document's text without the page chrome the dumps carry (libretexts' `Last updated Save as PDF Page ID n`
 *  in its inline and bulleted forms, the site-nav strip). Pure. */
export function cleanText(text: string): string {
    return text
        .replace(/^[ \t]*-?[ \t]*(?:Last updated|Save as PDF)[ \t]*$/gim, '')
        .replace(/^[ \t]*-[ \t]*$/gm, '')
        .replace(/Last updated\s*Save as PDF(?:\s*Page ID\s*\d+)?/gi, ' ')
        .replace(/(?:Sign in to see your \w+\s*)+(?:Log in\b)?/gi, ' ')
        .replace(/Skip to main content|Search site|Submit Search|Download Page|Table of contents/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim()
}

/** Whether an embedded passage reads as prose a person might ask about: long enough, not a pile of links,
 *  mostly letters. Pure. */
export function usablePassage(text: string): boolean {
    if (text.length < MIN_CHARS) return false
    if (/Sign in to see your/i.test(text)) return false
    if ((text.match(/https?:\/\//g) ?? []).length > 2) return false
    const letters = (text.match(/[\p{L}\s]/gu) ?? []).length
    return letters / text.length >= 0.6
}


/** Up to 3 of a document's passages, cut by the vault index's own `embedTexts` on a note-shaped object
 *  (the title is the name, so each passage leads with it as a vault note's path does). Which three is a
 *  seeded shuffle, so a rerun keeps them. Pure for a given seed. */
export function docPassages(doc: CorpusDoc, seed: number): string[] {
    const note = { name: doc.title, content: cleanText(doc.text), backlinks: [], frontmatter: { type: 'fact', tags: [], created: '', updated: '', description: '' } }
    const all = embedTexts(note as never).map(t => t.trim()).filter(usablePassage)
    const picked = shuffled(
        all.map((t, i) => ({ t, i })),
        seed ^ fnv1a(`${doc.source}/${doc.id}`),
    ).slice(0, PER_DOC)
    return picked.sort((a, b) => a.i - b.i).map(p => p.t)
}

/** `passages` minus every text already in `seen`, which grows by the ones kept (repeats inside `passages` too). Pure
 *  apart from `seen`. */
export function dedupePassages(passages: string[], seen: Set<string>): string[] {
    const out: string[] = []
    for (const p of passages) {
        if (seen.has(p)) continue
        seen.add(p)
        out.push(p)
    }
    return out
}

/** `{source}/{id}` of a document seen before is skipped: records `doc` in `ids` and says whether it is new. Pure apart from `ids`. */
export function firstSight(doc: Pick<CorpusDoc, 'source' | 'id'>, ids: Set<string>): boolean {
    const k = `${doc.source}/${doc.id}`
    if (ids.has(k)) return false
    ids.add(k)
    return true
}

/** How many passages each source contributes: the target split equally, a source with fewer than its
 *  share giving the remainder to the rest, never more than a source has, the leftover of an uneven split
 *  going to the sources listed first. Pure. */
export function allocate(available: Record<string, number>, target: number): Record<string, number> {
    const names = Object.keys(available)
    const out: Record<string, number> = Object.fromEntries(names.map(n => [n, 0]))
    let left = Math.min(target, names.reduce((s, n) => s + available[n]!, 0))
    let open = names.filter(n => available[n]! > 0)
    while (left > 0 && open.length) {
        const each = Math.floor(left / open.length)
        const extra = left - each * open.length
        let given = 0
        open.forEach((n, i) => {
            const give = Math.min(available[n]! - out[n]!, each + (i < extra ? 1 : 0))
            out[n]! += give
            given += give
        })
        left -= given
        open = open.filter(n => out[n]! < available[n]!)
        if (!given) break
    }
    return out
}

/** ChunkRows for kept passages: `file` is `<source>/<doc id>`, `key` `pub:<file>`, `fold` the hash of the key. Pure. */
export function passageRows(items: { doc: Omit<CorpusDoc, 'text'>; texts: string[] }[]): PublicChunkRow[] {
    const rows: PublicChunkRow[] = []
    for (const { doc, texts } of items)
        for (const text of texts) {
            const file = `${doc.source}/${doc.id}`
            const key = `pub:${file}`
            rows.push({ id: rows.length, file, key, fold: foldOf(key), text, source: doc.source, license: doc.license })
        }
    return rows
}

// ---- the command line -----------------------------------------------------------------------------

type Kept = { doc: Omit<CorpusDoc, 'text'>; texts: string[] }

/** A streaming reader over one dataset: `next()` gives the next kept document, null once the data ends. */
function reader(name: string, seed: number, seenText: Set<string>) {
    const venv = process.env.BISMUTH_FT_VENV ?? join(homedir(), '.cache', 'bismuth-finetune', 'venv')
    const proc = Bun.spawn([join(venv, 'bin', 'python'), '-I', join(import.meta.dir, 'embedCorpus.py'), '--source', name, '--dataset', DATASETS[name]!, '--seed', String(seed), '--fraction', String(FRACTION[name] ?? 1)], { stdout: 'pipe', stderr: 'inherit' })
    const lines = (async function* () {
        const dec = new TextDecoder()
        let buf = ''
        for await (const chunk of proc.stdout) {
            buf += dec.decode(chunk, { stream: true })
            let nl: number
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl)
                buf = buf.slice(nl + 1)
                if (line) yield line
            }
        }
        // A reader that dies mid-stream must not read as the data ending.
        const code = await proc.exited
        if (code !== 0 && !killed) throw new Error(`embedCorpus.py --source ${name} exited ${code} after ${seen} documents`)
    })()
    let seen = 0
    let killed = false
    const ids = new Set<string>()
    return {
        kill: () => {
            killed = true
            proc.kill()
        },
        async next(): Promise<Kept | null> {
            for (;;) {
                const r = await lines.next()
                if (r.done) return null
                const doc = JSON.parse(r.value) as CorpusDoc
                seen++
                if (!allowedLicense(doc.license)) continue
                if (!firstSight(doc, ids)) continue
                const texts = dedupePassages(docPassages(doc, seed), seenText)
                if (!texts.length) continue
                const { text: _text, ...meta } = doc
                return { doc: meta, texts }
            }
        },
        get seen() {
            return seen
        },
    }
}

async function main() {
    const argv = process.argv.slice(2)
    const flag = (n: string) => {
        const i = argv.indexOf(n)
        return i >= 0 ? argv[i + 1] : undefined
    }
    const outArg = flag('--out')
    if (!outArg) {
        console.error('usage: bun bench/embedCorpus.ts --out <dir> [--passages 10000] [--sources a,b] [--seed 7]')
        process.exit(2)
    }
    const out = resolve(outArg)
    const target = Number(flag('--passages') ?? 10000)
    const seed = Number(flag('--seed') ?? 7)
    const names = (flag('--sources') ?? Object.keys(DATASETS).join(',')).split(',').map(s => s.trim()).filter(Boolean)
    for (const n of names) if (!DATASETS[n]) throw new Error(`unknown source ${n}; known: ${Object.keys(DATASETS).join(', ')}`)
    mkdirSync(out, { recursive: true, mode: 0o700 })

    const seenText = new Set<string>()
    const readers = new Map(names.map(n => [n, reader(n, seed, seenText)]))
    const kept: Record<string, Kept[]> = Object.fromEntries(names.map(n => [n, []]))
    const count = (n: string) => kept[n]!.reduce((s, k) => s + k.texts.length, 0)
    const done = new Set<string>()
    const pull = async (n: string) => {
        const k = await readers.get(n)!.next()
        if (k) kept[n]!.push(k)
        else done.add(n)
    }
    try {
        // first each source up to its equal share, then the sources with data left until the target is met
        const share = Math.ceil(target / names.length)
        await Promise.all(
            names.map(async n => {
                while (!done.has(n) && count(n) < share) await pull(n)
            }),
        )
        while (names.reduce((s, n) => s + count(n), 0) < target && done.size < names.length) {
            await Promise.all(names.filter(n => !done.has(n)).map(pull))
        }
    } finally {
        for (const r of readers.values()) r.kill()
    }

    const quota = allocate(Object.fromEntries(names.map(n => [n, count(n)])), target)
    const used: Kept[] = []
    for (const n of names) {
        let left = quota[n]!
        for (const k of kept[n]!) {
            if (left <= 0) break
            const texts = k.texts.slice(0, left)
            left -= texts.length
            used.push({ doc: k.doc, texts })
        }
    }
    const rows = passageRows(used)
    writeFileSync(join(out, 'chunks.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))
    const report: SourcesReport = {
        sources: names.map(name => {
            const mine = used.filter(u => u.doc.source === name)
            const licenses: Record<string, number> = {}
            for (const u of mine) licenses[u.doc.license] = (licenses[u.doc.license] ?? 0) + 1
            return { name, dataset: DATASETS[name]!, docs: mine.length, passages: mine.reduce((s, u) => s + u.texts.length, 0), licenses }
        }),
        attribution: used.map(u => ({ source: u.doc.source, title: u.doc.title, ...(u.doc.url ? { url: u.doc.url } : {}), license: u.doc.license })),
    }
    writeFileSync(join(out, 'sources.json'), JSON.stringify(report, null, 2) + '\n')
    for (const s of report.sources) console.log(`${s.name}: ${s.docs} docs, ${s.passages} passages (read ${readers.get(s.name)!.seen} rows) licenses ${JSON.stringify(s.licenses)}`)
    console.log(`${rows.length} passages -> ${join(out, 'chunks.jsonl')}`)
}

if (import.meta.main) {
    await main()
    process.exit(0)
}
