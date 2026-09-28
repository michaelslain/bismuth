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
import { plainLabel } from './renderValue'
import { canWriteStoredRow, storedNote } from './taskWrite'
import { chipKeyAction } from '../calendar/taskChipKeys'
import { settings } from '../settings'
import { api } from '../api'
import { pushToast } from '../toastStore'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'
import IconButton from '../ui/IconButton'
import InlineCode from '../ui/InlineCode'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { createRow } from './AddRowAction'
import { openRowEditor } from './openRowEditor'
import {
    project,
    unproject,
    toNum,
    screenToLatLng,
    pastDragThreshold,
    writableFieldKey,
    shouldReframe,
} from './mapCoords'
import styles from './MapView.module.css'
import { isDismissKey } from '../ui/widgetKeys'

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

// Offline vector basemap. Continents are coarse lng/lat polygon outlines —
// enough to read as a world map without any network tiles. Each ring is a
// list of [lng, lat] vertices; we project them at the current zoom and draw
// them in the same world-pixel space as the markers so they pan/zoom together.
const LANDMASSES: [number, number][][] = [
    // North America
    [
        [-168, 65],
        [-140, 70],
        [-95, 72],
        [-60, 60],
        [-55, 47],
        [-70, 42],
        [-81, 25],
        [-97, 18],
        [-105, 23],
        [-117, 32],
        [-125, 40],
        [-130, 55],
        [-150, 60],
        [-168, 65],
    ],
    // South America
    [
        [-80, 9],
        [-60, 11],
        [-50, 0],
        [-35, -8],
        [-40, -22],
        [-58, -34],
        [-70, -52],
        [-75, -45],
        [-72, -30],
        [-81, -15],
        [-80, -5],
        [-80, 9],
    ],
    // Africa
    [
        [-17, 21],
        [0, 35],
        [11, 37],
        [32, 31],
        [43, 12],
        [51, 12],
        [40, -5],
        [40, -18],
        [33, -28],
        [20, -35],
        [16, -28],
        [9, -2],
        [-8, 5],
        [-17, 12],
        [-17, 21],
    ],
    // Europe
    [
        [-10, 36],
        [-9, 44],
        [-2, 49],
        [2, 51],
        [8, 54],
        [12, 56],
        [22, 60],
        [30, 62],
        [40, 55],
        [30, 45],
        [20, 40],
        [12, 38],
        [-10, 36],
    ],
    // Asia
    [
        [30, 62],
        [55, 70],
        [90, 73],
        [140, 72],
        [160, 68],
        [180, 65],
        [170, 55],
        [140, 52],
        [135, 40],
        [122, 30],
        [108, 18],
        [97, 9],
        [80, 8],
        [72, 20],
        [60, 25],
        [48, 30],
        [40, 40],
        [42, 50],
        [35, 58],
        [30, 62],
    ],
    // Australia
    [
        [114, -22],
        [130, -12],
        [142, -11],
        [153, -25],
        [150, -38],
        [137, -36],
        [128, -32],
        [115, -34],
        [114, -22],
    ],
]

