import { parseList, normalizeTag } from './schema/coerce'
import { stripCode } from './wikilinks'

/** A tag name: letters, digits, `_`, `/` (nesting) and `-`, starting with a letter, digit or `_`,
 *  and holding at least one letter — so `#42`, `#2026` and `#1-2` stay plain text (Obsidian's
 *  rule). The one source every tag reader builds its regex from (core indexing, the editor's
 *  tint, the reader's spans). Use with the `u` flag. */
export const TAG_NAME_SRC = '(?=[\\p{L}\\p{N}_/-]*\\p{L})[\\p{L}\\p{N}_][\\p{L}\\p{N}_/-]*'

/** Regex to match inline tags: #tag-name (preceded by whitespace or line start). A `\#` is not
 *  a tag, since the `#` follows a backslash. */
export const INLINE_TAG_REGEX = new RegExp(`(?:^|\\s)#(${TAG_NAME_SRC})`, 'gu')

export function extractTags(
    data: Record<string, unknown>,
    body: string,
): string[] {
    const tags = new Set<string>()

    // Frontmatter `tags`: YAML sequence OR comma-separated string. parseList is
    // comma-split only (so multi-word tags survive), array passthrough, null -> [].
    for (const item of parseList(data.tags)) {
        const tag = normalizeTag(item)
        if (tag) tags.add(tag)
    }

    // Extract tags from markdown body (#tag patterns). Strip fenced/inline code first
    // so a `#word` inside a code example doesn't register as a real tag. Fast path: a
    // body with no "#" at all can hold no inline tag, so skip the code-strip + scan
    // (~73% of note bodies contain no "#").
    if (body.indexOf('#') !== -1) {
        for (const match of stripCode(body).matchAll(INLINE_TAG_REGEX)) {
            const tag = match[1].trim()
            if (tag) tags.add(tag)
        }
    }

    return [...tags]
}
