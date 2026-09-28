import {
    For,
    Index,
    Show,
    createMemo,
    createSignal,
    createEffect,
    onMount,
    on,
    type JSX,
} from 'solid-js'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { resolveProperty } from '../../../core/src/bases/query'
import {
    renderCell,
    renderTitle,
} from './renderValue'
import {
    isTagColumn,
    isRatingColumn,
    isStatusColumn,
    bareName,
} from './columnKinds'
import { todayISO } from '../../../core/src/dates'
import { checkStatus, isOverdue } from './taskDisplay'
import TaskCheck from './TaskCheck'
import { settings } from '../settings'
import EmptyState from '../ui/EmptyState'
import { canWriteStoredRow, isStoredPlaceholder } from './taskWrite'
import { commitMeta } from './rowWrites'
import { useRowEditor } from './useRowEditor'
import { writableKey } from './kanbanMeta'
import TableCell from './TableCell'
import { mountKeys } from './reconcileRows'
import TableHeader from './TableHeader'
import TableGroupRow from './TableGroupRow'
import TableSummaryRow from './TableSummaryRow'
import {
    columnAtX,
    moveColumn,
    resizeTarget as resizeTargetFor,
    resizedWidths,
    seedWidths,
} from './tableColumnDrag'
import styles from './TableView.module.css'

// Pixels from the right edge of a header that count as the resize grab zone.
const RESIZE_GRAB_PX = 10

