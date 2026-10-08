// Query context: widen a bare prompt ("ok do it") with what the session was just about. Pure text
// work over transcript entries and tool calls; the ranker weighs this below the prompt itself.
import { extractText, stripInjectedBlocks } from './transcript'
import type { TranscriptEntry } from './transcript'

type Block = { type?: string; id?: string; tool_use_id?: string; name?: string; input?: unknown; text?: string }

const DEFAULT_MAX_CHARS = 1200
const CALLS_MAX_CHARS = 1500
const RECENT_TOOL_USES = 10
const PATHISH_KEYS = ['file_path', 'path', 'notebook_path', 'pattern', 'glob', 'url', 'query', 'command']

function blocksOf(entry: TranscriptEntry): Block[] {
    const c = entry.message?.content
    return Array.isArray(c) ? (c as Block[]) : []
}

function toolInputStrings(input: unknown): string[] {
    if (!input || typeof input !== 'object') return []
    const rec = input as Record<string, unknown>
    const out: string[] = []
    for (const k of PATHISH_KEYS) {
        const v = rec[k]
        if (typeof v === 'string' && v.trim()) out.push(v.trim().slice(0, 300))
    }
    return out
}

function cleanText(entry: TranscriptEntry): string {
    return stripInjectedBlocks(extractText(entry.message))
}

function tail(text: string, max: number): string {
    return text.length <= max ? text : text.slice(text.length - max)
}

/** The last assistant text, the user turn that prompted it, and recent tool-input paths/patterns. */
export function contextFromTranscript(
    entries: TranscriptEntry[],
    opts: { maxChars?: number } = {},
): string {
    const max = opts.maxChars ?? DEFAULT_MAX_CHARS
    let assistantIdx = -1
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!
        if (e.message?.role === 'assistant' && cleanText(e)) {
            assistantIdx = i
            break
        }
    }
    const assistant = assistantIdx >= 0 ? cleanText(entries[assistantIdx]!) : ''
    let prevUser = ''
    for (let i = (assistantIdx >= 0 ? assistantIdx : entries.length) - 1; i >= 0; i--) {
        const e = entries[i]!
        if (e.message?.role === 'user') {
            const t = cleanText(e)
            if (t) {
                prevUser = t
                break
            }
        }
    }

    const tools: string[] = []
    for (let i = entries.length - 1; i >= 0 && tools.length < RECENT_TOOL_USES; i--) {
        for (const b of blocksOf(entries[i]!)) {
            if (b.type === 'tool_use') tools.push(...toolInputStrings(b.input))
        }
    }

    const parts = [
        tail(assistant, Math.floor(max * 0.5)),
        prevUser.slice(0, Math.floor(max * 0.25)),
        [...new Set(tools)].join('\n'),
    ].filter(Boolean)
    const joined = parts.join('\n')
    return joined.length <= max ? joined : joined.slice(0, max)
}

// ---- tool payloads --------------------------------------------------------------------------
// A tool batch is mostly not ABOUT anything: an absolute path is a temp dir, a home dir and a hash
// before it reaches the one or two words that name the file, and a response arrives as the relay's
// JSON string (keys, escapes, metadata) around the text that matters. `toolQuery` keeps the words
// that name the topic and drops the rest, so the ranker scores the payload's subject, not its
// packaging.

type ToolCallLike = { tool_name: string; tool_input: unknown; tool_response?: unknown }

const RESPONSE_CHARS = 1500
const TOOL_PRIMARY_MAX_CHARS = 600
const TOOL_CONTEXT_MAX_CHARS = 1800
const PATH_KEYS = new Set(['file_path', 'path', 'notebook_path'])
/** Parent directories kept above a path's leaf: signal sits near the leaf, packaging near the root. */
const PATH_PARENTS = 2
/** Response JSON values that are metadata, not content. */
const META_KEYS = new Set(['type', 'mode', 'filePath', 'file_path', 'interrupted', 'isImage'])
/** Leading path segments that are machine packaging: temp dirs, home dirs, volume roots. */
const PATH_PREFIXES = [
    /^\/?(private\/)?var\/folders\/[^/]+\/[^/]+\/[^/]+\//,
    /^\/?(private\/)?(tmp|var\/tmp)\//,
    /^\/?(Users|home)\/[^/]+\//,
    /^[A-Za-z]:\/Users\/[^/]+\//,
    /^~\//,
]
/** Directory names that say where a file lives, not what it is about. */
const PATH_NOISE_SEGMENTS = new Set([
    'documents', 'desktop', 'downloads', 'dev', 'src', 'lib', 'dist', 'build', 'out', 'node_modules',
    'vault', 'tmp', 'temp', 't', '.claude', '.git', 'worktrees',
])

