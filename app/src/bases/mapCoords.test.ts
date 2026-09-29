import { test, expect } from 'bun:test'
import {
    project,
    unproject,
    round6,
    screenToLatLng,
    pastDragThreshold,
    writableFieldKey,
    shouldReframe,
} from './mapCoords'

test('project/unproject round-trip within rounding tolerance', () => {
    const cases: [number, number, number][] = [
        [0, 0, 4],
        [40.7128, -74.006, 10],
        [-33.87, 151.21, 8],
        [64.15, -21.94, 6],
    ]
    for (const [lat, lng, z] of cases) {
        const p = project(lat, lng, z)
        const back = unproject(p.x, p.y, z)
        expect(back.lat).toBeCloseTo(lat, 6)
        expect(back.lng).toBeCloseTo(lng, 6)
    }
})

test('round6 rounds to 6 decimal places', () => {
    expect(round6(40.712812345)).toBe(40.712812)
    expect(round6(-74.0000005)).toBeCloseTo(-74, 5)
    expect(round6(0)).toBe(0)
})

test('screenToLatLng resolves a screen click through the same projection as the renderer', () => {
    // Center screen (w/2, h/2) must resolve back to exactly the view center.
    const zoom = 6
    const center = { lat: 40.7128, lng: -74.006 }
    const centerWorld = project(center.lat, center.lng, zoom)
    const size = { w: 800, h: 600 }
    const atCenter = screenToLatLng(400, 300, size, centerWorld, zoom)
    expect(atCenter.lat).toBeCloseTo(center.lat, 4)
    expect(atCenter.lng).toBeCloseTo(center.lng, 4)
})

test('screenToLatLng rounds its result to 6 decimals', () => {
    const zoom = 8
    const centerWorld = project(10, 10, zoom)
    const r = screenToLatLng(
        123.456,
        78.9,
        { w: 800, h: 600 },
        centerWorld,
        zoom,
    )
    expect(r.lat).toBe(round6(r.lat))
    expect(r.lng).toBe(round6(r.lng))
})

test('pastDragThreshold ignores tremor, catches a real drag', () => {
    expect(pastDragThreshold(1, 1)).toBe(false)
    expect(pastDragThreshold(2, 2)).toBe(false)
    expect(pastDragThreshold(3, 3)).toBe(true)
    expect(pastDragThreshold(-5, 0)).toBe(true)
})

test('writableFieldKey strips a note. prefix and passes a bare id through', () => {
    expect(writableFieldKey('lat')).toBe('lat')
    expect(writableFieldKey('note.latitude')).toBe('latitude')
})

test('writableFieldKey refuses file./formula./this. — nothing to write back to', () => {
    expect(writableFieldKey('file.name')).toBeNull()
    expect(writableFieldKey('formula.computed_lat')).toBeNull()
    expect(writableFieldKey('this.x')).toBeNull()
})

test('shouldReframe: a view change always re-frames', () => {
    const base = { framedKey: 'a', hasMarkers: true, framedWithMarkers: true }
    expect(shouldReframe({ ...base, key: 'b', userMoved: false })).toBe(true)
    expect(shouldReframe({ ...base, key: 'b', userMoved: true })).toBe(true)
})

test('shouldReframe: first markers re-frame only an untouched map', () => {
    const first = {
        key: 'a',
        framedKey: 'a',
        hasMarkers: true,
        framedWithMarkers: false,
    }
    expect(shouldReframe({ ...first, userMoved: false })).toBe(true)
    // the user zoomed/armed, then placed the first pin: keep their framing
    expect(shouldReframe({ ...first, userMoved: true })).toBe(false)
})

test('shouldReframe: a refetch of the same view never re-frames', () => {
    const same = { key: 'a', framedKey: 'a', framedWithMarkers: true }
    expect(shouldReframe({ ...same, hasMarkers: true, userMoved: false })).toBe(
        false,
    )
    expect(
        shouldReframe({ ...same, hasMarkers: false, userMoved: false }),
    ).toBe(false)
})

test('screenToLatLng clamps a click past the world edge onto the edge instead of off the map', () => {
    // Zoom 1: the whole world is 512px wide, so a 1400px pane shows sea well past both edges.
    const zoom = 1
    const size = { w: 1400, h: 600 }
    const centerWorld = project(20, 0, zoom)
    const west = screenToLatLng(10, 300, size, centerWorld, zoom)
    const east = screenToLatLng(1390, 300, size, centerWorld, zoom)
    expect(west.lng).toBe(-180)
    expect(east.lng).toBe(180)
    const top = screenToLatLng(700, -5000, size, centerWorld, zoom)
    const bottom = screenToLatLng(700, 5000, size, centerWorld, zoom)
    expect(top.lat).toBe(85)
    expect(bottom.lat).toBe(-85)
    // Inside the world nothing changes.
    const mid = screenToLatLng(700, 300, size, centerWorld, zoom)
    expect(mid.lng).toBeCloseTo(0, 4)
})

