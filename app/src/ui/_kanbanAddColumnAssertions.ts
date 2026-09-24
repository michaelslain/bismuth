// app/src/ui/_kanbanAddColumnAssertions.ts
// Story-only probes for bases/KanbanAddColumn, shared by Bases/KanbanAddColumn.stories.tsx (the
// ghost alone) and Bases/KanbanView.stories.tsx's AddColumn (the ghost at the end of a real
// board). ONE definition of "where the text starts", so the two stories cannot drift apart on
// what they measure. Keys only on `data-testid="kanban-add-column"`, `data-kbcol` and tag
// selectors — never a CSS-module class name, which hashes.

/** Resolve once the UI web font has loaded. Every width and glyph box here depends on it, and a
 *  play() that measures "rest" in the fallback face then "editing" in the real one reads a
 *  font swap as a reflow (the ghost measured 71.4px, then 73.0px, with nothing clicked). */
export const fontsSettled = () => document.fonts.ready

export type TextOrigin = { x: number; y: number }

/** The ghost root KanbanAddColumn renders (its `data-testid`). */
export const ghostOf = (root: Element) =>
    root.querySelector('[data-testid="kanban-add-column"]') as HTMLElement

/** The resting "column" glyph box's top-left: a Range over the trigger's own text node, so
 *  line-box leading and button padding cannot hide a real shift. The trigger's label span now
 *  also holds a leading icon span (IconTextButton) ahead of the text, so the text node is found
 *  by node type rather than assumed to be the label's `firstChild` — that assumption silently
 *  measured the icon's glyph box instead once the icon was added, with no typecheck or test
 *  failure to catch it. */
export function restTextOrigin(ghost: HTMLElement): TextOrigin {
    const label = ghost.querySelector('button span') as HTMLElement
    const node = Array.from(label.childNodes).find(
        n => n.nodeType === Node.TEXT_NODE,
    ) as Node
    const range = document.createRange()
    range.selectNodeContents(node)
    const r = range.getBoundingClientRect()
    return { x: r.left, y: r.top }
}

/** Where an <input>'s text glyph box starts. A Range cannot reach an input's internal text, so
 *  this takes the content-box left, and for y centres a same-font mirror span's glyph box in
 *  the content box (a single-line input centres its text vertically) — the same glyph-box
 *  quantity restTextOrigin reads, so the two compare apples to apples. */
export function inputTextOrigin(input: HTMLInputElement): TextOrigin {
    const cs = getComputedStyle(input)
    const r = input.getBoundingClientRect()
    // The mirror must stay INLINE: `position: absolute` on the span itself blockifies it, and a
    // block's height is its line-height, not the glyph box — which would read the text as sitting
    // (line-height - glyph) / 2 higher than it paints. So the out-of-flow part is a wrapper.
    const wrap = document.createElement('div')
    wrap.style.position = 'absolute'
    wrap.style.visibility = 'hidden'
    const mirror = document.createElement('span')
    mirror.textContent = 'name'
    mirror.style.font = cs.font
    wrap.appendChild(mirror)
    document.body.appendChild(wrap)
    const glyphH = mirror.getBoundingClientRect().height
    wrap.remove()
    const padT = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)
    const padB = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth)
    const contentH = r.height - padT - padB
    return {
        x: r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth),
        y: r.top + padT + (contentH - glyphH) / 2,
    }
}

/** Every real board column's width, in DOM order, plus the ghost's own — a reflow anywhere on
 *  the board changes at least one entry. */
export function boardWidths(root: Element): number[] {
    const cols = Array.from(root.querySelectorAll('[data-kbcol]'))
    return [...cols, ghostOf(root)].map(el => el.getBoundingClientRect().width)
}
