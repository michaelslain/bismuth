// app/src/editor/readerAnchor.ts
// Where the line the reader is looking at lands after an external write replaces the buffer.
//
// `externalReconcileSpec` applies an external write as ONE change, the span between the common
// prefix and suffix. When an agent rewrites a note, that span covers most of it, and CodeMirror
// maps every position inside a replaced span to the span's edge — so its own scroll anchor, and
// any pixel scrollTop the editor pins, throw the reader to the top or bottom of the rewrite.
// This picks the reader's line in the NEW text instead: unchanged positions shift by the change's
// length, and a position inside the span finds the same line text in the replacement (the copy
// nearest to where it sits proportionally), else the line at that proportional offset.
//
// Pure and framework-free so it is testable under `bun test`.
import { minimalChange } from './normalizeFrontmatter'

const lineStartAt = (text: string, pos: number): number =>
    text.lastIndexOf('\n', pos - 1) + 1

/** The start of the line in `next` that holds what `pos` held in `current`. */
export const mapReaderAnchor = (
    current: string,
    next: string,
    pos: number,
): number => {
    const { from, to, insert } = minimalChange(current, next)
    if (pos <= from) return lineStartAt(next, pos)
    if (pos >= to) return lineStartAt(next, pos + insert.length - (to - from))

    const start = lineStartAt(current, pos)
    const end = current.indexOf('\n', pos)
    const line = current.slice(start, end < 0 ? current.length : end)
    const target = from + ((pos - from) * insert.length) / (to - from)

    if (line.trim()) {
        let best = -1
        for (
            let i = next.indexOf(line, lineStartAt(next, from));
            i >= 0 && i <= from + insert.length;
            i = next.indexOf(line, i + 1)
        ) {
            const whole =
                (i === 0 || next[i - 1] === '\n') &&
                (i + line.length === next.length ||
                    next[i + line.length] === '\n')
            if (
                whole &&
                (best < 0 || Math.abs(i - target) < Math.abs(best - target))
            )
                best = i
        }
        if (best >= 0) return best
    }
    return lineStartAt(next, Math.round(target))
}