import {
    worldToScreen,
    geoToScreen,
    isPlaceable,
    fitView,
    scaleBarFor,
    landPathsFor,
    graticuleFor,
    zoomAround,
    withCoords,
    withoutCoords,
    siblingFolder,
    LANDMASSES,
} from './mapCoords'

const SZ = { w: 800, h: 600 }

test('worldToScreen puts the view centre at the middle of the map', () => {
    const c = project(10, 20, 5)
    expect(worldToScreen(c.x, c.y, SZ, c)).toEqual({ x: 400, y: 300 })
    expect(worldToScreen(c.x + 10, c.y - 5, SZ, c)).toEqual({ x: 410, y: 295 })
})

test('geoToScreen is screenToLatLng inverted', () => {
    const zoom = 6
    const cw = project(40, -74, zoom)
    const s = geoToScreen(41, -73, SZ, cw, zoom)
    const back = screenToLatLng(s.x, s.y, SZ, cw, zoom)
    expect(back.lat).toBeCloseTo(41, 4)
    expect(back.lng).toBeCloseTo(-73, 4)
})

test('isPlaceable accepts the drawable range and refuses NaN and out-of-range', () => {
    expect(isPlaceable(0, 0)).toBe(true)
    expect(isPlaceable(85, -180)).toBe(true)
    expect(isPlaceable(NaN, 0)).toBe(false)
    expect(isPlaceable(86, 0)).toBe(false)
    expect(isPlaceable(0, 181)).toBe(false)
})

test('fitView: no points -> world view at the fallback zoom, one point -> zoom 10', () => {
    expect(fitView([], 3)).toEqual({ center: { lat: 20, lng: 0 }, zoom: 3 })
    expect(fitView([{ lat: 5, lng: 6 }], 3)).toEqual({
        center: { lat: 5, lng: 6 },
        zoom: 10,
    })
})

test('fitView: several points are centred on their bounding box at a zoom that covers them', () => {
    const v = fitView(
        [
            { lat: 35, lng: 139 },
            { lat: -34, lng: -58 },
        ],
        3,
    )
    expect(v.center.lat).toBeCloseTo(0.5, 6)
    expect(v.center.lng).toBeCloseTo(40.5, 6)
    const a = project(35, -58, v.zoom)
    const b = project(-34, 139, v.zoom)
    expect(Math.abs(b.x - a.x)).toBeLessThan(640)
    expect(Math.abs(b.y - a.y)).toBeLessThan(480)
})

test('scaleBarFor rounds to 1/2/5 x 10^n and labels km or m', () => {
    const wide = scaleBarFor(4, 0)
    expect(wide.label).toMatch(/^(1|2|5)0* km$/)
    expect(wide.widthPx).toBeGreaterThan(0)
    expect(scaleBarFor(18, 0).label).toMatch(/ m$/)
})

test('landPathsFor emits one closed path per ring; graticuleFor flags equator + meridian bold', () => {
    const cw = project(20, 0, 2)
    const paths = landPathsFor(LANDMASSES, SZ, cw, 2)
    expect(paths.length).toBe(LANDMASSES.length)
    for (const p of paths) {
        expect(p.startsWith('M')).toBe(true)
        expect(p.endsWith('Z')).toBe(true)
    }
    const lines = graticuleFor(SZ, cw, 2)
    expect(lines.filter(l => l.bold).length).toBe(2)
})

test('zoomAround keeps the anchored geo point under the anchor, and refuses past the limits', () => {
    const center = { lat: 20, lng: 0 }
    const anchor = { x: 600, y: 200 }
    const before = screenToLatLng(anchor.x, anchor.y, SZ, project(20, 0, 4), 4)
    const r = zoomAround(4, center, SZ, 1, anchor)!
    expect(r.zoom).toBe(5)
    const after = screenToLatLng(anchor.x, anchor.y, SZ, project(r.center.lat, r.center.lng, 5), 5)
    expect(after.lat).toBeCloseTo(before.lat, 3)
    expect(after.lng).toBeCloseTo(before.lng, 3)
    expect(zoomAround(18, center, SZ, 1)).toBeNull()
    expect(zoomAround(1, center, SZ, -1)).toBeNull()
})

test('withCoords / withoutCoords never mutate their input', () => {
    const note = { a: 1, lat: 1, lng: 2 }
    expect(withCoords(note, 'lat', 'lng', 9, 8)).toEqual({ a: 1, lat: 9, lng: 8 })
    expect(withoutCoords(note, 'lat', 'lng')).toEqual({ a: 1 })
    expect(note).toEqual({ a: 1, lat: 1, lng: 2 })
})

test('siblingFolder: beside the first note row; owned rows are skipped; none -> undefined', () => {
    expect(
        siblingFolder([
            { path: 'base.md', index: 0 },
            { path: 'places/Tokyo.md' },
        ]),
    ).toBe('places')
    expect(siblingFolder([{ path: 'Tokyo.md' }])).toBe('')
    expect(siblingFolder([{ path: 'base.md', index: 1 }])).toBeUndefined()
    expect(siblingFolder([])).toBeUndefined()
})
