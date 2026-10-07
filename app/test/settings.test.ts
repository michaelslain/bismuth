import { test, expect } from 'bun:test'
import {
    loadSettings,
    DEFAULTS,
    FONT_STACKS,
    PROSE_SCALES,
} from '../src/settings'
import { readFileSync } from 'node:fs'
import {
    DEFAULT_PROSE_FONT,
    PROSE_SCALE,
    CODE_SCALE,
} from '../src/export/exportTheme'

test('loadSettings returns defaults for null / malformed / non-object input', () => {
    expect(loadSettings(null)).toEqual(DEFAULTS)
    expect(loadSettings('not json')).toEqual(DEFAULTS)
    expect(loadSettings('42')).toEqual(DEFAULTS)
    expect(loadSettings('null')).toEqual(DEFAULTS)
})

test('loadSettings returns a fresh clone, not the DEFAULTS reference', () => {
    const a = loadSettings(null)
    a.appearance.editorFontSize = 99
    expect(DEFAULTS.appearance.editorFontSize).toBe(13.5)
})

test('loadSettings overlays stored values and keeps defaults for missing keys', () => {
    const raw = JSON.stringify({
        appearance: { theme: 'rose-gold' },
        graph: { spin: false },
    })
    const s = loadSettings(raw)
    expect(s.appearance.theme).toBe('rose-gold') // taken from storage
    expect(s.appearance.uiFont).toBe('Monaspace Xenon') // default kept
    expect(s.appearance.proseFont).toBe('Libron') // default kept
    expect(s.graph.spin).toBe(false) // taken from storage
    expect(s.appearance.editorFontSize).toBe(13.5) // default kept
})

test('loadSettings ignores wrong-typed and unknown keys', () => {
    const raw = JSON.stringify({
        appearance: { editorFontSize: 'huge', bogus: 1 }, // wrong type + unknown
        editor: { autoSaveDelay: 1500 },
    })
    const s = loadSettings(raw) as any
    expect(s.appearance.editorFontSize).toBe(13.5) // wrong type rejected → default
    expect(s.appearance.bogus).toBeUndefined() // unknown key dropped
    expect(s.editor.autoSaveDelay).toBe(1500) // valid override applied
})

test("the headless export's prose mirrors match the default prose face", () => {
    // exportTheme.ts cannot import settings.ts (the cli binary compiles it), so it carries
    // literals — pinned here to their sources.
    const face = DEFAULTS.appearance.proseFont
    expect(DEFAULT_PROSE_FONT).toBe(FONT_STACKS[face]!)
    expect(PROSE_SCALE).toBe(PROSE_SCALES[face]!)
})

test("the headless export's code scale mirrors global.css's --code-scale", () => {
    const css = readFileSync(new URL('../src/global.css', import.meta.url), 'utf8')
    const m = /--code-scale:\s*([\d.]+)\s*;/.exec(css)
    expect(m).not.toBeNull()
    expect(CODE_SCALE).toBe(Number(m![1]))
})
