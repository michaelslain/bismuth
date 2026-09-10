// Detect the one silent YAML behaviour that eats a Bases expression.
//
// In YAML a `#` preceded by whitespace starts a comment — and inside a PLAIN (unquoted)
// scalar that rule still applies, because the `"` characters in `tags.contains(" #book")`
// are ordinary text rather than YAML quoting: the scalar did not START with a quote, so
// nothing is quoting anything. The result:
//
//     filters: tags.contains("#book")     ->  tags.contains("#book")     (fine)
//     filters: tags.contains(" #book")    ->  tags.contains("           (silently truncated)
//
// That is correct YAML and there is nothing to fix in the parser. What is missing is anyone
// TELLING the user, so `bismuth base validate` calls this and reports the line with the fix
// (wrap the whole value in single quotes).
//
// The SAME truncation hits `and`/`or`/`not` filter trees (`FilterNode`, `core/src/bases/
// types.ts`, `docs/bases/filters.md`), just written differently — each leaf is a BARE
// sequence item with no colon of its own:
//
//     filters:
//       and:
//         - tags.contains(" #book")     (silently truncated, same as the flat spelling)
//         - status == "active"
//
// A bare item has no key to report against, so it is attributed to the nearest enclosing
// `and:`/`or:`/`filters:` line above it — real text from the user's own file, never invented.
//
// Deliberately a hand-rolled line scan rather than anything from the `yaml` package: the
// question is "what did the user WRITE that the parser then dropped", and by the time the
// parser has answered, the dropped text is gone. A scan over the raw text is the only place
// both halves still exist. Pure — no imports, no I/O — so every case below is a unit test.

/** One frontmatter line whose plain scalar was cut short by a YAML comment. */
export interface TruncatedScalar {
    /**
     * The frontmatter key whose value was cut, e.g. "filters". For a bare sequence item
     * inside an `and`/`or`/`not` tree (no key of its own), this is the nearest enclosing
     * key above it instead, e.g. "and".
     */
    key: string
    /** 1-based line number within the frontmatter text handed in. */
    line: number
    /** What YAML actually parsed — the value up to the comment, trimmed. */
    kept: string
    /** What the comment ate, starting at the `#`. */
    dropped: string
}

// `key: value` on one line, at any indent, including a `- ` sequence-item prefix. The key is
// deliberately narrow (word characters, dash, dot) so a colon inside prose does not read as a
// mapping. Requires whitespace between the colon and the value — see HEADER_LINE below for why
// that can't just be made optional.
const KEY_LINE = /^(\s*(?:-\s+)?)([\w.-]+):[ \t]+(.*)$/

// A key with NOTHING after the colon but whitespace — `and:`, `or:`, `not:`, `filters:` — the
// way and/or/not filter trees open a nested block. This needs its OWN regex rather than making
// KEY_LINE's value optional: doing that would also swallow a bare value like `- http://x` as a
// bogus key `http` with no value, since nothing would require a value to follow the colon.
const HEADER_LINE = /^(\s*(?:-\s+)?)([\w.-]+):\s*$/

// A bare sequence item — the leaf shape and/or/not trees are written in. Tried only after
// KEY_LINE and HEADER_LINE both miss, so an item that IS itself `key: value` (`- type: table`)
// still matches KEY_LINE and is handled there, keyed by its own key, same as always.
const BARE_ITEM = /^(\s*)-\s+(.*)$/

/**
 * Check one already-isolated scalar for a comment truncation. Shared by both codepaths below —
 * a `key: value` line and a bare `- value` sequence item apply the exact same rule: a quoted
 * scalar is immune, and a `#` with whitespace before it truncates.
 */
function truncationOf(value: string): { kept: string; dropped: string } | null {
    // A quoted scalar is immune: once the value OPENS with a quote, YAML is quoting and a `#`
    // inside it is just a character. Checking the first character is enough, and is what
    // distinguishes the two spellings the user is being told to switch between.
    const first = value.trimStart()[0]
    if (first === '"' || first === "'") return null
    // The comment marker: a `#` with whitespace before it. A `#` at position 0 of the value
    // cannot be a truncation — the value IS a comment, so there was never a value.
    const at = value.search(/[ \t]#/)
    if (at < 0) return null
    const kept = value.slice(0, at).trimEnd()
    if (!kept) return null
    return { kept, dropped: value.slice(at + 1) }
}

export function findCommentTruncations(frontmatter: string): TruncatedScalar[] {
    const out: TruncatedScalar[] = []
    // Nearest-enclosing-key stack for bare sequence items, which have no key of their own.
    // `and:`/`or:`/`not:`/`filters:` push a frame here; a bare `- value` item below reports
    // under whichever frame is still open at its indent. Popped by indent on EVERY line, not
    // just headers, so returning to a shallower key clears any deeper frame before it can leak
    // into an unrelated sibling further down the file.
    const stack: Array<{ indent: number; key: string }> = []

    frontmatter.split('\n').forEach((raw, i) => {
        const indent = raw.length - raw.trimStart().length
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()

        const km = KEY_LINE.exec(raw)
        if (km) {
            const t = truncationOf(km[3])
            if (t) out.push({ key: km[2], line: i + 1, ...t })
            return
        }

        const hm = HEADER_LINE.exec(raw)
        if (hm) {
            stack.push({ indent, key: hm[2] })
            return
        }

        const bm = BARE_ITEM.exec(raw)
        if (bm && stack.length) {
            const t = truncationOf(bm[2])
            if (t) out.push({ key: stack[stack.length - 1].key, line: i + 1, ...t })
        }
    })
    return out
}
