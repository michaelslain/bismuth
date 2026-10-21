// app/src/editor/inlineMath.ts
// Pure, DOM-free rule for single-line inline `$…$` math, shared by the live-preview editor and
// table cells (inlineMarkdown). Pandoc's rule, so a plain dollar amount stays text:
//   - the opening `$` is not `$$` and the char just inside it is not whitespace
//   - the closing `$` has no whitespace just inside it and is not followed by a digit or `$`
//   - `\$` is a literal dollar, never a delimiter
// So `$5 and $10`, `$5-$10` and `costs \$5` stay text while `$x^2$` renders.
// The reader (bases/markdown.ts) and the multi-line scan (mathBlock.ts) apply the same rule.

export type InlineMathSpan = { from: number; to: number; inner: string }

/** If the `$` at `open` begins an inline-math span on its line, return the index just past its
 *  closing `$`; else -1. The caller has already ruled out an escaped `$` (one after `\`). */
export function matchInlineMath(src: string, open: number): number {
    if (src[open] !== '$' || src[open + 1] === '$') return -1
    const after = src[open + 1]
    if (after === undefined || /\s/.test(after)) return -1
    for (let j = open + 1; j < src.length; j++) {
        const ch = src[j]
        if (ch === '\\') {
            j++
            continue
        } // skip the escaped char (e.g. \$)
        if (ch === '\n') return -1
        if (ch === '$') {
            if (/\s/.test(src[j - 1])) return -1
            const next = src[j + 1]
            if (next === '$' || (next !== undefined && next >= '0' && next <= '9'))
                return -1
            return j + 1
        }
    }
    return -1
}

/** Every inline-math span on one line, in order. `$$` pairs and `\`-escaped chars are stepped
 *  over, so neither a display delimiter nor `\$` ever opens a span. */
export function findInlineMath(line: string): InlineMathSpan[] {
    const spans: InlineMathSpan[] = []
    let i = 0
    while (i < line.length) {
        const ch = line[i]
        if (ch === '\\') {
            i += 2
            continue
        }
        if (ch !== '$') {
            i++
            continue
        }
        if (line[i + 1] === '$') {
            i += 2
            continue
        }
        const end = matchInlineMath(line, i)
        if (end < 0) {
            i++
            continue
        }
        spans.push({ from: i, to: end, inner: line.slice(i + 1, end - 1) })
        i = end
    }
    return spans
}

/** Every `\$` and `\#` on one line: the index of each escaping backslash. A run of backslashes
 *  pairs off first (`\\$` is an escaped backslash, then a bare `$`). The editor hides these
 *  backslashes off the caret so an escaped dollar or hash reads as the plain character. */
export function findSymbolEscapes(line: string): number[] {
    const out: number[] = []
    for (let i = 0; i < line.length; i++) {
        if (line[i] !== '\\') continue
        const next = line[i + 1]
        if (next === '$' || next === '#') out.push(i)
        i++ // the escaped char (or the second `\` of a pair) is consumed
    }
    return out
}
