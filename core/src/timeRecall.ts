// Time routing for recall: a prompt that names a time ("what did we do yesterday", "last tuesday")
// gets the digest notes covering that range under `# What happened <label>`, plus past chats whose
// session date falls in it. Pure of the ledger and the embedder: recall hands both in.
import * as mem from '@bismuth/memory'
import type { MemoryNote } from '@bismuth/memory'
import { sourceKey } from './semanticSources'
import { backgroundOf, gateAccepts, gateProbability } from './sourceGate'
import type { GateFeatures, GateModel, GateTraceRow } from './sourceGate'
import type { SourceHit, SourceQuery } from './semanticSources'

/** Most digest notes in one block, and their bodies' total size. */
export const DIGEST_MAX_NOTES = 3
export const DIGEST_BUDGET_CHARS = 2500
/** Dated chats the gate scores: the best by cosine among those inside the range. Bounds cost only; the
 *  gate decides which are injected. */
export const DATED_CHAT_CANDIDATES = 5
/** Chats asked of the chat source before the date filter. */
const DATED_CHAT_K = 100_000 // every session: the date filter runs after ranking, so a smaller k drops in-range chats

type TimeRange = { start: string; end: string; label: string }
export type TimeApi = {
    timeRefs: (text: string, now: Date) => TimeRange[]
    digestsCovering: (notes: MemoryNote[], start: string, end: string) => MemoryNote[]
}
const defaultApi = (): TimeApi => ({ timeRefs: mem.timeRefs, digestsCovering: mem.digestsCovering })

export type TimeRecallArgs = {
    vault: string
    memoryDir: string
    prompt: string
    now: Date
    channel: 'chat' | 'daemon'
    sessionId: string
    /** The query embedding; null = no dated chats. */
    vec: number[] | null
    /** What this session already received: key to hash. A digest is keyed by its note name and
     *  hashed with `noteHash`; a chat by `sourceKey`. */
    sent?: Map<string, string>
    /** Memory notes this request already injects by the ordinary path. */
    skipNames?: Set<string>
    /** Source keys this request already injects by the ordinary path. */
    skipKeys?: Set<string>
    /** Cap on the whole block. */
    budgetChars?: number
    /** What the ordinary path settled on, once it has: lets the slow lookups start before it
     *  finishes. When given, its values replace `skipNames`, `skipKeys` and `budgetChars`. */
    settled?: Promise<{ skipNames: Set<string>; skipKeys: Set<string>; budgetChars: number }>
}

export type TimeRecallDeps = {
    loadNotes: (dir: string) => Promise<MemoryNote[]>
    /** Past chats for a query vector, already gated by the chat visibility rule. */
    chatHits?: (q: SourceQuery) => Promise<SourceHit[]>
    /** The learned source gate: the date is a feature, not a waiver. */
    gate: GateModel
    /** Receives every dated chat the gate scored. */
    trace?: (rows: GateTraceRow[]) => void
    /** Test seam; defaults to `@bismuth/memory`. */
    time?: TimeApi
}

export type TimeRecallResult = {
    /** The digest sections only. */
    block: string
    /** Ledger keys of the digests in the block. */
    injected: string[]
    /** Ledger hash per injected digest key. */
    hashes: Map<string, string>
    /** Past chats dated in the range, best first; recall packs them with the ordinary chats. */
    chats: SourceHit[]
}

const inAny = (date: string | undefined, ranges: TimeRange[]): boolean =>
    !!date && ranges.some(r => date >= r.start && date <= r.end)

function cutLines(text: string, max: number): string {
    if (text.length <= max) return text
    const kept: string[] = []
    let used = 0
    for (const line of text.split('\n')) {
        if (used + line.length + 1 > max) break
        kept.push(line)
        used += line.length + 1
    }
    return kept.join('\n').trimEnd()
}

