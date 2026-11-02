// Pure half of the recall replay benchmark (bench/recallReplay.ts): turn one Claude Code session log
// into labelled recall cases. A case is one real prompt; its labels are the sources the agent went
// and fetched itself before the next prompt (a Bismuth docs page it read, a vault note, PDF or image
// a tool touched). Those are what recall should have handed it up front. A prompt that refers to an
// earlier conversation ("yesterday", "last time") is a past-chat case.
import { CRON_PREFIX, stripInjectedBlocks } from '../memory/src/transcript'

export type ReplayCase = {
    session: string
    /** ISO time of the prompt. */
    at: string
    /** Index of the prompt's line in the log: the lines before it are the transcript recall saw. */
    line: number
    prompt: string
    /** Source keys the agent fetched after this prompt: `docs:<page>`, `note:<path>`, `pdf:<path>`,
     *  `image:<path>`. Docs pages carry no `#anchor`. */
    labels: string[]
    /** Any tool call at all followed the prompt. */
    usedTools: boolean
    /** The prompt points at an earlier conversation. */
    refersToPast: boolean
}

export type ReplaySession = { id: string; started: string | null; cases: ReplayCase[] }

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const DOCS_READ = 'mcp__bismuth__bismuth_docs_read'
const FILE_EXT = /\.(md|pdf|png|jpe?g|gif|webp)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i
const PAST = /\b(yesterday|last time|last week|the other day|earlier today|we (talked|discussed|spoke)|you (said|told me|mentioned)|remember (when|what)|previous (chat|session|conversation)|in (our|the) last (chat|session|conversation))\b/i

export const refersToPast = (prompt: string): boolean => PAST.test(prompt)

/** The kind a vault file is indexed as. */
export function fileKey(rel: string): string | null {
    if (/\.pdf$/i.test(rel)) return `pdf:${rel}`
    if (IMAGE_EXT.test(rel)) return `image:${rel}`
    if (/\.md$/i.test(rel)) {
        // an image or PDF companion is that file
        const bin = rel.slice(0, -3)
        if (/\.pdf$/i.test(bin)) return `pdf:${bin}`
        if (IMAGE_EXT.test(bin)) return `image:${bin}`
        return `note:${rel}`
    }
    return null
}

/** Every vault file a tool input names, vault-relative, kept only when it is in `files`. Paths are
 *  matched as quoted strings, shell-escaped tokens and bare tokens, absolute or vault-relative. */
export function vaultPathsIn(input: unknown, vault: string, files: ReadonlySet<string>): string[] {
    const strings: string[] = []
    const walk = (v: unknown) => {
        if (typeof v === 'string') strings.push(v)
        else if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(input)
    const raw = new Set<string>()
    for (const text of strings) {
        raw.add(text)
        for (const m of text.matchAll(/"([^"]+)"/g)) raw.add(m[1]!)
        for (const m of text.matchAll(/'([^']+)'/g)) raw.add(m[1]!)
        for (const m of text.matchAll(/((?:[^\s"'\\]|\\ )+)/g)) raw.add(m[1]!.replace(/\\ /g, ' '))
    }
    const out = new Set<string>()
    const prefix = vault.endsWith('/') ? vault : `${vault}/`
    for (let p of raw) {
        p = p.replace(/\\ /g, ' ').trim()
        if (!FILE_EXT.test(p)) continue
        if (p.startsWith(prefix)) p = p.slice(prefix.length)
        if (p.startsWith('./')) p = p.slice(2)
        if (p.split('/').some(s => s.startsWith('.'))) continue
        if (files.has(p)) out.add(p)
    }
    return [...out]
}

type Entry = {
    type?: string
    isSidechain?: boolean
    isMeta?: boolean
    timestamp?: string
    message?: { content?: unknown }
}

function promptText(e: Entry): string | null {
    const c = e.message?.content
    if (typeof c === 'string') return c
    if (!Array.isArray(c)) return null
    if (c.some(b => (b as { type?: string })?.type === 'tool_result')) return null
    const t = c
        .filter(b => (b as { type?: string })?.type === 'text')
        .map(b => (b as { text?: string }).text ?? '')
        .join('\n')
    return t || null
}

const isNoise = (t: string) =>
    /^<(command-|local-command-|system-reminder|task-notification)/.test(t.trim()) ||
    t.startsWith('[Request interrupted')

/** Parse one session log into cases. Sidechain (subagent) entries are ignored; a cron session
 *  yields none. */
export function parseReplaySession(
    id: string,
    jsonl: string,
    vault: string,
    files: ReadonlySet<string>,
): ReplaySession {
    const cases: ReplayCase[] = []
    let started: string | null = null
    let cur: ReplayCase | null = null
    let labels = new Set<string>()
    const close = () => {
        if (cur) cases.push({ ...cur, labels: [...labels] })
        cur = null
        labels = new Set()
    }
    const lines = jsonl.split('\n')
    for (let li = 0; li < lines.length; li++) {
        const line = lines[li]!
        if (!line) continue
        let e: Entry
        try {
            e = JSON.parse(line)
        } catch {
            continue
        }
        if (e.isSidechain) continue
        if (e.type === 'user' && !e.isMeta) {
            const raw = promptText(e)
            if (raw === null || isNoise(raw)) continue
            if (raw.startsWith(CRON_PREFIX)) return { id, started, cases: [] }
            const prompt = stripInjectedBlocks(raw).trim()
            if (!prompt) continue
            close()
            started ??= e.timestamp ?? null
            cur = {
                session: id,
                at: e.timestamp ?? '',
                line: li,
                prompt,
                labels: [],
                usedTools: false,
                refersToPast: refersToPast(prompt),
            }
            continue
        }
        if (e.type !== 'assistant' || !cur) continue
        const c = e.message?.content
        if (!Array.isArray(c)) continue
        for (const b of c as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
            if (b?.type !== 'tool_use') continue
            ;(cur as ReplayCase).usedTools = true
            if (b.name === DOCS_READ && typeof b.input?.path === 'string') {
                labels.add(`docs:${b.input.path.replace(/#.*$/, '')}`)
                continue
            }
            if (WRITE_TOOLS.has(b.name ?? '')) continue
            for (const rel of vaultPathsIn(b.input, vault, files)) {
                const k = fileKey(rel)
                if (k) labels.add(k)
            }
        }
    }
    close()
    return { id, started, cases }
}

/** Whether an injected source key answers a label: docs match by page, files exactly. */
export function keyMatches(label: string, injected: string): boolean {
    if (label.startsWith('docs:')) return injected.startsWith('docs:') && injected.slice(5).replace(/#.*$/, '') === label.slice(5)
    return label === injected
}
