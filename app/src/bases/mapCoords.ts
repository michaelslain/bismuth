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
 * (open the note) rather than a DRAG (move the pin) — a few px of tremor shouldn't relocate
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
