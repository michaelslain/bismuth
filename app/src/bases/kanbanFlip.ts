// Pure DOM + math helpers behind the kanban drag: the FLIP (First-Last-Invert-Play) rect
// snapshot/play shared by the card- and column-level animations, the transform each of those
// plays, and the drop-slot resolution a pointer move runs against the hovered column. No Solid
// import — the stateful engine that drives these is `kanbanDrag.ts`.

/** The `{from, to}` transform pair a FLIP plays, or null to skip an element that didn't move. */
export type FlipTransform = { from: string; to: string } | null

/** Snapshot every element matching `selector`'s rect, keyed by `keyOf(el)` — the First half
 * of FLIP. Shared by the card-level and column-level FLIPs. */
export function snapshotFlip(
    root: ParentNode | undefined,
    map: Map<string, DOMRect>,
    selector: string,
    keyOf: (el: HTMLElement) => string | null | undefined,
): void {
    if (!root) return
    map.clear()
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
        const k = keyOf(el)
        if (k != null) map.set(k, el.getBoundingClientRect())
    }
}

/** Play the Invert+Play half of FLIP: for every element matching `selector` whose rect moved
 * since the matching `snapshotFlip`, force it back to its old position with no transition,
 * then release it into a `${ms}ms` transition back to rest. `transformFor(dx, dy)` returns the
 * `{from, to}` transform pair, or a falsy value to skip an element that didn't move on the axis
 * that matters (both axes for cards, x-only for columns). */
export function playFlipFrom(
    root: ParentNode | undefined,
    map: Map<string, DOMRect>,
    selector: string,
    keyOf: (el: HTMLElement) => string | null | undefined,
    transformFor: (dx: number, dy: number) => FlipTransform,
    ms: number,
): void {
    if (!root || map.size === 0) return
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
        const k = keyOf(el)
        const prev = k != null ? map.get(k) : undefined
        if (!prev) continue
        const now = el.getBoundingClientRect()
        const dx = prev.left - now.left
        const dy = prev.top - now.top
        const t = transformFor(dx, dy)
        if (!t) continue
        el.style.transition = 'none'
        el.style.transform = t.from
        // Force a reflow so the next style change actually transitions.
        el.getBoundingClientRect()
        el.style.transition = `transform ${ms}ms cubic-bezier(.2,.7,.2,1)`
        el.style.transform = t.to
    }
    map.clear()
}

/** A card slides on both axes (it can change column AND position within one). */
export function cardFlipTransform(dx: number, dy: number): FlipTransform {
    return dx === 0 && dy === 0
        ? null
        : {
              from: `translate(${dx}px, ${dy}px)`,
              to: 'translate(0, 0)',
          }
}

/** A column only ever moves horizontally on a header reorder. */
export function columnFlipTransform(dx: number): FlipTransform {
    return dx === 0
        ? null
        : { from: `translateX(${dx}px)`, to: 'translateX(0)' }
}

/** The slot a dragged card lands in within a column: the index of the first card whose vertical
 * midpoint is below the cursor `y`, else the end. `rectOf` is read lazily, in order, and the walk
 * stops at the first hit — so only the cards above the drop slot are measured. */
export function cardDropIndex<T>(
    cards: T[],
    rectOf: (card: T) => { top: number; height: number },
    y: number,
): number {
    let idx = cards.length
    for (let k = 0; k < cards.length; k++) {
        const r = rectOf(cards[k])
        if (y < r.top + r.height / 2) {
            idx = k
            break
        }
    }
    return idx
}

/** Whether `x` is in the right half of `rect` — a column drag drops AFTER the hovered column
 * when true. */
export function isAfterMidpoint(
    x: number,
    rect: { left: number; width: number },
): boolean {
    return x > rect.left + rect.width / 2
}
