import { describe, expect, test } from 'bun:test'
import { DEFAULT_STATUS_BAR, normalizeStatusBar } from './statusBarItems'

describe('normalizeStatusBar', () => {
    test('non-list input falls back to the default list', () => {
        for (const raw of [undefined, 'x', {}, 3, null]) {
            expect(normalizeStatusBar(raw).map(i => i.builtin)).toEqual([
                'location',
                'connection',
                'inbox',
                'daemon',
            ])
        }
    })
    test('default list: aligns left,left,right,right and ids s0..s3', () => {
        const items = normalizeStatusBar(DEFAULT_STATUS_BAR)
        expect(items.map(i => i.align)).toEqual(['left', 'left', 'right', 'right'])
        expect(items.map(i => i.id)).toEqual(['s0', 's1', 's2', 's3'])
        expect(items.every(i => i.every === 60)).toBe(true)
    })
    test('invalid items are dropped but ids keep raw positions', () => {
        const items = normalizeStatusBar([{}, { builtin: 'nope' }, { text: 'hi' }, 'str'])
        expect(items.map(i => i.id)).toEqual(['s2'])
    })
    test('every clamps to >= 5', () => {
        expect(normalizeStatusBar([{ text: 'a', every: 1 }])[0].every).toBe(5)
        expect(normalizeStatusBar([{ text: 'a', every: 30 }])[0].every).toBe(30)
    })
    test('unknown tone is omitted, known kept', () => {
        expect(normalizeStatusBar([{ text: 'a', tone: 'puce' }])[0].tone).toBeUndefined()
        expect(normalizeStatusBar([{ text: 'a', tone: 'gold' }])[0].tone).toBe('gold')
    })
    test('text item defaults to align right; unknown align defaults', () => {
        expect(normalizeStatusBar([{ text: 'a' }])[0].align).toBe('right')
        expect(normalizeStatusBar([{ builtin: 'location', align: 'middle' }])[0].align).toBe('left')
        expect(normalizeStatusBar([{ text: 'a', align: 'left' }])[0].align).toBe('left')
    })
    test('query and run kinds survive', () => {
        const [q, r] = normalizeStatusBar([{ query: { source: 'tasks', where: 'x' } }, { run: 'date' }])
        expect(q.query).toEqual({ source: 'tasks', where: 'x' })
        expect(r.run).toBe('date')
        expect(normalizeStatusBar([{ query: { source: 'bogus' } }])).toEqual([])
    })
    test('run is trimmed (YAML block scalars end in a newline)', () => {
        const [r] = normalizeStatusBar([{ run: 'echo hi\n' }])
        expect(r.run).toBe('echo hi')
    })
})
