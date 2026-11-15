import { stripCode } from './wikilinks'

/** `![[target]]`, `![[target|size]]`, `![[target#heading]]`. */
const EMBED_REGEX = /!\[\[([^\]]+?)\]\]/g

/**
 * The targets a note embeds with `![[...]]`, in first-seen order, deduplicated: the text
 * before any `|` (alias or image size) and `#` (heading or block), trimmed. A table cell
 * escapes the pipe as `\|`, so a trailing backslash is dropped from the target. Embeds
 * inside code are skipped, as `extractWikilinks` skips links there.
 */
export function extractEmbeds(md: string): string[] {
    if (md.indexOf('![[') === -1) return []
    const targets = new Set<string>()
    for (const match of stripCode(md).matchAll(EMBED_REGEX)) {
        const target = match[1]
            .split('|')[0]
            .split('#')[0]
            .replace(/\\$/, '')
            .trim()
        if (target) targets.add(target)
    }
    return [...targets]
}
