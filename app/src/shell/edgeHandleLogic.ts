// app/src/shell/edgeHandleLogic.ts
// What an edge handle SAYS and WHERE it points, derived once from three facts about its panel: which
// panel it is, which window edge the panel sits against, and whether the panel is open. Pure, so it is
// unit-tested (edgeHandleLogic.test.ts) — and so the four places that wired an EdgeHandle by hand stop
// re-deriving it, two of them wrongly (a chevron pointing the way the panel was NOT about to move).

export type EdgePanel = 'sidebar' | 'tab rail'
export type EdgeSide = 'left' | 'right'

export type EdgeHandleView = {
    /** The strip's accessible name. */
    label: string
    /** The toggle's name, lowercase — the button's tooltip. */
    action: string
    /** Which side of the line the pop-out button opens on: always AWAY from the panel, over the editor. */
    buttonSide: EdgeSide
    /** Which way the chevron points: the direction the panel's inner edge moves when toggled. */
    direction: EdgeSide
}

const opposite = (side: EdgeSide): EdgeSide => (side === 'left' ? 'right' : 'left')

/** The sidebar hides/shows; the rail pins/unpins. */
const ACTIONS: Record<EdgePanel, { open: string; closed: string }> = {
    sidebar: { open: 'hide sidebar', closed: 'show sidebar' },
    'tab rail': { open: 'unpin tab rail', closed: 'pin tab rail' },
}

export function edgeHandleView(
    panel: EdgePanel,
    edge: EdgeSide,
    open: boolean,
): EdgeHandleView {
    return {
        label: `${panel} edge`,
        action: open ? ACTIONS[panel].open : ACTIONS[panel].closed,
        buttonSide: opposite(edge),
        // Open: the toggle collapses the panel toward the window edge it sits on. Closed: it grows back
        // out of that edge, toward the editor.
        direction: open ? edge : opposite(edge),
    }
}
