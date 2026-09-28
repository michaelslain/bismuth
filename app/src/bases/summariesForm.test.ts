import { describe, expect, test } from 'bun:test'
import { buildSummaries, seedSummaryChoices } from './summariesForm'

describe('summaries form', () => {
    test('seed matches bare and note.-prefixed ids', () => {
        const c = seedSummaryChoices({ 'note.price': 'Sum' }, [
            'file.name',
            'price',
        ])
        expect(c).toEqual({ 'file.name': '', price: 'Sum' })
    })

    test('save reuses the existing key spelling', () => {
        const out = buildSummaries({ 'note.price': 'Sum' }, ['price'], {
            price: 'Average',
        })
        expect(out).toEqual({ 'note.price': 'Average' })
    })

    test('a hidden column keeps its summary', () => {
        const out = buildSummaries({ qty: 'Max', price: 'Sum' }, ['price'], {
            price: '',
        })
        expect(out).toEqual({ qty: 'Max' })
    })

    test('nothing chosen → undefined', () => {
        expect(
            buildSummaries(undefined, ['price'], { price: '' }),
        ).toBeUndefined()
    })

    test('a new choice uses the column id', () => {
        expect(
            buildSummaries(undefined, ['file.name'], { 'file.name': 'Count' }),
        ).toEqual({
            'file.name': 'Count',
        })
    })
})
