// Embedder fine-tune on one vault: does training the default embedder on questions about the vault's own
// chunks put the files an agent went and fetched nearer the top? Train and test are split by document:
// every vault file falls in fold a or b by a hash of its path, the model for fold a trains only on
// chunks of fold b's files, and a replay case is scored only by the model that never saw its labels.
//   bun bench/finetuneEmbed.ts chunks  --vault <dir> --out <dir> [--chunks 4000] [--per-file 3]
//   bun bench/finetuneEmbed.ts queries --out <dir> [--batch 16] [--jobs 4]
//   bun bench/finetuneEmbed.ts train   --out <dir> --name <name> --fold a|b|none|general [--epochs 1] [--lr 2e-5] [--fp32]
//   general: [--lr 1e-5] [--scale 50] [--batch 32] [--negatives 1] [--merge 0.3,0.5,0.7] [--beir scifact,nfcorpus,fiqa,arguana] [--beir-limit n]
//   bun bench/finetuneEmbed.ts merge   --base <pools dir> --a <pools dir> --b <pools dir> --out <dir>
//   bun bench/finetuneEmbed.ts recall  --base <dir> --a <dir> --b <dir>
// `chunks` samples the texts the vault index embeds (`embedTexts`), never from a file the daemon may not
// read (hidden or chat-only), and writes `<out>/chunks.jsonl`. `queries` asks Claude Haiku for three
// queries per chunk (a chat message to an assistant, a question, keywords) into `<out>/queries.jsonl`,
// resumable. `train` runs bench/finetuneEmbed.py in the venv at `BISMUTH_FT_VENV` (default
// `~/.cache/bismuth-finetune/venv`): `general` trains on every chunk whose document is not one of the 1-in-10
// `heldOutDoc` ones (public text from `embedCorpus.ts`), with a mined hard negative per pair, exports `<name>`,
// `<name>-m<α×100>` per merge and `<name>-base`, and writes `<out>/train-<name>/eval.json` (held-out MRR@10 and
// BEIR nDCG@10, scored on the exported int8 ONNX). Fold a trains on fold b's chunks, `none` exports the default model
// untouched through the same ONNX export and quantization, so the base differs from a variant only by
// training. The export lands at `~/.bismuth/models/bismuth-ft/<name>`, which `BISMUTH_EMBED_MODEL=ft:<name>`
// loads, so `bench/searchReplay.ts pools --embed ft:<name>` builds its pools. `merge` keeps the cases whose
// labels all sit in one fold and writes `<out>/base/pools.jsonl` and `<out>/tuned/pools.jsonl`, each case's
// tuned row taken from the model of its labels' fold; `searchReplay.ts score --base <out>/base --variant
// <out>/tuned` then reports the held-out difference. `recall` does the same for three
// `bench/recallReplay.ts --out` runs (each with `BISMUTH_EMBED_MODEL=ft:<name>`): did recall inject a label,
// and was one in the sources' raw top 10, with 95% intervals over sessions. `--out` holds vault text, so keep it out of the repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileKey } from './recallReplayCases'
import { pairedDiff, readJsonl, type SearchPool } from './searchReplay'

export type Fold = 'a' | 'b'
export type ChunkRow = { id: number; file: string; key: string; fold: Fold; text: string; source?: string; license?: string }
export type QueryRow = { id: number; ask: string; question: string; keywords: string }

/** The fold of a vault file's label key (`note:x.md`, `pdf:y.pdf`): FNV-1a of the key, low bit. Pure. */
export function foldOf(key: string): Fold {
    return fnv1a(key) & 1 ? 'b' : 'a'
}

export function fnv1a(key: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0
    return h
}

/** True for the 1-in-10 of documents held out of a general run: FNV-1a of the key mod 10 === 0. Pure. */
export function heldOutDoc(key: string): boolean {
    return fnv1a(key) % 10 === 0
}

/** The one fold every label sits in, or null when the labels span both. Pure. */
export function caseFold(labels: readonly string[]): Fold | null {
    const fs = new Set(labels.map(foldOf))
    return fs.size === 1 ? [...fs][0]! : null
}

/** Seeded Fisher-Yates. Pure for a given seed. */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
    const out = [...xs]
    let r = seed >>> 0 || 1
    const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[out[i], out[j]] = [out[j]!, out[i]!]
    }
    return out
}

/** Up to `perFile` chunks of each file (texts under `minChars` dropped), then `total` of them across
 *  files, spread so every file gets one before any gets a second. Pure for a given seed. */
