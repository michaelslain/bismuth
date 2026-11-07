// app/src/paneMenuExtras.ts
// Rows a pane's content adds to the pane's right-click menu. A view inside a pane that has its own
// actions for the thing under the pointer (a book page's `transcribe again with ai`) adds them to the
// contextmenu event and lets it bubble; PaneLeaf reads them back and the pane menu shows them above
// its own rows (split, close). One menu, every time, instead of either one or the other.
import type { MenuItem } from './ui/ContextMenu'

const extras = new WeakMap<Event, MenuItem[]>()

/** Add rows to the pane menu this right-click opens. Do not stop the event. */
export function addPaneMenuItems(e: Event, items: MenuItem[]): void {
    extras.set(e, [...(extras.get(e) ?? []), ...items])
}

/** The rows the content under the pointer added to this right-click, in the order added. */
export function paneMenuItemsOf(e: Event): MenuItem[] {
    return extras.get(e) ?? []
}

/** The content's rows, then the pane's own rows after a separator. */
export function withPaneItems(content: MenuItem[], pane: MenuItem[]): MenuItem[] {
    if (content.length === 0) return pane
    return [...content, ...pane.map((it, i) => (i === 0 ? { ...it, separatorBefore: true } : it))]
}
