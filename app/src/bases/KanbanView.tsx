import {
    createSignal,
    createMemo,
    createEffect,
    untrack,
    For,
    Show,
    onCleanup,
    onMount,
} from 'solid-js'
import { stringify as yamlStringify } from 'yaml'
import type {
    ViewResult,
    BaseConfig,
    Row,
    ResultGroup,
} from '../../../core/src/bases/types'
import {
    placeholderFile,
    syntheticBaseFile,
} from '../../../core/src/bases/types'
import { resolveProperty } from '../../../core/src/bases/query'
import { api } from '../api'
import { KanbanCard } from './KanbanCard'
import TaskRow from './TaskRow'
import CardFrame from './CardFrame'
import CardBodyInner from './CardBodyInner'
import { rowId } from './rowIdentity'
import { canWriteStoredRow, isStoredPlaceholder, storedNote } from './taskWrite'
import { storedTitleColumn, matchedStoredRowId } from './kanbanMeta'
import { PALETTE_NAMES } from './kanbanPalette'
import { parentOf } from '../fileTreeOps'
import {
    groupUpdatesByPath,
    rollbackPending,
    rollbackRemoved,
} from './kanbanRollback'
import {
    flushEditorsAtOrUnder,
    flushSidecarsAtOrUnder,
} from '../editorRegistry'
import { appendOrder } from './kanbanOrder'
import {
    appendColumnKey,
    removeColumnKey,
    renameColumnKey,
    renamePropertyOption,
    reorderColumnKeys,
    withPropertyOption,
} from './kanbanColumnOrder'
import KanbanAddColumn from './KanbanAddColumn'
import { createKanbanDrag, type KanbanCardDrop } from './kanbanDrag'
import KanbanColumnMenu from './KanbanColumnMenu'
import { metaColumns, metaSource, writableKey } from './kanbanMeta'
import {
    appendEmbedToValue,
    markdownDropTarget,
    isImagePath,
} from './kanbanImageDrop'
import {
    isFileDrag,
    nativeDropPoint,
    uploadImageEmbeds,
    uploadsFromFiles,
    uploadsFromNativePaths,
    type ImageUpload,
} from './cardImageDrop'
import { propertyEditKind, type PropertyEditKind } from './propertyEdit'
import { propertyType } from '../../../core/src/bases/properties'
import { propertyRegistry } from '../propertyRegistry'
import {
    markDeleted,
    unmarkDeleted,
    pruneDeleted,
    isRowHidden,
    type DeletedMap,
} from './kanbanDelete'
import { type NativeDragDetail } from '../nativeDrop'
import { claimNativeDrop } from '../nativeDropRouting'
import { declaredDefaults } from '../../../core/src/bases/properties'
import { STATUS_COLOR } from '../ui/StatusDot'
import { pushToast } from '../Toast'
import { suppressCardContextMenu } from './kanbanCardMenu'
import { isConfirmKey, isDismissKey } from '../ui/widgetKeys'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'
import IconButton from '../ui/IconButton'
import TextInput from '../ui/TextInput'
import Swatch from '../ui/Swatch'
import AnchoredPopover from '../ui/AnchoredPopover'
import Callout from '../ui/Callout'
import InlineCode from '../ui/InlineCode'
import styles from './KanbanView.module.css'

// Frontmatter key used to persist manual within-column ordering.
const ORDER_KEY = 'order'

// The active theme's graph-node ramp (`accentPalette` → --graph-0..4), a designed set of
// distinguishable-yet-cohesive colors. Used as the per-column fallback so columns vary out of
// the box (issue: every custom column was the same accent color) AND as the picker swatches —
// so it stays on-theme and adapts to light/dark + whichever theme is active.
const PALETTE = [
    'var(--graph-0)',
    'var(--graph-1)',
    'var(--graph-2)',
    'var(--graph-3)',
    'var(--graph-4)',
]

// Human names for the PALETTE swatches above, parallel by index — every theme's --graph-0..4
// ramp is rose/violet/blue/teal/green in that order. Used as each Swatch's accessible name +
// title (a color, not a token name, reads better to a keyboard/screen-reader user).
// (PALETTE_NAMES itself lives in ./kanbanPalette, shared with the stories.)

// An optimistic move: the column key + order a just-dropped card should render at, before the
// backend write + refetch land. Keyed by rowId (see rowIdentity.ts).
/** `keyOnly`: clear once the card reaches `key`, whatever its stored order (a column rename
 *  moves cards without writing an order, so an order match would never come). */
type PendingMove = { key: string; order: number; keyOnly?: boolean }

