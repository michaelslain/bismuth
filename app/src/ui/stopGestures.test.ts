import { describe, it, expect } from 'bun:test'
import { gestureStops, stopGestures } from './stopGestures'

function fakeEvent() {
    let stopped = 0
    return {
        e: { stopPropagation: () => stopped++ } as unknown as Event,
        count: () => stopped,
    }
}

describe('stopGestures', () => {
    it('stops propagation', () => {
        const f = fakeEvent()
        stopGestures(f.e)
        expect(f.count()).toBe(1)
    })
})

describe('gestureStops', () => {
    it('carries the four handlers and each stops propagation', () => {
        expect(Object.keys(gestureStops).sort()).toEqual([
            'onClick',
            'onDblClick',
            'onMouseDown',
            'onPointerDown',
        ])
        for (const handler of Object.values(gestureStops)) {
            const f = fakeEvent()
            ;(handler as (e: Event) => void)(f.e)
            expect(f.count()).toBe(1)
        }
    })
})