export function sampleChunks(
    files: { file: string; texts: string[] }[],
    opts: { total: number; perFile: number; minChars: number; seed: number },
): { file: string; text: string }[] {
    const per = shuffled(files, opts.seed).map((f, i) => ({
        file: f.file,
        texts: shuffled(
            f.texts.filter(t => t.length >= opts.minChars),
            opts.seed + i + 1,
        ).slice(0, opts.perFile),
    }))
    const out: { file: string; text: string }[] = []
    for (let round = 0; round < opts.perFile && out.length < opts.total; round++)
        for (const f of per) {
            if (out.length >= opts.total) break
            const t = f.texts[round]
            if (t !== undefined) out.push({ file: f.file, text: t })
        }
    return out
}

/** Haiku's reply for a batch: per passage 1..n the first complete `{n, ask, question, keywords}` object
 *  numbered for it (extras and out-of-range numbers ignored), null for a passage with none, and null
 *  overall when the reply holds no JSON array. Pure. */
export function parseQueries(reply: string, n: number): (Omit<QueryRow, 'id'> | null)[] | null {
    const m = /\[[\s\S]*\]/.exec(reply)
    if (!m) return null
    try {
        const arr = JSON.parse(m[0]) as unknown
        if (!Array.isArray(arr)) return null
        // keywords sometimes come back as a list of words: join it
        const text = (v: unknown) => (Array.isArray(v) && v.every(w => typeof w === 'string') ? v.join(' ') : typeof v === 'string' ? v : '').trim()
        const out: (Omit<QueryRow, 'id'> | null)[] = Array.from({ length: n }, () => null)
        for (const x of arr) {
            if (!x || typeof x !== 'object') continue
            const o = x as Record<string, unknown>
            const num = typeof o.n === 'string' && o.n.trim() ? Number(o.n) : o.n
            if (typeof num !== 'number' || !Number.isInteger(num) || num < 1 || num > n || out[num - 1]) continue
            const row = { ask: text(o.ask), question: text(o.question), keywords: text(o.keywords) }
            if (row.ask && row.question && row.keywords) out[num - 1] = row
        }
        return out
    } catch {
        return null
    }
}

/** The training pairs of the model for `fold`: every query of every chunk in the OTHER fold, with the
 *  default model's query prefix; `none` takes no pairs; `general` takes every query of every chunk whose
 *  key is not `heldOutDoc` and carries the chunk's `file` so negatives can skip the positive's document. Pure. */
export function trainPairs(chunks: ChunkRow[], queries: QueryRow[], fold: Fold | 'none' | 'general', prefix: string): { query: string; passage: string; group: number; file?: string }[] {
    if (fold === 'none') return []
    const byId = new Map(chunks.map(c => [c.id, c]))
    const out: { query: string; passage: string; group: number; file?: string }[] = []
    for (const q of queries) {
        const c = byId.get(q.id)
        if (!c) continue
        if (fold === 'general' ? heldOutDoc(c.key) : c.fold === fold) continue
        for (const s of [q.ask, q.question, q.keywords]) out.push({ query: prefix + s, passage: c.text, group: c.id, ...(fold === 'general' ? { file: c.file } : {}) })
    }
    return out
}

/** Held-out pairs for the trainer's own check: the queries of chunks IN `fold` (never trained on); for
 *  `general`, the ask of every `heldOutDoc` chunk. Pure. */
export function heldOutPairs(chunks: ChunkRow[], queries: QueryRow[], fold: Fold | 'general', prefix: string) {
    const byId = new Map(chunks.map(c => [c.id, c]))
    return queries.flatMap(q => {
        const c = byId.get(q.id)
        return c && (fold === 'general' ? heldOutDoc(c.key) : c.fold === fold) ? [{ query: prefix + q.ask, passage: c.text, group: c.id }] : []
    })
}

/** Paired pools of the cases whose labels sit in one fold: the base row, and the tuned row from that
 *  fold's model. Cases missing from any of the three runs are dropped from both. Pure. */
