// Geometry probes for THE ONE LIST-MARKER COLUMN, shared by the two story files that assert it:
// editor/TaskCheckbox.stories.tsx (rendered markers) and Editor.stories.tsx (the revealed raw
// marker and the caret inside it). Story-only, like ui/_fontFace.ts and ui/_storyKit.tsx —
// nothing in the app imports it, so the `_` prefix marks it as harness code.
//
// WHY RANGES AND NOT ELEMENT RECTS. The thing being graded is a HANGING INDENT, and an element
// rect cannot see it: a wrapped line is one element with one rect, so "row 1 starts where row 2
// starts" is unanswerable from `getBoundingClientRect()`. Worse, a list line carries a NEGATIVE
// `text-indent`, which is inherited — a marker rendered as inline text or through a `::before`
// applies that indent to its own first line and paints somewhere its element rect does not
// report. `Range.getClientRects()` returns one rect per visual row of real laid-out text, which
// is the only measurement that matches the pixels.

/** The x of the first glyph of each visual row of a list line's OWN text — the marker column's
 *  contents excluded. `[0]` is the first row, `[1]` the first wrapped continuation row. */
export function textRowLefts(line: Element): number[] {
    const MARKER =
        '.cm-checkbox, .cm-task-checkbox, .cm-bullet, .cm-ol-number, .cm-list-marker'
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n as Text
        if (!t.data.trim()) continue
        if (t.parentElement?.closest(MARKER)) continue
        nodes.push(t)
    }
    if (!nodes.length)
        throw new Error(
            `no text outside the marker column on line ${JSON.stringify(line.textContent)}`,
        )
    const rects: DOMRect[] = []
    for (const n of nodes) {
        const r = document.createRange()
        r.selectNodeContents(n)
        rects.push(...Array.from(r.getClientRects()))
    }
    const rows: number[] = []
    let lastTop = -Infinity
    for (const rect of rects) {
        if (rect.width === 0 && rect.height === 0) continue
        if (rect.top > lastTop + 1) {
            rows.push(rect.left)
            lastTop = rect.top
        }
    }
    return rows
}

/** The marker COLUMN's box — `.cm-checkbox` / `.cm-bullet` / `.cm-ol-number` for a rendered
 *  marker, `.cm-list-marker` for the raw one revealed under the caret. Document order puts the
 *  `.cm-checkbox` column ahead of the `.cm-task-checkbox` glyph it contains. */
export function markerRect(line: Element): DOMRect {
    const el = line.querySelector(
        '.cm-checkbox, .cm-bullet, .cm-ol-number, .cm-list-marker',
    )
    if (!el)
        throw new Error(
            `no marker column on line ${JSON.stringify(line.textContent)}`,
        )
    return el.getBoundingClientRect()
}

/** `.cm-content`'s content-box left: THE CLIP EDGE. A note editor has horizontal padding and
 *  merely spills into its own chrome, but the chat composer's CodeMirror content box has zero
 *  horizontal padding and `.cm-scroller` clips at it — so anything a list line hangs left of
 *  this is sliced off there (it is what used to shave the left of every numeral). */
export function contentOriginLeft(root: Element): number {
    const content = root.querySelector('.cm-content')
    if (!content) throw new Error('no .cm-content inside this editor')
    const cs = getComputedStyle(content)
    return (
        content.getBoundingClientRect().left +
        parseFloat(cs.borderLeftWidth) +
        parseFloat(cs.paddingLeft)
    )
}

/** The `.cm-line` whose rendered text contains `needle`. */
export function lineWith(root: Element, needle: string): Element {
    const line = [...root.querySelectorAll('.cm-line')].find(l =>
        (l.textContent ?? '').includes(needle),
    )
    if (!line) throw new Error(`no .cm-line containing ${JSON.stringify(needle)}`)
    return line
}
