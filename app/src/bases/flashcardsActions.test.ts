import { describe, expect, it } from 'bun:test'
import {
    answerColumn,
    promptColumn,
    resetKeys,
    scheduleColumns,
    stripSchedule,
} from './flashcardsActions'

const base = { due: 'due', ease: 'ease', interval: 'interval' }

describe('scheduleColumns', () => {
    it('forward uses the base triple', () => {
        expect(scheduleColumns('fwd', base)).toEqual(base)
    })
    it('reverse uses the *Back companions', () => {
        expect(scheduleColumns('rev', base)).toEqual({
            due: 'dueBack',
            ease: 'easeBack',
            interval: 'intervalBack',
        })
    })
    it('honours renamed columns', () => {
        expect(
            scheduleColumns('rev', { due: 'next', ease: 'e', interval: 'i' }),
        ).toEqual({ due: 'nextBack', ease: 'eBack', interval: 'iBack' })
    })
})

describe('resetKeys', () => {
    it('is the forward triple on a one-way deck', () => {
        expect(resetKeys(base, false)).toEqual(['due', 'ease', 'interval'])
    })
    it('adds the Back companions on a bidirectional deck', () => {
        expect(resetKeys(base, true)).toEqual([
            'due',
            'ease',
            'interval',
            'dueBack',
            'easeBack',
            'intervalBack',
        ])
    })
})

describe('stripSchedule', () => {
    const note = {
        front: 'q',
        back: 'a',
        due: '2026-01-01',
        ease: 2.5,
        interval: 3,
        dueBack: '2026-02-02',
        tag: 'keep',
    }
    it('drops only the named columns and never mutates the input', () => {
        const out = stripSchedule(note, resetKeys(base, false))
        expect(out).toEqual({
            front: 'q',
            back: 'a',
            dueBack: '2026-02-02',
            tag: 'keep',
        })
        expect(note.due).toBe('2026-01-01')
    })
    it('a bidirectional reset also clears the reverse triple', () => {
        const out = stripSchedule(note, resetKeys(base, true))
        expect('dueBack' in out).toBe(false)
        expect(out.tag).toBe('keep')
    })
})

describe('promptColumn / answerColumn', () => {
    it('forward asks the front and answers the back', () => {
        expect(promptColumn('fwd', 'front', 'back')).toBe('front')
        expect(answerColumn('fwd', 'front', 'back')).toBe('back')
    })
    it('reverse swaps them', () => {
        expect(promptColumn('rev', 'front', 'back')).toBe('back')
        expect(answerColumn('rev', 'front', 'back')).toBe('front')
    })
})
