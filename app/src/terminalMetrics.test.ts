import { expect, test } from 'bun:test'
import { terminalLineHeight } from './terminalMetrics'

test('the shell prompt matches a note line', () => {
    expect(terminalLineHeight(22, 16, false)).toBe(22 / 16)
})

test('a full-screen program gets the font height, so block and box glyphs join', () => {
    expect(terminalLineHeight(22, 16, true)).toBe(1)
})

test('an unmeasured grid stays at the font height', () => {
    expect(terminalLineHeight(22, 0, false)).toBe(1)
    expect(terminalLineHeight(0, 16, false)).toBe(1)
})