export function mergePools(base: SearchPool[], a: SearchPool[], b: SearchPool[]): { base: SearchPool[]; tuned: SearchPool[]; dropped: { spanning: number; missing: number } } {
    const ai = new Map(a.map(p => [p.id, p]))
    const bi = new Map(b.map(p => [p.id, p]))
    const out = { base: [] as SearchPool[], tuned: [] as SearchPool[], dropped: { spanning: 0, missing: 0 } }
    for (const p of base) {
        const f = caseFold(p.labels)
        if (!f) {
            out.dropped.spanning++
            continue
        }
        const t = (f === 'a' ? ai : bi).get(p.id)
        if (!t) {
            out.dropped.missing++
            continue
        }
        out.base.push(p)
        out.tuned.push(t)
    }
    return out
}

/** A row of `bench/recallReplay.ts`'s `cases.jsonl`, the fields the fold merge reads. */
export type RecallRow = { session: string; prompt: string; labels: string[]; hit: boolean; labelRetrieved: boolean }

/** Recall replay rows paired like `mergePools`, by position (the three runs parse the same logs in the
 *  same order; a row whose prompt differs is dropped): cases whose file labels sit in one fold, the
 *  tuned row from that fold's run. `hit` is whether recall injected a label, `rr` carries whether a label was in
 *  the sources' raw top 10, so `pairedDiff` reports both. Pure. */
export function mergeRecall(base: RecallRow[], a: RecallRow[], b: RecallRow[]) {
    const row = (r: RecallRow) => ({ session: r.session, hit: r.hit ? 1 : 0, rr: r.labelRetrieved ? 1 : 0 })
    const out = { base: [] as ReturnType<typeof row>[], tuned: [] as ReturnType<typeof row>[] }
    for (const [i, r] of base.entries()) {
        const files = r.labels.filter(l => !l.startsWith('docs:'))
        const f = files.length ? caseFold(files) : null
        const t = f && (f === 'a' ? a : b)[i]
        if (!t || t.prompt !== r.prompt) continue
        out.base.push(row(r))
        out.tuned.push(row(t))
    }
    return out
}

// ---- the command line -----------------------------------------------------------------------------

const BGE_QUERY = 'Represent this sentence for searching relevant passages: '
const MODELS = join(homedir(), '.bismuth', 'models')

const argv = process.argv.slice(2)
const flag = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
}
const need = (name: string) => {
    const v = flag(name)
    if (!v) {
        console.error(`missing ${name}`)
        process.exit(2)
    }
    return v
}

