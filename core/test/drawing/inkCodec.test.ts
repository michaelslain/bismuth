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

    test('beats plain JSON by a wide margin on a dense stroke set', () => {
        const dense: Stroke[] = Array.from({ length: 50 }, (_, s) => ({
            t: 'pen' as const,
            c: 'fg',
            w: 5,
            pts: Array.from({ length: 150 * 3 }, (_, i) =>
                i % 3 === 2 ? 180 : Math.round(300 + 40 * Math.sin((i + s) / 7)),
            ),
        }))
        const encoded = encodeStrokes(dense).length
        const json = JSON.stringify(dense).length
        expect(encoded).toBeLessThan(json / 4)
    })

    test('rejects a payload with an unknown version byte', () => {
        const bad = btoa(String.fromCharCode(99, 1, 2, 3))
        expect(() => decodeStrokes(bad)).toThrow()
    })
})
