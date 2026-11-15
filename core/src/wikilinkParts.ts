// The parts of a wikilink's inner text (`[[target#anchor|alias]]`, between the brackets). Every
// parser that reads a link's target or alias goes through here, so they agree on one rule set.
// Pure: no I/O, no framework imports.

/** Split `target#anchor|alias` into its trimmed parts. A pipe written `\|` separates like `|`
 *  (inside a markdown table a bare pipe would end the cell, so Obsidian writes `[[Note\|Alias]]`
 *  there), and its backslash belongs to neither side. `#` splits on its first occurrence. `anchor` is the text
 *  after the `#` (a heading, or `^id` for a block); absent parts are undefined. */
export function splitWikilinkInner(inner: string): {
    target: string
    anchor?: string
    alias?: string
} {
    const pipe = inner.indexOf('|')
    let left = pipe === -1 ? inner : inner.slice(0, pipe)
    if (pipe !== -1 && left.endsWith('\\')) left = left.slice(0, -1)
    const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim()
    const hash = left.indexOf('#')
    const anchor = hash === -1 ? undefined : left.slice(hash + 1).trim()
    const target = (hash === -1 ? left : left.slice(0, hash)).trim()
    return {
        target,
        ...(anchor ? { anchor } : {}),
        ...(alias ? { alias } : {}),
    }
}
