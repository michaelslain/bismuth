import {
    createSignal,
    createMemo,
    createEffect,
    untrack,
    For,
    Show,
    onMount,
    onCleanup,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { resolveProperty } from '../../../core/src/bases/query'
import { titleOf } from './kanbanMeta'
import { canWriteStoredRow, storedNote } from './taskWrite'
import { settings } from '../settings'
import { api } from '../api'
import { pushToast } from '../toastStore'
import Text from '../ui/Text'
import InlineCode from '../ui/InlineCode'
import EmptyState from '../ui/EmptyState'
import MapBasemap from './MapBasemap'
import MapPin from './MapPin'
import MapControls from './MapControls'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { createRow } from './rowWrites'
import { newTaskVisible } from './taskScope'
import { useRowEditor } from './useRowEditor'
import {
    project,
    unproject,
    toNum,
    screenToLatLng,
    pastDragThreshold,
    writableFieldKey,
    shouldReframe,
    worldToScreen,
    geoToScreen as geoToScreenAt,
    isPlaceable,
    fitView,
    scaleBarFor,
    zoomAround,
    withCoords,
    withoutCoords,
    siblingFolder as siblingFolderOf,
} from './mapCoords'
import styles from './MapView.module.css'
import { isDismissKey, isMenuKey } from '../ui/widgetKeys'

interface Marker {
    row: Row
    lat: number
    lng: number
}

/** A pin's identity across refetches: a note row by path, a stored row by path + index. */
const markerKey = (row: Row) => `${row.file.path}::${row.index ?? ''}`

/** What the next click on the map does: create a NEW row there (`Add pin`), or write the
 *  coordinates of an EXISTING row (Add pin's `place …` or a pin's `move pin`). */
type Armed = { kind: 'new' } | { kind: 'row'; row: Row }

export function MapView(props: {
    result: ViewResult
    config: BaseConfig
    /** The base file — what `Add pin` creates a row through (AddRowAction's `createRow`). With
     *  none, the map can still place/move/remove existing rows but cannot create one. */
    basePath?: string
    /** True when the base owns its rows (BaseView's `ownsRows`): a new pin is a row in the base
     *  file's own table rather than a new note. */
    ownsRows?: boolean
    /** Called after a pin is placed, moved or removed writes successfully. The real backend's
     *  mutating endpoints already invalidate + push SSE, but the ROUTE from that push back to
     *  this view's own `resolveRows` result runs through BaseView's own refetch, not a self-
     *  contained loop inside MapView — and Storybook's fake transport pushes no SSE at all, so
     *  without this callback wired to BaseView's `refetchAll` (as every sibling view does), a
     *  placed/moved/removed pin never reappears until something else refetches. Awaited when it
     *  returns a promise, so a newly created pin is on the map before its editor opens. */
    onChange?: () => unknown
}) {
    const latKey = () => props.result.view.lat ?? 'lat'
    const lngKey = () => props.result.view.lng ?? 'lng'
    const titleCol = () => props.result.columns[0] ?? 'file.name'

    // Whether the configured lat/lng property ids resolve to a real frontmatter key we can
    // write back to. `file.*`/`formula.*`/`this.*` coordinates have no note behind them, so
    // placement/move/remove are all disabled and the map stays read-only, exactly as today.
    const writable = createMemo(
        () =>
            writableFieldKey(latKey()) !== null &&
            writableFieldKey(lngKey()) !== null,
    )

    // Single pass: rows with a valid numeric, in-range lat/lng become markers; everything
    // else is "unplaced" — surfaced in the map's own chrome instead of silently dropped.
    const partitioned = createMemo<{ placed: Marker[]; unplaced: Row[] }>(
        () => {
            const lk = latKey()
            const lnk = lngKey()
            const placed: Marker[] = []
            const unplaced: Row[] = []
            for (const group of props.result.groups) {
                for (const row of group.rows) {
                    const lat = toNum(resolveProperty(lk, row))
                    const lng = toNum(resolveProperty(lnk, row))
                    if (!isPlaceable(lat, lng)) {
                        unplaced.push(row)
                        continue
                    }
                    placed.push({ row, lat, lng })
                }
            }
            return { placed, unplaced }
        },
    )
    const markers = createMemo(() => partitioned().placed)
    // Pins render keyed by row identity, not by Marker object: every refetch builds new Marker
    // objects, and keying on those re-created every pin <button> — a press that landed just as a
    // write's refetch arrived went down on one element and up on its replacement, so no click.
    const markerByKey = createMemo(
        () => new Map(markers().map(m => [markerKey(m.row), m])),
    )
    const markerKeys = createMemo(() => [...markerByKey().keys()])
    const unplacedRows = createMemo(() => partitioned().unplaced)

    // Initial framing: use view.center/zoom if given; else center+fit on the markers
    // we have; else fall back to a low-zoom world view.
    const initialView = createMemo(() => {
        const v = props.result.view
        if (v.center && typeof v.zoom === 'number')
            return { center: v.center, zoom: v.zoom }
        return fitView(markers(), settings.graph.mapDefaultZoom)
    })

    const [center, setCenter] = createSignal(initialView().center)
    const [zoom, setZoom] = createSignal(initialView().zoom)
    // Re-frame when the view's configured center/zoom changes, and once
    // when the first markers arrive on a map the user has not touched — never merely because a
    // marker moved (see `shouldReframe`). Placing or dragging a pin writes its note, the rows
    // refetch, and re-fitting on that jerked the whole map out from under the pin the user had
    // just put down. `userMoved` flips on any pan, zoom or arming, so placing the FIRST pin on
    // an all-unplaced map keeps the zoom the user chose instead of snapping to that pin.
    const frameKey = () => {
        const v = props.result.view
        return `${v.type}|${v.center?.lat},${v.center?.lng}|${v.zoom}`
    }
    let framedKey: string | null = null
    let framedWithMarkers = false
    let userMoved = false
    createEffect(() => {
        const key = frameKey()
        const hasMarkers = markers().length > 0
        if (
            !shouldReframe({
                key,
                framedKey,
                hasMarkers,
                framedWithMarkers,
                userMoved,
            })
        )
            return
        if (key !== framedKey) userMoved = false
        framedKey = key
        framedWithMarkers = hasMarkers
        const iv = untrack(initialView)
        setCenter(iv.center)
        setZoom(iv.zoom)
    })

    let mapEl: HTMLDivElement | undefined
    const [size, setSize] = createSignal({ w: 800, h: 600 })

    // ── Placement / move / remove state ─────────────────────────────────────────────────
    // What is "armed" for placement: a NEW pin (Add pin), or an existing row (a pin's own
    // `move pin` item). The next click on the map (not on a pin) creates the pin / writes that
    // row's coordinates and disarms. Escape disarms too.
    const [armed, setArmed] = createSignal<Armed | null>(null)
    // A background pan in progress — drives the `grabbing` cursor (a class, not an inline style).
    const [panning, setPanning] = createSignal(false)
    const [hoverPos, setHoverPos] = createSignal<{
        x: number
        y: number
    } | null>(null)
    // A pin mid-drag: its live pointer offset from its projected position, plus whether the
    // pointer has moved past the click/drag threshold yet.
    const [dragState, setDragState] = createSignal<{
        row: Row
        dx: number
        dy: number
        startX: number
        startY: number
        moved: boolean
    } | null>(null)
    // A pointerup that ends a real drag suppresses the synthetic click Solid's real <button>
    // would otherwise fire right after — a plain mutable flag (not a signal) is enough since
    // only one pointer interaction is ever in flight and it's read synchronously.
    let suppressNextPinClick = false

    const [pinMenu, setPinMenu] = createSignal<{
        x: number
        y: number
        row: Row
    } | null>(null)
    // The map's own right-click menu, at the clicked point: `new pin here`, then `place <title>
    // here` per row with no location yet — the one place an existing unplaced row gets a pin.
    const [mapMenu, setMapMenu] = createSignal<{
        x: number
        y: number
        lat: number
        lng: number
    } | null>(null)

    onMount(() => {
        if (!mapEl) return
        const ro = new ResizeObserver(() => {
            const r = mapEl!.getBoundingClientRect()
            if (r.width > 0 && r.height > 0)
                setSize({ w: r.width, h: r.height })
        })
        ro.observe(mapEl)
        onCleanup(() => ro.disconnect())

        // Escape disarms placement from anywhere, not just while the map has focus.
        const onKeyDown = (e: KeyboardEvent) => {
            if (isDismissKey(e) && armed()) disarm()
        }
        document.addEventListener('keydown', onKeyDown)
        onCleanup(() => document.removeEventListener('keydown', onKeyDown))
    })

    // World-pixel coords of the map center at the current zoom — the anchor for
    // both basemap geometry and marker placement.
    const centerWorld = createMemo(() =>
        project(center().lat, center().lng, zoom()),
    )

    // Convert a world-pixel coord into screen-pixel coords inside the map element.
    const toScreen = (wx: number, wy: number) =>
        worldToScreen(wx, wy, size(), centerWorld())

    // Project a geographic point to screen pixels at the current view.
    const geoToScreen = (lat: number, lng: number) =>
        geoToScreenAt(lat, lng, size(), centerWorld(), zoom())

    // Scale bar: ground distance of a fixed on-screen segment, at the map centre.
    const scaleBar = createMemo(() => scaleBarFor(zoom(), center().lat))

    // ── Write seam ───────────────────────────────────────────────────────────────────────
    // A note row writes its lat/lng straight onto frontmatter; a stored (own-rows) row
    // writes back by index — same split BaseView's storedTarget makes for task writes, and
    // the same reason: the write handle belongs to the ROW, not the view.
    const writeCoords = async (row: Row, lat: number, lng: number) => {
        const latField = writableFieldKey(latKey())
        const lngField = writableFieldKey(lngKey())
        if (!latField || !lngField) return
        try {
            if (canWriteStoredRow(row)) {
                const note = withCoords(
                    storedNote(row),
                    latField,
                    lngField,
                    lat,
                    lng,
                )
                await api.rowUpdate(row.file.path, row.index!, note)
            } else {
                await api.setProperties([
                    { path: row.file.path, key: latField, value: lat },
                    { path: row.file.path, key: lngField, value: lng },
                ])
            }
            props.onChange?.()
        } catch (err) {
            pushToast(
                `Could not place pin: ${err instanceof Error ? err.message : String(err)}`,
            )
        }
    }

    const removeCoords = async (row: Row) => {
        const latField = writableFieldKey(latKey())
        const lngField = writableFieldKey(lngKey())
        if (!latField || !lngField) return
        try {
            if (canWriteStoredRow(row)) {
                const note = withoutCoords(storedNote(row), latField, lngField)
                await api.rowUpdate(row.file.path, row.index!, note)
            } else {
                await api.deleteProperty(row.file.path, latField)
                await api.deleteProperty(row.file.path, lngField)
            }
            props.onChange?.()
        } catch (err) {
            pushToast(
                `Could not remove pin: ${err instanceof Error ? err.message : String(err)}`,
            )
        }
    }

    // Whether `Add pin` can create a row at all, and — when it cannot — why, for its title.
    const createBlocked = (): string | null => {
        if (!writable())
            return `Pins can't be added: ${latKey()} / ${lngKey()} are computed, not note properties`
        if (!props.basePath)
            return "Pins can't be added: this map is not backed by a base file"
        // Rows stored in ANOTHER base file (a `from:` source): a new pin would be written as a
        // note this source never selects — an orphan the map would never show.
        if (!props.ownsRows) {
            const rows = props.result.groups.flatMap(g => g.rows)
            const foreign = rows.find(
                r => r.index !== undefined && r.file.path !== props.basePath,
            )
            if (rows.length > 0 && foreign && rows.every(r => r.index !== undefined))
                return `Pins can't be added here: these rows live in ${foreign.file.path} — add them there`
        }
        return null
    }

    // The folder a new NOTE row lands in: beside an existing note row, so a folder-scoped source
    // still selects it (KanbanView's `boardFolder()` does the same). Undefined = the base's own.
    const siblingFolder = (): string | undefined =>
        siblingFolderOf(
            props.result.groups.flatMap(g =>
                g.rows.map(r => ({ path: r.file.path, index: r.index })),
            ),
        )

    /** The row a create just made, once the refetch has it on the map: a note row by its path,
     *  a stored row as the one marker at exactly these coordinates that was not there before. */
    async function findCreated(
        created: Row,
        lat: number,
        lng: number,
        before: Set<string>,
    ): Promise<Row | undefined> {
        // Up to ~5s: the real server learns of the write over SSE a moment after it lands.
        for (let i = 0; i < 100; i++) {
            const hit = markers().find(m =>
                props.ownsRows
                    ? !before.has(markerKey(m.row)) &&
                      m.lat === lat &&
                      m.lng === lng
                    : m.row.file.path === created.file.path,
            )
            if (hit) return hit.row
            await new Promise(r => setTimeout(r, 50))
        }
        return undefined
    }

    // Add pin: create a NEW row at (lat, lng) through the same path the bar's `[+]` uses, then
    // open the row editor on it so the person names it and fills its properties.
    async function createPin(lat: number, lng: number): Promise<void> {
        const basePath = props.basePath
        const latField = writableFieldKey(latKey())
        const lngField = writableFieldKey(lngKey())
        if (!basePath || !latField || !lngField) return
        const before = new Set(markers().map(m => markerKey(m.row)))
        try {
            const created = await createRow({
                basePath,
                config: props.config,
                ownsRows: !!props.ownsRows,
                note: { [latField]: lat, [lngField]: lng },
                folder: siblingFolder(),
            })
            await props.onChange?.()
            // Same filter check as the bar's `[+]` (AddRowAction): report, never prevent.
            const visible = newTaskVisible(
                props.config,
                props.ownsRows ? { ...created, index: 0 } : created,
            )
            if (!visible) {
                pushToast(
                    props.ownsRows
                        ? `Pin added to ${basePath} — it does not match this view's filters, so it is not on this map`
                        : `Added ${created.file.path} — it does not match this view's filters, so it is not on this map`,
                )
                // A note row can still be named and filled in; a stored row has no write handle
                // until it is seen with its index.
                if (!props.ownsRows) editRow(created)
                return
            }
            const row = await findCreated(created, lat, lng, before)
            if (!row && props.ownsRows) {
                pushToast('Pin added — it will show once the map refreshes')
                return
            }
            editRow(row ?? created)
        } catch (err) {
            pushToast(
                `Could not add pin: ${err instanceof Error ? err.message : String(err)}`,
            )
        }
    }

    // The row editor (title + properties, with `[open note]`) — what a pin's click opens.
    const rowEditor = useRowEditor({
        config: () => props.config,
        view: () => props.result.view,
        columns: () => props.result.columns,
        onChanged: () => void props.onChange?.(),
        // Array-valued siblings feed a tags column's dropdown in the editor.
        siblingValues: id =>
            props.result.groups
                .flatMap(g => g.rows)
                .map(r => resolveProperty(id, r))
                .filter(Array.isArray),
    })
    function editRow(row: Row, focusTarget?: string) {
        rowEditor.open(row, focusTarget)
    }

    function disarm() {
        setArmed(null)
        setHoverPos(null)
    }

    // Arm a row for placement — a pin's own "move pin" item.
    function arm(row: Row) {
        userMoved = true
        setArmed({ kind: 'row', row })
        setPinMenu(null)
    }

    // Pan via mouse drag. Track in world-pixel deltas, then unproject the new center.
    let dragging = false
    let dragLastX = 0
    let dragLastY = 0

    function onMouseDown(e: MouseEvent): void {
        if (e.button !== 0) return
        if (armed()) return // a click while armed places the pin instead of panning
        dragging = true
        dragLastX = e.clientX
        dragLastY = e.clientY
        setPanning(true)
    }

    function onMouseMove(e: MouseEvent): void {
        if (armed()) {
            const rect = mapEl!.getBoundingClientRect()
            setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
            return
        }
        if (!dragging) return
        const dx = e.clientX - dragLastX
        const dy = e.clientY - dragLastY
        dragLastX = e.clientX
        dragLastY = e.clientY
        const c = centerWorld()
        userMoved = true
        setCenter(unproject(c.x - dx, c.y - dy, zoom()))
    }

    function onMouseUp(): void {
        dragging = false
        setPanning(false)
    }

    // Click to place: fires only when armed and the click landed on the map background. Pins
    // are click-through while armed (`.mapArmed .mapPin`), so a click beside a label still
    // lands here instead of opening that pin's editor.
    function onMapClick(e: MouseEvent): void {
        const a = armed()
        if (!a || !mapEl) return
        const rect = mapEl.getBoundingClientRect()
        const { lat, lng } = screenToLatLng(
            e.clientX - rect.left,
            e.clientY - rect.top,
            size(),
            centerWorld(),
            zoom(),
        )
        disarm()
        if (a.kind === 'new') void createPin(lat, lng)
        else void writeCoords(a.row, lat, lng)
    }

    // Zoom keeping a screen point anchored. `anchor` is screen-px within the map;
    // defaults to the map center (used by the +/- buttons).
    function zoomBy(delta: number, anchor?: { x: number; y: number }): void {
        const next = zoomAround(zoom(), center(), size(), delta, anchor)
        if (!next) return
        userMoved = true
        setZoom(next.zoom)
        setCenter(next.center)
    }

    // Zoom on wheel. Scroll up → zoom in; cursor's world point stays anchored under cursor.
    function onWheel(e: WheelEvent): void {
        e.preventDefault()
        const rect = mapEl!.getBoundingClientRect()
        zoomBy(-Math.sign(e.deltaY), {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        })
    }

    // Reset view: zoom out to a neutral, whole-world framing.
    function resetView(): void {
        setCenter({ lat: 20, lng: 0 })
        setZoom(settings.graph.mapDefaultZoom)
    }

    // Add pin: the next click on the map creates a NEW pin there (a new row, its editor opened).
    // It never touches center/zoom, so the click lands where the user is looking. Pressed again
    // while armed, it cancels (like Escape).
    function onAddPin(): void {
        if (armed()) {
            disarm()
            return
        }
        if (createBlocked()) return
        userMoved = true
        setArmed({ kind: 'new' })
    }

    // Right-click on the map background: a menu anchored at that point — `new pin here`, and
    // `place <title> here` for each row that has no location yet. Pins claim their own
    // right-click (onPinContextMenu stops it), so this is only ever the empty map.
    function onMapContextMenu(e: MouseEvent): void {
        if (!writable() || !mapEl) return
        e.preventDefault()
        const rect = mapEl.getBoundingClientRect()
        const { lat, lng } = screenToLatLng(
            e.clientX - rect.left,
            e.clientY - rect.top,
            size(),
            centerWorld(),
            zoom(),
        )
        disarm()
        setMapMenu({ x: e.clientX, y: e.clientY, lat, lng })
    }

    // Locate: recenter (and fit) on the markers we have.
    function locate(): void {
        const iv = initialView()
        setCenter(iv.center)
        setZoom(iv.zoom)
    }

    // ── Pin pointer handlers (drag to move; a plain click opens the pin — see openPin) ──────
    function onPinPointerDown(e: PointerEvent, m: Marker): void {
        if (!writable() || e.button !== 0 || noteFor(m.row) !== undefined) return
        e.stopPropagation()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        setDragState({
            row: m.row,
            dx: 0,
            dy: 0,
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
        })
    }

    function onPinPointerMove(e: PointerEvent, m: Marker): void {
        const ds = dragState()
        if (!ds || ds.row !== m.row) return
        const dx = e.clientX - ds.startX
        const dy = e.clientY - ds.startY
        setDragState({
            ...ds,
            dx,
            dy,
            moved: ds.moved || pastDragThreshold(dx, dy),
        })
    }

    function onPinPointerUp(e: PointerEvent, m: Marker): void {
        const ds = dragState()
        if (!ds || ds.row !== m.row) return
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
        setDragState(null)
        if (!ds.moved) return // a plain click — let the native click event open the pin
        suppressNextPinClick = true
        const orig = geoToScreen(m.lat, m.lng)
        const { lat, lng } = screenToLatLng(
            orig.x + ds.dx,
            orig.y + ds.dy,
            size(),
            centerWorld(),
            zoom(),
        )
        void writeCoords(m.row, lat, lng)
    }

    function onPinClick(e: MouseEvent, m: Marker): void {
        e.stopPropagation()
        if (suppressNextPinClick) {
            suppressNextPinClick = false
            return
        }
        openPin(m.row)
    }

    // A pin opens its row editor. A pin that cannot be edited (an embed with no base file, or a
    // task LINE whose fields are not frontmatter) renders as a NoteLink instead — see `noteFor`.
    const noteFor = (row: Row): string | undefined =>
        !props.basePath || typeof row.note.line === 'number'
            ? row.file.path
            : undefined
    function openPin(row: Row): void {
        if (noteFor(row) === undefined) editRow(row)
    }

    function onPinContextMenu(e: MouseEvent, m: Marker): void {
        // Nothing to offer (a read-only map's link pin): leave the native menu alone.
        if (pinMenuItems(m.row).length === 0) return
        e.preventDefault()
        e.stopPropagation()
        setPinMenu({ x: e.clientX, y: e.clientY, row: m.row })
    }

    function onPinKeyDown(e: KeyboardEvent, m: Marker): void {
        if (!isMenuKey(e) || pinMenuItems(m.row).length === 0) return
        e.preventDefault()
        e.stopPropagation()
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        setPinMenu({ x: r.left, y: r.bottom, row: m.row })
    }

    const pinMenuItems = (row: Row): MenuItem[] => {
        const items: MenuItem[] = []
        // A pin that opens a note IS the link, so only an editable one offers `edit`.
        if (noteFor(row) === undefined)
            items.push({
                label: 'edit',
                icon: 'Pencil',
                onSelect: () => openPin(row),
            })
        if (writable()) {
            items.push(
                { label: 'move pin', icon: 'Pin', onSelect: () => arm(row) },
                {
                    label: 'remove pin',
                    icon: 'Trash2',
                    danger: true,
                    separatorBefore: items.length > 0,
                    onSelect: () => void removeCoords(row),
                },
            )
        }
        return items
    }

    const mapMenuItems = (lat: number, lng: number): MenuItem[] => [
        {
            label: 'new pin here',
            icon: 'Plus',
            disabled: !!createBlocked(),
            onSelect: () => void createPin(lat, lng),
        },
        ...unplacedRows().map((row, i) => ({
            label: `place ${titleOf(row, titleCol()) || row.file.path || '(untitled)'} here`,
            icon: 'Pin',
            separatorBefore: i === 0,
            onSelect: () => void writeCoords(row, lat, lng),
        })),
    ]

    return (
        <div class={styles.mapWrap}>
            <div
                class={styles.map}
                classList={{
                    [styles.mapArmed]: !!armed(),
                    [styles.mapPanning]: panning(),
                }}
                ref={mapEl}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                onWheel={onWheel}
                onClick={onMapClick}
                onContextMenu={onMapContextMenu}
            >
                <MapBasemap
                    size={size()}
                    centerWorld={centerWorld()}
                    zoom={zoom()}
                />

                <div class={styles.mapMarkers}>
                    <For each={markerKeys()}>
                        {key => {
                            // Read through the key on every access: the Marker behind a key is
                            // replaced by each refetch (a renamed title, a moved pin).
                            const cur = () => markerByKey().get(key)
                            const m = () => cur()!
                            const dragging = () => {
                                const ds = dragState()
                                return !!ds && ds.moved && ds.row === cur()?.row
                            }
                            const pos = () => {
                                const mk = cur()
                                if (!mk) return { x: -9999, y: -9999 }
                                const p = project(mk.lat, mk.lng, zoom())
                                const s = toScreen(p.x, p.y)
                                const ds = dragState()
                                if (ds && ds.row === mk.row)
                                    return { x: s.x + ds.dx, y: s.y + ds.dy }
                                return s
                            }
                            const title = () => {
                                const mk = cur()
                                return mk ? titleOf(mk.row, titleCol()) : ''
                            }
                            return (
                                <MapPin
                                    title={title()}
                                    x={pos().x}
                                    y={pos().y}
                                    dragging={dragging()}
                                    passThrough={!!armed()}
                                    notePath={cur() ? noteFor(cur()!.row) : undefined}
                                    hint={
                                        cur() && noteFor(cur()!.row) !== undefined
                                            ? 'Open note'
                                            : writable()
                                            ? 'Click to edit — drag to move, right-click for more'
                                            : 'Click to edit'
                                    }
                                    onClick={e => onPinClick(e, m())}
                                    // A pin claims its mousedown too, not just its pointerdown:
                                    // the map pans on MOUSEdown, and stopping only the pointer
                                    // event let a pin drag also pan the map under it, so the
                                    // dropped pin landed twice as far as it was dragged.
                                    onMouseDown={e => {
                                        if (writable() && noteFor(m().row) === undefined)
                                            e.stopPropagation()
                                    }}
                                    onPointerDown={e => onPinPointerDown(e, m())}
                                    onPointerMove={e => onPinPointerMove(e, m())}
                                    onPointerUp={e => onPinPointerUp(e, m())}
                                    onContextMenu={e => onPinContextMenu(e, m())}
                                    onKeyDown={e => onPinKeyDown(e, m())}
                                />
                            )
                        }}
                    </For>
                </div>

                <MapControls
                    armed={!!armed()}
                    blockedReason={createBlocked()}
                    onZoomIn={() => zoomBy(1)}
                    onZoomOut={() => zoomBy(-1)}
                    onReset={resetView}
                    onFit={locate}
                    onAddPin={onAddPin}
                />

                {/* Armed-placement hint. Follows the cursor once it moves over the map;
                    shown at a fixed corner before that so arming is visible immediately,
                    without waiting on a mousemove event. */}
                <Show when={armed()}>
                    {a => (
                        <div
                            class={styles.mapPlacingLabel}
                            style={
                                hoverPos()
                                    ? {
                                          left: `${hoverPos()!.x + 14}px`,
                                          top: `${hoverPos()!.y + 14}px`,
                                      }
                                    : { left: 'var(--sp-6)', top: 'var(--map-hint-top)' }
                            }
                        >
                            <Text as="span" inherit>
                                {(() => {
                                    const cur = a()
                                    return cur.kind === 'new'
                                        ? 'click to add a pin'
                                        : `placing ${titleOf(cur.row, titleCol()) || cur.row.file.path}`
                                })()}{' '}
                                — esc to cancel
                            </Text>
                        </div>
                    )}
                </Show>

                {/* Scale bar. */}
                <div class={styles.mapScale}>
                    <Text
                        as="span"
                        inherit
                        class={styles.mapScaleBar}
                        style={{ width: `${scaleBar().widthPx}px` }}
                    />
                    <Text
                        as="span"
                        size="inherit"
                        tone="muted"
                        weight="inherit"
                        class={styles.mapScaleLabel}
                    >
                        {scaleBar().label}
                    </Text>
                </div>

                <Show when={markers().length === 0}>
                    <div class={styles.mapEmpty}>
                        <EmptyState title="no rows have a location">
                            add <InlineCode>{latKey()}</InlineCode> /{' '}
                            <InlineCode>{lngKey()}</InlineCode> properties to a
                            note to pin it
                        </EmptyState>
                    </div>
                </Show>
            </div>

            <Show when={pinMenu()}>
                {m => (
                    <Portal>
                        <ContextMenu
                            x={m().x}
                            y={m().y}
                            items={pinMenuItems(m().row)}
                            onClose={() => setPinMenu(null)}
                        />
                    </Portal>
                )}
            </Show>

            <Show when={mapMenu()}>
                {m => (
                    <Portal>
                        <ContextMenu
                            x={m().x}
                            y={m().y}
                            items={mapMenuItems(m().lat, m().lng)}
                            onClose={() => setMapMenu(null)}
                        />
                    </Portal>
                )}
            </Show>
        </div>
    )
}
