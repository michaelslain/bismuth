import { GlobalWindow } from 'happy-dom'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { THEME_NAMES } from '../themes'
import { applyIntroTheme, introThemeVars, snapshotRootTheme } from './introTheme'

// A real happy-dom document installed as the globals setCssVars reads. Restored in afterAll.
const GLOBALS = ['document', 'window'] as const
const saved: Record<string, unknown> = {}
let win: GlobalWindow
let root: HTMLElement

beforeAll(() => {
    win = new GlobalWindow()
    for (const k of GLOBALS) {
        saved[k] = (globalThis as Record<string, unknown>)[k]
        ;(globalThis as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k]
    }
    root = win.document.documentElement as unknown as HTMLElement
})
afterAll(() => {
    for (const k of GLOBALS) {
        if (saved[k] === undefined) delete (globalThis as Record<string, unknown>)[k]
        else (globalThis as Record<string, unknown>)[k] = saved[k]
    }
})

describe('introThemeVars', () => {
    it('gives each theme its own background', () => {
        const bgs = THEME_NAMES.map(n => introThemeVars(n)['--bg'])
        expect(new Set(bgs).size).toBe(THEME_NAMES.length)
    })
})

describe('applyIntroTheme + snapshotRootTheme', () => {
    it('paints vars and color-scheme, and restore puts both back', () => {
        root.style.setProperty('--bg', 'red')
        root.style.colorScheme = 'dark'
        const restore = snapshotRootTheme(root)

        applyIntroTheme('paper', root)
        expect(root.style.getPropertyValue('--bg')).toBe(introThemeVars('paper')['--bg'])
        expect(root.style.colorScheme).toBe('light')

        restore()
        expect(root.style.getPropertyValue('--bg')).toBe('red')
        expect(root.style.colorScheme).toBe('dark')
    })

    it('removes a var that had no inline value instead of leaving the theme painted', () => {
        root.style.removeProperty('--accent')
        root.style.colorScheme = ''
        const restore = snapshotRootTheme(root)

        applyIntroTheme('riso', root)
        expect(root.style.getPropertyValue('--accent')).not.toBe('')

        restore()
        expect(root.style.getPropertyValue('--accent')).toBe('')
        expect(root.style.colorScheme).toBe('')
    })

    it('restores every var any theme writes, after cycling through every theme', () => {
        root.removeAttribute('style')
        const restore = snapshotRootTheme(root)
        for (const n of THEME_NAMES) applyIntroTheme(n, root)
        const written = new Set(THEME_NAMES.flatMap(n => Object.keys(introThemeVars(n))))
        expect(written.size).toBeGreaterThan(50)
        restore()
        for (const k of written) expect(root.style.getPropertyValue(k)).toBe('')
    })

    it('defaults to document.documentElement', () => {
        const restore = snapshotRootTheme()
        applyIntroTheme('paper')
        expect(root.style.getPropertyValue('--bg')).toBe(introThemeVars('paper')['--bg'])
        restore()
    })
})
