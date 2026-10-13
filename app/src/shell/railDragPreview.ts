// app/src/shell/railDragPreview.ts
// The live reorder preview for a tab dragged on the rail. While the drag is over the rail, each row
// is offset to the slot it takes once the drop lands, so the rows part around the drop slot as the
// pointer moves, the way kanban cards do. The order the drop would produce comes from `reorderTabs`
// itself, pinned-block clamp included, so the preview and the drop always agree. Off the rail the
// order holds at the last slot the drag showed.
import {
    createEffect,
    createMemo,
    createSignal,
    untrack,
    type Accessor,
} from 'solid-js'
import type { DragState } from '../dnd/viewDrag'
import { reorderTabs, type Tab } from '../panes'
import { railShifts } from './tabRailShift'

/** Distance between two row tops on the rail (row height + list gap). `offsetTop` ignores the
 *  slide transforms, so it reads the same mid-drag as at rest. */
function measureRailPitch(): number {
    const rows = document.querySelectorAll<HTMLElement>(
        '[data-tabstrip="vertical"] [data-tab-chip]',
    )
    if (rows.length >= 2) return rows[1].offsetTop - rows[0].offsetTop
    return rows[0]?.offsetHeight ?? 0
}

export function createRailDragPreview(
    drag: Accessor<DragState>,
    tabs: Accessor<Tab[]>,
) {
    /** The tab mid-drag, or null — its row turns into the drop slot. */
    const draggingTabId = (): string | null => {
        const d = drag()
        return d.active && d.descriptor?.kind === 'tab'
            ? d.descriptor.tabId
            : null
    }
    let pitch = 0
    const [slot, setSlot] = createSignal<number | null>(null)
    createEffect(() => {
        const d = drag()
        if (!d.active || d.descriptor?.kind !== 'tab') return setSlot(null)
        const id = d.descriptor.tabId
        untrack(() => {
            const fresh = slot() === null
            if (fresh) pitch = measureRailPitch()
            if (d.target?.kind === 'tabstrip') setSlot(d.target.index)
            else if (fresh) setSlot(tabs().findIndex(t => t.id === id))
        })
    })
    /** Each row's px offset, in `tabs()` order; all zero outside a tab drag. */
    const shifts = createMemo((): number[] => {
        const id = draggingTabId()
        const at = slot()
        const ts = tabs()
        if (!id || at === null) return ts.map(() => 0)
        return railShifts(
            ts.map(t => t.id),
            reorderTabs(ts, id, at).map(t => t.id),
            pitch,
        )
    })
    return { draggingTabId, shifts }
}
