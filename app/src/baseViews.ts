// app/src/baseViews.ts
// The base "views" a user can create from the "New Base ▸" menu — surfaced in both
// the folder context menu (FileTree) and the toolbar "+" chooser (App). A base is a
// `.base.jsonl` file whose first line picks a view; FileView routes it to
// BaseView. Listing every view kind here keeps the two menus in sync and is the one
// place the labels/icons/templates live (mirrors core's VIEW_TYPES, docs/bases).

import { BASE_EXT, serializeBaseJsonl } from '../../core/src/bases/baseFile'

export interface BaseViewKind {
    /** The Bases `view:` value (a core ViewType). */
    view: string
    /** Menu label; also the default file-name stem ("Untitled <label>"). */
    label: string
    /** icon name (resolved lazily from the full icon registry). */
    icon: string
}

// Order mirrors the docs' 12 view types: note-family first, then the full-pane
// views (calendar/flashcards), then map + the chart family.
export const BASE_VIEW_KINDS: BaseViewKind[] = [
    { view: 'table', label: 'Table', icon: 'Table' },
    { view: 'cards', label: 'Cards', icon: 'LayoutGrid' },
    { view: 'list', label: 'List', icon: 'List' },
    { view: 'bullets', label: 'Bullets', icon: 'TextQuote' },
    { view: 'kanban', label: 'Kanban', icon: 'SquareKanban' },
    { view: 'calendar', label: 'Calendar', icon: 'Calendar' },
    { view: 'flashcards', label: 'Flashcards', icon: 'Layers' },
    { view: 'map', label: 'Map', icon: 'Map' },
    { view: 'bar', label: 'Bar chart', icon: 'ChartColumn' },
    { view: 'line', label: 'Line chart', icon: 'ChartLine' },
    { view: 'stat', label: 'Stat', icon: 'Sigma' },
    { view: 'heatmap', label: 'Heatmap', icon: 'Grid3x3' },
]

/** Default filename for a freshly-created base of the given view label. */
export const baseFileName = (label: string): string =>
    `Untitled ${label}${BASE_EXT}`

/** `baseFileName` made unique among `existing` (vault-relative paths) in `parentDir`:
 *  "Untitled Table.base.jsonl", then "Untitled Table 1.base.jsonl", … The double extension
 *  means a generic stem/ext split would put the counter in the middle of it. */
export function uniqueBaseFileName(
    existing: readonly string[],
    parentDir: string,
    label: string,
): string {
    const taken = new Set(existing)
    const at = (n: string) => (parentDir ? `${parentDir}/${n}` : n)
    const first = baseFileName(label)
    if (!taken.has(at(first))) return first
    for (let i = 1; i < 10000; i++) {
        const cand = `Untitled ${label} ${i}${BASE_EXT}`
        if (!taken.has(at(cand))) return cand
    }
    return `Untitled ${label} ${Date.now()}${BASE_EXT}`
}

/** Starter text for a new base of `view`: a JSON Lines file whose line 1 is the config
 *  (`type: base` is what marks it a base). Calendar stores its own events as rows, so it gets
 *  no `source:`; every other view reads the vault (`source: notes`) so it renders something
 *  immediately, ready for the user to scope. */
export function baseTemplate(view: string): string {
    const raw: Record<string, unknown> =
        view === 'calendar'
            ? { type: 'base', view }
            : { type: 'base', source: 'notes', view }
    return serializeBaseJsonl(raw, [])
}