/** A random-looking token: a hash, a mktemp suffix (`b92H`), a base64 run. Real words, codes like
 *  `H07`/`207b`, numbers and dates survive. */
function isNoiseToken(t: string): boolean {
    if (/^[0-9a-f]{7,}$/i.test(t) && /\d/.test(t) && /[a-f]/i.test(t)) return true
    const digits = (t.match(/\d/g) ?? []).length
    const letters = (t.match(/[a-z]/gi) ?? []).length
    if (!digits || !letters) return false
    if (/[a-z]/.test(t) && /[A-Z]/.test(t) && /\d/.test(t.slice(1))) return true // mixed case + digit
    return t.length >= 8 && digits >= 2 && letters >= 3
}

function dropNoiseTokens(text: string): string {
    return text.replace(/[A-Za-z0-9+/=_]{3,}/g, w =>
        w.split(/[_+/=]/).some(isNoiseToken) ? ' ' : w,
    )
}

/** Extensions of files whose name is an identifier, not a title: source, styles, manifests, data
 *  formats. A prose vault's `weekend plan.md` is named for its subject; `ProductCard.tsx` is not. */
const CODE_EXTENSIONS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'swift', 'rb', 'php', 'c',
    'h', 'cc', 'cpp', 'hpp', 'cs', 'css', 'scss', 'sass', 'less', 'html', 'vue', 'svelte', 'json',
    'jsonc', 'lock', 'lockb', 'yaml', 'yml', 'toml', 'xml', 'sh', 'zsh', 'sql', 'map', 'snap',
])
/** File names that say what kind of file it is, never what it is about. */
const GENERIC_LEAVES = new Set([
    'package', 'package lock', 'index', 'main', 'readme', 'license', 'changelog', 'config', 'setup',
    'utils', 'util', 'helpers', 'types', 'constants', 'app', 'page', 'layout', 'route', 'mod', 'lib',
    'init', '__init__', 'tsconfig', 'makefile', 'dockerfile', 'cargo', 'pyproject', 'requirements',
    'yarn', 'bun', 'pnpm lock', 'go', 'gemfile', 'test', 'tests', 'spec', 'claude', 'agents',
])

/** The words of a path that name it: prefixes stripped, extensions dropped, the leaf and its
 *  nearest parents only. `leaf` is the file's own name, `dirs` its kept parents; `named` is false
 *  for a code/manifest file or a generic name (`package.json`, `index.ts`), whose leaf says what
 *  kind of file it is rather than what it is about. */
export function pathWords(p: string): { leaf: string; dirs: string; named: boolean } {
    let rest = p.trim().replace(/\\/g, '/')
    for (const re of PATH_PREFIXES) rest = rest.replace(re, '')
    const segs = rest
        .split('/')
        .filter(Boolean)
        .filter(s => !PATH_NOISE_SEGMENTS.has(s.toLowerCase()))
        .map(s => dropNoiseTokens(s.replace(/-/g, ' ')).trim())
        .filter(Boolean)
    if (!segs.length) return { leaf: '', dirs: '', named: false }
    const last = segs[segs.length - 1]!
    const ext = /\.([A-Za-z][A-Za-z0-9]{0,5})$/.exec(last)?.[1]?.toLowerCase() ?? ''
    const leaf = last.replace(/(\.[A-Za-z][A-Za-z0-9]{0,5}){1,2}$/, '')
    const named = !CODE_EXTENSIONS.has(ext) && !GENERIC_LEAVES.has(leaf.toLowerCase().replace(/[._]/g, ' ').trim())
    return { leaf, dirs: segs.slice(-1 - PATH_PARENTS, -1).join(' '), named }
}

const looksLikePath = (s: string) => !/\s/.test(s.trim()) && /[/\\]/.test(s) && s.length > 2

/** The string values of a JSON-ish response, keys and metadata dropped. Tolerates the relay's
 *  2000-char cut, which usually leaves the JSON unterminated. */
