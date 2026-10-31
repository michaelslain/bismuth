// app/src/export/blankLines.ts
// Keeps a note's extra blank lines in html/pdf/png export. marked folds any run of blank lines
// into one block boundary, so `a\n\n\n\nb` renders exactly like `a\n\nb` and the deliberate
// space a writer left in the editor disappears. The export template gives a paragraph one rule
// of bottom margin (htmlTemplate.ts), which covers the FIRST blank line; every blank line after
// it becomes a one-rule `.bismuth-blank-line` spacer block here, before marked runs.
import { maskCode, unmaskCode } from '../bases/markdown'

export const BLANK_LINE_CLASS = 'bismuth-blank-line'

const MATH_BLOCK_MASK_RE = /\$\$[\s\S]+?\$\$/g
const BLANK_RE = /^[ \t]*$/
// A next line indented this far (or by a tab) may be an indented code block, where a spacer
// would turn into literal text.
const CODE_INDENT_RE = /^(?: {4}|\t)/

/**
 * Turn each blank line past the first in a run between two blocks into a spacer div. Runs at
 * the start or end of the text are left alone (they separate nothing), and blank lines inside
 * fenced code, inline code or a `$$` math block are masked out first, so code keeps its own
 * lines. A spacer takes the indent of the line after it, so a gap inside a list item stays in
 * that item. Pure; unit-tested in blankLines.test.ts.
 */
export function keepBlankLines(md: string): string {
    const { masked, codes } = maskCode(md)
    const maths: string[] = []
    const src = masked.replace(
        MATH_BLOCK_MASK_RE,
        m => `\u0001${maths.push(m) - 1}\u0001`,
    )
    const lines = src.split('\n')
    const out: string[] = []
    let i = 0
    while (i < lines.length) {
        if (!BLANK_RE.test(lines[i])) {
            out.push(lines[i++])
            continue
        }
        let end = i
        while (end < lines.length && BLANK_RE.test(lines[end])) end++
        const run = end - i
        const next = lines[end]
        const between = out.length > 0 && next !== undefined
        if (!between || run < 2 || CODE_INDENT_RE.test(next)) {
            out.push(...lines.slice(i, end))
        } else {
            const indent = /^ */.exec(next)?.[0] ?? ''
            out.push('')
            for (let k = 1; k < run; k++)
                out.push(`${indent}<div class="${BLANK_LINE_CLASS}"></div>`, '')
        }
        i = end
    }
    const joined = out
        .join('\n')
        .replace(/\u0001(\d+)\u0001/g, (_m, n) => maths[Number(n)] ?? '')
    return unmaskCode(joined, codes)
}
