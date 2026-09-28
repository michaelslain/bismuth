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
