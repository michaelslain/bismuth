import {
    createSignal,
    createMemo,
    createEffect,
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
import TextButton from '../ui/TextButton'
import InlineCode from '../ui/InlineCode'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import {
    project,
    unproject,
    toNum,
    screenToLatLng,
    pastDragThreshold,
    writableFieldKey,
} from './mapCoords'
import styles from './MapView.module.css'
import { isDismissKey } from '../ui/widgetKeys'

interface Marker {
    row: Row
    lat: number
    lng: number
}

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
    onOpen?: (path: string) => void
    /** Called after a pin is placed, moved or removed writes successfully. Mutating endpoints
     *  already invalidate + push SSE, so a view refetches on its own without this — it's an
     *  extra hook for a caller (or a story/test) that wants to react synchronously. */
    onChange?: () => void
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
    // Re-frame when the result changes (e.g. switching views).
    createEffect(() => {
        const iv = initialView()
        setCenter(iv.center)
        setZoom(iv.zoom)
    })

    let mapEl: HTMLDivElement | undefined
    const [size, setSize] = createSignal({ w: 800, h: 600 })

    // ── Placement / move / remove state ─────────────────────────────────────────────────
    // The row currently "armed" for placement — picked from the unplaced menu, or from a
    // pin's own "move…" menu item. The next click on the map (not on a pin) writes that
    // row's coordinates and disarms. Escape disarms too.
    const [armed, setArmed] = createSignal<Row | null>(null)
    const [hoverPos, setHoverPos] = createSignal<{ x: number; y: number } | null>(
        null,
    )
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
    const [unplacedMenu, setUnplacedMenu] = createSignal<{
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
            if (isDismissKey(e) && armed()) {
                setArmed(null)
                setHoverPos(null)
            }
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

    // Arm a row for placement — from the unplaced menu, or a pin's own "move…" item.
    function arm(row: Row) {
        setArmed(row)
        setPinMenu(null)
        setUnplacedMenu(null)
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
        ;(e.currentTarget as HTMLElement).style.cursor = 'grabbing'
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
        setCenter(unproject(c.x - dx, c.y - dy, zoom()))
    }

    function onMouseUp(e: MouseEvent): void {
        dragging = false
        ;(e.currentTarget as HTMLElement).style.cursor = ''
    }

    // Click to place: fires only when a row is armed and the click landed on the map
    // background (a pin's own onClick stops propagation, so this never double-fires there).
    function onMapClick(e: MouseEvent): void {
        const row = armed()
        if (!row || !mapEl) return
        const rect = mapEl.getBoundingClientRect()
        const { lat, lng } = screenToLatLng(
            e.clientX - rect.left,
            e.clientY - rect.top,
            size(),
            centerWorld(),
            zoom(),
        )
        setArmed(null)
        setHoverPos(null)
        void writeCoords(row, lat, lng)
    }

    // Zoom keeping a screen point anchored. `anchor` is screen-px within the map;
    // defaults to the map center (used by the +/- buttons).
    function zoomBy(delta: number, anchor?: { x: number; y: number }): void {
        const z0 = zoom()
        const z1 = Math.max(1, Math.min(18, z0 + delta))
        if (z1 === z0) return
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
        props.onOpen?.(m.row.file.path)
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
            {
                label: 'open note',
                icon: 'ExternalLink',
                onSelect: () => props.onOpen?.(row.file.path),
            },
        ]
        if (writable()) {
            items.push(
                { label: 'move…', icon: 'Pin', onSelect: () => arm(row) },
                {
                    label: 'remove from map',
                    icon: 'Trash2',
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => void removeCoords(row),
                },
            )
        }
        return items
    }

    const unplacedMenuItems = (): MenuItem[] =>
        unplacedRows().map(row => ({
            label: plainLabel(titleCol(), row) || row.file.path || '(untitled)',
            onSelect: () => arm(row),
        }))

    return (
        <div class={styles.mapWrap}>
            <div
                class={styles.map}
                classList={{ [styles.mapArmed]: !!armed() }}
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
                    <For each={markers()}>
                        {m => {
                            const pos = () => {
                                const p = project(m.lat, m.lng, zoom())
                                const s = toScreen(p.x, p.y)
                                const ds = dragState()
                                if (ds && ds.row === m.row)
                                    return { x: s.x + ds.dx, y: s.y + ds.dy }
                                return s
                            }
                            const title = plainLabel(titleCol(), m.row)
                            return (
                                <PlainButton
                                    class={styles.mapPin}
                                    style={{
                                        left: `${pos().x}px`,
                                        top: `${pos().y}px`,
                                    }}
                                    title="Click to open — drag to move, right-click to move or remove"
                                    onClick={e => onPinClick(e, m)}
                                    onPointerDown={e => onPinPointerDown(e, m)}
                                    onPointerMove={e => onPinPointerMove(e, m)}
                                    onPointerUp={e => onPinPointerUp(e, m)}
                                    onContextMenu={e => onPinContextMenu(e, m)}
                                    onKeyDown={e => onPinKeyDown(e, m)}
                                >
                                    <Text
                                        as="span"
                                        size="inherit"
                                        tone="default"
                                        weight="inherit"
                                        class={styles.mapPinChip}
                                    >
                                        {title}
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
                <div class={styles.mapControls}>
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
                        icon="Pin"
                        label="Locate notes"
                        onClick={locate}
                    />
                </div>

                {/* Unplaced rows — no valid lat/lng yet. Picking one arms placement; the
                    next click on the map writes its coordinates. Hidden entirely on a
                    read-only (formula/file-derived) map, since there's nowhere to write. */}
                <Show when={writable() && unplacedRows().length > 0}>
                    <div class={styles.mapUnplaced}>
                        <TextButton
                            data-testid="map-unplaced-button"
                            onClick={e => {
                                const r = (
                                    e.currentTarget as HTMLElement
                                ).getBoundingClientRect()
                                setUnplacedMenu({ x: r.left, y: r.bottom })
                            }}
                        >
                            unplaced ({unplacedRows().length})
                        </TextButton>
                    </div>
                </Show>

                {/* Armed-placement hint. Follows the cursor once it moves over the map;
                    shown at a fixed corner before that so arming is visible immediately,
                    without waiting on a mousemove event. */}
                <Show when={armed()}>
                    {row => (
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
                                placing{' '}
                                {plainLabel(titleCol(), row()) ||
                                    row().file.path}{' '}
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

                {/* Offline-vector attribution badge. */}
                <div class={styles.mapAttribution}>
                    <Text as="span" inherit class={styles.mapOfflineBadge}>
                        offline vector
                    </Text>
                    <Show when={markers().length > 0}>
                        <Text
                            as="span"
                            size="inherit"
                            tone="faint"
                            weight="inherit"
                        >
                            {markers().length}{' '}
                            {markers().length === 1 ? 'place' : 'places'}
                        </Text>
                    </Show>
                </div>

                <Show when={markers().length === 0}>
                    <div class={styles.mapEmpty}>
                        No notes have valid <InlineCode>{latKey()}</InlineCode> /{' '}
                        <InlineCode>{lngKey()}</InlineCode> properties.
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

            <Show when={unplacedMenu()}>
                {m => (
                    <Portal>
                        <ContextMenu
                            x={m().x}
                            y={m().y}
                            items={unplacedMenuItems()}
                            onClose={() => setUnplacedMenu(null)}
                        />
                    </Portal>
                )}
            </Show>
        </div>
    )
}