/** Whether the prompt names a time; recall embeds the query for dated chats only then. */
export const hasTimeRefs = (prompt: string, now: Date, time: TimeApi = defaultApi()): boolean =>
    time.timeRefs(prompt, now).length > 0

export async function timeRecall(a: TimeRecallArgs, deps: TimeRecallDeps): Promise<TimeRecallResult | null> {
    const time = deps.time ?? defaultApi()
    const ranges = time.timeRefs(a.prompt, a.now)
    if (!ranges.length) return null
    const sent = a.sent ?? new Map<string, string>()
    const injected: string[] = []
    const hashes = new Map<string, string>()
    const parts: string[] = []
    let used = 0

    // The chat lookup is the slow part: start it before waiting for the ordinary path.
    const hitsP: Promise<SourceHit[]> =
        a.vec && deps.chatHits
            ? deps
                  .chatHits({
                      vec: Float32Array.from(a.vec),
                      k: DATED_CHAT_K,
                      channel: a.channel,
                      excludeSessionId: a.sessionId,
                  })
                  .catch(() => [] as SourceHit[])
            : Promise.resolve([])
    const notesP = deps.loadNotes(a.memoryDir).catch(() => [] as MemoryNote[])
    const settled = a.settled
        ? await a.settled
        : { skipNames: a.skipNames, skipKeys: a.skipKeys, budgetChars: a.budgetChars }
    const skipNames = settled.skipNames
    const skipKeys = settled.skipKeys
    const budget = settled.budgetChars ?? DIGEST_BUDGET_CHARS

    // Digests: per range, the most specific covering notes; one note serves one range only.
    const notes = (await notesP).filter(mem.isMemoryNoteVisibleToDaemon)
    const taken = new Set<string>()
    let digestChars = 0
    for (const r of ranges) {
        const sections: string[] = []
        for (const n of time.digestsCovering(notes, r.start, r.end)) {
            if (taken.size >= DIGEST_MAX_NOTES) break
            if (taken.has(n.name) || skipNames?.has(n.name)) continue
            const hash = mem.noteHash(n)
            if (sent.get(n.name) === hash) continue
            const room = Math.min(DIGEST_BUDGET_CHARS - digestChars, budget - used) - n.name.length - 8
            const body = mem.defang(cutLines(n.content.trim(), room))
            if (!body || room < 40) continue
            const section = `## ${n.name}\n${body}`
            sections.push(section)
            taken.add(n.name)
            injected.push(n.name)
            hashes.set(n.name, hash)
            digestChars += section.length + 2
            used += section.length + 2
        }
        if (sections.length) {
            const head = `# What happened ${mem.defang(r.label)}`
            parts.push(`${head}\n\n${sections.join('\n\n')}`)
            used += head.length + 2
        }
    }

    // Dated chats: the session date is a feature of the learned gate (`inRange`), with no cosine floor
    // and no background margin of its own; the visibility gate (inside `chatHits`) still applies.
    // The time path does not rerank, so `rerank` is null.
    const ranked = (await hitsP).filter(h => h.kind === 'chat').sort((x, y) => y.score - x.score)
    const background = backgroundOf(ranked)
    const dated = ranked.filter(h => inAny(h.date, ranges)).slice(0, DATED_CHAT_CANDIDATES)
    const rows: GateTraceRow[] = dated.map((h, rank) => {
        const features: GateFeatures = { cosine: h.score, background, rank, rerank: null, kind: 'chat', inRange: true, promptChars: a.prompt.length }
        return { key: sourceKey(h), path: 'time', features, probability: gateProbability(features, deps.gate), accepted: gateAccepts(features, deps.gate) }
    })
    deps.trace?.(rows)
    const chats = dated
        .filter((_, i) => rows[i]!.accepted)
        .filter(h => !skipKeys?.has(sourceKey(h)) && sent.get(sourceKey(h)) !== h.hash)
    if (!parts.length && !chats.length) return null
    return { block: parts.length ? `${parts.join('\n\n')}\n\n` : '', injected, hashes, chats }
}
