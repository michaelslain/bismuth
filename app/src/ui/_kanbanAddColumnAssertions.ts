// app/src/ui/_kanbanAddColumnAssertions.ts
// Story-only probes for bases/KanbanAddColumn, shared by Bases/KanbanAddColumn.stories.tsx (the
// ghost alone) and Bases/KanbanView/Columns.stories' AddColumn (the ghost at the end of a real
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

/** The resting trigger's `+` glyph: its box's left edge and vertical CENTRE. The trigger is an
 *  IconButton (icon `Plus`, no text node), so this reads the `svg` inside the button — the same
 *  element KanbanAddColumn.placeOverlay measures. */
export function restGlyphOrigin(ghost: HTMLElement): TextOrigin {
    const r = (
        ghost.querySelector('button svg') as SVGElement
    ).getBoundingClientRect()
    return { x: r.left, y: r.top + r.height / 2 }
}

/** Where an <input>'s text starts: the content-box left, and for y the content box's vertical
 *  CENTRE (a single-line input centres its text vertically) — the same two quantities
 *  restGlyphOrigin reads and that bases/kanbanAddColumnOverlay's overlayOrigin aligns on, so the
 *  two compare apples to apples. */
export function inputTextOrigin(input: HTMLInputElement): TextOrigin {
    const cs = getComputedStyle(input)
    const r = input.getBoundingClientRect()
    const padT = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)
    const padB = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth)
    const contentH = r.height - padT - padB
    return {
        x: r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth),
        y: r.top + padT + contentH / 2,
    }
}

/** Every real board column's width, in DOM order, plus the ghost's own — a reflow anywhere on
 *  the board changes at least one entry. */
export function boardWidths(root: Element): number[] {
    const cols = Array.from(root.querySelectorAll('[data-kbcol]'))
    return [...cols, ghostOf(root)].map(el => el.getBoundingClientRect().width)
}
