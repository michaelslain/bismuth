import { test, expect } from 'bun:test'
import { isPaletteToken, resolvePaletteColor } from './palette'

test('isPaletteToken: a token is one, a raw var or undefined is not', () => {
    expect(isPaletteToken('teal')).toBe(true)
    expect(isPaletteToken('var(--graph-2)')).toBe(false)
    expect(isPaletteToken(undefined)).toBe(false)
})

test('resolvePaletteColor: token to var, raw passthrough, undefined empty', () => {
    expect(resolvePaletteColor('teal')).toBe('var(--teal)')
    expect(resolvePaletteColor('var(--graph-2)')).toBe('var(--graph-2)')
    expect(resolvePaletteColor('#ff0000')).toBe('#ff0000')
    expect(resolvePaletteColor(undefined)).toBe('')
})
