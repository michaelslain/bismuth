import { describe, expect, it } from 'bun:test'
import { syncToDocumentClock } from './caretClock'

describe('syncToDocumentClock', () => {
    it('pins every running animation to the timeline origin', () => {
        const animations = [
            { startTime: 1234 as number | null },
            { startTime: null as number | null },
        ]
        syncToDocumentClock({ getAnimations: () => animations })
        expect(animations.map(a => a.startTime)).toEqual([0, 0])
    })
    it('does nothing where the Web Animations API is missing', () => {
        expect(() => syncToDocumentClock({})).not.toThrow()
    })
})
