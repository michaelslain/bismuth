// app/src/chat/appSelection.ts
// "What text is the user pointing at, anywhere in the app" — a selection made in a note editor, a
// PDF preview, a markdown render, the graph's text… tracked on document `selectionchange` and read
// by the chat at send time (chatSession's preamble). No Solid imports; plain module state.
//
// Ownership rules:
//  1. A selection INSIDE a chat surface (a chat pane, the daemon page chat, the quick-ask popover)
//     never replaces or clears the tracked one — the user selects a transcript line or clicks the
//     composer while the thing they meant to ask about stays selected elsewhere.
//  2. Selections in the export screen's preview, or outside any pane (file tree, switcher, app
//     chrome), are dropped (fail closed): they carry no reliable path for the visibility gate.
//  3. CodeMirror selections are read from the view (selectionInView), not the DOM.
// A collapsed selection anywhere else clears it, so a stale highlight never rides a later message.
import { selectionInView } from '../editorRegistry'
import { EXPORT_PREFIX, isSentinel } from '../tabIds'

export type AppSelection = { text: string; path: string | null }

const MAX_CHARS = 8000
const TRUNCATED = '… (truncated)'
// Tag/attribute selectors only — class names are hashed at build time.
const CHAT_SURFACE = '[data-chat-surface], [data-pane-content^="::chat:"]'
const EDITABLE = 'input, textarea, [contenteditable]'

let current: AppSelection | null = null
const trackers = new WeakMap<Document, () => void>()

/** The last selection the user made OUTSIDE a chat surface, or null when it was cleared. */
export function getAppSelection(): AppSelection | null {
    return current
}

function elementOf(node: Node | null): Element | null {
    if (!node) return null
    return node.nodeType === 1 ? (node as Element) : node.parentElement
}

function clip(text: string): string {
    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + TRUNCATED : text
}

type InView = typeof selectionInView

/** Listen to document `selectionchange`; returns an unsubscribe. Idempotent per document: a second
 *  call while tracking returns the same unsubscribe instead of listening twice. `inView` is the
 *  CodeMirror seam (defaults to the editor registry's). */
export function startAppSelectionTracking(
    doc: Document = document,
    inView: InView = selectionInView,
): () => void {
    const existing = trackers.get(doc)
    if (existing) return existing

    const onChange = (): void => {
        const sel = doc.getSelection()
        const anchor = sel?.anchorNode ?? null
        const el = elementOf(anchor)
        if (el?.closest(CHAT_SURFACE)) return // chat surfaces never touch it

        const text = sel && !sel.isCollapsed ? sel.toString() : ''
        const cm = anchor ? inView(anchor) : null
        if (cm) {
            current = cm.selection
                ? { text: clip(cm.selection), path: cm.path }
                : null
            return
        }
        // A plain form field's selection is its own business, not the app's — leave it alone.
        if (el?.closest(EDITABLE)) return
        if (!text.trim()) {
            current = null
            return
        }
        const content =
            el?.closest('[data-pane-content]')?.getAttribute('data-pane-content') ??
            null
        // The export screen previews a vault file whose source can be re-pointed in-pane; its text is
        // note content with no reliable path, so it never becomes the tracked selection.
        if (content?.startsWith(EXPORT_PREFIX)) {
            current = null
            return
        }
        // Outside any pane (file tree, switcher, chrome): no path to gate on, so drop it.
        if (!content) {
            current = null
            return
        }
        current = {
            text: clip(text),
            path: content && !isSentinel(content) ? content : null,
        }
    }

    doc.addEventListener('selectionchange', onChange)
    const dispose = (): void => {
        doc.removeEventListener('selectionchange', onChange)
        trackers.delete(doc)
    }
    trackers.set(doc, dispose)
    return dispose
}

/** Test seam: forget the tracked selection. */
export function resetAppSelection(): void {
    current = null
}