function responseStrings(r: unknown, top = true): string[] {
    if (r == null) return []
    if (typeof r === 'string') {
        const t = r.trimStart()
        // Only the response itself may be JSON packaging; a JSON FILE's text inside it is content
        // (and its lines are dropped as code by `cleanResponse`).
        if (!top || (!t.startsWith('{') && !t.startsWith('['))) return [r]
        try {
            return responseStrings(JSON.parse(t), false)
        } catch {
            const out: string[] = []
            const re = /"((?:[^"\\]|\\.)*)(?:"(\s*:)?|\\?$)/g
            let key = ''
            for (let m = re.exec(t); m; m = re.exec(t)) {
                if (m[2]) {
                    key = m[1]!
                    continue
                }
                if (META_KEYS.has(key)) continue
                try {
                    out.push(JSON.parse(`"${m[1]!.replace(/\\$/, '')}"`))
                } catch {
                    out.push(m[1]!)
                }
            }
            return out
        }
    }
    if (typeof r !== 'object') return []
    if (Array.isArray(r)) return r.flatMap(v => responseStrings(v, false))
    return Object.entries(r as Record<string, unknown>).flatMap(([k, v]) =>
        META_KEYS.has(k) ? [] : responseStrings(v, false),
    )
}

/** Code, JSON and log syntax: a memory note is prose, so a line of a source file, a manifest or a
 *  test log shares words with it only by coincidence. Prose with the odd bracket or `$x^2$` passes. */
function isCodeLine(line: string): boolean {
    const t = line.trim()
    if (!t) return false
    if (/^["'{}\[\]]|^(import|export|const|let|var|function|return|def|class|from|if|for|while|#include)\b/.test(t)) return true
    if (/=>|===|!==|&&|\|\||::|\)\s*[{;]|[;{]\s*$|^\s*[)}\]]|"\s*:\s*|<\/?[A-Za-z][^>]*>/.test(t)) return true
    const symbols = (t.match(/[{}[\]()<>;=|&]/g) ?? []).length
    return symbols / t.length > 0.08
}

/** Response text with the packaging gone: line-number gutters, grep `path:line:` prefixes and bare
 *  path lines reduced to their words, code/JSON/log lines dropped, hashes removed. */
function cleanResponse(r: unknown): string {
    const lines: string[] = []
    for (const s of responseStrings(r)) {
        for (let line of stripInjectedBlocks(s).split('\n')) {
            line = line.replace(/^\s*\d+[\t→]/, '')
            const grep = /^([^\s:]+):(\d+)[:-](.*)$/.exec(line)
            if (grep) line = grep[3]!
            else if (looksLikePath(line)) {
                const w = pathWords(line)
                line = `${w.leaf} ${w.dirs}`
            }
            if (isCodeLine(line)) continue
            line = dropNoiseTokens(line).trim()
            if (line) lines.push(line)
        }
    }
    const text = lines.join('\n')
    return text.length <= RESPONSE_CHARS ? text : text.slice(0, RESPONSE_CHARS)
}

function cap(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max)
}

/**
 * A tool batch as a ranker query, in three tiers. `primary` is what the calls are about: a named
 * file's leaf, grep/glob patterns, search queries, a command's arguments. `context` is what came
 * back: the cleaned response body (and a code file's identifier-like leaf). `location` is where and
 * how: a path's nearest parent directories and a command's program. The ranker weighs them in that
 * order (`PACK_LIMITS.tool`), and location alone never qualifies a note.
 */
export function toolQuery(calls: ToolCallLike[]): { primary: string; context: string; location: string } {
    const { primary, context, location } = toolParts(calls)
    return { primary, context, location }
}

