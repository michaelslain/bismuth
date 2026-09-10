import { describe, expect, test } from 'bun:test'
import { encodeStrokes, decodeStrokes } from '../../src/drawing/inkCodec'
import type { Stroke } from '../../src/drawing/model'

const sample: Stroke[] = [
    { t: 'pen', c: 'fg', w: 5, pts: [10, 20, 128, 12, 24, 130, 15, 30, 200] },
    { t: 'hl', c: 'accent', w: 12, straight: true, pts: [0, 0, 255, 400, 300, 255] },
]

describe('inkCodec', () => {
    test('round-trips a stroke list exactly', () => {
        expect(decodeStrokes(encodeStrokes(sample))).toEqual(sample)
    })

    test('round-trips an empty list', () => {
        expect(decodeStrokes(encodeStrokes([]))).toEqual([])
    })

    test('payload is base64 with no newlines', () => {
        const p = encodeStrokes(sample)
        expect(p).toMatch(/^[A-Za-z0-9+/=]+$/)
    })

    test('beats plain JSON by a wide margin on a dense random-walk stroke set', () => {
        // Deterministic PRNG (mulberry32) so the fixture never flakes. Large absolute
        // coordinates + small per-step deltas is exactly the shape delta coding earns its
        // keep on — deflate alone over a random walk's raw JSON digits compresses poorly,
        // since each point's absolute value shares little structure with its neighbours.
        function mulberry32(seed: number) {
            let a = seed
            return () => {
                a |= 0
                a = (a + 0x6d2b79f5) | 0
                let t = Math.imul(a ^ (a >>> 15), 1 | a)
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296
            }
        }
        const rand = mulberry32(12345)
        const dense: Stroke[] = Array.from({ length: 50 }, () => {
            const pts: number[] = []
            let x = 4000 + Math.round(rand() * 4000)
            let y = 4000 + Math.round(rand() * 4000)
            let p = 128
            for (let i = 0; i < 150; i++) {
                x += Math.round((rand() - 0.5) * 6)
                y += Math.round((rand() - 0.5) * 6)
                p = Math.max(0, Math.min(255, p + Math.round((rand() - 0.5) * 4)))
                pts.push(x, y, p)
            }
            return { t: 'pen' as const, c: 'fg', w: 5, pts }
        })
        const encoded = encodeStrokes(dense).length
        const json = JSON.stringify(dense).length
        expect(encoded).toBeLessThan(json / 4)
    })

    test('rejects a payload shorter than the header', () => {
        const bad = btoa(String.fromCharCode(1, 2, 3))
        expect(() => decodeStrokes(bad)).toThrow()
    })

    test('rejects a payload with an unknown version byte', () => {
        // Must be long enough to pass the header-length guard so this actually exercises
        // version handling rather than failing on payload length alone: take a real, valid
        // payload and flip only its version byte.
        const bytes = Uint8Array.from(atob(encodeStrokes(sample)), c => c.charCodeAt(0))
        bytes[0] = 99
        const bad = btoa(String.fromCharCode(...bytes))
        expect(() => decodeStrokes(bad)).toThrow()
    })

    test('round-trips with the Bun compression globals genuinely unavailable', () => {
        // app/src/api.ts imports core/src/drawing/model (and this codec) straight into the
        // browser bundle, where there is no `Bun` global at all. A plain round-trip test
        // passes identically whether the codec calls Bun.deflateSync or a portable library,
        // so it can never catch a regression back to a Bun-only API.
        //
        // `globalThis.Bun` itself is a non-configurable, non-writable binding in the Bun
        // runtime (`Object.defineProperty`/`delete` on it both throw), so it cannot be
        // removed wholesale. Its OWN methods are writable though (non-configurable, but
        // writable: true) — so this stubs `Bun.deflateSync`/`Bun.inflateSync` to throw for
        // the duration of the call, which reproduces exactly what a browser bundle sees:
        // any code path that still reaches for a Bun compression global blows up.
        const realDeflate = Bun.deflateSync
        const realInflate = Bun.inflateSync
        const explode = () => {
            throw new Error('Bun global unavailable (simulated browser environment)')
        }
        Bun.deflateSync = explode
        Bun.inflateSync = explode
        try {
            expect(decodeStrokes(encodeStrokes(sample))).toEqual(sample)
        } finally {
            Bun.deflateSync = realDeflate
            Bun.inflateSync = realInflate
        }
        expect(Bun.deflateSync).toBe(realDeflate)
        expect(Bun.inflateSync).toBe(realInflate)
    })
})
