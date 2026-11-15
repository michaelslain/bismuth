import { describe, expect, test } from 'bun:test'
import { retryLabel } from './chatRetry'

describe('retryLabel', () => {
    test('names the attempt and the cap', () => {
        expect(retryLabel({ attempt: 2, maxAttempts: 3 })).toBe('retrying // attempt 2 of 3')
    })
    test('omits the cap when the backend gives none', () => {
        expect(retryLabel({ attempt: 1 })).toBe('retrying // attempt 1')
    })
    test('shows the note in place of the attempt count', () => {
        expect(
            retryLabel({ attempt: 2, maxAttempts: 2, note: 'chat condensed to fit the model window' }),
        ).toBe('retrying // chat condensed to fit the model window')
    })
})
