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
import type {
    ViewResult,
    BaseConfig,
    Row,
    ResultGroup,
} from '../../../core/src/bases/types'
import { resolveProperty } from '../../../core/src/bases/query'
import { propertyType } from '../../../core/src/bases/properties'
import { rowId } from './rowIdentity'
import { storedNote } from './taskWrite'
import { storedTitleColumn, matchedStoredRowId } from './kanbanMeta'
import { metaColumns, metaSource, writableKey } from './kanbanMeta'
import { createKanbanDrag } from './kanbanDrag'
import {
    createKanbanActions,
    deleteSnapshot,
    ORDER_KEY,
    type PendingAdd,
    type PendingMove,
} from './kanbanActions'
import KanbanAddColumn from './KanbanAddColumn'
import KanbanColumn from './KanbanColumn'
import { markdownDropTarget, isImagePath } from './kanbanImageDrop'
import {
    isFileDrag,
    nativeDropPoint,
    uploadsFromFiles,
    uploadsFromNativePaths,
    type ImageUpload,
} from './cardImageDrop'
import { embedUploadsIntoValue } from './imageEmbedWrite'
import { propertyEditKind, type PropertyEditKind } from './propertyEdit'
import { propertyRegistry } from '../propertyRegistry'
import { isRowHidden, pruneDeleted, type DeletedMap } from './kanbanDelete'
import { type NativeDragDetail } from '../nativeDrop'
import { claimNativeDrop } from '../nativeDropRouting'
import { GROUP_PALETTE, autoGroupColor } from './groupHue'
import { pushToast } from '../Toast'
import Callout from '../ui/Callout'
import InlineCode from '../ui/InlineCode'
import styles from './KanbanView.module.css'

