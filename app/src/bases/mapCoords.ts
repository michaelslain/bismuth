// Pure geo-projection + coordinate-write math for MapView — no framework imports, so it is
// unit-testable headlessly and MapView.tsx only wires the result. Extracted from MapView so
// the placement/move/remove actions (Task F) can round-trip a screen click through the SAME
// projection the renderer already uses, rather than a second hand-rolled one drifting from it.

// Web Mercator: convert (lat, lng) at zoom level z to world-pixel coords.
// Standard slippy-map projection — one tile = 256px, 2^z tiles per axis.
export function project(
    lat: number,
    lng: number,
    z: number,
): { x: number; y: number } {
    const n = 2 ** z
    const x = ((lng + 180) / 360) * n * 256
    const sin = Math.sin((lat * Math.PI) / 180)
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n * 256
    return { x, y }
}

// Inverse: world-pixel (x, y) at zoom z back to (lat, lng).
export function unproject(
    x: number,
    y: number,
    z: number,
): { lat: number; lng: number } {
    const n = 2 ** z
    const lng = (x / (n * 256)) * 360 - 180
    const t = Math.PI - (2 * Math.PI * y) / (n * 256)
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)))
    return { lat, lng }
}

export function toNum(v: unknown): number {
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
        const n = Number(v)
        return Number.isNaN(n) ? NaN : n
    }
    return NaN
}

/** Round a coordinate to 6 decimal places (~11cm precision) — the resolution a written-back
 *  lat/lng is stored at, so a pin placed or dragged doesn't leave a note carrying 17
 *  significant digits of float noise. */
export function round6(n: number): number {
    return Math.round(n * 1e6) / 1e6
}

/**
 * Given a click/drop point in SCREEN pixels (relative to the map element) plus the current
 * view (center world-pixel coords + zoom), resolve the geographic coordinate it lands on —
 * the inverse of the renderer's own `toScreen`/`geoToScreen`. Rounded to 6 decimals so a
 * placed or dragged pin writes a clean value.
 *
 * CLAMPED to the range MapView draws a marker for (lat ±85, lng ±180). The basemap paints sea
 * past the world's edges, so a click there is an ordinary-looking click — and unclamped it wrote
 * e.g. `lng: -182.98`, which the view then files under `unplaced` instead of drawing: the pin
 * silently never appeared. On a wide pane at low zoom most of the surface is past an edge, which
 * is why placing "sometimes worked". A click off the world now lands on its nearest edge.
 */
export function screenToLatLng(
    screenX: number,
    screenY: number,
    size: { w: number; h: number },
    centerWorld: { x: number; y: number },
    zoom: number,
): { lat: number; lng: number } {
    const wx = centerWorld.x + (screenX - size.w / 2)
    const wy = centerWorld.y + (screenY - size.h / 2)
    const { lat, lng } = unproject(wx, wy, zoom)
    const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v))
    return { lat: round6(clamp(lat, 85)), lng: round6(clamp(lng, 180)) }
}

/**
 * Total on-screen movement below which a pointer-down/up pair on a pin counts as a CLICK
 * (open the pin) rather than a DRAG (move the pin) — a few px of tremor shouldn't relocate
 * a marker the user only meant to open.
 */
export const DRAG_THRESHOLD_PX = 4

export function pastDragThreshold(dx: number, dy: number): boolean {
    return Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX
}

/**
 * A map view's `lat`/`lng` config values (e.g. bare `"lat"`, `"note.latitude"`,
 * `"formula.computed_lat"`) name a PROPERTY ID, only some of which are writable frontmatter
 * keys. `file.*` is derived from the filesystem, `formula.*` is computed from other columns,
 * and `this.*` has no note behind it at all — none of those can be written back to. Only a
 * bare name or an explicit `note.*` id resolves to a real frontmatter key, so placement/move
 * is disabled (read-only map) whenever either axis is formula/file/this-derived.
 */
export function writableFieldKey(id: string): string | null {
    if (id.startsWith('note.')) return id.slice(5)
    if (
        id.startsWith('file.') ||
        id.startsWith('formula.') ||
        id.startsWith('this.')
    )
        return null
    return id
}

