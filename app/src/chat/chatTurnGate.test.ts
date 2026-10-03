import { describe, expect, test } from 'bun:test'
import { gateDone, gateError, gateStop } from './chatTurnGate'

describe('chatTurnGate', () => {
    test('a done with no stop outstanding finishes the turn', () => {
        expect(gateDone(0)).toEqual({ stale: 0, finished: true })
    })

    test('stopping a running turn expects one stale done', () => {
        expect(gateStop(0, true)).toBe(1)
    })

    test('stopping an idle chat expects nothing', () => {
        expect(gateStop(0, false)).toBe(0)
    })

    test('the stopped turn done is swallowed, the next turn done finishes', () => {
        const stale = gateStop(0, true)
        const first = gateDone(stale)
        expect(first).toEqual({ stale: 0, finished: false })
        expect(gateDone(first.stale)).toEqual({ stale: 0, finished: true })
    })

    test('a stopped turn that ends in an error leaves nothing stale', () => {
        expect(gateStop(0, true)).toBe(1)
        const stale = gateError()
        expect(gateDone(stale)).toEqual({ stale: 0, finished: true })
    })
})
