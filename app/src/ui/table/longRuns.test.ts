import { describe, expect, test } from 'bun:test'
import { LONG_RUN, longRuns } from './longRuns'

describe('longRuns', () => {
    test('prose words stay unmarked', () => {
        expect(longRuns('internationalization is a long word')).toEqual([
            { text: 'internationalization is a long word', long: false },
        ])
    })
    test('a url inside prose is marked on its own', () => {
        expect(longRuns('see https://example.com/a/long/path now')).toEqual([
            { text: 'see ', long: false },
            { text: 'https://example.com/a/long/path', long: true },
            { text: ' now', long: false },
        ])
    })
    test('a run one past the limit is long, the limit itself is not', () => {
        expect(longRuns('x'.repeat(LONG_RUN))[0].long).toBe(false)
        expect(longRuns('x'.repeat(LONG_RUN + 1))[0].long).toBe(true)
    })
    test('the pieces always rejoin to the input', () => {
        for (const s of [
            '',
            ' ',
            'a',
            'Pneumonoultramicroscopicsilicovolcanoconiosis',
            ' lead averyveryverylongidentifierwithoutjoints trail ',
        ])
            expect(
                longRuns(s)
                    .map(p => p.text)
                    .join(''),
            ).toBe(s)
    })
})
