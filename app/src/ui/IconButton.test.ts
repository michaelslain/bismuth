import { describe, expect, test } from 'bun:test'
import { pressedFor } from './pressedFor'

describe('pressedFor', () => {
    test('selected is pressed', () => expect(pressedFor('selected')).toBe(true))
    test('unselected is not pressed', () => expect(pressedFor('unselected')).toBe(false))
    test('normal and absent carry no aria-pressed', () => {
        expect(pressedFor('normal')).toBeUndefined()
        expect(pressedFor(undefined)).toBeUndefined()
    })
})