// Coarse graticule spacing in degrees.
const GRAT_LNG = 30
const GRAT_LAT = 20

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
                    if (
                        Number.isNaN(lat) ||
                        Number.isNaN(lng) ||
                        lat < -85 ||
                        lat > 85 ||
                        lng < -180 ||
                        lng > 180
                    ) {
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
        const ms = markers()
        if (ms.length === 0)
            return {
                center: { lat: 20, lng: 0 },
                zoom: settings.graph.mapDefaultZoom,
            }
        if (ms.length === 1)
            return { center: { lat: ms[0].lat, lng: ms[0].lng }, zoom: 10 }
        let minLat = Infinity,
            maxLat = -Infinity,
            minLng = Infinity,
            maxLng = -Infinity
        for (const m of ms) {
            if (m.lat < minLat) minLat = m.lat
            if (m.lat > maxLat) maxLat = m.lat
            if (m.lng < minLng) minLng = m.lng
            if (m.lng > maxLng) maxLng = m.lng
        }
        // Rough zoom-fit: pick a zoom whose viewport covers the bbox at 800×600.
        // Iterate down from max zoom to find the first that fits with 80% padding.
        const cLat = (minLat + maxLat) / 2
        const cLng = (minLng + maxLng) / 2
        for (let z = 14; z >= 1; z--) {
            const a = project(maxLat, minLng, z)
            const b = project(minLat, maxLng, z)
            if (
                Math.abs(b.x - a.x) < 800 * 0.8 &&
                Math.abs(b.y - a.y) < 600 * 0.8
            ) {
                return { center: { lat: cLat, lng: cLng }, zoom: z }
            }
        }
        return {
            center: { lat: cLat, lng: cLng },
            zoom: settings.graph.mapDefaultZoom,
        }
    })

    const [center, setCenter] = createSignal(initialView().center)
    const [zoom, setZoom] = createSignal(initialView().zoom)
    // Re-frame when the VIEW changes (switching views, or its configured center/zoom), and once
    // when the first markers arrive on a map the user has not touched — never merely because a
    // marker moved (see `shouldReframe`). Placing or dragging a pin writes its note, the rows
    // refetch, and re-fitting on that jerked the whole map out from under the pin the user had
    // just put down. `userMoved` flips on any pan, zoom or arming, so placing the FIRST pin on
    // an all-unplaced map keeps the zoom the user chose instead of snapping to that pin.
    const frameKey = () => {
        const v = props.result.view
        return `${v.name}|${v.type}|${v.center?.lat},${v.center?.lng}|${v.zoom}`
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
    // The row currently "armed" for placement — picked from Add pin's menu, or from a
    // pin's own "move…" menu item. The next click on the map (not on a pin) writes that
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
    // `[📌] Add pin`'s own menu — only when ≥1 row lacks a location: `new place` first, then
    // `place <title>` per unplaced row. With no unplaced rows, Add pin arms straight away and
    // this menu never opens.
    const [addPinMenu, setAddPinMenu] = createSignal<{
        x: number
        y: number
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
    function toScreen(wx: number, wy: number) {
        const { w, h } = size()
        const c = centerWorld()
        return { x: w / 2 + (wx - c.x), y: h / 2 + (wy - c.y) }
    }

    // Project a geographic point to screen pixels at the current view.
    function geoToScreen(lat: number, lng: number) {
        const p = project(lat, lng, zoom())
        return toScreen(p.x, p.y)
    }

    // Landmass polygons as screen-space SVG path strings.
    const landPaths = createMemo(() => {
        // Touch zoom()/centerWorld() (via geoToScreen) so the memo recomputes on pan/zoom.
        return LANDMASSES.map(ring => {
            let d = ''
            for (let i = 0; i < ring.length; i++) {
                const [lng, lat] = ring[i]
                const s = geoToScreen(lat, lng)
                d +=
                    (i === 0 ? 'M' : 'L') +
                    s.x.toFixed(1) +
                    ' ' +
                    s.y.toFixed(1) +
                    ' '
            }
            return d + 'Z'
        })
    })

    // Graticule: meridians (vertical) + parallels (horizontal) as screen lines.
    // Equator + prime meridian are flagged bold.
    const graticule = createMemo(() => {
        const lines: {
            x1: number
            y1: number
            x2: number
            y2: number
            bold: boolean
        }[] = []
        for (let lng = -180; lng <= 180; lng += GRAT_LNG) {
            const a = geoToScreen(85, lng)
            const b = geoToScreen(-85, lng)
            lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, bold: lng === 0 })
        }
        for (let lat = -80; lat <= 80; lat += GRAT_LAT) {
            const a = geoToScreen(lat, -180)
            const b = geoToScreen(lat, 180)
            lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, bold: lat === 0 })
        }
        return lines
    })

    // Scale bar: how many km does a fixed on-screen segment represent, rounded
    // to a "nice" number. Uses the meters-per-pixel at the map center.
    const scaleBar = createMemo(() => {
        const z = zoom()
        const lat = center().lat
        // Web-Mercator ground resolution (m/px) at this lat & zoom.
        const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
        const targetPx = 70
        const rawKm = (mPerPx * targetPx) / 1000
        // Round down to 1/2/5 × 10^n.
        const pow = 10 ** Math.floor(Math.log10(rawKm))
        const mult = rawKm / pow
        const nice = mult >= 5 ? 5 : mult >= 2 ? 2 : 1
        const km = nice * pow
        const widthPx = (km * 1000) / mPerPx
        const label = km >= 1 ? `${km} km` : `${Math.round(km * 1000)} m`
        return { widthPx, label }
    })

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
                const note = {
                    ...storedNote(row),
                    [latField]: lat,
                    [lngField]: lng,
                }
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
                const note = { ...storedNote(row) }
                delete note[latField]
                delete note[lngField]
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
        return null
    }

    // The folder a new NOTE row lands in: beside an existing note row, so a folder-scoped source
    // still selects it (KanbanView's `boardFolder()` does the same). Undefined = the base's own.
    const siblingFolder = (): string | undefined => {
        for (const g of props.result.groups)
            for (const r of g.rows)
                if (r.index === undefined && r.file.path)
                    return r.file.path.includes('/')
                        ? r.file.path.slice(0, r.file.path.lastIndexOf('/'))
                        : ''
        return undefined
    }

    /** The row a create just made, once the refetch has it on the map: a note row by its path,
     *  a stored row as the one marker at exactly these coordinates that was not there before. */
    async function findCreated(
        created: Row,
        lat: number,
        lng: number,
        before: Set<string>,
    ): Promise<Row | undefined> {
        for (let i = 0; i < 20; i++) {
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
            const row = await findCreated(created, lat, lng, before)
            if (!row && props.ownsRows) {
                // A stored row has no write handle until it is seen with its index.
                pushToast(
                    `Pin added to ${basePath} — it does not match this view's filters, so it is not on this map`,
                )
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
    function editRow(row: Row, focusTarget?: string) {
        openRowEditor({
            row,
            config: props.config,
            view: props.result.view,
            onChanged: () => void props.onChange?.(),
            columns: props.result.columns,
            focusTarget,
        })
    }

    function disarm() {
        setArmed(null)
        setHoverPos(null)
    }

    // Arm a row for placement — from `Add pin`'s menu, or a pin's own "move pin" item.
    function arm(row: Row) {
        userMoved = true
        setArmed({ kind: 'row', row })
        setPinMenu(null)
        setAddPinMenu(null)
    }

    // Arm creating a NEW row — `Add pin` itself when there is nothing unplaced, or the `new
    // place` item in its menu when there is.
    function armNew() {
        userMoved = true
        setArmed({ kind: 'new' })
        setAddPinMenu(null)
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
        const z0 = zoom()
        const z1 = Math.max(1, Math.min(18, z0 + delta))
        if (z1 === z0) return
        userMoved = true
        const { w, h } = size()
        const ax = anchor ? anchor.x : w / 2
        const ay = anchor ? anchor.y : h / 2

        const c0 = centerWorld()
        const wx0 = c0.x + (ax - w / 2)
        const wy0 = c0.y + (ay - h / 2)
        const scale = 2 ** (z1 - z0)
        const wx1 = wx0 * scale
        const wy1 = wy0 * scale

        setZoom(z1)
        setCenter(unproject(wx1 - (ax - w / 2), wy1 - (ay - h / 2), z1))
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

    // Add pin never touches center/zoom, so the next click lands where the user is looking.
    // With rows lacking a location it opens a small menu (`new place`, then `place <title>` per
    // unplaced row); with none it arms a NEW row straight away. Pressed again while armed, it
    // cancels (like Escape).
    function onAddPin(e: MouseEvent): void {
        if (armed()) {
            disarm()
            return
        }
        if (unplacedRows().length > 0 && writable()) {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setAddPinMenu({ x: r.left, y: r.bottom })
            return
        }
        if (createBlocked()) return
        armNew()
    }

    // The floating chrome (zoom controls, Add pin) sits INSIDE the map element, so its
    // mousedown would start a pan and — worse — its click would bubble into `onMapClick` and,
    // while armed, drop the pin under the button that was pressed. The chrome claims both.
    function claimPointer(e: MouseEvent): void {
        e.stopPropagation()
    }

    // Locate: recenter (and fit) on the markers we have.
    function locate(): void {
        const iv = initialView()
        setCenter(iv.center)
        setZoom(iv.zoom)
    }

    // ── Pin pointer handlers (drag to move; a plain click still opens the note) ─────────
    function onPinPointerDown(e: PointerEvent, m: Marker): void {
        if (!writable() || e.button !== 0) return
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
        if (!ds.moved) return // a plain click — let the native click event open the note
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
        editRow(m.row)
    }

    function onPinContextMenu(e: MouseEvent, m: Marker): void {
        e.preventDefault()
        e.stopPropagation()
        setPinMenu({ x: e.clientX, y: e.clientY, row: m.row })
    }

    function onPinKeyDown(e: KeyboardEvent, m: Marker): void {
        const action = chipKeyAction({
            key: e.key,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
        })
        if (action?.kind !== 'menu') return
        e.preventDefault()
        e.stopPropagation()
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        setPinMenu({ x: r.left, y: r.bottom, row: m.row })
    }

    const pinMenuItems = (row: Row): MenuItem[] => {
        const items: MenuItem[] = [
            { label: 'edit', icon: 'Pencil', onSelect: () => editRow(row) },
        ]
        if (writable()) {
            items.push(
                { label: 'move pin', icon: 'Pin', onSelect: () => arm(row) },
                {
                    label: 'remove pin',
                    icon: 'Trash2',
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => void removeCoords(row),
                },
            )
        }
        return items
    }

    const addPinMenuItems = (): MenuItem[] => [
        {
            label: 'new place',
            icon: 'Plus',
            disabled: !!createBlocked(),
            onSelect: armNew,
        },
        ...unplacedRows().map((row, i) => ({
            label: `place ${plainLabel(titleCol(), row) || row.file.path || '(untitled)'}`,
            icon: 'Pin',
            separatorBefore: i === 0,
            onSelect: () => arm(row),
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
            >
                {/* Offline vector basemap: sea bg + graticule + landmasses. */}
                <svg
                    class={styles.mapVector}
                    width={size().w}
                    height={size().h}
                >
                    <rect
                        class={styles.mapSea}
                        x="0"
                        y="0"
                        width={size().w}
                        height={size().h}
                    />
                    <g>
                        <For each={graticule()}>
                            {l => (
                                <line
                                    class={
                                        l.bold
                                            ? styles.mapGridBold
                                            : styles.mapGrid
                                    }
                                    x1={l.x1}
                                    y1={l.y1}
                                    x2={l.x2}
                                    y2={l.y2}
                                />
                            )}
                        </For>
                    </g>
                    <g>
                        <For each={landPaths()}>
                            {d => <path class={styles.mapLand} d={d} />}
                        </For>
                    </g>
                </svg>

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
                                return mk ? plainLabel(titleCol(), mk.row) : ''
                            }
                            return (
                                <PlainButton
                                    class={styles.mapPin}
                                    classList={{ [styles.mapPinDragging]: dragging() }}
                                    style={{
                                        left: `${pos().x}px`,
                                        top: `${pos().y}px`,
                                    }}
                                    title={
                                        writable()
                                            ? 'Click to edit — drag to move, right-click for more'
                                            : 'Click to edit'
                                    }
                                    onClick={e => onPinClick(e, m())}
                                    // A pin claims its mousedown too, not just its pointerdown:
                                    // the map pans on MOUSEdown, and stopping only the pointer
                                    // event let a pin drag also pan the map under it, so the
                                    // dropped pin landed twice as far as it was dragged.
                                    onMouseDown={e => {
                                        if (writable()) e.stopPropagation()
                                    }}
                                    onPointerDown={e => onPinPointerDown(e, m())}
                                    onPointerMove={e => onPinPointerMove(e, m())}
                                    onPointerUp={e => onPinPointerUp(e, m())}
                                    onContextMenu={e => onPinContextMenu(e, m())}
                                    onKeyDown={e => onPinKeyDown(e, m())}
                                >
                                    <Text
                                        as="span"
                                        size="inherit"
                                        tone="default"
                                        weight="inherit"
                                        class={styles.mapPinChip}
                                    >
                                        {title()}
                                    </Text>
                                    {/* Accent glyph marker — no drawn teardrop shape, per bases-map.card.html
                      ("@ a record"). */}
                                    <Text
                                        as="span"
                                        size="inherit"
                                        tone="inherit"
                                        weight="bold"
                                        class={styles.mapPinGlyph}
                                        aria-hidden="true"
                                    >
                                        @
                                    </Text>
                                </PlainButton>
                            )
                        }}
                    </For>
                </div>

                {/* Floating controls, top-right — bracket IconButtons. */}
                <div
                    class={styles.mapControls}
                    onMouseDown={claimPointer}
                    onClick={claimPointer}
                >
                    <div class={styles.mapZoomStack}>
                        <IconButton
                            icon="ZoomIn"
                            label="Zoom in"
                            onClick={() => zoomBy(1)}
                        />
                        <IconButton
                            icon="ZoomOut"
                            label="Zoom out"
                            onClick={() => zoomBy(-1)}
                        />
                    </div>
                    <IconButton
                        icon="RotateCcw"
                        label="Reset view"
                        onClick={resetView}
                    />
                    <IconButton
                        icon="Map"
                        label="Fit to pins"
                        onClick={locate}
                    />
                </div>

                {/* Placement, top-left: `Add pin`. The next map click creates a NEW row there, or
                    — picked from its menu when some rows have no location yet — places one of
                    those. Disabled only when there is nothing it could do, and then its title says
                    why. Kept at the LEFT so its menu, which opens rightward, stays on screen. */}
                <div
                    class={styles.mapUnplaced}
                    onMouseDown={claimPointer}
                    onClick={claimPointer}
                >
                    <IconButton
                        icon="Pin"
                        label={armed() ? 'Cancel placing pin' : 'Add pin'}
                        variant={armed() ? 'selected' : 'normal'}
                        aria-pressed={!!armed()}
                        disabled={
                            !armed() &&
                            !!createBlocked() &&
                            !(writable() && unplacedRows().length > 0)
                        }
                        title={
                            armed()
                                ? 'Cancel placing pin (esc)'
                                : writable() && unplacedRows().length > 0
                                  ? 'Add pin'
                                  : (createBlocked() ?? 'Add pin')
                        }
                        data-testid="map-add-pin"
                        onClick={onAddPin}
                    />
                </div>

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
                                    : { left: '16px', top: '52px' }
                            }
                        >
                            <Text as="span" inherit>
                                {(() => {
                                    const cur = a()
                                    return cur.kind === 'new'
                                        ? 'click to add a pin'
                                        : `placing ${plainLabel(titleCol(), cur.row) || cur.row.file.path}`
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
                        No notes have valid <InlineCode>{latKey()}</InlineCode>{' '}
                        / <InlineCode>{lngKey()}</InlineCode> properties.
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

            <Show when={addPinMenu()}>
                {m => (
                    <Portal>
                        <ContextMenu
                            x={m().x}
                            y={m().y}
                            items={addPinMenuItems()}
                            onClose={() => setAddPinMenu(null)}
                        />
                    </Portal>
                )}
            </Show>
        </div>
    )
}
