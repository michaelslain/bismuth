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
// Deliberately a hand-rolled line scan rather than anything from the `yaml` package: the
// question is "what did the user WRITE that the parser then dropped", and by the time the
// parser has answered, the dropped text is gone. A scan over the raw text is the only place
// both halves still exist. Pure — no imports, no I/O — so every case below is a unit test.

/** One frontmatter line whose plain scalar was cut short by a YAML comment. */
export interface TruncatedScalar {
    /** The frontmatter key whose value was cut, e.g. "filters". */
    key: string
    /** 1-based line number within the frontmatter text handed in. */
    line: number
    /** What YAML actually parsed — the value up to the comment, trimmed. */
    kept: string
    /** What the comment ate, starting at the `#`. */
    dropped: string
}

// `key: value` at any indent, including a `- ` sequence-item prefix. The key is deliberately
// narrow (word characters, dash, dot) so a colon inside prose does not read as a mapping.
const KEY_LINE = /^(\s*(?:-\s+)?)([\w.-]+):[ \t]+(.*)$/

export function findCommentTruncations(frontmatter: string): TruncatedScalar[] {
    const out: TruncatedScalar[] = []
    frontmatter.split('\n').forEach((raw, i) => {
        const m = KEY_LINE.exec(raw)
        if (!m) return
        const value = m[3]
        // A quoted scalar is immune: once the value OPENS with a quote, YAML is quoting and a
        // `#` inside it is just a character. Checking the first character is enough, and is
        // what distinguishes the two spellings the user is being told to switch between.
        const first = value.trimStart()[0]
        if (first === '"' || first === "'") return
        // The comment marker: a `#` with whitespace before it. A `#` at position 0 of the
        // value cannot be a truncation — the value IS a comment, so there was never a value.
        const at = value.search(/[ \t]#/)
        if (at < 0) return
        const kept = value.slice(0, at).trimEnd()
        if (!kept) return
        out.push({
            key: m[2],
            line: i + 1,
            kept,
            dropped: value.slice(at + 1),
        })
    })
    return out
}
