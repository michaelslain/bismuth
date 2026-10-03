import { describe, expect, it } from 'bun:test'
import {
    BODY_MAX_MS,
    TITLE_MS_PER_CHAR,
    TITLE_TO_BODY_MS,
    keystrokeTimes,
    typedCounts,
    typingPlan,
} from './introTyping'

const gaps = (at: number[]) => at.map((t, i) => t - (i ? at[i - 1] : 0))

describe('keystrokeTimes', () => {
    const text = 'Notes that think. An agent that never sleeps.'
    const at = keystrokeTimes(text, TITLE_MS_PER_CHAR, 11)

    it('is ascending, one time per character', () => {
        expect(at.length).toBe(text.length)
        for (let i = 1; i < at.length; i++)
            expect(at[i]).toBeGreaterThan(at[i - 1])
    })
    it('is irregular: letters do not share one delay', () => {
        const letterGaps = gaps(at).filter(
            (_, i) => i > 0 && /[a-z]/i.test(text[i - 1]),
        )
        expect(
            new Set(letterGaps.map(g => Math.round(g))).size,
        ).toBeGreaterThan(8)
        expect(
            Math.max(...letterGaps) / Math.min(...letterGaps),
        ).toBeGreaterThan(2)
    })
    it('pauses after punctuation longer than after a letter', () => {
        const g = gaps(at)
        const afterStop = g[text.indexOf('.') + 1]
        const letterGaps = g.filter(
            (_, i) => i > 0 && /[a-z]/i.test(text[i - 1]),
        )
        const mean = letterGaps.reduce((a, b) => a + b, 0) / letterGaps.length
        expect(afterStop).toBeGreaterThan(mean * 2)
    })
    it('averages near the nominal speed', () => {
        const letterGaps = gaps(at).filter(
            (_, i) => i > 0 && /[a-z]/i.test(text[i - 1]),
        )
        const mean = letterGaps.reduce((a, b) => a + b, 0) / letterGaps.length
        expect(mean).toBeGreaterThan(TITLE_MS_PER_CHAR * 0.6)
        expect(mean).toBeLessThan(TITLE_MS_PER_CHAR * 2)
    })
    it('is deterministic', () => {
        expect(keystrokeTimes(text, TITLE_MS_PER_CHAR, 11)).toEqual(at)
        expect(keystrokeTimes(text, TITLE_MS_PER_CHAR, 12)).not.toEqual(at)
    })
})

describe('typingPlan + typedCounts', () => {
    const title = 'Notes that think.'
    const body = 'x'.repeat(400)
    const plan = typingPlan(title, body)

    it('types the title first, then the body after a beat', () => {
        expect(typedCounts(0, plan)).toEqual({ title: 0, body: 0 })
        const titleEnd = plan.title[plan.title.length - 1]
        expect(typedCounts(titleEnd, plan)).toEqual({
            title: title.length,
            body: 0,
        })
        expect(plan.body[0]).toBeGreaterThanOrEqual(titleEnd + TITLE_TO_BODY_MS)
    })
    it('caps a long body at BODY_MAX_MS', () => {
        const titleEnd = plan.title[plan.title.length - 1]
        expect(
            plan.duration - (titleEnd + TITLE_TO_BODY_MS),
        ).toBeLessThanOrEqual(BODY_MAX_MS + 1e-6)
        expect(typedCounts(plan.duration, plan)).toEqual({
            title: title.length,
            body: body.length,
        })
    })
    it('counts never exceed the lengths', () => {
        expect(typedCounts(1e9, plan)).toEqual({
            title: title.length,
            body: body.length,
        })
    })
    it('an empty body ends with the title', () => {
        const p = typingPlan(title, '')
        expect(p.duration).toBe(p.title[p.title.length - 1])
    })
})
