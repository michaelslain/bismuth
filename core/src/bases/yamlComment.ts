import { LineCounter, Scalar, isPair, isScalar, parseDocument, visit } from 'yaml'

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
// types.ts`, `docs/bases/filters.md`), just written differently — each leaf is a bare
// sequence item with no colon of its own, and YAML's block-sequence rules let that item sit
// at any of several valid indentations relative to the key that introduces it.
//
// This was originally a hand-rolled line scan, on the theory that "by the time the parser
// has answered, the dropped text is gone." That theory is wrong, and the two rewrites it
// took to find out are why this comment says so plainly: `parseDocument` keeps a `range`
// into the ORIGINAL source on every node, and `range[1]` marks exactly where the parser
// stopped reading a value — which is exactly where a truncating comment began. Nothing is
// gone; both the kept text and the dropped text are still addressable from the source string.
//
// A hand-rolled scan has to re-derive YAML's block structure — indentation rules, flush
// sequences, blank lines between a key and its list — from regexes, and that structure has
// more shapes than an indent stack can track: the scan variously misattributed a nested tree
// leaf to the wrong enclosing key, silently dropped a top-level flush sequence's report
// entirely, and misattributed an item following a nested block to that nested key instead of
// its true parent. Do not go back to a line scan; the parser has already solved this problem.
//
// The mechanism actually used:
//   - `parseDocument` builds the real AST, so there is no indentation to re-derive.
//   - `visit` walks it and hands each `Scalar` its `path` — the chain of ancestor nodes back
//     to the document root. Walking that path back to the nearest `Pair` whose key is a
//     `Scalar` gives the ENCLOSING key directly, whether the scalar is a flat value or a bare
//     item several levels down an `and`/`or`/`not` tree. No stack, no indent comparison.
//   - `Scalar.PLAIN` is the parser's OWN verdict on whether a scalar was quoted — replacing
//     the "does the value start with a quote character" heuristic with the thing that
//     heuristic was trying to approximate.
//   - `node.range[1]` is the offset where the parser stopped reading the scalar. The text from
//     there to the next newline is inspected for the comment marker (whitespace then `#`); if
//     found, everything before it on that stretch is what was kept, and it agrees with the
//     parsed value by construction — it IS the parsed value — not by cross-checking a second
//     implementation of "what YAML would have parsed."
//   - `LineCounter` turns that same offset into a 1-based line number for the report.

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

export function findCommentTruncations(frontmatter: string): TruncatedScalar[] {
    const lineCounter = new LineCounter()
    const doc = parseDocument(frontmatter, { lineCounter })
    const out: TruncatedScalar[] = []

    visit(doc, {
        Scalar(key, node, path) {
            // `key === 'key'` is the mapping KEY itself (e.g. `filters` in `filters: …`), not
            // its value — a user does not write a truncatable expression as a key.
            if (key === 'key') return
            // Only a PLAIN scalar can be truncated: once YAML is quoting, a `#` inside the
            // quotes is just a character, and the parser has already told us that via `type`.
            if (node.type !== Scalar.PLAIN) return
            if (typeof node.value !== 'string') return
            if (!node.range) return

            const end = node.range[1]
            const eol = frontmatter.indexOf('\n', end)
            const rest = frontmatter.slice(end, eol < 0 ? frontmatter.length : eol)
            // The comment marker: whitespace then `#`, immediately after where the parser
            // stopped reading the value. Anything else on that stretch (more of the same
            // line, past the scalar) is not this module's concern.
            if (!/^[ \t]+#/.test(rest)) return

            // Walk back to the nearest Pair whose key is itself a Scalar — that is the
            // enclosing key, whether this scalar is a flat `key: value` or a bare item
            // several levels into an `and`/`or`/`not` tree. Real text from the user's own
            // file, taken from the AST, never invented.
            let enclosing = ''
            for (let i = path.length - 1; i >= 0; i--) {
                const ancestor = path[i]
                if (isPair(ancestor) && isScalar(ancestor.key)) {
                    enclosing = String(ancestor.key.value)
                    break
                }
            }

            out.push({
                key: enclosing,
                line: lineCounter.linePos(end).line,
                kept: node.value,
                dropped: rest.replace(/^[ \t]+/, '').replace(/\r$/, ''),
            })
        },
    })

    return out
}