/** Make a title safe as a filename: strip path/YAML-hostile chars, collapse whitespace. */
function safeFilename(title: string): string {
    const s = title
        .replace(/[\\/:*?"<>|#[\]]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')
        .trim()
    return s.slice(0, 120) || 'Untitled'
}

export function KanbanView(props: {
    result: ViewResult
    config: BaseConfig
    basePath?: string
    viewIndex?: number
    onChange: () => void
    // See ListView for why the mode and the write seam arrive as props. In tasks mode a
    // card's FACE is a <TaskRow> instead of <KanbanCard>'s title + meta chips; everything
    // around it — the columns, the drag, the composer — is unchanged.
    mode?: 'normal' | 'tasks'
    onToggle?: (row: Row, e: Event) => void
    onSetStatus?: (row: Row, e: MouseEvent) => void
    /** Open the card's note in a tab. Same plumbing as MapView's marker-click open; unused by
     *  KanbanView itself today (no host currently wires it in) — kept for prop-shape parity. */
    onOpen?: (path: string) => void
    /** The board owns its rows (no `source:`): a new card is a row in the base file's body,
     *  not a note file. Computed by BaseView (`ownsRows`), the same flag CalendarView gets. */
    ownsRows?: boolean
}) {
    const groupBy = () => props.result.view.groupBy
    // TASKS MODE IS A DECLARATION, NOT A SHAPE. This branches on `props.mode`, never on
    // `isTaskRow(row, mode)` — that helper ALSO returns true for a row merely SHAPED like a
    // task, which is right for ListView (it has rendered task lines off the shape since long
    // before this mode existed) and wrong here: an existing `source: tasks` base with no
    // `mode:` key would silently stop being this view kind at all.
    // On a board it costs the most: a shape-driven branch would drop <KanbanCard> from an
    // existing `source: tasks` board and take rename, meta editing, delete/undo and the edit
    // modal with it.
    const isTasks = () => props.mode === 'tasks'
    // Editing (rename / reorder / colors / add) only works against a real base
    // file to persist into. Embedded ```query kanbans stay read-only.
    const editable = () => !!props.basePath
    // Adding a card also needs a WRITABLE groupBy: we can only place a new card in the clicked
    // column by writing that column's value onto the note. A file./formula./this. groupBy has no
    // writable target, so the composer is hidden rather than silently creating a mis-placed card.
    const canAdd = () =>
        editable() && !!groupBy() && writableKey(groupBy()!.property) !== null
    const groupColors = (): Record<string, string> =>
        props.result.view.groupColors ?? {}
    // #105: hide each meta row's label caption, showing values only.
    const hideLabels = () => props.result.view.hideLabels === true

    // A kanban card IS a note; its title is the note's filename (editing it renames the file).
    // Bound to file.name — NOT the base's first display column — so an explicit `order:` that puts
    // a property first can't turn a title-edit into a rename-to-a-property-value.
    //
    // `props.ownsRows` boards have no file at all — a card there is a row in the base's own
    // body — so there is no `file.name` to bind. `storedTitleColumn` picks the `order:` id to
    // write the title under instead (the first writable one, falling back to `title`).
    const titleCol = () =>
        props.ownsRows
            ? storedTitleColumn(props.result.view.order ?? [])
            : 'file.name'
    // The view's remaining `order:` properties — or, when the base declares its own property
    // set (list-form `properties:`), the engine-resolved columns — shown as editable meta chips
    // on each card below the title (which keeps its own dedicated editable slot). `description`
    // is not special-cased here (#103): a declared/`order`-listed `description` flows through
    // like any other property, rendered via its type (markdown by default — propertyEdit.ts).
    const metaCols = () =>
        metaColumns(
            metaSource(
                props.result.view.order,
                props.config.declaredProperties,
                props.result.columns,
                groupBy()?.property,
            ),
            titleCol(),
        )

    // The color a column gets with NO override: known-status palette, then a palette slot
    // chosen by a stable hash of the column KEY (not its position) so reordering columns never
    // recolors them. Extracted so a rename can compare "what color would this key get on its
    // own" for both the old and the new key, without writing an override just to ask.
    function autoColor(key: string): string {
        if (STATUS_COLOR[key.trim().toLowerCase()])
            return STATUS_COLOR[key.trim().toLowerCase()]
        let h = 0
        for (let i = 0; i < key.length; i++)
            h = (h * 31 + key.charCodeAt(i)) | 0
        return PALETTE[Math.abs(h) % PALETTE.length]
    }

    // Per-column color: explicit override > auto.
    function colColor(key: string): string {
        return groupColors()[key] ?? autoColor(key)
    }

    // The card (by rowId) currently highlighted as an IMAGE-drop target (an OS file dragged over
    // it). Set on a native/HTML5 file drag-over, cleared on leave/drop. See the "Image drop onto a
    // card" section.
    const [dropCardId, setDropCardId] = createSignal<string | null>(null)

    // UI popovers / composers, keyed by column key (only one open at a time).
    const [pickerCol, setPickerCol] = createSignal<string | null>(null)
    const [composerCol, setComposerCol] = createSignal<string | null>(null)
    const [draft, setDraft] = createSignal('')
    // Paths minted this session, so two quick adds don't collide before a refetch lands.
    const created = new Set<string>()

    // Optimistic moves: on drop we place cards immediately from this overlay so a dragged card
    // never snaps back to its origin while the async setProperty writes + refetch are in flight
    // (the flicker). Each entry clears itself once the server data catches up (see the effect below).
    const [pending, setPending] = createSignal<Record<string, PendingMove>>({})
    // Just-created cards, shown INSTANTLY in their column before the file write's (debounced) refetch
    // brings the real row — so adding a card doesn't blink/hide-then-reappear. Each clears once the
    // server data contains its path.
    const [pendingAdds, setPendingAdds] = createSignal<
        Array<{
            row: Row
            col: string
            /** Set only for a `props.ownsRows` (stored-row) add — see the resolve effect
             *  below. A file-based add still clears by path match (the file write's own
             *  refetch brings a row at that exact path), so it needs none of this.
             *  `priorSnapshots` is CONTENT-keyed (`JSON.stringify(storedNote(r))`), not
             *  id-keyed — an id can be reassigned to a different row by an unrelated delete
             *  landing between the add and this resolve (`matchedStoredRowId`'s own doc). */
            stored?: {
                priorSnapshots: Set<string>
                matchKey: string
                matchValue: unknown
            }
        }>
    >([])
    // Monotonic sentinel for a stored-row optimistic placeholder's `Row.index` — always
    // negative, so its rowId (`${path}#${index}`) can never collide with a real appended
    // row's (always >= 0). The real index is unknowable client-side (see matchedStoredRowId).
    let nextStoredPendingIndex = -1
    // Optimistic column order after a header drag — so the columns settle instantly instead of
    // snapping back while the `columns` write + refetch land. Cleared once the server order matches.
    const [pendingColOrder, setPendingColOrder] = createSignal<string[] | null>(
        null,
    )
    // Columns deleted optimistically — the server keeps reporting a deleted key (still pinned
    // in `groupOrder`/its group) until the `columns` write's refetch lands, and `columnKeys()`
    // appends every server key its pending order doesn't know about, so without this exclusion
    // set a just-deleted column would be re-appended and appear to never leave. Cleared once the
    // server no longer reports the key (same shape as the pendingColOrder clear-effect below).
    const [pendingRemovedCols, setPendingRemovedCols] = createSignal<
        Set<string>
    >(new Set())

    /** Roll `pendingColOrder` back to `prevOrder`, but only-if-still-mine: another column action
     * (reorder/rename/delete) may have written a newer order during this call's await, and an
     * unconditional restore would clobber that action's own in-flight state. Used by
     * addColumn/renameColumn/deleteColumn's catch blocks. */
    function rollbackColOrder(
        keys: string[],
        prevOrder: string[] | null,
    ): void {
        setPendingColOrder(cur => (cur === keys ? prevOrder : cur))
    }

    /** Effective within-column sort order: the pending (optimistic) order if this card has one for
     * this column, else its explicit `order`, else its stable engine position. */
    function effOrder(row: Row, group: ResultGroup): number {
        const mv = pending()[rowId(row)]
        if (mv && mv.key === group.key) return mv.order
        const o = (row.note as Record<string, unknown>)[ORDER_KEY]
        return typeof o === 'number' ? o : group.rows.indexOf(row)
    }
    function sortedRows(group: ResultGroup): Row[] {
        return [...group.rows].sort(
            (a, b) => effOrder(a, group) - effOrder(b, group),
        )
    }

    // The groups to render: the server groups with any pending optimistic moves applied (a moved
    // card is pulled from its server column and shown in its pending target column). Column set +
    // order are untouched, so the Index below stays stable.
    const displayGroups = createMemo((): ResultGroup[] => {
        const pend = pending()
        const adds = pendingAdds()
        const groups = props.result.groups
        if (Object.keys(pend).length === 0 && adds.length === 0) return groups
        const byId = new Map<string, Row>()
        for (const g of groups) for (const r of g.rows) byId.set(rowId(r), r)
        const out = groups.map(g => {
            const rows = g.rows.filter(r => {
                const mv = pend[rowId(r)]
                return !mv || mv.key === g.key
            })
            for (const [id, mv] of Object.entries(pend)) {
                if (mv.key === g.key && !rows.some(x => rowId(x) === id)) {
                    const r = byId.get(id)
                    if (r) rows.push(r)
                }
            }
            // Optimistic new cards land at the bottom of their column until the real row resolves.
            for (const a of adds) {
                if (
                    a.col === g.key &&
                    !byId.has(rowId(a.row)) &&
                    !rows.some(x => rowId(x) === rowId(a.row))
                )
                    rows.push(a.row)
            }
            return { key: g.key, rows }
        })
        // A pending target with no server group yet (a just-renamed column, before the refetch
        // lands) still gets its cards — otherwise they would vanish until the server catches up.
        const known = new Set(groups.map(g => g.key))
        const extra = new Map<string, Row[]>()
        for (const [id, mv] of Object.entries(pend)) {
            if (known.has(mv.key)) continue
            const r = byId.get(id)
            if (!r) continue
            const list = extra.get(mv.key) ?? []
            list.push(r)
            extra.set(mv.key, list)
        }
        for (const [key, rows] of extra) out.push({ key, rows })
        return out
    })

    // Clear each optimistic move once the freshly-resolved server data matches it exactly (the card
    // is in the target column AND its `order` equals the pending order) — so the overlay hands off to
    // real data with no visible jump. Entries that never needed a write (order already correct) match
    // immediately and clear on the next resolve.
    createEffect(() => {
        const groups = props.result.groups // re-run only when the server data changes
        untrack(() => {
            if (Object.keys(pending()).length === 0) return
            const cur = new Map<string, { key: string; order: unknown }>()
            for (const g of groups)
                for (const r of g.rows)
                    cur.set(rowId(r), {
                        key: g.key,
                        order: (r.note as Record<string, unknown>)[ORDER_KEY],
                    })
            setPending(prev => {
                let changed = false
                const next = { ...prev }
                for (const [id, mv] of Object.entries(prev)) {
                    const c = cur.get(id)
                    if (
                        c &&
                        c.key === mv.key &&
                        (mv.keyOnly || c.order === mv.order)
                    ) {
                        delete next[id]
                        changed = true
                    }
                }
                return changed ? next : prev
            })
        })
    })

    // Drop an optimistic new card once the server data resolves it:
    //  - a FILE-based add, once the server data actually contains its path (the write's
    //    refetch has landed) — the path-keyed row then just re-points at the real Row, no
    //    remount.
    //  - a STORED-row add, once its target column contains a row that wasn't there before the
    //    add and carries the value the add wrote (`matchedStoredRowId` — see its own doc for
    //    why an index guess can't be used: the server appends to the base's raw row array,
    //    not this view's filtered/grouped position).
    createEffect(() => {
        const groups = props.result.groups
        untrack(() => {
            if (pendingAdds().length === 0) return
            const present = new Set<string>()
            for (const g of groups)
                for (const r of g.rows) present.add(rowId(r))
            const claimed = new Set<string>()
            setPendingAdds(prev => {
                const next = prev.filter(a => {
                    if (a.stored) {
                        const grp = groups.find(g => g.key === a.col)
                        const rows = (grp?.rows ?? [])
                            .map(r => ({
                                id: rowId(r),
                                snapshot: JSON.stringify(storedNote(r)),
                                value: (r.note as Record<string, unknown>)[
                                    a.stored!.matchKey
                                ],
                            }))
                            .filter(r => !claimed.has(r.id))
                        const hit = matchedStoredRowId(
                            rows,
                            a.stored.priorSnapshots,
                            a.stored.matchValue,
                        )
                        if (hit) claimed.add(hit)
                        return !hit
                    }
                    return !present.has(rowId(a.row))
                })
                return next.length === prev.length ? prev : next
            })
        })
    })

    // The board's root element — the scope the drag engine's FLIP queries run against, and
    // `cardAtPoint`'s containment check (so a drop in one split pane's kanban can't land in another's).
    let rootEl: HTMLDivElement | undefined

    // Cards shown in column: while dragging, lift the dragged card out of EVERY column (the floating
    // ghost represents it) so the placeholder is the only thing marking its new home.
    const visibleRows = (group: ResultGroup): Row[] => {
        const deleted = deletedIds()
        const rows = sortedRows(group).filter(
            r => !isRowHidden(deleted, rowId(r), deleteSnapshot(r)),
        )
        return drag.dragActive()
            ? rows.filter(r => rowId(r) !== drag.dragId())
            : rows
    }
    // Id list per column (the <For> is keyed by these primitive strings, so a within-column
    // reorder MOVES card DOM instead of remounting it — an `order`-only change re-keys the Row via
    // reconcileRows, which a ref-keyed <For> would remount). Row content is looked up reactively.
    const visibleIds = (group: ResultGroup): string[] =>
        visibleRows(group).map(r => rowId(r))
    const rowById = createMemo(() => {
        const m = new Map<string, Row>()
        for (const g of displayGroups())
            for (const r of g.rows) m.set(rowId(r), r)
        return m
    })

    // Column KEY order to render (the outer <For> is keyed by these strings, so a reorder MOVES the
    // column DOM instead of re-rendering every column's content). Applies the optimistic order.
    const columnKeys = (): string[] => {
        const removed = pendingRemovedCols()
        const keys = displayGroups()
            .map(g => g.key)
            .filter(k => !removed.has(k))
        const order = pendingColOrder()
        if (!order) return keys
        // Keep the FULL pending order, including keys with no server group yet (a
        // just-added column) — groupByKey falls back to an empty group for those, so
        // they still render. Append any server key the pending order doesn't know about
        // (but never a key that was just optimistically deleted).
        const out = order.filter(k => !removed.has(k))
        for (const k of keys) if (!out.includes(k)) out.push(k)
        return out
    }
    const groupByKey = (key: string): ResultGroup =>
        displayGroups().find(g => g.key === key) ?? { key, rows: [] }

    // The pointer-drag + FLIP engine (kanbanDrag.ts). Created here, after `columnKeys`, since its
    // drop-gap memo reads that on creation; the writes a drop implies stay in this view.
    const drag = createKanbanDrag({
        root: () => rootEl,
        editable,
        columnKeys,
        dropCard,
        reorderColumns,
    })

    // Clear the optimistic column order once the server's column order matches it.
    createEffect(() => {
        const groups = props.result.groups
        untrack(() => {
            const order = pendingColOrder()
            if (!order) return
            const serverKeys = groups.map(g => g.key)
            // Only clear once every pending key has landed on the server (a just-added
            // column stays pending until its group exists) — then confirm relative order.
            if (!order.every(k => serverKeys.includes(k))) return
            const a = serverKeys.filter(k => order.includes(k))
            const b = order.filter(k => serverKeys.includes(k))
            if (a.length === b.length && a.every((k, i) => k === b[i]))
                setPendingColOrder(null)
        })
    })

    // Clear a pending-removed column once the server no longer reports its key.
    createEffect(() => {
        const groups = props.result.groups
        untrack(() => {
            const removed = pendingRemovedCols()
            if (removed.size === 0) return
            const serverKeys = new Set(groups.map(g => g.key))
            const next = new Set([...removed].filter(k => serverKeys.has(k)))
            if (next.size !== removed.size) setPendingRemovedCols(next)
        })
    })

    // Commit a card drop (called by the drag engine on pointerup, with the drag state it read).
    async function dropCard(drop: KanbanCardDrop): Promise<void> {
        const id = drop.id
        const insertAt = drop.insertAt
        const targetKey = drop.targetKey
        const from = drop.from
        if (!id || targetKey === null) return
        const gb = groupBy()
        if (!gb) return
        const statusKey = writableKey(gb.property)
        const group = groupByKey(targetKey)
        const dragged =
            props.result.groups
                .flatMap(g => g.rows)
                .find(r => rowId(r) === id) ??
            pendingAdds().find(a => rowId(a.row) === id)?.row
        if (!dragged) return
        // A placeholder card is inert until its add resolves — dragging it writes nothing.
        // Checked FIRST, before any optimistic state: the row's write-back handle (a negative
        // index) does not name a real server slot yet, so ordering it now would be racing the
        // add's own eventual index.
        if (isStoredPlaceholder(dragged)) return

        // Target column's new integer ordering — explicit orders for every card keep the sort stable
        // (a fractional-only scheme drifts). Applied OPTIMISTICALLY (see the clear-effect above).
        const others = sortedRows(group).filter(r => rowId(r) !== id)
        const i = Math.max(0, Math.min(insertAt, others.length))
        const newList = [...others.slice(0, i), dragged, ...others.slice(i)]
        drag.snapshotRects()
        setPending(prev => {
            const next = { ...prev }
            newList.forEach((r, k) => {
                next[rowId(r)] = { key: targetKey, order: k }
            })
            return next
        })
        requestAnimationFrame(drag.playFlip)

        // Two boards, two write APIs. A NOTE board writes frontmatter keys on N different
        // files, which is what `setProperties` batches. An OWN-ROWS board writes N rows of
        // ONE file, which is what `rowUpdateMany` batches — and `setProperty(row.file.path,
        // …)` there would write the key onto the BASE's frontmatter instead of onto the row,
        // silently corrupting the board's own config. The discriminator is the row's write-back
        // handle, exactly as it is for a task tick: `canWriteStoredRow`, never "this looks like
        // an own-rows base".
        //
        // `storedNote(r)` and not `r.note`: the view is holding NORMALIZED rows, and
        // `serializeRows` does not strip. Writing `r.note` back would bake all seven
        // computed task columns into the user's file as stale stored data.
        if (canWriteStoredRow(dragged)) {
            // The row's OWN file, not props.basePath: a `source:` base's rows carry
            // `syntheticBaseFile(<that base's path>)`, so props.basePath would silently write
            // this board's own file instead of the board it actually sources from.
            // Placeholder SIBLINGS (another pending add sharing this column, dragged around
            // only in the optimistic `pending` overlay above) are left out here — they have no
            // real server index yet, so writing one into a batch by its negative `r.index!`
            // would either 400 or, worse, collide with whatever real index the add eventually
            // resolves to. Their order stays whatever the `pending` overlay says until their
            // own add lands; only rows the server already knows about get written.
            const items = newList
                .filter(r => !isStoredPlaceholder(r))
                .map((r, k) => ({
                    path: r.file.path,
                    index: r.index!,
                    note: {
                        ...storedNote(r),
                        ...(statusKey !== null &&
                        r === dragged &&
                        from !== targetKey
                            ? { [statusKey]: targetKey }
                            : {}),
                        [ORDER_KEY]: k,
                    },
                }))
            for (const [path, group] of groupUpdatesByPath(items))
                await api.rowUpdateMany(
                    path,
                    group.map(g => ({ index: g.index, note: g.note })),
                )
            return
        }

        // ONE batched request → ONE invalidation → ONE refetch (separate writes stormed the view). The
        // status change + the dragged card's order + the reindex of shifted siblings are all folded in.
        const writes: Array<{ path: string; key: string; value: unknown }> = []
        if (statusKey !== null && from !== targetKey)
            writes.push({
                path: dragged.file.path,
                key: statusKey,
                value: targetKey,
            })
        writes.push({ path: dragged.file.path, key: ORDER_KEY, value: i })
        for (let k = 0; k < newList.length; k++) {
            const row = newList[k]
            if (rowId(row) === id) continue
            if ((row.note as Record<string, unknown>)[ORDER_KEY] !== k)
                writes.push({ path: row.file.path, key: ORDER_KEY, value: k })
        }
        await api.setProperties(writes)
    }

    // ── Column reorder — persist the full visible key order to `columns` (groupOrder). ──
    async function reorderColumns(
        from: string,
        over: string,
        after: boolean,
    ): Promise<void> {
        if (!props.basePath || from === over) return
        const keys = reorderColumnKeys(columnKeys(), from, over, after)
        // Optimistic: reorder instantly (FLIP the columns) so they don't snap back during the write's
        // refetch. The single `columns` write's SSE drives one refetch; the clear-effect then drops the
        // overlay (no props.onChange — a second refetch is unnecessary).
        drag.snapshotColRects()
        setPendingColOrder(keys)
        requestAnimationFrame(drag.playColFlip)
        await api.setViewProperty(
            props.basePath,
            props.viewIndex ?? 0,
            'columns',
            keys,
        )
    }

    // The exact declared name (as it appears in `properties:`) that `propertyType` matched for
    // `property` — mirrors ITS OWN [name, bare, note.<bare>] lookup order (properties.ts) so
    // `withPropertyOption` edits the SAME entry `propertyType` just read the type off of.
    function declaredPropertyName(property: string): string | null {
        const declared = props.config.properties
        if (!declared) return null
        const bare = property.startsWith('note.') ? property.slice(5) : property
        for (const candidate of [property, bare, `note.${bare}`])
            if (declared[candidate]) return candidate
        return null
    }

    // The base's declared `properties:` reconstructed in the FLAT list-YAML shape
    // (`{name, type, options?, ...}`) `normalizeProperties` reads back — the shape
    // `withPropertyOption` edits and `api.setProperty(basePath, 'properties', ...)` writes.
    // `props.config.properties` already carries every field the flat form has (parsed by
    // `normalizePropertyDef`), so this round-trips losslessly at the level the engine models —
    // the same reconstruction `basePropertiesForm.ts`'s save path performs from its rows.
    function declaredPropertiesRaw(): unknown[] {
        const names = props.config.declaredProperties
        const defs = props.config.properties
        if (!names || !defs) return []
        return names.map(name => {
            const def = defs[name]
            const out: Record<string, unknown> = { name }
            if (def?.displayName !== undefined)
                out.displayName = def.displayName
            if (def?.hidden) out.hidden = true
            if (def?.type) {
                out.type = def.type.kind
                if (def.type.options) out.options = def.type.options
                if (def.type.number) out.number = def.type.number
                if (def.type.unit) out.unit = def.type.unit
                if (def.type.expr) out.expr = def.type.expr
            }
            if (def?.default !== undefined) out.default = def.default
            return out
        })
    }

    // ── Add column — pin a new, empty column at the end of `columns`. ──
    // Only rendered when `canAdd()` (editable + a writable groupBy) — see the trailing
    // <KanbanAddColumn> below. If the groupBy property is declared select/multiselect, the new
    // column's value is ALSO appended to that declaration's `options` so a future card dropped
    // into it (or picked from a select editor) matches the same vocabulary the column shows.
    async function addColumn(name: string): Promise<void> {
        if (!props.basePath) return
        const keys = appendColumnKey(columnKeys(), name)
        if (keys === null) return
        const basePath = props.basePath
        // Optimistic, like reorderColumns: the column appears instantly (empty), settling once
        // the `columns` write's SSE-driven refetch lands. Rolled back on a failed write below —
        // otherwise columnKeys() keeps rendering a phantom column with no server group forever.
        const trimmedName = name.trim()
        const prevOrder = pendingColOrder()
        // Captured BEFORE the rollback below clears it — this is the only place that still
        // knows the re-add was covering a pending removal, and the catch needs it to restore
        // that removal if the `columns` write never lands (mirrors renameColumn's catch).
        const targetWasRemoved = pendingRemovedCols().has(trimmedName)
        // Whether the `columns` write below has landed — a failure before it lands means the
        // add never happened server-side, so a removal it was covering must come back.
        let columnsLanded = false
        setPendingColOrder(keys)
        // A column removed then re-added inside the refetch window is still in
        // pendingRemovedCols (its own removal write's refetch hasn't landed yet), and
        // columnKeys() filters every removed key out — without deleting it here the re-added
        // column would stay invisible until the OLD removal's refetch happens to clear it.
        setPendingRemovedCols(prev => rollbackRemoved(prev, trimmedName))
        try {
            await api.setViewProperty(
                basePath,
                props.viewIndex ?? 0,
                'columns',
                keys,
            )
            columnsLanded = true
            const gb = groupBy()
            if (!gb) return
            const t = propertyType(props.config, gb.property)
            if (t?.kind !== 'select' && t?.kind !== 'multiselect') return
            const declName = declaredPropertyName(gb.property)
            if (!declName) return
            const updated = withPropertyOption(
                declaredPropertiesRaw(),
                declName,
                name.trim(),
            )
            if (updated) await api.setProperty(basePath, 'properties', updated)
        } catch (e) {
            // Only-if-still-mine: another column action (reorder/rename/delete) may have
            // written a newer `pendingColOrder` during this await — restoring `prevOrder`
            // unconditionally would clobber that action's own in-flight state.
            rollbackColOrder(keys, prevOrder)
            // Mirrors renameColumn's catch: this call cleared `trimmedName` out of
            // pendingRemovedCols optimistically (to un-hide the re-added column). If the
            // `columns` write never landed, the add never happened server-side — the removal
            // it was covering is still real, so put it back, or the column that was just
            // deleted reappears (hidden nowhere) until a stale refetch happens to reconcile it.
            // Once `columnsLanded`, the column genuinely exists again and must stay un-hidden.
            setPendingRemovedCols(prev =>
                targetWasRemoved && !columnsLanded
                    ? new Set(prev).add(trimmedName)
                    : prev,
            )
            pushToast(`Add column failed: ${(e as Error).message}`)
        }
    }

    // ── Column rename — rewrites `columns`, moves any `groupColors` override, renames a
    // declared select/multiselect option, and moves every card in the column in one batched
    // write. ──
    async function renameColumn(from: string, to: string): Promise<void> {
        if (!props.basePath) return
        const keys = renameColumnKey(columnKeys(), from, to)
        if (keys === null) return
        const trimmed = to.trim()
        const basePath = props.basePath
        const idx = props.viewIndex ?? 0

        // Not writable (file./formula./this. groupBy) — bail before any optimistic state.
        // The column menu's Rename is now gated on `canAdd()` (editable + writable groupBy),
        // but keep this belt-and-braces: without it, the `columns` write below would still
        // rename the pinned column while every card's status write is skipped (statusKey
        // null), leaving an empty new column pinned alongside the untouched old one on reload.
        const gb = groupBy()
        const statusKey = gb ? writableKey(gb.property) : null
        if (statusKey === null) return

        // A view `limit` caps every group's rows (`query.ts`'s `applyLimit`), so
        // `groupByKey(from).rows` can be a TRUNCATED set — renaming would move only the
        // visible cards and strand the hidden ones under the old key forever. Refuse before
        // any optimistic state.
        if (typeof props.result.view.limit === 'number') {
            pushToast('rename unavailable // this view has a limit')
            return
        }

        // The cards to move, captured BEFORE the optimistic overlay below empties `from` — and
        // excluding stored-row PLACEHOLDERS (a negative `index`, an optimistic add not yet
        // resolved to a real row): sending one to the server as a rename target 400s, and the
        // rollback would then fire after `columns` already landed.
        const movedRows = groupByKey(from).rows.filter(
            r => !isStoredPlaceholder(r),
        )

        // Optimistic, like reorderColumns/addColumn: the renamed column shows instantly, the old
        // key is hidden (columnKeys() would otherwise re-append it while the server still reports
        // it) and its cards render under the new key through the card overlay. All rolled back on
        // any failed write below — a partial rename otherwise leaves the column showing its new
        // name while the server still has the old one, permanently out of sync.
        // Whether `from` was ALREADY hidden before this call — if so, this call didn't add it
        // and must not remove it on rollback (some other in-flight action owns that removal).
        const alreadyRemoved = pendingRemovedCols().has(from)
        const targetWasRemoved = pendingRemovedCols().has(trimmed)
        const prevOrder = pendingColOrder()
        // The exact entries THIS call is about to write into `pending`, so a rollback can undo
        // only these (by `===` identity) rather than clobbering an overlay entry another
        // action wrote during this call's await.
        const writtenPending: Record<string, PendingMove> = {}
        movedRows.forEach((r, k) => {
            const o = (r.note as Record<string, unknown>)[ORDER_KEY]
            writtenPending[rowId(r)] = {
                key: trimmed,
                order: typeof o === 'number' ? o : k,
                keyOnly: true,
            }
        })
        // Whether the `columns` write below has landed — once it has, the column itself is
        // already renamed server-side, so a failure afterward is a PARTIAL failure: the overlays
        // still roll back, but the toast says `partially applied`, `props.onChange()` refetches
        // the server's already-renamed state, and `trimmed`'s prior removal is not restored.
        let columnsLanded = false
        setPendingColOrder(keys)
        setPendingRemovedCols(prev => rollbackRemoved(prev, trimmed).add(from))
        setPending(prev => ({ ...prev, ...writtenPending }))
        try {
            await api.setViewProperty(basePath, idx, 'columns', keys)
            columnsLanded = true

            // Move a color override from the old key to the new one, if it had one. When there
            // was none, a rename-carried color counts as an override ONLY when it has to: the
            // auto color hashes the KEY, so leaving `groupColors` untouched would silently
            // recolor the column via a hash-of-`trimmed` slot instead of keeping `from`'s — but
            // when the new key happens to auto-color the same as the old one, writing an
            // override would show a plain rename as a custom color the user never chose. Skip
            // the write entirely when `groupColors` would come out unchanged either way.
            const colors = groupColors()
            const next = { ...colors }
            let colorsChanged = false
            if (colors[from] !== undefined) {
                next[trimmed] = next[from]!
                delete next[from]
                colorsChanged = true
            } else if (autoColor(trimmed) !== autoColor(from)) {
                next[trimmed] = autoColor(from)
                colorsChanged = true
            }
            if (colorsChanged)
                await api.setViewProperty(basePath, idx, 'groupColors', next)

            // Declared select/multiselect option rename — mirrors addColumn's append.
            const t = gb ? propertyType(props.config, gb.property) : null
            if (gb && (t?.kind === 'select' || t?.kind === 'multiselect')) {
                const declName = declaredPropertyName(gb.property)
                if (declName) {
                    const updated = renamePropertyOption(
                        declaredPropertiesRaw(),
                        declName,
                        from,
                        trimmed,
                    )
                    if (updated)
                        await api.setProperty(basePath, 'properties', updated)
                }
            }

            // Move every card currently in the renamed column — ONE batched write per write
            // TARGET (a file path), same two-target split as dropCard/setMetaProperty
            // (`canWriteStoredRow`). statusKey is non-null here — guarded at the top of the
            // function. A stored row's write target is ITS OWN `file.path` (a `source:` base's
            // rows carry `syntheticBaseFile(<that base's path>)` — never `props.basePath`
            // blindly, which would land on the wrong base for a `source:` board), so the
            // updates are grouped by path and issued one `rowUpdateMany` call per path — one
            // call total for an own-rows board, where every row shares the same path.
            const rows = movedRows
            const storedRows = rows.filter(canWriteStoredRow)
            const noteRows = rows.filter(r => !canWriteStoredRow(r))
            if (storedRows.length > 0) {
                const items = storedRows.map(r => ({
                    path: r.file.path,
                    index: r.index!,
                    note: { ...storedNote(r), [statusKey]: trimmed },
                }))
                for (const [path, group] of groupUpdatesByPath(items)) {
                    await api.rowUpdateMany(
                        path,
                        group.map(g => ({ index: g.index, note: g.note })),
                    )
                }
            }
            if (noteRows.length > 0) {
                const writes = noteRows.map(r => ({
                    path: r.file.path,
                    key: statusKey,
                    value: trimmed,
                }))
                await api.setProperties(writes)
            }
            props.onChange()
        } catch (e) {
            rollbackColOrder(keys, prevOrder)
            setPendingRemovedCols(prev => {
                const s = rollbackRemoved(prev, alreadyRemoved ? null : from)
                return targetWasRemoved && !columnsLanded
                    ? new Set(s).add(trimmed)
                    : s
            })
            setPending(prev => rollbackPending(prev, writtenPending))
            if (columnsLanded) {
                props.onChange()
                pushToast(
                    `Rename column partially applied: ${(e as Error).message}`,
                )
            } else {
                pushToast(`Rename column failed: ${(e as Error).message}`)
            }
        }
    }

    // ── Column delete — only ever called for an empty column (KanbanColumnMenu gates it via
    // `canDelete`); removes the key from `columns` and any `groupColors` override. ──
    async function deleteColumn(key: string): Promise<void> {
        if (!props.basePath) return
        if (groupByKey(key).rows.length > 0) return
        const basePath = props.basePath
        const idx = props.viewIndex ?? 0
        const keys = removeColumnKey(columnKeys(), key)
        const alreadyRemoved = pendingRemovedCols().has(key)
        const prevOrder = pendingColOrder()
        let columnsLanded = false
        // Optimistic, like add/rename: the column disappears instantly. Both signals rolled back
        // on a failed write — otherwise the column vanishes from the UI for good even though the
        // server still has it, or worse, columnKeys() keeps hiding a key the server never lost.
        setPendingColOrder(keys)
        setPendingRemovedCols(prev => new Set(prev).add(key))
        try {
            await api.setViewProperty(basePath, idx, 'columns', keys)
            columnsLanded = true
            const colors = groupColors()
            if (colors[key] !== undefined) {
                const next = { ...colors }
                delete next[key]
                if (Object.keys(next).length === 0)
                    await api.deleteViewProperty(basePath, idx, 'groupColors')
                else
                    await api.setViewProperty(
                        basePath,
                        idx,
                        'groupColors',
                        next,
                    )
            }
            props.onChange()
        } catch (e) {
            rollbackColOrder(keys, prevOrder)
            setPendingRemovedCols(prev =>
                rollbackRemoved(prev, alreadyRemoved ? null : key),
            )
            if (columnsLanded) {
                props.onChange()
                pushToast(
                    `Delete column partially applied: ${(e as Error).message}`,
                )
                return
            }
            pushToast(`Delete column failed: ${(e as Error).message}`)
        }
    }

    // ── Column color — persist/clear an override in `groupColors`. ──
    async function setColColor(
        key: string,
        color: string | null,
    ): Promise<void> {
        if (!props.basePath) return
        setPickerCol(null)
        const next = { ...groupColors() }
        if (color === null) delete next[key]
        else next[key] = color
        const idx = props.viewIndex ?? 0
        if (Object.keys(next).length === 0)
            await api.deleteViewProperty(props.basePath, idx, 'groupColors')
        else await api.setViewProperty(props.basePath, idx, 'groupColors', next)
        props.onChange()
    }

    // ── Card rename ──
    // A stored row has no file to rename — `row.file.path` there is the BASE's own path, so
    // an `api.move` on it would rename the base out from under every OTHER row it holds.
    // Instead it writes the new title under `titleCol()`'s key (`storedTitleColumn`'s pick)
    // via `api.rowUpdate`, addressed by `row.index` like every other stored-row write
    // (`setMetaProperty`, `dropCard`) — the note's OTHER keys are carried through unchanged.
    async function renameCard(row: Row, newTitle: string): Promise<void> {
        // A placeholder is not yet a row the server knows about — `canWriteStoredRow` is
        // `false` for it (negative index), which without this check would fall through to the
        // note-file branch below and `api.move` the BASE's own file (a placeholder's `file` is
        // `syntheticBaseFile`, the base's own path, not a note). Bail before either branch.
        if (isStoredPlaceholder(row)) return
        if (canWriteStoredRow(row)) {
            const key = writableKey(titleCol())
            if (key === null) return
            const note = { ...storedNote(row), [key]: newTitle }
            // The row's OWN file (see `dropCard`'s comment) — never `props.basePath`, which is
            // the wrong target for a `source:` board's row.
            await api.rowUpdate(row.file.path, row.index!, note)
            return
        }
        // A rename changes the note's path, so the refetch below re-keys the row and remounts the
        // card (its identity genuinely changed). Editing is single-mode, so there's no open
        // description edit to lose in the normal flow; only a description typed into the SAME
        // card during the brief in-flight window of a just-committed rename would be dropped — a
        // narrow, no-existing-data-loss race we accept rather than couple the two async writes.
        const dir = parentOf(row.file.path)
        const desired = `${dir ? dir + '/' : ''}${safeFilename(newTitle)}.md`
        if (desired === row.file.path) return
        const target = dedupe(desired, takenPaths())
        await api.move(row.file.path, target)
        props.onChange()
    }

    // ── Card meta property (any `order:` property besides title — including `description`,
    // #103 dropped its own dedicated write path in favor of this one) ──
    // Persists a value the card's type-aware chip editor produced. `null` clears the key
    // entirely (rather than writing a literal null into frontmatter) — file./formula./this.
    // ids have no writable key and are silently ignored (KanbanCard already gates the click).
    //
    // Two boards, two write targets — same split as `dropCard`. A stored row's `row.file.path`
    // is the BASE's own path, so `setProperty`/`deleteProperty` there would land on the base's
    // frontmatter instead of the row. `storedNote(row)`, not `row.note`, for the same reason as
    // `dropCard`: the view holds normalized rows, and a write must not bake computed columns in.
    async function setMetaProperty(
        row: Row,
        id: string,
        value: unknown,
    ): Promise<void> {
        const key = writableKey(id)
        if (key === null) return
        // See `renameCard`'s comment — a placeholder falling through to the note-file branch
        // below would `setProperty`/`deleteProperty` the BASE's own file, not the row.
        if (isStoredPlaceholder(row)) return
        if (canWriteStoredRow(row)) {
            const note = { ...storedNote(row) }
            if (value === null || value === undefined || value === '')
                delete note[key]
            else note[key] = value
            // The row's OWN file — see `dropCard`'s comment on why never `props.basePath`.
            await api.rowUpdate(row.file.path, row.index!, note)
            return
        }
        if (value === null || value === undefined || value === '')
            await api.deleteProperty(row.file.path, key)
        else await api.setProperty(row.file.path, key, value)
    }

    // Every OTHER row's raw value for `id`, across the whole board — feeds the meta chip
    // editor's "select from known values" fallback (propertyEdit.ts). Computed on demand (a
    // click, not every render) so it's cheap even though it's an O(rows) scan.
    function siblingValuesFor(id: string): unknown[] {
        return props.result.groups
            .flatMap(g => g.rows)
            .map(r => resolveProperty(id, r))
    }

    // ── Add card — create a note in the board's folder with the column's status set. ──
    function boardFolder(): string {
        const first = props.result.groups.flatMap(g => g.rows)[0]
        if (first) return parentOf(first.file.path)
        return props.basePath ? props.basePath.replace(/\.md$/, '') : ''
    }
    // Frontmatter shared by EVERY existing card (e.g. `board`, or a `tags` array the base filters
    // on) — copied onto new cards so they keep matching the base's source/filter. Compared by value
    // (JSON) so array/object fields count as equal across notes, and carried through as-is (the YAML
    // serializer handles arrays/objects). Excludes only the status/order keys — `description` is no
    // longer special-cased (#103), so a fresh card only "inherits" one when every existing card
    // happens to share the identical text (the normal constProps rule for any property).
    function constProps(exclude: Set<string>): Record<string, unknown> {
        const rows = props.result.groups.flatMap(g => g.rows)
        if (rows.length === 0) return {}
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(rows[0].note)) {
            if (exclude.has(k) || v == null) continue
            const s = JSON.stringify(v)
            if (
                rows.every(
                    r =>
                        JSON.stringify(
                            (r.note as Record<string, unknown>)[k],
                        ) === s,
                )
            )
                out[k] = v
        }
        return out
    }
    // ── Delete (trash + undo toast, mirrors FileTree) ──
    // Lives ONLY inside the card's edit modal (CardEditModal) — no separate right-click menu, so
    // there's exactly one delete affordance per card. A stored row has no file to trash, so it
    // deletes by index (`api.rowDelete`) instead; Undo re-creates the row (`api.rowCreate`) rather
    // than restoring it to its exact prior index/position, which `api.rowDelete` doesn't hand back.
    //
    // Ids deleted this session but not yet confirmed gone by a refetch — hidden from every
    // column immediately (like FileTree's optimisticRemove) so the card vanishes without waiting
    // on the round-trip. Reverted on failure; a successful Undo also drops its entry.
    //
    // A STORED row's id (`${basePath}#${index}`) is not stable across a delete — deleting ANY
    // stored row splices the base's raw row array (`rowOps.ts`), shifting every LATER row's
    // index/id down by one. Hiding by bare id would then hide the card that shifted INTO the
    // deleted card's old id, permanently (`kanbanDelete.ts` has the full account). So the map
    // also carries a snapshot for a stored-row entry — `undefined` for a note row, whose id
    // (its file path) IS stable — and `isRowHidden`/`pruneDeleted` only keep hiding while the
    // row currently at that id still matches the snapshot of the row that was actually deleted.
    const [deletedIds, setDeletedIds] = createSignal<DeletedMap>(new Map())
    // The value `deletedIds`/`pruneDeleted` compare against for a given row: the stored row's
    // own content for a writable-by-index row, `undefined` (id-only match) for a note row.
    const deleteSnapshot = (row: Row): string | undefined =>
        canWriteStoredRow(row) ? JSON.stringify(storedNote(row)) : undefined

    async function deleteCard(row: Row): Promise<void> {
        if (!editable()) return
        // A placeholder is inert until its add resolves — no delete affordance either. Bailing
        // here (before the optimistic hide) matters doubly: `canWriteStoredRow` is `false` for
        // it, so without this check it would fall to the note-file branch below and `api.del`
        // the BASE's own file (a placeholder's `file` is `syntheticBaseFile`, the base's own
        // path), trashing the whole board out from under every other card.
        if (isStoredPlaceholder(row)) return
        const id = rowId(row)
        // Hide the card INSTANTLY (optimistic overlay), FLIP the survivors so they slide up smoothly
        // instead of snapping. No props.onChange(): both delete routes are mutating → they bump the
        // server version, and BaseView's SSE-driven revalidation refetches the board in a
        // useTransition (stale-while-revalidate) — the SMOOTH path. The deletedIds hide covers the
        // gap until that refetch lands and the prune-effect clears it.
        drag.snapshotRects()
        setDeletedIds(prev => markDeleted(prev, id, deleteSnapshot(row)))
        requestAnimationFrame(drag.playFlip)

        if (canWriteStoredRow(row)) {
            // The row's OWN file — see `dropCard`'s comment on why never `props.basePath`.
            const path = row.file.path
            const note = { ...storedNote(row) }
            const titleKey = writableKey(titleCol())
            const name = String(
                (titleKey ? note[titleKey] : undefined) ?? 'card',
            )
            try {
                await api.rowDelete(path, row.index!)
                pushToast(`Deleted "${name}"`, {
                    label: 'Undo',
                    onClick: () => void restoreStoredCard(path, note, id, name),
                })
            } catch (e) {
                setDeletedIds(prev => unmarkDeleted(prev, id))
                pushToast(`Delete failed: ${(e as Error).message}`)
            }
            return
        }

        const path = row.file.path
        const name = row.file.name
        try {
            // Flush a pending autosave for this note BEFORE trashing it — a delete landing
            // inside the autosave debounce would otherwise discard the just-typed edit, and
            // Undo would restore the note without it (mirrors FileTree.doDelete). ALSO flush
            // non-CodeMirror sidecar writers registered under this path (a Kanban row CAN be a
            // companion note, indexed like any other note) — same hazard (chunk-1 re-review).
            await Promise.all([
                flushEditorsAtOrUnder(path),
                flushSidecarsAtOrUnder(path),
            ])
            const { trashPath } = await api.del(path)
            pushToast(`Deleted "${name}"`, {
                label: 'Undo',
                onClick: () => void restoreCard(trashPath, path, id),
            })
        } catch (e) {
            setDeletedIds(prev => unmarkDeleted(prev, id)) // revert the optimistic hide
            pushToast(`Delete failed: ${(e as Error).message}`)
        }
    }

    /** Undo for a stored-row delete: re-create the row via `api.rowCreate` (appends — see
     *  `deleteCard`'s comment on why an exact position isn't restored). The optimistic hide
     *  drops right away; the prune-effect above clears the `deletedIds` entry for good once
     *  the SSE refetch confirms the row is really back. */
    async function restoreStoredCard(
        path: string,
        note: Record<string, unknown>,
        id: string,
        name: string,
    ): Promise<void> {
        try {
            await api.rowCreate(path, note)
            setDeletedIds(prev => unmarkDeleted(prev, id))
            pushToast(`Restored "${name}"`)
        } catch (e) {
            pushToast(`Restore failed: ${(e as Error).message}`)
        }
    }

    async function restoreCard(
        trashPath: string,
        to: string,
        id: string,
    ): Promise<void> {
        try {
            await api.restore(trashPath, to)
            // Drop the optimistic hide; POST /restore is mutating, so its SSE revalidation brings the note
            // back through the same smooth transition (no direct props.onChange() refetch).
            setDeletedIds(prev => unmarkDeleted(prev, id))
            pushToast(
                `Restored "${to.split('/').pop()?.replace(/\.md$/, '') ?? to}"`,
            )
        } catch (e) {
            pushToast(`Restore failed: ${(e as Error).message}`)
        }
    }

    // Prune a hidden id once the server data no longer BACKS it (the delete's refetch has
    // landed, for a note row — or, for a stored row, once the id now belongs to a SHIFTED
    // sibling whose content no longer matches the row that was actually deleted — see
    // `kanbanDelete.ts`) — mirrors the pending/pendingAdds clear-effects. Re-runs only when the
    // server groups change (not when deletedIds itself changes), so right after an optimistic
    // hide — while the card is STILL in props.result with its OWN snapshot — nothing is pruned;
    // the entry drops only once the refetch actually removes/replaces it for good.
    createEffect(() => {
        const groups = props.result.groups
        untrack(() => {
            if (deletedIds().size === 0) return
            const present = new Map<string, string | undefined>()
            for (const g of groups)
                for (const r of g.rows) present.set(rowId(r), deleteSnapshot(r))
            setDeletedIds(prev => pruneDeleted(prev, present))
        })
    })

    const takenPaths = (): Set<string> =>
        new Set([
            ...props.result.groups.flatMap(g => g.rows).map(r => r.file.path),
            ...created,
        ])
    // Resolve a non-colliding path against the board's own notes + this session's fresh adds. (A
    // same-named note the board's FILTER hides isn't covered — but for the common folder-scoped
    // board every note is a visible row, and there's no reliable client-side disk-existence probe:
    // /file and /meta both 200 for missing paths.)
    function dedupe(desired: string, taken: Set<string>): string {
        if (!taken.has(desired)) return desired
        const stem = desired.replace(/\.md$/, '')
        for (let n = 2; ; n++) {
            const cand = `${stem} ${n}.md`
            if (!taken.has(cand)) return cand
        }
    }
    async function addCard(colKey: string): Promise<void> {
        const title = draft().trim()
        const gb = groupBy()
        const statusKey = gb ? writableKey(gb.property) : null
        if (!title || !statusKey) return

        // Use an existing card's actual (typed) status value for this column when there is one, so a
        // numeric/boolean groupBy writes the same type as its siblings (a stringified key would fail
        // a numeric filter / type-aware sort). Fall back to the string key for an empty column.
        const sibling = props.result.groups.find(g => g.key === colKey)?.rows[0]
        const statusValue = sibling
            ? (sibling.note as Record<string, unknown>)[statusKey]
            : colKey

        // Pin the new card to the BOTTOM of its column with an explicit `order` strictly after every
        // current sort key (#93). Without it the card rendered at the bottom optimistically, then
        // teleported into the middle once the refetch landed: the real row's indexOf fallback
        // interleaved with the siblings' explicit drag-written orders. Computed over the DISPLAYED
        // group (effOrder), so back-to-back adds stack in insertion order — each sees the previous
        // optimistic card's order. (appendOrder is pure + unit-tested in kanbanOrder.test.ts.)
        const grp = groupByKey(colKey)
        const orderVal = appendOrder(grp.rows.map(r => effOrder(r, grp)))

        // The title column's writable key. On a normal (file-backed) board `titleCol()` is
        // `'file.name'`, a computed pseudo-property with no writable key, so this stays a
        // no-op there. On a `props.ownsRows` (stored-row) board `titleCol()` is
        // `storedTitleColumn`'s pick — always writable — so the composer's typed title lands
        // under that key below, same as every other property here.
        const titleKey = writableKey(titleCol())
        const exclude = new Set([statusKey, ORDER_KEY])
        if (titleKey) exclude.add(titleKey)

        // Declared property defaults (list-form `properties:`) seed first; frontmatter shared by
        // every existing card overrides them (a new card must keep matching the base's filter),
        // the clicked column's status value wins, and the appended `order` pins it to the bottom.
        const front: Record<string, unknown> = {
            ...declaredDefaults(props.config, exclude),
            ...constProps(exclude),
            [statusKey]: statusValue ?? colKey,
            [ORDER_KEY]: orderVal,
            ...(titleKey ? { [titleKey]: title } : {}),
        }

        // The board owns its rows (no `source:`): a new card is a ROW in the base file's own
        // body, not a note file — same split as `dropCard`/`setMetaProperty` (`canWriteStoredRow`,
        // never "this looks like an own-rows base"). The optimistic placeholder must NOT claim a
        // file path (there is no note being created): it shares the base's own synthetic file,
        // same as every other stored row (`rowIdentity.ts`), so `rowId` addresses it consistently.
        //
        // Its `index` is a negative sentinel, NOT a guess at the row's real position — the
        // server appends to the base file's raw row array (rowOps.ts), which this view's
        // filtered/grouped `props.result` cannot predict (a `filters:` block, or any row this
        // view drops, throws a positional guess off). `matchedStoredRowId` (the resolve effect
        // above) finds the real row once it lands, by "new since this add + carries the
        // written value" instead of by index.
        if (props.ownsRows) {
            if (!props.basePath) return
            const basePath = props.basePath
            // Content-keyed, not id-keyed — see `matchedStoredRowId`'s doc for why an id set
            // breaks under a delete landing between this add and its resolve.
            const priorSnapshots = new Set(
                props.result.groups
                    .flatMap(g => g.rows)
                    .map(r => JSON.stringify(storedNote(r))),
            )
            const optimistic: Row = {
                file: syntheticBaseFile(basePath),
                note: { ...front },
                formula: {},
                index: nextStoredPendingIndex--,
            }
            setDraft('')
            setPendingAdds(prev => [
                ...prev,
                {
                    row: optimistic,
                    col: colKey,
                    stored: {
                        priorSnapshots,
                        matchKey: statusKey,
                        matchValue: statusValue ?? colKey,
                    },
                },
            ])
            try {
                await api.rowCreate(basePath, front)
            } catch (e) {
                // Drop exactly this call's placeholder (matched by its own optimistic index —
                // never "the last pendingAdds entry", which could belong to a different add
                // that raced in during this await) so a failed add never leaves a permanent
                // ghost card.
                setPendingAdds(prev =>
                    prev.filter(a => a.row.index !== optimistic.index),
                )
                pushToast(`Add card failed: ${(e as Error).message}`)
            }
            return
        }

        const folder = boardFolder()
        const content = `---\n${yamlStringify(front)}---\n`
        const path = dedupe(
            `${folder ? folder + '/' : ''}${safeFilename(title)}.md`,
            takenPaths(),
        )
        const name = safeFilename(title)

        // Show the card OPTIMISTICALLY so it appears the instant you hit Enter — then just write the
        // file. No props.onChange(): a PUT /file doesn't bump the version, so an eager refetch would
        // read stale rows; the file-watcher's debounced SSE refetch brings the real row and the
        // clear-effect drops the optimistic one (path-keyed → the card never blinks). Not gated on the
        // write being in flight: draft is cleared synchronously (a double-Enter no-ops on the empty
        // title) and `created` de-collides paths, so rapid successive adds each land instead of the
        // next Enter being silently dropped while the previous PUT round-trips (#93). No await-return
        // that would bounce the active tab — the file-watcher SSE, not a tab switch, brings the row in.
        const optimistic: Row = {
            file: placeholderFile(name, path),
            note: { ...front },
            formula: {},
        }
        created.add(path)
        setDraft('')
        setPendingAdds(prev => [...prev, { row: optimistic, col: colKey }])
        await api.write(path, content)
    }

    // ── Image drop onto a card ───────────────────────────────────────────────────────────────────
    // Dragging an image FILE (from Finder/desktop, or any OS file drag) onto a card copies it into the
    // vault's attachment folder and embeds `![[basename]]` in the card's DESCRIPTION — the property
    // both the card face and the edit modal already render, so the picture is VISIBLE the moment it
    // lands. (It used to be appended to the card note's BODY, which neither surface shows: the image
    // was on disk but nowhere on screen.) The two OS-file intake paths + the upload live in
    // cardImageDrop.ts, shared with the modal's description field; the pure append/target logic is in
    // kanbanImageDrop.ts.

    /** A property's edit KIND, resolved exactly the way the card face + edit modal resolve it
     *  (declared `type:` → vault property registry → the bare-`description`-is-markdown default), so
     *  a drop targets the SAME field the modal shows as the rich description editor. The value +
     *  siblings only steer the non-markdown fallbacks (select-from-known-values), which this
     *  "is it the markdown field?" question doesn't care about — hence the empty stand-ins. */
    function kindOfProperty(id: string): PropertyEditKind {
        return propertyEditKind(
            id,
            null,
            propertyRegistry(),
            [],
            propertyType(props.config, id),
        )
    }

    /** The card row under (x, y), scoped to THIS board's DOM (so a drop in one split pane's kanban
     *  can't land in another's). Null when the cursor isn't over a card of this board. */
    function cardAtPoint(
        x: number,
        y: number,
    ): { id: string; row: Row } | null {
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        const card = el?.closest<HTMLElement>('[data-kbcard][data-path]')
        if (!card || !rootEl || !rootEl.contains(card)) return null
        const id = card.getAttribute('data-path')
        if (!id) return null
        const row = props.result.groups
            .flatMap(g => g.rows)
            .find(r => rowId(r) === id)
        return row ? { id, row } : null
    }

    /** Upload each image, then append its embed to the card's description property — the same
     *  property (and the same value shape) the modal's Milkdown field writes. Shared by the native +
     *  HTML5 intake paths. Toasts on every outcome, including "this board has no description", so a
     *  drop never silently vanishes.
     *
     *  Takes the ROW, not a path — `uploadImageEmbeds` needs a genuine FILE path to place the
     *  attachment near (not a rowId, which for a stored row carries a `#<index>` suffix that
     *  addresses no file). `row.file.path` is that path for both kinds: a note's own path, or —
     *  for a stored row — the base's, which is the correct folder to drop an attachment near even
     *  though the row itself has no file of its own. */
    async function embedImagesInCard(
        row: Row,
        uploads: ImageUpload[],
    ): Promise<void> {
        if (uploads.length === 0) return
        const id = markdownDropTarget(
            metaCols(),
            kindOfProperty,
            i => writableKey(i) !== null,
        )
        if (!id) {
            pushToast(
                'No description property on this board to drop an image into',
            )
            return
        }
        const embeds = await uploadImageEmbeds(uploads, row.file.path)
        if (embeds.length === 0) return
        try {
            const current = resolveProperty(id, row)
            const next = appendEmbedToValue(
                current == null ? '' : String(current),
                embeds.join('\n'),
            )
            await setMetaProperty(row, id, next)
            const label =
                row.file.path.split('/').pop()?.replace(/\.md$/, '') ??
                row.file.path
            pushToast(
                `Added ${embeds.length === 1 ? 'image' : `${embeds.length} images`} to "${label}"`,
            )
        } catch (e) {
            pushToast(`Couldn't add image: ${(e as Error).message}`)
        }
    }

    /** Native (Tauri) OS image drop — resolve the card under the cursor, read each file's real bytes
     *  (fs plugin), upload, and embed. Coordinates are corrected for a WebKit page-zoom / DPR mismatch
     *  (nativeDropPoint), same as the editor's native-drop handler. Desktop-only (the event never
     *  fires in a browser); `claimNativeDrop` ensures exactly one surface/board processes the drop. */
    async function handleNativeCardDrop(d: NativeDragDetail): Promise<void> {
        if (!editable()) return
        if (!d.paths.some(isImagePath)) {
            setDropCardId(null)
            return
        }
        const pt = await nativeDropPoint(d)
        const hit = cardAtPoint(pt.x, pt.y)
        setDropCardId(null)
        if (!hit) return // not dropped on a card of this board — let another surface handle it
        if (!claimNativeDrop(d)) return // a duplicated listener already owns this drop
        await embedImagesInCard(hit.row, await uploadsFromNativePaths(d.paths))
    }

    // Window-level native drag listener: highlight the hovered card on enter/over, clear on leave, and
    // process the file on drop. `enter`/`over` carry no paths (only `drop` does), so the highlight is
    // shown for any OS drag over a card and the drop itself validates it's an image.
    onMount(() => {
        const onNativeDrag = (ev: Event): void => {
            const d = (ev as CustomEvent<NativeDragDetail>).detail
            if (!d || !editable()) return
            if (d.type === 'drop') {
                void handleNativeCardDrop(d)
                return
            }
            if (d.type === 'leave') {
                setDropCardId(null)
                return
            }
            // enter/over — raw coords are fine for a card-sized target (the small zoom/DPR residual the
            // drop corrects for can't cross a whole card); highlight whatever card is under the cursor.
            setDropCardId(cardAtPoint(d.x, d.y)?.id ?? null)
        }
        window.addEventListener('bismuth-native-drag', onNativeDrag)
        onCleanup(() =>
            window.removeEventListener('bismuth-native-drag', onNativeDrag),
        )
    })

    // HTML5 file-drag intake (plain browser / dev only — see the section header). Does the drag carry
    // OS FILES (not an internal reorder)? Only then do we claim it as an image-drop target.
    function onCardFileDragOver(e: DragEvent, id: string): void {
        if (!editable() || !isFileDrag(e.dataTransfer)) return
        e.preventDefault() // required for the drop to fire
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        setDropCardId(id)
    }
    function onCardFileDragLeave(e: DragEvent, id: string): void {
        // Only clear when the cursor actually left the card (dragleave also fires moving between the
        // card's own children); ignore a leave whose destination is still inside this card.
        const card = e.currentTarget as HTMLElement
        const to = e.relatedTarget as Node | null
        if (to && card.contains(to)) return
        if (dropCardId() === id) setDropCardId(null)
    }
    async function onCardFileDrop(e: DragEvent, row: Row): Promise<void> {
        if (!editable() || !isFileDrag(e.dataTransfer)) return
        e.preventDefault()
        e.stopPropagation()
        setDropCardId(null)
        await embedImagesInCard(
            row,
            await uploadsFromFiles(e.dataTransfer!.files),
        )
    }

    return (
        <Show
            when={groupBy()}
            fallback={
                <Callout class={styles.kanbanHint}>
                    This kanban view needs a "groupBy" property. Add e.g.{' '}
                    <InlineCode>groupBy: note.status</InlineCode> to the view.
                </Callout>
            }
        >
            <div
                class={styles.kanban}
                ref={rootEl}
                style={{ '--kb-drag-h': `${drag.dragH()}px` }}
            >
                {/* Columns are keyed by their group KEY (a stable string), so a header reorder MOVES the
            column DOM (FLIP-animated via data-kbcol) rather than re-rendering every column's content,
            and a card status-toggle refetch (same keys) reuses columns. `group()` is looked up
            reactively; the inner card <For> is path-keyed. `columnKeys()` folds in the optimistic
            reorder so columns settle instantly instead of snapping back during the write round-trip. */}
                <For each={columnKeys()}>
                    {key => {
                        const group = () => groupByKey(key)
                        const color = () => colColor(key)
                        // Exactly one control is ever marked: a swatch when an override is set
                        // (and it matches the current color), else Auto — never both at once.
                        const hasOverride = () => !!groupColors()[key]
                        let colorAnchorRef: HTMLDivElement | undefined
                        return (
                            <>
                                {/* Drop-gap placeholder: a slim insertion bar in the slot the dragged column lands in
                  (the horizontal analogue of the card placeholder). Rendered BEFORE this column when
                  it's the drop target's neighbour; a trailing one after the <For> handles last-slot. */}
                                <Show when={drag.colGap().before === key}>
                                    <div class={styles.kanbanColPlaceholder} />
                                </Show>
                                <div
                                    class={styles.kanbanColumn}
                                    data-kbcol={key}
                                    classList={{
                                        [styles.kanbanColumnOver]:
                                            drag.overCol() === key &&
                                            drag.colDrag() === null,
                                        [styles.kanbanColReorder]:
                                            drag.colOver() === key &&
                                            drag.colDrag() !== null &&
                                            drag.colDrag() !== key,
                                        [styles.kanbanColDragging]:
                                            drag.colDrag() === key,
                                    }}
                                    style={{ '--kb-col-color': color() }}
                                >
                                    <div
                                        class={styles.kbColorAnchor}
                                        ref={el => (colorAnchorRef = el)}
                                    >
                                        <div
                                            class={styles.kanbanColHeader}
                                            onPointerDown={e =>
                                                drag.startColDrag(e, key)
                                            }
                                        >
                                            <PlainButton
                                                class={styles.kbDotBtn}
                                                title={
                                                    editable()
                                                        ? 'Column color'
                                                        : undefined
                                                }
                                                disabled={!editable()}
                                                onClick={() =>
                                                    setPickerCol(
                                                        pickerCol() ===
                                                            group().key
                                                            ? null
                                                            : group().key,
                                                    )
                                                }
                                            >
                                                <Text
                                                    as="span"
                                                    inherit
                                                    class={styles.dot}
                                                />
                                            </PlainButton>
                                            <Text
                                                as="span"
                                                inherit
                                                class={styles.kanbanColTitle}
                                            >
                                                {group().key === ''
                                                    ? '(empty)'
                                                    : group().key}
                                            </Text>
                                            <Text
                                                as="span"
                                                inherit
                                                class={styles.kanbanCount}
                                            >
                                                {group().rows.length}
                                            </Text>
                                            <Show when={canAdd()}>
                                                <KanbanColumnMenu
                                                    name={group().key}
                                                    canDelete={
                                                        group().rows.length ===
                                                        0
                                                    }
                                                    existing={columnKeys().filter(
                                                        k => k !== group().key,
                                                    )}
                                                    onRename={to =>
                                                        void renameColumn(
                                                            group().key,
                                                            to,
                                                        )
                                                    }
                                                    onDelete={() =>
                                                        void deleteColumn(
                                                            group().key,
                                                        )
                                                    }
                                                />
                                            </Show>
                                        </div>

                                        {/* Color picker popover */}
                                        <AnchoredPopover
                                            anchor={() => colorAnchorRef}
                                            open={pickerCol() === group().key}
                                            onDismiss={() => setPickerCol(null)}
                                            class={styles.kbColorPanel}
                                            panelAttrs={{
                                                'data-testid':
                                                    'kanban-color-picker',
                                            }}
                                        >
                                            <For each={PALETTE}>
                                                {(c, i) => (
                                                    <Swatch
                                                        size="sm"
                                                        color={c}
                                                        selected={
                                                            hasOverride() &&
                                                            color() === c
                                                        }
                                                        label={
                                                            PALETTE_NAMES[i()]!
                                                        }
                                                        onClick={() =>
                                                            void setColColor(
                                                                group().key,
                                                                c,
                                                            )
                                                        }
                                                    />
                                                )}
                                            </For>
                                            <PlainButton
                                                class={styles.kbSwatchAuto}
                                                classList={{
                                                    [styles.kbSwatchAutoActive]:
                                                        !hasOverride(),
                                                }}
                                                title="Auto"
                                                aria-label="Auto"
                                                aria-pressed={
                                                    hasOverride()
                                                        ? undefined
                                                        : 'true'
                                                }
                                                onClick={() =>
                                                    void setColColor(
                                                        group().key,
                                                        null,
                                                    )
                                                }
                                            >
                                                Auto
                                            </PlainButton>
                                        </AnchoredPopover>
                                    </div>

                                    <div class={styles.kanbanCards}>
                                        <For each={visibleIds(group())}>
                                            {(id, i) => {
                                                const [editing, setEditing] =
                                                    createSignal(false)
                                                const row = () =>
                                                    rowById().get(id)
                                                return (
                                                    <>
                                                        <div
                                                            class={`${styles.kanbanPlaceholder} ${
                                                                drag.overCol() ===
                                                                    group()
                                                                        .key &&
                                                                drag.overIndex() ===
                                                                    i()
                                                                    ? styles.kanbanPlaceholderActive
                                                                    : ''
                                                            }`}
                                                        />
                                                        <Show when={row()}>
                                                            {r => (
                                                                <CardFrame
                                                                    kind={
                                                                        isTasks()
                                                                            ? 'task'
                                                                            : 'note'
                                                                    }
                                                                    draggable
                                                                    dropTarget={
                                                                        dropCardId() ===
                                                                        id
                                                                    }
                                                                    data-kbcard=""
                                                                    data-path={
                                                                        id
                                                                    }
                                                                    data-testid="kanban-card"
                                                                    onPointerDown={e => {
                                                                        if (
                                                                            !editing()
                                                                        )
                                                                            drag.startCardDrag(
                                                                                e,
                                                                                id,
                                                                                group()
                                                                                    .key,
                                                                            )
                                                                    }}
                                                                    onContextMenu={
                                                                        suppressCardContextMenu
                                                                    }
                                                                    onDragEnter={e =>
                                                                        onCardFileDragOver(
                                                                            e,
                                                                            id,
                                                                        )
                                                                    }
                                                                    onDragOver={e =>
                                                                        onCardFileDragOver(
                                                                            e,
                                                                            id,
                                                                        )
                                                                    }
                                                                    onDragLeave={e =>
                                                                        onCardFileDragLeave(
                                                                            e,
                                                                            id,
                                                                        )
                                                                    }
                                                                    onDrop={e =>
                                                                        void onCardFileDrop(
                                                                            e,
                                                                            r(),
                                                                        )
                                                                    }
                                                                >
                                                                    <Show
                                                                        when={isTasks()}
                                                                        fallback={
                                                                            <CardBodyInner
                                                                                looseGap
                                                                            >
                                                                                <KanbanCard
                                                                                    row={r()}
                                                                                    titleCol={titleCol()}
                                                                                    metaCols={metaCols()}
                                                                                    config={
                                                                                        props.config
                                                                                    }
                                                                                    editable={
                                                                                        editable() &&
                                                                                        !isStoredPlaceholder(
                                                                                            r(),
                                                                                        )
                                                                                    }
                                                                                    hideLabels={hideLabels()}
                                                                                    onEditingChange={
                                                                                        setEditing
                                                                                    }
                                                                                    onRename={t =>
                                                                                        void renameCard(
                                                                                            r(),
                                                                                            t,
                                                                                        )
                                                                                    }
                                                                                    onSetMeta={(
                                                                                        id,
                                                                                        v,
                                                                                    ) =>
                                                                                        void setMetaProperty(
                                                                                            r(),
                                                                                            id,
                                                                                            v,
                                                                                        )
                                                                                    }
                                                                                    onDelete={() =>
                                                                                        void deleteCard(
                                                                                            r(),
                                                                                        )
                                                                                    }
                                                                                    siblingValues={
                                                                                        siblingValuesFor
                                                                                    }
                                                                                />
                                                                            </CardBodyInner>
                                                                        }
                                                                    >
                                                                        <TaskRow
                                                                            row={r()}
                                                                            variant="card"
                                                                            onToggle={(
                                                                                row,
                                                                                e,
                                                                            ) =>
                                                                                props.onToggle?.(
                                                                                    row,
                                                                                    e,
                                                                                )
                                                                            }
                                                                            onSetStatus={(
                                                                                row,
                                                                                e,
                                                                            ) =>
                                                                                props.onSetStatus?.(
                                                                                    row,
                                                                                    e,
                                                                                )
                                                                            }
                                                                        />
                                                                    </Show>
                                                                </CardFrame>
                                                            )}
                                                        </Show>
                                                    </>
                                                )
                                            }}
                                        </For>
                                        <div
                                            class={`${styles.kanbanPlaceholder} ${
                                                drag.overCol() ===
                                                    group().key &&
                                                drag.overIndex() ===
                                                    visibleRows(group()).length
                                                    ? styles.kanbanPlaceholderActive
                                                    : ''
                                            }`}
                                        />

                                        {/* Add-card composer (Trello-style) — only when the column value is writable. */}
                                        <Show when={canAdd()}>
                                            <Show
                                                when={
                                                    composerCol() ===
                                                    group().key
                                                }
                                                fallback={
                                                    <IconButton
                                                        icon="Plus"
                                                        label="Add a card"
                                                        class={styles.kbAddBtn}
                                                        onClick={() => {
                                                            setComposerCol(
                                                                group().key,
                                                            )
                                                            setDraft('')
                                                        }}
                                                    />
                                                }
                                            >
                                                <TextInput
                                                    multiline
                                                    plain
                                                    class={styles.kbComposer}
                                                    value={draft()}
                                                    placeholder="Card title…  (⏎ to add, Esc to close)"
                                                    ref={el =>
                                                        queueMicrotask(() =>
                                                            el.focus(),
                                                        )
                                                    }
                                                    onInput={value =>
                                                        setDraft(value)
                                                    }
                                                    onKeyDown={e => {
                                                        if (isConfirmKey(e)) {
                                                            e.preventDefault()
                                                            // Capture the element NOW — after the await, `e.currentTarget` is null
                                                            // (it only points at the handler's node during dispatch), so the old
                                                            // `.then(() => e.currentTarget.focus())` threw instead of restoring
                                                            // focus. Composer focus must survive every add for rapid entry (#93).
                                                            const el =
                                                                e.currentTarget
                                                            void addCard(
                                                                group().key,
                                                            ).then(() =>
                                                                el.focus(),
                                                            )
                                                        } else if (
                                                            isDismissKey(e)
                                                        ) {
                                                            setComposerCol(null)
                                                            setDraft('')
                                                        }
                                                    }}
                                                    onBlur={() => {
                                                        if (
                                                            draft().trim() ===
                                                            ''
                                                        )
                                                            setComposerCol(null)
                                                    }}
                                                />
                                            </Show>
                                        </Show>
                                    </div>
                                </div>
                            </>
                        )
                    }}
                </For>
                {/* Trailing drop-gap: the dragged column lands past the last column. */}
                <Show when={drag.colGap().trailing}>
                    <div class={styles.kanbanColPlaceholder} />
                </Show>
                {/* Add-column ghost — same gate as the per-column add-card composer: editable +
                    a writable groupBy (a new column has nowhere writable to place its value
                    otherwise). */}
                <Show when={canAdd()}>
                    <KanbanAddColumn
                        existing={columnKeys()}
                        onAdd={name => void addColumn(name)}
                    />
                </Show>
            </div>
        </Show>
    )
}
