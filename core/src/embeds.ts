import { stripCode } from './wikilinks'
import { splitWikilinkInner } from './wikilinkParts'

/** `![[target]]`, `![[target|size]]`, `![[target#heading]]`. */
const EMBED_REGEX = /!\[\[([^\]]+?)\]\]/g

/**
 * The targets a note embeds with `![[...]]`, in first-seen order, deduplicated: the text
 * before any `|` (alias or image size) and `#` (heading or block), trimmed, with a table
 * cell's escaped `\|` read as a pipe (`splitWikilinkInner`). Embeds inside code are skipped,
 * as `extractWikilinks` skips links there.
 */
export function extractEmbeds(md: string): string[] {
    if (md.indexOf('![[') === -1) return []
    const targets = new Set<string>()
    for (const match of stripCode(md).matchAll(EMBED_REGEX)) {
        const { target } = splitWikilinkInner(match[1])
        if (target) targets.add(target)
    }
    return [...targets]
}