/**
 * Whether the map should snap back to its computed framing. Only two things earn a re-frame:
 * the VIEW changed (a different view, or its configured center/zoom), or the first markers
 * just arrived on a map the user has not touched yet. Once the user has panned, zoomed, or
 * armed a placement, the framing is theirs — placing the FIRST pin on an all-unplaced map
 * used to count as "markers arrived" and snapped to zoom 10 on the new pin, which read as the
 * add-pin flow resetting the zoom.
 */
export function shouldReframe(s: {
    key: string
    framedKey: string | null
    hasMarkers: boolean
    framedWithMarkers: boolean
    userMoved: boolean
}): boolean {
    if (s.key !== s.framedKey) return true
    if (s.userMoved) return false
    return s.hasMarkers && !s.framedWithMarkers
}

// ── Screen mapping ───────────────────────────────────────────────────────────────────────
// Everything MapView + its basemap need to turn a geographic point into a screen pixel and
// back, kept here so the pieces (MapBasemap, MapPin, MapView) share ONE projection.

export type Size = { w: number; h: number }
export type XY = { x: number; y: number }

/** World-pixel coords -> screen-pixel coords inside the map element. */
export function worldToScreen(
    wx: number,
    wy: number,
    size: Size,
    centerWorld: XY,
): XY {
    return {
        x: size.w / 2 + (wx - centerWorld.x),
        y: size.h / 2 + (wy - centerWorld.y),
    }
}

/** A geographic point -> screen pixels at the given view. */
export function geoToScreen(
    lat: number,
    lng: number,
    size: Size,
    centerWorld: XY,
    zoom: number,
): XY {
    const p = project(lat, lng, zoom)
    return worldToScreen(p.x, p.y, size, centerWorld)
}

/** Whether a coordinate pair is one MapView draws a marker for (the range `screenToLatLng`
 *  clamps to): finite, lat within ±85, lng within ±180. */
export function isPlaceable(lat: number, lng: number): boolean {
    return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -85 &&
        lat <= 85 &&
        lng >= -180 &&
        lng <= 180
    )
}

/** Initial framing for a set of markers: none -> the whole-world view at `fallbackZoom`, one ->
 *  centred on it at zoom 10, several -> centred on their bounding box at the deepest zoom whose
 *  box fits 80% of an 800x600 viewport. */
export function fitView(
    points: { lat: number; lng: number }[],
    fallbackZoom: number,
): { center: { lat: number; lng: number }; zoom: number } {
    if (points.length === 0)
        return { center: { lat: 20, lng: 0 }, zoom: fallbackZoom }
    if (points.length === 1)
        return { center: { lat: points[0].lat, lng: points[0].lng }, zoom: 10 }
    let minLat = Infinity,
        maxLat = -Infinity,
        minLng = Infinity,
        maxLng = -Infinity
    for (const m of points) {
        if (m.lat < minLat) minLat = m.lat
        if (m.lat > maxLat) maxLat = m.lat
        if (m.lng < minLng) minLng = m.lng
        if (m.lng > maxLng) maxLng = m.lng
    }
    const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 }
    for (let z = 14; z >= 1; z--) {
        const a = project(maxLat, minLng, z)
        const b = project(minLat, maxLng, z)
        if (Math.abs(b.x - a.x) < 800 * 0.8 && Math.abs(b.y - a.y) < 600 * 0.8)
            return { center, zoom: z }
    }
    return { center, zoom: fallbackZoom }
}

/** Scale bar: the ground distance a ~70px segment covers at this zoom + latitude, rounded down
 *  to a 1/2/5 x 10^n figure, with the pixel width that figure actually spans. */
export function scaleBarFor(
    zoom: number,
    lat: number,
): { widthPx: number; label: string } {
    // Web-Mercator ground resolution (m/px) at this lat & zoom.
    const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
    const rawKm = (mPerPx * 70) / 1000
    const pow = 10 ** Math.floor(Math.log10(rawKm))
    const mult = rawKm / pow
    const nice = mult >= 5 ? 5 : mult >= 2 ? 2 : 1
    const km = nice * pow
    return {
        widthPx: (km * 1000) / mPerPx,
        label: km >= 1 ? `${km} km` : `${Math.round(km * 1000)} m`,
    }
}

