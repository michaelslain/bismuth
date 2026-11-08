import { join } from 'node:path'
import { defang } from '@bismuth/memory'
import type { SourceHit } from './semanticSources'

/** Renders the source half of the recall block: `# Vault files`, `# Past chats`, `# Bismuth docs`,
 *  each only when it has an item. Every item is a reference (one line naming the thing and how to
 *  open it), never its text, so a wrong item costs one line. Pure: no fs, no model. Recall appends
 *  the text just before the closing `</bismuth-memory>` tag, after whatever memory packed. */

export type SourceLimits = { files: number; chats: number; docs: number }

/** Most items per source, by recall mode. */
export const SOURCE_LIMITS: Record<'prompt' | 'subagent', SourceLimits> = {
    prompt: { files: 2, chats: 2, docs: 2 },
    subagent: { files: 2, chats: 1, docs: 2 },
}

type Section = keyof SourceLimits

const SECTIONS: { key: Section; heading: string }[] = [
    { key: 'files', heading: '# Vault files' },
    { key: 'chats', heading: '# Past chats' },
    { key: 'docs', heading: '# Bismuth docs' },
]

export const sourceSection = (h: SourceHit): Section =>
    h.kind === 'chat' ? 'chats' : h.kind === 'docs' ? 'docs' : 'files'

/** Width of a reference's one-line description. A line width, not a relevance threshold. */
export const SOURCE_HOOK_CHARS = 160

const LEAD = 'Possibly related, unverified. Open one only if it helps; ignore the rest.'

/** The item's best one-line description: its title, else the first sentence of its excerpt. */
function hookOf(h: SourceHit): string {
    const flat = (t: string) => t.replace(/\s+/g, ' ').trim()
    const title = flat(h.title ?? '')
    const text = title || flat(h.excerpt).split(/(?<=[.!?])\s/)[0]!
    if (text.length <= SOURCE_HOOK_CHARS) return defang(text)
    const head = text.slice(0, SOURCE_HOOK_CHARS)
    const atWord = text[SOURCE_HOOK_CHARS] === ' ' ? head : head.replace(/\s*\S*$/, '')
    return defang((atWord || head) + '…')
}

function render(h: SourceHit, vault: string): string {
    const id = defang(h.id)
    switch (h.kind) {
        case 'chat':
            return `- ${h.date ? `${defang(h.date)} — ` : ''}"${hookOf(h)}" (open: \`bismuth history show ${id}\`)`
        case 'docs':
            return `- ${id}${h.title ? ` — ${defang(h.title.replace(/\s+/g, ' ').trim())}` : ''} (read: \`bismuth docs read ${id}\`)`
        default: {
            const label = h.kind === 'pdf' && h.page ? `pdf, page ${h.page}` : h.kind
            return `- ${id} (${label}) — ${hookOf(h)} (open: \`${defang(join(vault, h.id))}\`)`
        }
    }
}

/** The text of the chosen items: the lead line and a blank line once, then per section its
 *  heading, a blank line, its items one per line, and a blank line closing it. */
function compose(chosen: Record<Section, string[]>): string {
    const out: string[] = []
    for (const { key, heading } of SECTIONS) {
        const items = chosen[key]
        if (!items.length) continue
        if (!out.length) out.push(LEAD, '')
        out.push(heading, '', items.join('\n'), '')
    }
    return out.length ? out.join('\n') + '\n' : ''
}

/** Pick and render source hits within `budgetChars`. An item that does not fit is skipped, not the
 *  end of the pass; each section stops at its `SOURCE_LIMITS` cap. `hits` are taken in the order
 *  given (best first). `text` is null when nothing was chosen. */
export function packSources(
    hits: SourceHit[],
    mode: 'prompt' | 'subagent',
    budgetChars: number,
    vault: string,
): { text: string | null; injected: SourceHit[] } {
    const limits = SOURCE_LIMITS[mode]
    const chosen: Record<Section, string[]> = { files: [], chats: [], docs: [] }
    const taken: Record<Section, SourceHit[]> = { files: [], chats: [], docs: [] }
    for (const { key } of SECTIONS)
        for (const h of hits) {
            if (sourceSection(h) !== key) continue
            if (taken[key].length >= limits[key]) break
            chosen[key].push(render(h, vault))
            if (compose(chosen).length > budgetChars) chosen[key].pop()
            else taken[key].push(h)
        }
    const text = compose(chosen)
    return {
        text: text || null,
        injected: SECTIONS.flatMap(s => taken[s.key]),
    }
}
