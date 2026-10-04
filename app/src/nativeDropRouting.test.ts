import { test, expect, describe } from 'bun:test'
import {
    nativeDragScale,
    nativeDragUnits,
    claimNativeDrop,
} from './nativeDropRouting'

// The bridge multiplies Tauri's raw drag position by nativeDragScale. The units differ per
// engine (wry: macOS/Linux logical points, Windows physical px), so the scale is measured from
// the window's own width in those units against the CSS viewport width.
describe('nativeDragScale — raw drag position → page CSS px', () => {
    test('units: only Windows reports physical px', () => {
        expect(nativeDragUnits(true)).toBe('physical')
        expect(nativeDragUnits(false)).toBe('logical')
    })

    test('Retina Mac, no zoom: points ARE CSS px → 1 (the halving bug)', () => {
        // 1500pt window at 2× backing: innerSize 3000 physical, innerWidth 1500 CSS. The old
        // bridge divided by devicePixelRatio (2) here, putting every drop at half its x and y.
        const s = nativeDragScale({
            units: 'logical',
            cssInnerWidth: 1500,
            physicalInnerWidth: 3000,
            scaleFactor: 2,
            dpr: 2,
        })
        expect(s).toBe(1)
        // A drop on a chat pane at x=500 must stay at 500, not land in a 0–300 sidebar at 250.
        expect(500 * s).toBe(500)
    })

    test('Mac at page zoom z: scale = 1/z', () => {
        // 125% zoom: the 1500pt viewport is 1200 CSS px wide.
        expect(
            nativeDragScale({
                units: 'logical',
                cssInnerWidth: 1200,
                physicalInnerWidth: 3000,
                scaleFactor: 2,
                dpr: 2,
            }),
        ).toBeCloseTo(1 / 1.25, 10)
        // 80% zoom: 1875 CSS px.
        expect(
            nativeDragScale({
                units: 'logical',
                cssInnerWidth: 1875,
                physicalInnerWidth: 3000,
                scaleFactor: 2,
                dpr: 2,
            }),
        ).toBeCloseTo(1.25, 10)
    })

    test('Windows physical px: scale = 1/DPR, and zoom folds in', () => {
        expect(
            nativeDragScale({
                units: 'physical',
                cssInnerWidth: 1200,
                physicalInnerWidth: 1800,
                scaleFactor: 1.5,
                dpr: 1.5,
            }),
        ).toBe(1 / 1.5)
        // 125% zoom on a 1.5× display: 1800 physical → 960 CSS.
        expect(
            nativeDragScale({
                units: 'physical',
                cssInnerWidth: 960,
                physicalInnerWidth: 1800,
                scaleFactor: 1.5,
                dpr: 1.875,
            }),
        ).toBeCloseTo(960 / 1800, 10)
    })

    test('measurement noise within 2% snaps to the no-zoom value', () => {
        const base = {
            units: 'logical' as const,
            physicalInnerWidth: 3000,
            scaleFactor: 2,
            dpr: 2,
        }
        expect(nativeDragScale({ ...base, cssInnerWidth: 1499 })).toBe(1)
        expect(nativeDragScale({ ...base, cssInnerWidth: 1510 })).toBe(1)
    })

    test('degenerate inputs fall back to the no-zoom value', () => {
        const logical = {
            units: 'logical' as const,
            cssInnerWidth: 1500,
            physicalInnerWidth: 3000,
            scaleFactor: 2,
            dpr: 2,
        }
        expect(nativeDragScale({ ...logical, physicalInnerWidth: 0 })).toBe(1)
        expect(nativeDragScale({ ...logical, cssInnerWidth: NaN })).toBe(1)
        expect(nativeDragScale({ ...logical, scaleFactor: -1 })).toBe(1)
        const physical = { ...logical, units: 'physical' as const }
        expect(nativeDragScale({ ...physical, physicalInnerWidth: 0 })).toBe(
            0.5,
        )
        expect(nativeDragScale({ ...physical, cssInnerWidth: 0, dpr: 0 })).toBe(
            1,
        )
    })
})

// The claim guard: one drop event fans out to every subscribed handler; only the FIRST
// one that decides to process it may insert. This is the coordinator-shaped test: two
// subscribe cycles (two live handlers) + one drop → exactly one insert.
describe('#30 claimNativeDrop — double-insert guard', () => {
    test('two live handlers, one drop → exactly one insert', () => {
        let inserts = 0
        // The handler body every Editor subscription runs: claim, then insert.
        const handler = (detail: object): void => {
            if (!claimNativeDrop(detail)) return
            inserts++
        }
        // Two subscribe cycles left two live listeners (e.g. across an editor rebuild)…
        const listeners = [handler, handler]
        // …and ONE drop event fans out to both with the SAME detail object.
        const detail = { type: 'drop', paths: ['/tmp/cat.png'], x: 10, y: 10 }
        for (const l of listeners) l(detail)
        expect(inserts).toBe(1)
    })

    test('distinct drops are claimed independently (a second drag still inserts)', () => {
        const a = { paths: ['/tmp/a.png'] }
        const b = { paths: ['/tmp/b.png'] }
        expect(claimNativeDrop(a)).toBe(true)
        expect(claimNativeDrop(b)).toBe(true) // a different drop is not blocked
        expect(claimNativeDrop(a)).toBe(false) // but re-processing the same one is
        expect(claimNativeDrop(b)).toBe(false)
    })
})