/** Polygon rings ([lng, lat] vertices) as screen-space SVG path strings. */
export function landPathsFor(
    rings: [number, number][][],
    size: Size,
    centerWorld: XY,
    zoom: number,
): string[] {
    return rings.map(ring => {
        let d = ''
        for (let i = 0; i < ring.length; i++) {
            const s = geoToScreen(ring[i][1], ring[i][0], size, centerWorld, zoom)
            d += `${i === 0 ? 'M' : 'L'}${s.x.toFixed(1)} ${s.y.toFixed(1)} `
        }
        return d + 'Z'
    })
}

export type GraticuleLine = {
    x1: number
    y1: number
    x2: number
    y2: number
    bold: boolean
}

/** Meridians + parallels as screen lines; the equator and prime meridian are flagged bold. */
export function graticuleFor(
    size: Size,
    centerWorld: XY,
    zoom: number,
): GraticuleLine[] {
    const lines: GraticuleLine[] = []
    for (let lng = -180; lng <= 180; lng += GRAT_LNG) {
        const a = geoToScreen(85, lng, size, centerWorld, zoom)
        const b = geoToScreen(-85, lng, size, centerWorld, zoom)
        lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, bold: lng === 0 })
    }
    for (let lat = -80; lat <= 80; lat += GRAT_LAT) {
        const a = geoToScreen(lat, -180, size, centerWorld, zoom)
        const b = geoToScreen(lat, 180, size, centerWorld, zoom)
        lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, bold: lat === 0 })
    }
    return lines
}

/** Zoom by `delta` keeping the screen point `anchor` (default: the map centre) over the same
 *  geographic spot. Null when the result would leave the 1..18 range (nothing to do). */
export function zoomAround(
    zoom: number,
    center: { lat: number; lng: number },
    size: Size,
    delta: number,
    anchor?: XY,
): { zoom: number; center: { lat: number; lng: number } } | null {
    const z1 = Math.max(1, Math.min(18, zoom + delta))
    if (z1 === zoom) return null
    const ax = anchor ? anchor.x : size.w / 2
    const ay = anchor ? anchor.y : size.h / 2
    const c0 = project(center.lat, center.lng, zoom)
    const scale = 2 ** (z1 - zoom)
    const wx1 = (c0.x + (ax - size.w / 2)) * scale
    const wy1 = (c0.y + (ay - size.h / 2)) * scale
    return {
        zoom: z1,
        center: unproject(wx1 - (ax - size.w / 2), wy1 - (ay - size.h / 2), z1),
    }
}

// ── Coordinate writes + folder resolution ───────────────────────────────────────────────

/** A copy of a row's note with its lat/lng fields set — the payload of a place/move write. */
export function withCoords(
    note: Record<string, unknown>,
    latField: string,
    lngField: string,
    lat: number,
    lng: number,
): Record<string, unknown> {
    return { ...note, [latField]: lat, [lngField]: lng }
}

/** A copy of a row's note with its lat/lng fields removed — the payload of a remove-pin write. */
export function withoutCoords(
    note: Record<string, unknown>,
    latField: string,
    lngField: string,
): Record<string, unknown> {
    const out = { ...note }
    delete out[latField]
    delete out[lngField]
    return out
}

/** The folder a new NOTE row lands in: beside the first existing note row (one with no `index`),
 *  so a folder-scoped source still selects it. '' = the vault root; undefined = no note row to
 *  copy, so the base's own folder applies. */
export function siblingFolder(
    rows: { path: string; index?: number }[],
): string | undefined {
    for (const r of rows)
        if (r.index === undefined && r.path)
            return r.path.includes('/')
                ? r.path.slice(0, r.path.lastIndexOf('/'))
                : ''
    return undefined
}

// ── Basemap data ────────────────────────────────────────────────────────────────────────
// Coarse continent outlines ([lng, lat]) — drawn in the same world-pixel space as the markers so they pan/zoom together.
export const LANDMASSES: [number, number][][] = [
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
export const GRAT_LNG = 30
export const GRAT_LAT = 20