// The active theme's graph-node ramp (`accentPalette` → --graph-0..4), a designed set of
// distinguishable-yet-cohesive colors. Used as the per-column fallback so columns vary out of
// the box (issue: every custom column was the same accent color) AND as the picker swatches —
// so it stays on-theme and adapts to light/dark + whichever theme is active. Lives in
// groupHue.ts with the key→colour rule, which CardsView's grouped covers share.
const PALETTE = GROUP_PALETTE

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
    /** Open the card's note in a tab. Unused by KanbanView itself today (no host currently
     *  wires it in) — kept for prop-shape parity with the other views. */
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
        return autoGroupColor(key)
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
    // The column whose header is mid-rename — swaps the title `Text` for the same inline
    // `KanbanColumnNameInput` the old `…` menu's rename step used.
    const [renamingCol, setRenamingCol] = createSignal<string | null>(null)
    // The column the pointer is over — reveals that column's header `[✎][🗑]` bar (as
    // `data-hover`, alongside CSS `:hover`) so a story's synthetic `userEvent.hover` shows it too.
    const [hoverCol, setHoverCol] = createSignal<string | null>(null)
    const [composerCol, setComposerCol] = createSignal<string | null>(null)
    const [draft, setDraft] = createSignal('')

    // Optimistic moves: on drop we place cards immediately from this overlay so a dragged card
    // never snaps back to its origin while the async setProperty writes + refetch are in flight
    // (the flicker). Each entry clears itself once the server data catches up (see the effect below).
    const [pending, setPending] = createSignal<Record<string, PendingMove>>({})
    // Just-created cards, shown INSTANTLY in their column before the file write's (debounced) refetch
    // brings the real row — so adding a card doesn't blink/hide-then-reappear. Each clears once the
    // server data contains its path.
    const [pendingAdds, setPendingAdds] = createSignal<PendingAdd[]>([])
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

    // Ids deleted this session but not yet confirmed gone by a refetch — hidden from every column
    // at once; a stored row's entry carries a content snapshot (see kanbanDelete.ts).
    const [deletedIds, setDeletedIds] = createSignal<DeletedMap>(new Map())

    const actions = createKanbanActions({
        basePath: () => props.basePath,
        viewIndex: () => props.viewIndex ?? 0,
        config: () => props.config,
        result: () => props.result,
        ownsRows: () => !!props.ownsRows,
        onChange: () => props.onChange(),
        groupBy,
        groupColors,
        titleCol,
        editable,
        autoColor,
        columnKeys,
        groupByKey,
        effOrder,
        sortedRows,
        overlay: {
            pending,
            setPending,
            pendingAdds,
            setPendingAdds,
            pendingColOrder,
            setPendingColOrder,
            pendingRemovedCols,
            setPendingRemovedCols,
            setDeletedIds,
        },
        // Lazy: `drag` is built just below from this module's own dropCard/reorderColumns.
        drag: () => drag,
        closeColorPicker: () => setPickerCol(null),
        draft,
        setDraft,
    })

    // The pointer-drag + FLIP engine (kanbanDrag.ts). Created here, after `columnKeys`, since its
    // drop-gap memo reads that on creation; the writes a drop implies stay in this view.
    const drag = createKanbanDrag({
        root: () => rootEl,
        editable,
        columnKeys,
        dropCard: actions.dropCard,
        reorderColumns: actions.reorderColumns,
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

    // Every OTHER row's raw value for `id`, across the whole board — feeds the meta chip
    // editor's "select from known values" fallback (propertyEdit.ts). Computed on demand (a
    // click, not every render) so it's cheap even though it's an O(rows) scan.
    function siblingValuesFor(id: string): unknown[] {
        return props.result.groups
            .flatMap(g => g.rows)
            .map(r => resolveProperty(id, r))
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
        try {
            const { value: next, landed } = await embedUploadsIntoValue({
                uploads,
                notePath: row.file.path,
                value: () => String(resolveProperty(id, row) ?? ''),
            })
            if (landed === 0) return // nothing landed (uploadImageEmbeds already toasted why)
            await actions.setMetaProperty(row, id, next)
            const label =
                row.file.path.split('/').pop()?.replace(/\.md$/, '') ??
                row.file.path
            pushToast(
                `Added ${landed === 1 ? 'image' : `${landed} images`} to "${label}"`,
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
                    This kanban view needs a "group by" property. Open{' '}
                    <InlineCode>Settings</InlineCode> (the gear in the view bar)
                    and set group by.
                </Callout>
            }
        >
            <div
                class={styles.kanban}
                ref={rootEl}
                style={{ '--kb-drag-h': `${drag.dragH()}px` }}
            >
                {/* Columns are keyed by their group KEY (a stable string), so a header reorder MOVES the
                    column DOM (FLIP-animated via data-kbcol) rather than re-rendering every column's
                    content, and a card status-toggle refetch (same keys) reuses columns. `columnKeys()`
                    folds in the optimistic reorder so columns settle instantly instead of snapping back
                    during the write round-trip. */}
                <For each={columnKeys()}>
                    {(key, colIndex) => {
                        const group = () => groupByKey(key)
                        return (
                            <>
                                {/* Drop-gap placeholder: a slim insertion bar in the slot the dragged column lands in
                                    (the horizontal analogue of the card placeholder). Rendered BEFORE this column when
                                    it's the drop target's neighbour; a trailing one after the <For> handles last-slot. */}
                                <Show when={drag.colGap().before === key}>
                                    <div class={styles.kanbanColPlaceholder} />
                                </Show>
                                <KanbanColumn
                                    columnKey={key}
                                    color={colColor(key)}
                                    hasOverride={!!groupColors()[key]}
                                    palette={PALETTE}
                                    count={group().rows.length}
                                    editable={editable()}
                                    actions={canAdd()}
                                    renaming={renamingCol() === key}
                                    existing={columnKeys().filter(
                                        k => k !== key,
                                    )}
                                    pickerOpen={pickerCol() === key}
                                    onTogglePicker={() =>
                                        setPickerCol(
                                            pickerCol() === key ? null : key,
                                        )
                                    }
                                    onPickColor={c =>
                                        void actions.setColColor(key, c)
                                    }
                                    onStartRename={() => setRenamingCol(key)}
                                    onRename={to => {
                                        void actions.renameColumn(key, to)
                                        setRenamingCol(null)
                                    }}
                                    onCancelRename={() => setRenamingCol(null)}
                                    onDelete={() =>
                                        void actions.deleteColumn(key)
                                    }
                                    onPointerDown={e =>
                                        drag.startColDrag(e, key)
                                    }
                                    hovered={hoverCol() === key}
                                    onHover={h =>
                                        setHoverCol(c =>
                                            h ? key : c === key ? null : c,
                                        )
                                    }
                                    over={
                                        drag.overCol() === key &&
                                        drag.colDrag() === null
                                    }
                                    reorderTarget={
                                        drag.colOver() === key &&
                                        drag.colDrag() !== null &&
                                        drag.colDrag() !== key
                                    }
                                    dragging={drag.colDrag() === key}
                                    last={
                                        colIndex() === columnKeys().length - 1
                                    }
                                    ids={visibleIds(group())}
                                    rowById={id => rowById().get(id)}
                                    overIndex={
                                        drag.overCol() === key
                                            ? drag.overIndex()
                                            : null
                                    }
                                    tasks={isTasks()}
                                    config={props.config}
                                    titleCol={titleCol()}
                                    metaCols={metaCols()}
                                    hideLabels={hideLabels()}
                                    cardsEditable={editable()}
                                    dropCardId={dropCardId()}
                                    onCardPointerDown={(e, id) =>
                                        drag.startCardDrag(e, id, key)
                                    }
                                    onFileDragOver={onCardFileDragOver}
                                    onFileDragLeave={onCardFileDragLeave}
                                    onFileDrop={(e, row) =>
                                        void onCardFileDrop(e, row)
                                    }
                                    onRenameCard={actions.renameCard}
                                    onSetMeta={(row, id, v) =>
                                        void actions.setMetaProperty(row, id, v)
                                    }
                                    onDeleteCard={row =>
                                        void actions.deleteCard(row)
                                    }
                                    siblingValues={siblingValuesFor}
                                    onToggle={props.onToggle}
                                    onSetStatus={props.onSetStatus}
                                    canAdd={canAdd()}
                                    composing={composerCol() === key}
                                    draft={draft()}
                                    onDraft={setDraft}
                                    onOpenComposer={() => {
                                        setComposerCol(key)
                                        setDraft('')
                                    }}
                                    onCloseComposer={() => {
                                        setComposerCol(null)
                                        setDraft('')
                                    }}
                                    onAddCard={() => actions.addCard(key)}
                                />
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
                        onAdd={name => void actions.addColumn(name)}
                    />
                </Show>
            </div>
        </Show>
    )
}
