import { describe, expect, test } from 'bun:test'
import {
    deliveryDone,
    gateDone,
    gateError,
    gateStop,
    settleDelivered,
} from './chatTurnGate'

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

describe('chatTurnGate idle done', () => {
    test('an idle done finishes even with a stop outstanding', () => {
        expect(gateDone(gateStop(0, true), true)).toEqual({
            stale: 0,
            finished: true,
        })
    })
})

describe('chatTurnGate delivery', () => {
    test('a done with nothing waiting finishes the turn', () => {
        expect(deliveryDone([])).toEqual({ pending: [], finished: true })
    })

    test('a done while a sent message is waiting belongs to an earlier turn', () => {
        expect(deliveryDone(['m1'])).toEqual({ pending: ['m1'], finished: false })
    })

    test('stop then send: the stopped turn done is ignored, the new turn done finishes', () => {
        let pending = ['m2']
        expect(deliveryDone(pending).finished).toBe(false)
        pending = settleDelivered(pending, ['m2'])
        expect(deliveryDone(pending).finished).toBe(true)
    })

    test('two messages read into one turn give one done, and it finishes', () => {
        const pending = settleDelivered(['m1', 'm2'], ['m1'])
        const after = settleDelivered(pending, ['m2'])
        expect(deliveryDone(after).finished).toBe(true)
    })

    test('an idle done drops messages the backend never received', () => {
        expect(deliveryDone(['lost'], true)).toEqual({
            pending: [],
            finished: true,
        })
    })
})
