import { describe, expect, test } from 'bun:test'
import { snippetLead } from './snippetLead'

describe('snippetLead', () => {
    test('keeps a short lead-in untouched', () => {
        expect(snippetLead('Finished the ')).toBe('Finished the ')
    })

    test('drops leading indentation', () => {
        expect(snippetLead('    back: ')).toBe('back: ')
    })

    test('cuts a long lead-in on a word boundary with an ellipsis', () => {
        const before =
            'uff. Overall just very odd structure of the dorm. We also lived very close to a '
        const out = snippetLead(before, 32)
        expect(out.startsWith('…')).toBe(true)
        expect(out.length).toBeLessThanOrEqual(33)
        expect(out).toBe('…We also lived very close to a ')
    })

    test('keeps the tail when it has no space to cut on', () => {
        expect(snippetLead('x'.repeat(40), 10)).toBe(`…${'x'.repeat(10)}`)
    })
})