export function TableView(props: {
    result: ViewResult
    config: BaseConfig
    /** When set, dragging a header body reorders columns; called with the new order. */
    onReorder?: (cols: string[]) => void
    /** Initial per-column widths (px); called after a resize-drag to persist them. */
    widths?: Record<string, number>
    onWidthsChange?: (widths: Record<string, number>) => void
    // The table is the ONE row view that does not become a task line in tasks mode — a
    // checkbox, a description and five chips do not fit a cell, and folding a row into one
    // would throw away the columns the table exists to show. It gets the two affordances that
    // DO fit a cell instead: the `status` column becomes a live checkbox, and the `due` column
    // paints overdue. Everything else stays an ordinary cell. See ListView for the seam.
    mode?: 'normal' | 'tasks'
    onToggle?: (row: Row, e: Event) => void
    onSetStatus?: (row: Row, e: MouseEvent) => void
    /** The base file, so a cell can open the row/property editor. Optional: a view rendered
     *  read-only (an embedded ```query block, a story with no base of its own) gets none of
     *  the row-editing affordances below, same gate as KanbanView's `editable()`. */
    basePath?: string
    /** Refetch after a row edit/delete lands — BaseView's `refetchAll`. */
    onChange?: () => void
}) {
    const cols = (): string[] => props.result.columns
    const isTasks = () => props.mode === 'tasks'
    /** The `due` column, by the same bare-name rule `isStatusColumn` uses for `status`. */
    const isDueColumn = (id: string) => bareName(id) === 'due'
    const [, setDragIdx] = createSignal<number | null>(null)
    const [overIdx, setOverIdx] = createSignal<number | null>(null)
    const [w, setW] = createSignal<Record<string, number>>(props.widths ?? {})
    // Index of the column currently being resized (drives the visual cue + table-layout:fixed lock).
    const [resizing, setResizing] = createSignal<number | null>(null)
    let theadRef: HTMLTableSectionElement | undefined

    // Every OTHER row's raw value for `id`, across the table, restricted to ARRAY-valued
    // rows only — a `tags`/multiselect column needs its siblings so its dropdown lists the
    // rest of the board's values, but leaking a STRING sibling here would turn every short
    // text column (two titles, two authors) into a select you cannot type into. A declared
    // select/date/number type still gets its own dedicated editor regardless.
    const allRows = createMemo(() => props.result.groups.flatMap(g => g.rows))
    const arraySiblingsFor = (id: string): unknown[] =>
        allRows()
            .map(r => resolveProperty(id, r))
            .filter(Array.isArray)
    // Stored rows per base file — a TableCell drops an open edit when its file's count changes
    // (a stored row's identity is its index in that file, so an earlier row's delete shifts it).
    const storedCounts = createMemo(() => {
        const m = new Map<string, number>()
        for (const r of allRows())
            if (typeof r.index === 'number')
                m.set(r.file.path, (m.get(r.file.path) ?? 0) + 1)
        return m
    })
    const editable = () => !!props.basePath
    const rowEditable = (row: Row) => editable() && !isStoredPlaceholder(row)
    // A cell is edited in place when its row can be written and its column is a real property
    // (not file.* / formula.*). A task LINE's fields are not frontmatter — those rows edit through
    // the task editor instead, so their cells stay read-only here.
    const canEditCell = (row: Row, c: string) =>
        rowEditable(row) &&
        writableKey(c) !== null &&
        (canWriteStoredRow(row) || typeof row.note.line !== 'number')
    // `row` is an accessor, not a Row: the body <For> keys rows by `mountKeys`, so an edited row
    // hands this same cell a NEW row object in place rather than remounting it. Everything here
    // therefore reads `row()` inside a getter — only `editable`'s boolean decides whether the
    // TableCell exists, so a value change repaints the display and never tears down an open
    // editor (a tags toggle's own write revalidates the base while the picker is still open).
    const cellBody = (c: string, ci: number, row: () => Row): JSX.Element => {
        const display = () =>
            ci === 0
                ? renderTitle(c, row())
                : renderCell(c, row(), false, props.config, true)
        // A NOTE row's title opens the note, as it always has; its other cells edit in place.
        const editable = createMemo(
            () =>
                !(ci === 0 && !canWriteStoredRow(row())) &&
                canEditCell(row(), c),
        )
        return (
            <Show when={editable()} fallback={display()}>
                <TableCell
                    row={row()}
                    col={c}
                    config={props.config}
                    // Array-only siblings (see arraySiblingsFor above) — a tags column's dropdown
                    // fills in from the rest of the table; a text column never sees another row's
                    // string value, so it never turns into a select you cannot type into.
                    siblingValues={() => arraySiblingsFor(c)}
                    storedCount={
                        typeof row().index === 'number'
                            ? () => storedCounts().get(row().file.path) ?? 0
                            : undefined
                    }
                    onCommit={v => void commitMeta(row(), c, v, props.onChange)}
                >
                    {display()}
                </TableCell>
            </Show>
        )
    }

    // Right-click opens the row editor. `editable` already refuses a task-line row (its fields
    // are not frontmatter — the task editor owns those) and a pending placeholder.
    const rowEditor = useRowEditor({
        config: () => props.config,
        view: () => props.result.view,
        columns: cols,
        onChanged: () => props.onChange?.(),
    })
    function onRowContextMenu(e: MouseEvent, row: Row): void {
        if (!editable() || !rowEditor.editable(row)) return
        e.preventDefault()
        e.stopPropagation()
        rowEditor.open(row)
    }

    // Re-apply persisted widths whenever they change (e.g. on reload / refetch).
    // TableView stays mounted across BaseView refetches, so the createSignal
    // initializer above only runs once — without this effect, widths saved to
    // the file would never re-appear after a reload. Skip while a drag owns w().
    createEffect(
        on(
            () => props.widths,
            incoming => {
                if (resizing() !== null) return
                setW(incoming ?? {})
            },
            { defer: true },
        ),
    )

    const headerEls = () =>
        theadRef
            ? (Array.from(theadRef.querySelectorAll('th')) as HTMLElement[])
            : []

    const headerRects = () => headerEls().map(t => t.getBoundingClientRect())

    // Pointer-based column reorder (deterministic; no HTML5 DnD). Header body only —
    // the right-edge resize handle stops propagation so it never starts a reorder.
    const startReorder = (fromIdx: number, e: PointerEvent) => {
        if (!props.onReorder) return
        e.preventDefault()
        document.body.style.userSelect = 'none'
        setDragIdx(fromIdx)
        const onMove = (ev: PointerEvent) =>
            setOverIdx(columnAtX(headerRects(), ev.clientX))
        const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            document.body.style.userSelect = ''
            const next = moveColumn(cols(), fromIdx, overIdx())
            setDragIdx(null)
            setOverIdx(null)
            if (next) props.onReorder!(next)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }

    // Which column a pointerdown on header `idx` would resize, or null if not in a resize zone.
    const resizeTarget = (idx: number, e: PointerEvent): number | null =>
        resizeTargetFor(
            idx,
            (e.currentTarget as HTMLElement).getBoundingClientRect(),
            e.clientX,
            RESIZE_GRAB_PX,
            !!props.onWidthsChange,
        )

    // th pointerdown: in a resize zone (either edge of the boundary) → resize that column;
    // otherwise begin a reorder drag.
    const onHeaderPointerDown = (idx: number, e: PointerEvent) => {
        const target = resizeTarget(idx, e)
        if (target !== null) startResize(cols()[target], target, e)
        else startReorder(idx, e)
    }

    // Pointer-based column resize. Seeds unset widths from rendered header widths so the
    // switch to fixed layout doesn't jump.
    const startResize = (col: string, idx: number, e: PointerEvent) => {
        e.preventDefault()
        e.stopPropagation()
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
        setResizing(idx)
        const ths = headerEls()
        // Seed every column from its rendered width so switching to table-layout:fixed
        // doesn't reflow the untouched columns.
        const seed = seedWidths(
            cols(),
            w(),
            ths.map(t => t.offsetWidth),
        )
        const startX = e.clientX
        const startW = seed[col] ?? ths[idx]?.offsetWidth ?? 120
        setW(seed)
        const onMove = (ev: PointerEvent) =>
            setW(
                resizedWidths(
                    seed,
                    col,
                    startW,
                    startX,
                    ev.clientX,
                    settings.ui.tableMinColWidth,
                ),
            )
        const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
            setResizing(null)
            props.onWidthsChange?.(w())
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }

    // Columns with no STORED width (never resized, or a column added after widths were
    // saved) get a default seeded once, on first paint, from the header's own rendered
    // natural width — before this signal fills in, the table renders auto-layout (identical
    // to today's pre-fixed appearance), and it fills in synchronously on mount, before the
    // browser paints, so the default and the natural width are the same pixels. After that
    // the table is fixed forever: opening a cell's editor mounts inside a `<td>` whose column
    // width is already pinned, so it can never widen the column.
    const [defaultW, setDefaultW] = createSignal<Record<string, number>>({})
    const [mounted, setMounted] = createSignal(false)
    onMount(() => {
        const ths = headerEls()
        const seed: Record<string, number> = {}
        cols().forEach((c, i) => {
            if (w()[c] == null && ths[i]) seed[c] = ths[i].offsetWidth
        })
        setDefaultW(seed)
        setMounted(true)
    })
    const colWidth = (c: string): number | undefined => w()[c] ?? defaultW()[c]

    // Once mounted, EVERY visible column has a width (stored, or the natural-width default
    // above) — the table is table-layout:fixed and carries a <colgroup> from then on. The
    // pinned table width is the exact SUM of those widths, so resizing one column never
    // redistributes space to the others: the grabbed column changes, columns after it shift
    // as a block, and columns before it stay exactly put.
    const totalWidth = (): number | null => {
        if (!mounted() || cols().length === 0) return null
        let sum = 0
        for (const c of cols())
            sum += colWidth(c) ?? settings.ui.tableMinColWidth
        return sum
    }
    const fixed = () => totalWidth() !== null
    // Per-th hover flag: when the pointer is in the right-edge zone, show the
    // col-resize cursor on the whole cell so the affordance is discoverable.
    const [edgeIdx, setEdgeIdx] = createSignal<number | null>(null)

    // table-layout:fixed honors the <colgroup> px widths; pinning the table width to the
    // exact sum of those widths (NOT 100% / min-width:100%) is what stops the browser from
    // stretching columns to fill the container. That stretch is what made resizing one
    // column visibly reflow the columns before it — the leftover space was being shared
    // across every column. With an exact-sum width there is no leftover to redistribute.
    const tableStyle = () => {
        const total = totalWidth()
        return total != null
            ? { 'table-layout': 'fixed' as const, width: `${total}px` }
            : undefined
    }

    return (
        <>
            <table class={styles.table} style={tableStyle()}>
                <Show when={fixed()}>
                    <colgroup>
                        <For each={cols()}>
                            {c => (
                                <col
                                    style={
                                        colWidth(c)
                                            ? { width: `${colWidth(c)}px` }
                                            : undefined
                                    }
                                />
                            )}
                        </For>
                    </colgroup>
                </Show>
                <TableHeader
                    ref={el => (theadRef = el)}
                    cols={cols()}
                    config={props.config}
                    reorderable={!!props.onReorder}
                    resizable={!!props.onWidthsChange}
                    overIdx={overIdx()}
                    edgeIdx={edgeIdx()}
                    onPointerDown={onHeaderPointerDown}
                    onPointerMove={(i, e) =>
                        setEdgeIdx(resizeTarget(i, e) !== null ? i : null)
                    }
                    onPointerLeave={() => setEdgeIdx(null)}
                />
                <tbody>
                    {/* Index-keyed groups (see ListView): keeps each group's rows mounted across
                        a re-resolve so only the inner reference-keyed row <For> diffs — no
                        whole-table remount flash on a task toggle. */}
                    <Index each={props.result.groups}>
                        {group => {
                            // Rows keyed by `mountKeys`, NOT by object identity: reconcileRows
                            // hands an edited row a fresh object (so identity-keyed views
                            // repaint it), which under an identity-keyed <For> would unmount the
                            // very cell being edited. See `cellBody`.
                            const keyed = createMemo(() => {
                                const rows = group().rows
                                const keys = mountKeys(rows)
                                return {
                                    keys,
                                    byKey: new Map(
                                        keys.map((k, i) => [k, rows[i]!]),
                                    ),
                                }
                            })
                            return (
                                <>
                                    <Show when={group().key !== ''}>
                                        <TableGroupRow
                                            label={group().key}
                                            count={group().rows.length}
                                            colspan={cols().length}
                                        />
                                    </Show>
                                    <For each={keyed().keys}>
                                        {key => {
                                            // Keeps the last row while <For> disposes a removed
                                            // key, so a getter re-running mid-teardown never sees
                                            // undefined.
                                            let last: Row = keyed().byKey.get(key)!
                                            const row = () =>
                                                (last =
                                                    keyed().byKey.get(key) ?? last)
                                            return (
                                                <tr
                                                    class={styles.row}
                                                    onContextMenu={e =>
                                                        onRowContextMenu(e, row())
                                                    }
                                                >
                                                    <For each={cols()}>
                                                        {(c, ci) => {
                                                            const check = () =>
                                                                isTasks() &&
                                                                isStatusColumn(c)
                                                            const muted =
                                                                !isTagColumn(c) &&
                                                                !isRatingColumn(c) &&
                                                                ci() !== 0
                                                            return (
                                                                <td
                                                                    classList={{
                                                                        [styles.cell]: true,
                                                                        [styles.cellMuted]:
                                                                            muted &&
                                                                            !check(),
                                                                        [styles.cellOverdue]:
                                                                            isTasks() &&
                                                                            isDueColumn(c) &&
                                                                            isOverdue(
                                                                                row().note,
                                                                                todayISO(),
                                                                            ),
                                                                    }}
                                                                >
                                                                    <Show
                                                                        when={check()}
                                                                        fallback={cellBody(
                                                                            c,
                                                                            ci(),
                                                                            row,
                                                                        )}
                                                                    >
                                                                        <TaskCheck
                                                                            variant="cell"
                                                                            status={checkStatus(
                                                                                row().note
                                                                                    .status,
                                                                            )}
                                                                            onToggle={e =>
                                                                                props.onToggle?.(
                                                                                    row(),
                                                                                    e,
                                                                                )
                                                                            }
                                                                            onSetStatus={e =>
                                                                                props.onSetStatus?.(
                                                                                    row(),
                                                                                    e,
                                                                                )
                                                                            }
                                                                        />
                                                                    </Show>
                                                                </td>
                                                            )
                                                        }}
                                                    </For>
                                                </tr>
                                            )
                                        }}
                                    </For>
                                </>
                            )
                        }}
                    </Index>
                </tbody>
                <Show when={Object.keys(props.result.summaries).length > 0}>
                    <TableSummaryRow
                        cols={cols()}
                        summaries={props.result.summaries}
                    />
                </Show>
            </table>
            {/* Beside the table, not instead of it: the header row stays so the columns are
                still legible, and the table's own mount-time width seeding never has to wait
                for a first row. */}
            <Show when={allRows().length === 0}>
                <EmptyState title="no rows" class={styles.empty}>
                    nothing in this view matches its filters
                </EmptyState>
            </Show>
        </>
    )
}