function toolParts(calls: ToolCallLike[]) {
    const primary: string[] = []
    const context: string[] = []
    const location: string[] = []
    /** The cleaned inputs in call order, a command kept whole: the flat form's head. */
    const flat: string[] = []
    for (const call of calls) {
        const input = call.tool_input
        if (input && typeof input === 'object') {
            const rec = input as Record<string, unknown>
            for (const k of PATHISH_KEYS) {
                const v = rec[k]
                if (typeof v !== 'string' || !v.trim()) continue
                const val = v.trim().slice(0, 300)
                if (PATH_KEYS.has(k) || (k !== 'command' && k !== 'query' && looksLikePath(val))) {
                    const w = pathWords(val)
                    if (w.leaf) (w.named ? primary : context).push(w.leaf)
                    if (w.dirs) location.push(w.dirs)
                    flat.push(`${w.dirs} ${w.leaf}`.trim())
                } else if (k === 'command') {
                    flat.push(
                        val
                            .split(/\s+/)
                            .map(t => (looksLikePath(t) ? pathWords(t).leaf : t))
                            .join(' '),
                    )
                    // The program (`git`, `bun`, `ls`) says how, its arguments say what.
                    for (const seg of val.split(/&&|\|\||;|\|/)) {
                        const words = seg.trim().split(/\s+/).filter(Boolean)
                        if (words[0] === 'cd') continue
                        if (words[0]) location.push(words[0])
                        primary.push(
                            words
                                .slice(1)
                                .map(t => (looksLikePath(t) ? pathWords(t).leaf : t))
                                .join(' '),
                        )
                    }
                } else if (k === 'url') {
                    const u = val.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/[?#].*$/, '')
                    primary.push(u)
                    flat.push(u)
                } else {
                    primary.push(val)
                    flat.push(val)
                }
            }
        }
        const body = cleanResponse(call.tool_response)
        if (body) context.push(body)
    }
    return {
        primary: cap(dropNoiseTokens(primary.join('\n')), TOOL_PRIMARY_MAX_CHARS),
        context: cap(context.join('\n'), TOOL_CONTEXT_MAX_CHARS),
        location: cap(location.join('\n'), TOOL_PRIMARY_MAX_CHARS),
        flat: dropNoiseTokens(flat.join('\n')),
    }
}

/** A tool batch as one string: the cleaned inputs (a command whole), then the cleaned responses,
 *  at most 1500 chars. Untiered; recall ranks `toolQuery`. */
export function queryFromToolCalls(calls: ToolCallLike[]): string {
    const { flat, context } = toolParts(calls)
    return cap([flat, context].filter(Boolean).join('\n'), CALLS_MAX_CHARS)
}

/** Characters of a query that get embedded. bge-small reads at most 512 tokens and a query's
 *  salient part comes first (primary, then location, then context), so a longer text only adds
 *  latency to the semantic channel and averages its vector toward boilerplate. */
export const SEMANTIC_QUERY_CHARS = 1000

/** The text the semantic channel embeds for a ranker query: its tiers in salience order, capped. */
export function semanticQueryText(q: { primary: string; context?: string; location?: string }): string {
    const text = [q.primary, q.location ?? '', q.context ?? '']
        .map(s => s.trim())
        .filter(Boolean)
        .join('\n')
    return text.length <= SEMANTIC_QUERY_CHARS ? text : text.slice(0, SEMANTIC_QUERY_CHARS)
}

/** The latest Agent/Task tool_use `input.prompt` in the transcript (the subagent's task). */
export function lastAgentPrompt(entries: TranscriptEntry[]): string | null {
    for (let i = entries.length - 1; i >= 0; i--) {
        const blocks = blocksOf(entries[i]!)
        for (let j = blocks.length - 1; j >= 0; j--) {
            const b = blocks[j]!
            if (b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task')) {
                const p = (b.input as { prompt?: unknown } | undefined)?.prompt
                if (typeof p === 'string' && p.trim()) return p
            }
        }
    }
    return null
}

/** Every UNRESOLVED Agent/Task tool_use `input.prompt` in transcript order, with its tool_use id.
 *  A starting subagent always has a tool_use with no tool_result yet, so resolved ones are skipped;
 *  parallel dispatch puts several in one assistant message and each subagent claims one by id. */
export function agentPrompts(entries: TranscriptEntry[]): { id: string; prompt: string }[] {
    const out: { id: string; prompt: string }[] = []
    const resolved = new Set<string>()
    for (const e of entries)
        for (const b of blocksOf(e))
            if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') resolved.add(b.tool_use_id)
    entries.forEach((e, i) => {
        blocksOf(e).forEach((b, j) => {
            if (b.type !== 'tool_use' || (b.name !== 'Agent' && b.name !== 'Task')) return
            const p = (b.input as { prompt?: unknown } | undefined)?.prompt
            if (typeof b.id === 'string' && resolved.has(b.id)) return
            if (typeof p === 'string' && p.trim())
                out.push({ id: typeof b.id === 'string' && b.id ? b.id : `#${i}.${j}`, prompt: p })
        })
    })
    return out
}
