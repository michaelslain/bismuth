// core/src/buttons/buttonBlock.ts
//
// The pure half of a ```button fence: finding fences in markdown, parsing a body into buttons,
// and the deterministic key that names a button's stored state. No Bun, node:fs or node:crypto
// import: the app imports this module (and mobile runs it), so the key is a plain-JS hash that is
// identical in Bun and the browser.
import { parse } from 'yaml'
import { COMMAND_IDS, UI_CONTROL_BLOCKLIST } from '../commands'
import type {
    ButtonAction,
    ButtonBlock,
    ButtonHost,
    ButtonKind,
    ButtonSpec,
} from './buttonTypes'

export const BUTTON_FENCE_LANG = 'button'

const KINDS: ButtonKind[] = ['primary', 'default', 'danger']
const DEFAULT_MODEL = 'haiku'
const DEFAULT_TIMEOUT_SECS = 300
const MAX_TIMEOUT_SECS = 3600

/** `note:<path>` or `chat:<chatId>` — the host half of a button's key and of its stored state. */
export function hostString(host: ButtonHost): string {
    return host.kind === 'note' ? `note:${host.path}` : `chat:${host.chatId}`
}

/** 53-bit string hash (cyrb53), two seeds → 16 hex chars. Pure JS so the app computes the same
 *  key core does. */
function hash16(input: string): string {
    const part = (seed: number): string => {
        let h1 = 0xdeadbeef ^ seed
        let h2 = 0x41c6ce57 ^ seed
        for (let i = 0; i < input.length; i++) {
            const ch = input.charCodeAt(i)
            h1 = Math.imul(h1 ^ ch, 2654435761)
            h2 = Math.imul(h2 ^ ch, 1597334677)
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
        h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
        h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
        return (
            (h2 >>> 0).toString(16).padStart(8, '0') +
            (h1 >>> 0).toString(16).padStart(8, '0')
        )
    }
    // Fold both 64-bit halves into one 16-char key.
    const a = part(0)
    const b = part(0x9e3779b9)
    return (
        ((parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(8), 16)) >>> 0)
            .toString(16)
            .padStart(8, '0') +
        ((parseInt(a.slice(8), 16) ^ parseInt(b.slice(0, 8), 16)) >>> 0)
            .toString(16)
            .padStart(8, '0')
    )
}

/** The id of a button's stored state: 16 hex chars from the host, the fence body and the button's
 *  index. Editing the fence changes it, so a changed button starts idle. */
export function buttonKey(
    host: ButtonHost,
    body: string,
    index: number,
): string {
    return hash16(`${hostString(host)}\n${index}\n${body}`)
}

const OPEN_RE = /^ {0,3}(`{3,}|~{3,})button[ \t]*$/

/** Every ```button fence in `markdown`: `from`/`to` are the offsets of the whole fence (markers
 *  included, no trailing newline), `body` is the text between the markers. */
export function scanButtonFences(
    markdown: string,
): { from: number; to: number; body: string }[] {
    const out: { from: number; to: number; body: string }[] = []
    const lines = markdown.split('\n')
    let offset = 0
    let open: {
        from: number
        char: string
        len: number
        bodyStart: number
    } | null = null
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        const lineStart = offset
        const lineEnd = offset + line.length
        offset = lineEnd + 1
        const text = line.endsWith('\r') ? line.slice(0, -1) : line
        if (!open) {
            const m = OPEN_RE.exec(text)
            if (m)
                open = {
                    from: lineStart,
                    char: m[1]![0]!,
                    len: m[1]!.length,
                    bodyStart: lineEnd + 1,
                }
            continue
        }
        const t = text.trim()
        if (
            t.length >= open.len &&
            t === open.char.repeat(t.length) &&
            /^ {0,3}\S/.test(text)
        ) {
            out.push({
                from: open.from,
                to: lineEnd,
                body: markdown
                    .slice(
                        open.bodyStart,
                        Math.max(open.bodyStart, lineStart - 1),
                    )
                    .replace(/\r$/gm, ''),
            })
            open = null
        }
    }
    return out
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fail(error: string): ButtonBlock {
    return { buttons: [], error }
}

function parseEntry(entry: unknown): ButtonSpec | string {
    if (!isRecord(entry)) return 'each button needs label and an action'
    const label = entry.label
    if (typeof label !== 'string' || !label.trim()) return 'label is required'
    const kindRaw = entry.kind ?? 'default'
    if (!KINDS.includes(kindRaw as ButtonKind))
        return 'kind must be primary, default or danger'
    const kind = kindRaw as ButtonKind

    const present = ['prompt', 'send', 'command'].filter(
        k => entry[k] !== undefined && entry[k] !== null,
    )
    if (present.length !== 1)
        return 'needs exactly one of prompt, send, command'
    const which = present[0]!

    if (which !== 'prompt') {
        for (const k of ['model', 'timeout'])
            if (entry[k] !== undefined) return `${k} only works with prompt`
    }

    let action: ButtonAction
    if (which === 'prompt') {
        const prompt = entry.prompt
        if (typeof prompt !== 'string' || !prompt.trim())
            return 'prompt must be text'
        const model = entry.model ?? DEFAULT_MODEL
        if (typeof model !== 'string' || !model.trim())
            return 'model must be text'
        const timeout = entry.timeout ?? DEFAULT_TIMEOUT_SECS
        if (
            typeof timeout !== 'number' ||
            !Number.isInteger(timeout) ||
            timeout < 1 ||
            timeout > MAX_TIMEOUT_SECS
        )
            return `timeout must be a whole number of seconds from 1 to ${MAX_TIMEOUT_SECS}`
        action = {
            type: 'prompt',
            prompt: prompt.trim(),
            model: model.trim(),
            timeoutSecs: timeout,
        }
    } else if (which === 'send') {
        const text = entry.send
        if (typeof text !== 'string' || !text.trim()) return 'send must be text'
        action = { type: 'send', text: text.trim() }
    } else {
        const id = entry.command
        if (typeof id !== 'string' || !id.trim()) return 'command must be text'
        if (UI_CONTROL_BLOCKLIST.includes(id))
            return `${id} can't run from a button`
        if (!COMMAND_IDS.includes(id)) return `unknown command ${id}`
        action = { type: 'command', id }
    }
    return { label: label.trim(), kind, action }
}

/** Parse a fence body — one YAML mapping or a list of them — into buttons. Any violation yields
 *  `buttons: []` and a lowercase `error` naming the first problem (the renderer adds the
 *  `button // ` prefix). */
export function parseButtonBlock(body: string): ButtonBlock {
    if (!body.trim()) return fail('empty')
    let doc: unknown
    try {
        doc = parse(body)
    } catch {
        return fail('not valid yaml')
    }
    const entries = Array.isArray(doc) ? doc : [doc]
    if (entries.length === 0 || entries[0] == null) return fail('empty')
    const buttons: ButtonSpec[] = []
    for (const entry of entries) {
        const spec = parseEntry(entry)
        if (typeof spec === 'string') return fail(spec)
        buttons.push(spec)
    }
    return { buttons, error: null }
}
