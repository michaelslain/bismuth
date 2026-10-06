import { expect, test } from 'bun:test'
import { shouldCloseOnKey } from './takeoverDismiss'

test('closes on the dismiss key', () => {
    expect(shouldCloseOnKey({ defaultPrevented: false }, true)).toBe(true)
})
test('ignores other keys', () => {
    expect(shouldCloseOnKey({ defaultPrevented: false }, false)).toBe(false)
})
test('leaves a dismiss a menu already handled alone', () => {
    expect(shouldCloseOnKey({ defaultPrevented: true }, true)).toBe(false)
})
