// transcriptDocWindow.ts — which page sections of the text-mode column mount an editor.
// Pure: sizes and offsets in, a window out. A section off the window keeps its height (measured
// once seen, estimated until then) so the column's scroll length never changes under the reader.

export type WindowInput = {
    count: number
    /** Measured heights by index; undefined where the section has not been laid out yet. */
    heights: (number | undefined)[]
    /** Guess for an unmeasured section. */
    estimate: (index: number) => number
    scrollTop: number
    viewport: number
    /** Extra px mounted above and below the viewport. */
    overscan: number
}

export type WindowPlan = {
    /** First index to mount. */
    from: number
    /** One past the last index to mount. */
    to: number
    /** Top offset of every section; `tops[count]` is the column's total height. */
    tops: number[]
}

export function sizeAt(input: Pick<WindowInput, 'heights' | 'estimate'>, i: number) {
    return input.heights[i] ?? input.estimate(i)
}

export function planWindow(input: WindowInput): WindowPlan {
    const tops: number[] = new Array(input.count + 1)
    let y = 0
    for (let i = 0; i < input.count; i++) {
        tops[i] = y
        y += sizeAt(input, i)
    }
    tops[input.count] = y
    const lo = input.scrollTop - input.overscan
    const hi = input.scrollTop + input.viewport + input.overscan
    let from = 0
    while (from < input.count && tops[from + 1] <= lo) from++
    from = Math.max(0, Math.min(from, input.count - 1))
    let to = from
    while (to < input.count && tops[to] < hi) to++
    return { from, to: Math.max(to, Math.min(from + 1, input.count)), tops }
}

/** The section holding offset `y`, and how far through it `y` is (0..1). */
export function indexAt(tops: number[], y: number): { index: number; frac: number } {
    const count = tops.length - 1
    if (count <= 0) return { index: 0, frac: 0 }
    let lo = 0
    let hi = count - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (tops[mid] <= y) lo = mid
        else hi = mid - 1
    }
    const size = tops[lo + 1] - tops[lo]
    const frac = size > 0 ? Math.min(1, Math.max(0, (y - tops[lo]) / size)) : 0
    return { index: lo, frac }
}

/** The offset that puts section `index`, `frac` of the way through, at the top. */
export function offsetOf(tops: number[], index: number, frac = 0) {
    const i = Math.max(0, Math.min(index, tops.length - 2))
    return tops[i] + (tops[i + 1] - tops[i]) * frac
}

/** A section's height before it is measured: the divider plus one line per text line, wrapped at
 *  about `charsPerLine`. Close enough that mounting the editor moves the column by little. */
export function estimateHeight(text: string, o: { divider: number; line: number; charsPerLine: number; min: number }) {
    let lines = 0
    for (const l of text.split('\n')) lines += Math.max(1, Math.ceil(l.length / o.charsPerLine))
    return o.divider + Math.max(o.min, lines * o.line)
}
