// Pure dev-time lint helpers for the ui/ primitives. These encode the
// standardization rules the components enforce:
//   • TextButton labels must be lowercase — pass already-lowercase text; no
//     hidden CSS transform, what you pass is what shows.
//   • IconButton/SearchBar icons must be icon names, never literal glyphs.
// The checks are pure so they can be unit-tested; the components call them
// behind an `import.meta.env.DEV` guard and emit console warnings.

/** Recursively collect the plain-string text out of a JSX children value. */
export function extractText(children: unknown): string {
    if (children == null || children === true || children === false) return ''
    if (typeof children === 'string') return children
    if (typeof children === 'number') return String(children)
    if (Array.isArray(children)) return children.map(extractText).join('')
    // Functions / DOM nodes / components contribute no statically-knowable text.
    return ''
}

/** True when `text` contains no uppercase A–Z letter (i.e. it is all-lowercase, or has no letters at all). */
export function isLowercaseLabel(text: string): boolean {
    return !/[A-Z]/.test(text)
}

/**
 * Returns a warning string if the children's text is not all-lowercase, else null.
 * Empty / non-textual children (icon-only, dynamic) pass silently.
 */
export function labelCaseWarning(children: unknown): string | null {
    const text = extractText(children).trim()
    if (!text) return null
    if (isLowercaseLabel(text)) return null
    return `TextButton label must be lowercase — got "${text}". Pass "${text.toLowerCase()}".`
}
