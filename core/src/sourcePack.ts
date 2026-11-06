import { join } from 'node:path'
import { defang } from '@bismuth/memory'
import { SOURCE_EXCERPT_CHARS } from './semanticSources'
import type { SourceHit } from './semanticSources'

/** Renders the source half of the recall block: `# Vault files`, `# Past chats`, `# Bismuth docs`,
 *  each only when it has an item. Pure: no fs, no model. Recall appends the text just before the
 *  closing `</bismuth-memory>` tag, after whatever memory packed. */

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

const excerptOf = (h: SourceHit): string =>
    defang(h.excerpt.replace(/\s+/g, ' ').trim().slice(0, SOURCE_EXCERPT_CHARS))

function render(h: SourceHit, vault: string): string {
    const id = defang(h.id)
    switch (h.kind) {
        case 'chat':
            return `- ${h.date ? `${defang(h.date)} — ` : ''}"${excerptOf(h)}" (open: \`bismuth history show ${id}\`)`
        case 'docs':
            return `- ${id}${h.title ? ` — ${defang(h.title.replace(/\s+/g, ' ').trim())}` : ''} (read: \`bismuth docs read ${id}\`)`
        default: {
            const label = h.kind === 'pdf' && h.page ? `pdf, page ${h.page}` : h.kind
            return `## ${id} (${label})\nPath: ${defang(join(vault, h.id))}\n${excerptOf(h)}`
        }
    }
}

/** The text of the chosen items: a section is its heading, a blank line, then its items (files
 *  one blank line apart, chats and docs as a list), and a blank line closes it. */
function compose(chosen: Record<Section, string[]>): string {
    const out: string[] = []
    for (const { key, heading } of SECTIONS) {
        const items = chosen[key]
        if (!items.length) continue
        out.push(heading, '', key === 'files' ? items.join('\n\n') : items.join('\n'), '')
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
