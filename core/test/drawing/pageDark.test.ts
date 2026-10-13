import { test, expect } from 'bun:test'
import { emptyDoc, parseDoc, serializeDoc } from '../../src/drawing/model'
import { darkOf, setDark } from '../../src/drawing/pageDark'

test('darkOf follows the default when the doc has no flag', () => {
    expect(darkOf(emptyDoc(), false)).toBe(false)
    expect(darkOf(emptyDoc(), true)).toBe(true)
    expect(darkOf(null, true)).toBe(true)
})

test('darkOf prefers the file flag over the default, both ways', () => {
    expect(darkOf({ ...emptyDoc(), dark: true }, false)).toBe(true)
    expect(darkOf({ ...emptyDoc(), dark: false }, true)).toBe(false)
})

test('darkOf treats a non-boolean flag as absent', () => {
    const d = { ...emptyDoc(), dark: 'yes' } as unknown as Parameters<typeof darkOf>[0]
    expect(darkOf(d, false)).toBe(false)
})

test('setDark stores false as well as true, without mutating', () => {
    const d = emptyDoc()
    const on = setDark(d, true)
    expect(on.dark).toBe(true)
    expect(d.dark).toBeUndefined()
    expect(setDark(on, false).dark).toBe(false)
})

test('setDark hands the same doc back when nothing changes', () => {
    const on = setDark(emptyDoc(), true)
    expect(setDark(on, true)).toBe(on)
})

test('the flag survives a .draw round trip on the header line', () => {
    const text = serializeDoc(setDark(emptyDoc(), false))
    expect(JSON.parse(text.split('\n')[0]!).dark).toBe(false)
    expect(parseDoc(text).dark).toBe(false)
})
