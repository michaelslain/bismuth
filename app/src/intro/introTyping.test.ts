import { describe, expect, it } from 'bun:test'
import { typedCounts, typingDuration, TITLE_MS_PER_CHAR } from './introTyping'

describe('typedCounts', () => {
    it('types the title first', () => {
        expect(typedCounts(0, 20, 100)).toEqual({ title: 0, body: 0 })
        expect(typedCounts(TITLE_MS_PER_CHAR * 10, 20, 100)).toEqual({ title: 10, body: 0 })
    })
    it('then the body, capped near BODY_MAX_MS', () => {
        const titleDone = TITLE_MS_PER_CHAR * 20
        expect(typedCounts(titleDone + 900, 20, 300).body).toBe(300)
        expect(typedCounts(titleDone + 140, 20, 30).body).toBe(10)
    })
    it('never exceeds lengths and duration covers both', () => {
        expect(typedCounts(1e9, 20, 100)).toEqual({ title: 20, body: 100 })
        expect(typingDuration(20, 100)).toBe(TITLE_MS_PER_CHAR * 20 + Math.min(14, 900 / 100) * 100)
    })
})