async function chunks() {
    const vault = resolve(need('--vault'))
    const out = resolve(need('--out'))
    mkdirSync(out, { recursive: true })
    const [{ vaultEntries }, { embedTexts }, { resolveDenyPlan }] = await Promise.all([
        import('../core/src/vaultEmbed'),
        import('../core/src/memoryEmbed'),
        import('../core/src/visibility'),
    ])
    // the daemon channel denies hidden and chat-only files alike: neither goes to a model
    const plan = await resolveDenyPlan(vault, 'daemon')
    if (!plan.determined) throw new Error(`visibility of ${vault} could not be read: ${plan.reason}`)
    const denied = new Set(plan.entries.map(e => e.rel))
    const byFile = new Map<string, string[]>()
    let skipped = 0
    for (const { file, note } of await vaultEntries(vault)) {
        if (denied.has(file) || denied.has(`${file}.md`)) {
            skipped++
            continue
        }
        byFile.set(file, [...(byFile.get(file) ?? []), ...embedTexts(note)])
    }
    const picked = sampleChunks(
        [...byFile].map(([file, texts]) => ({ file, texts })),
        { total: Number(flag('--chunks') ?? 4000), perFile: Number(flag('--per-file') ?? 3), minChars: 200, seed: 7 },
    )
    const rows: ChunkRow[] = []
    for (const p of picked) {
        const key = fileKey(p.file)
        if (key) rows.push({ id: rows.length, file: p.file, key, fold: foldOf(key), text: p.text })
    }
    writeFileSync(join(out, 'chunks.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
    const nf = (f: Fold) => new Set(rows.filter(r => r.fold === f).map(r => r.file)).size
    console.log(`${byFile.size} files (${skipped} entries skipped by visibility), ${rows.length} chunks: fold a ${nf('a')} files, fold b ${nf('b')} files`)
}

const WRITE_SYSTEM =
    "You write search queries for a person's notes, readings and school work (lecture notes, textbook chapters, papers, tasks, journals). For each numbered passage, write three things this person might send when the passage is what they need: " +
    '"ask": a message to their AI assistant in a chat, the way they type (casual, lowercase, short, often a request to do something with what the passage holds, and it need not name the source); ' +
    '"question": a short question the passage answers; "keywords": two to five words they would type into a search box. ' +
    "Use everyday words, not the passage's rare phrases; never name its file or path. Reply with one JSON array of objects with keys n (the passage number), ask, question, keywords: exactly one object per passage number, even when a passage holds several exercises or questions (one set covering the passage as a whole), and nothing else."

async function haiku(text: string): Promise<string | null> {
    const { whichClaude, claudeSpawnEnv } = await import('../core/src/claudeWhich')
    const bin = whichClaude()
    if (!bin) throw new Error('claude binary not found')
    const { query } = (await import('../core/node_modules/@anthropic-ai/claude-agent-sdk')) as unknown as {
        query: (a: unknown) => AsyncIterable<{ type: string; subtype?: string; result?: string }>
    }
    try {
        for await (const m of query({
            prompt: text,
            options: { model: 'claude-haiku-5-5', pathToClaudeCodeExecutable: bin, cwd: '/private/tmp', env: claudeSpawnEnv(), tools: [], maxTurns: 1, persistSession: false, settingSources: [], systemPrompt: WRITE_SYSTEM },
        }))
            if (m.type === 'result' && m.subtype === 'success' && m.result) return m.result
    } catch {}
    return null
}

async function queries() {
    const out = resolve(need('--out'))
    const rows = readJsonl<ChunkRow>(join(out, 'chunks.jsonl'))
    const path = join(out, 'queries.jsonl')
    const done = new Set(existsSync(path) ? readJsonl<QueryRow>(path).map(r => r.id) : [])
    const todo = rows.filter(r => !done.has(r.id))
    const size = Number(flag('--batch') ?? 16)
    const batches: ChunkRow[][] = []
    for (let i = 0; i < todo.length; i += size) batches.push(todo.slice(i, i + size))
    console.log(`${done.size} chunks done, ${todo.length} to write in ${batches.length} batches`)
    const { mapWithConcurrency } = await import('../core/src/concurrency')
    let ok = 0
    let failed = 0
    await mapWithConcurrency(batches, Number(flag('--jobs') ?? 4), async batch => {
        let pending = batch
        let wrote = 0
        for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
            const prompt = pending.map((c, i) => `[${i + 1}]\n${c.text.slice(0, 1200)}`).join('\n\n')
            const reply = await haiku(prompt)
            const qs = reply ? parseQueries(reply, pending.length) : null
            if (reply && (!qs || qs.some(q => !q))) appendFileSync(join(out, 'failed.jsonl'), JSON.stringify({ n: pending.length, reply }) + '\n')
            if (!qs) {
                console.error(`  batch at chunk ${pending[0]!.id}: ${reply === null ? 'no reply' : `unparsed reply: ${reply.slice(0, 160).replace(/\n/g, ' ')}`}`)
                continue
            }
            const got = pending.flatMap((c, i) => (qs[i] ? [JSON.stringify({ id: c.id, ...qs[i]! })] : []))
            if (got.length) appendFileSync(path, got.join('\n') + '\n')
            wrote += got.length
            pending = pending.filter((_, i) => !qs[i])
        }
        if (pending.length) failed++
        else {
            ok++
            if (ok % 20 === 0) console.log(`  ${ok} batches written`)
        }
        if (wrote < batch.length) console.error(`  batch at chunk ${batch[0]!.id}: ${batch.length - wrote} of ${batch.length} passages still without queries`)
    })
    console.log(`wrote ${ok} batches, ${failed} failed (rerun to retry them)`)
}

async function train() {
    const out = resolve(need('--out'))
    const name = need('--name')
    if (!/^[\w.-]+$/.test(name)) throw new Error('--name is letters, digits, dot, dash, underscore')
    const fold = need('--fold') as Fold | 'none' | 'general'
    if (!['a', 'b', 'none', 'general'].includes(fold)) throw new Error('--fold is a, b, none or general')
    const general = fold === 'general'
    const cs = readJsonl<ChunkRow>(join(out, 'chunks.jsonl'))
    if (general && cs.some(c => !c.key.startsWith('pub:'))) throw new Error('--fold general trains only on public chunks from bench/embedCorpus.ts (keys pub:…)')
    const qs = fold === 'none' ? [] : readJsonl<QueryRow>(join(out, 'queries.jsonl'))
    const dir = join(out, `train-${name}`)
    mkdirSync(dir, { recursive: true })
    const pairs = trainPairs(cs, qs, fold, BGE_QUERY)
    writeFileSync(join(dir, 'pairs.jsonl'), pairs.map(p => JSON.stringify(p)).join('\n') + (pairs.length ? '\n' : ''))
    const held = fold === 'none' ? [] : heldOutPairs(cs, qs, fold, BGE_QUERY)
    writeFileSync(join(dir, 'heldout.jsonl'), held.map(p => JSON.stringify(p)).join('\n') + (held.length ? '\n' : ''))
    console.log(`${name}: ${pairs.length} training pairs, ${held.length} held-out queries`)
    const venv = process.env.BISMUTH_FT_VENV ?? join(homedir(), '.cache', 'bismuth-finetune', 'venv')
    const general_args = general
        ? [
              '--general',
              '--name', name,
              '--export-root', join(MODELS, 'bismuth-ft'),
              '--eval-out', join(dir, 'eval.json'),
              '--beir-cache', join(homedir(), '.cache', 'bismuth-finetune', 'beir'),
              '--scale', flag('--scale') ?? '50',
              '--negatives', flag('--negatives') ?? '1',
              '--merge', flag('--merge') ?? '0.3,0.5,0.7',
              '--beir', flag('--beir') ?? 'scifact,nfcorpus,fiqa,arguana',
              ...(flag('--beir-limit') ? ['--beir-limit', flag('--beir-limit')!] : []),
          ]
        : []
    const py = Bun.spawn(
        [
            join(venv, 'bin', 'python'),
            '-I',
            join(import.meta.dir, 'finetuneEmbed.py'),
            '--pairs', join(dir, 'pairs.jsonl'),
            '--heldout', join(dir, 'heldout.jsonl'),
            '--work', dir,
            '--export', join(MODELS, 'bismuth-ft', name),
            '--epochs', flag('--epochs') ?? '1',
            '--lr', flag('--lr') ?? (general ? '1e-5' : '2e-5'),
            '--batch', flag('--batch') ?? '32',
            ...general_args,
            ...(argv.includes('--fp32') ? ['--fp32'] : []),
        ],
        { stdout: 'inherit', stderr: 'inherit' },
    )
    const code = await py.exited
    if (code !== 0) throw new Error(`trainer exited ${code}`)
    console.log(`exported ${join(MODELS, 'bismuth-ft', name)}; build its pools with --embed ft:${name}`)
}

function merge() {
    const load = (d: string) => readJsonl<SearchPool>(join(resolve(d), 'pools.jsonl'))
    const m = mergePools(load(need('--base')), load(need('--a')), load(need('--b')))
    const out = resolve(need('--out'))
    for (const [k, rows] of [['base', m.base], ['tuned', m.tuned]] as const) {
        mkdirSync(join(out, k), { recursive: true })
        writeFileSync(join(out, k, 'pools.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
    }
    console.log(`${m.base.length} cases kept, ${m.dropped.spanning} dropped for labels in both folds, ${m.dropped.missing} missing from a run`)
}

function recall() {
    const load = (d: string) => readJsonl<RecallRow>(join(resolve(d), 'cases.jsonl'))
    const m = mergeRecall(load(need('--base')), load(need('--a')), load(need('--b')))
    const d = pairedDiff(m.base, m.tuned, Number(flag('--draws') ?? 2000))
    const mean = (xs: { hit: number; rr: number }[], k: 'hit' | 'rr') => (xs.reduce((s, x) => s + x[k], 0) / Math.max(1, xs.length)).toFixed(3)
    const f = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3)
    console.log(
        `recall injected a label ${mean(m.base, 'hit')} → ${mean(m.tuned, 'hit')} (${f(d.recall.diff)}, ${f(d.recall.lo)} to ${f(d.recall.hi)})  ` +
            `label in raw top 10 ${mean(m.base, 'rr')} → ${mean(m.tuned, 'rr')} (${f(d.mrr.diff)}, ${f(d.mrr.lo)} to ${f(d.mrr.hi)})  ${d.cases} cases / ${d.sessions} sessions`,
    )
}

if (import.meta.main) {
    const mode = argv[0]
    if (mode === 'chunks') await chunks()
    else if (mode === 'queries') await queries()
    else if (mode === 'train') await train()
    else if (mode === 'merge') merge()
    else if (mode === 'recall') recall()
    else {
        console.error('usage: bun bench/finetuneEmbed.ts chunks|queries|train|merge|recall …')
        process.exit(2)
    }
    process.exit(0)
}
