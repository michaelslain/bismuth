import { describe, expect, it } from 'bun:test'
import { setCustomThemesFeed, customThemes, customThemeLabels, customThemeOverrides, bootRefresh, changeTouchesThemes, customThemesLoaded } from './customThemes'
import { resolveAppearance, THEMES } from './themes'
import { settingsToCssVars } from './settingsCssVars'
import { DEFAULTS } from './settings'
import { EXAMPLE_THEMES_FEED, PARTIAL_FEED_ENTRY } from './ui/_themeFixtures'
import type { Settings } from './settings'

const vars = (theme: string) =>
    settingsToCssVars({
        ...DEFAULTS,
        appearance: { ...DEFAULTS.appearance, theme },
    } as unknown as Settings)

describe('custom themes', () => {
    it('setCustomThemesFeed marks the feed loaded', () => {
        setCustomThemesFeed(EXAMPLE_THEMES_FEED)
        expect(customThemesLoaded()).toBe(true)
    })

    it('resolves a fed custom theme by name', () => {
        setCustomThemesFeed(EXAMPLE_THEMES_FEED)
        const dusk = EXAMPLE_THEMES_FEED.themes[0].colors
        expect(resolveAppearance({ theme: 'dusk' })).toEqual(dusk)
        expect(customThemeLabels().dusk).toBe('Dusk')
        expect(Object.keys(customThemes())).toEqual(['dusk'])
    })

    it('falls back to ink for an unknown name', () => {
        setCustomThemesFeed(EXAMPLE_THEMES_FEED)
        expect(resolveAppearance({ theme: 'nope' })).toEqual(THEMES.ink)
    })

    it('a built-in name is never shadowed', () => {
        setCustomThemesFeed(EXAMPLE_THEMES_FEED)
        expect(resolveAppearance({ theme: 'paper' })).toEqual(THEMES.paper)
    })

    it('projects the same css var key set as ink', () => {
        setCustomThemesFeed(EXAMPLE_THEMES_FEED)
        expect(Object.keys(vars('dusk')).sort()).toEqual(
            Object.keys(vars('ink')).sort(),
        )
        const t = EXAMPLE_THEMES_FEED.themes[0].colors
        expect(vars('dusk')['--bg']).toBe(t.background)
        expect(vars('dusk')['--accent']).toBe(t.accent)
    })

    it('a partial v2 theme resolves over its extends base', () => {
        // ember sets no accent of its own, so these only hold if `extends` is honoured
        setCustomThemesFeed({ themes: [PARTIAL_FEED_ENTRY], invalid: [] })
        const colors = resolveAppearance({ theme: 'ember' })
        expect(colors.accent).toBe('#C2410C')
        expect(colors.isLight).toBe(true)
    })

    it('a theme that disappears from the feed repaints ink', () => {
        setCustomThemesFeed(EXAMPLE_THEMES_FEED)
        setCustomThemesFeed({ themes: [], invalid: [] })
        expect(resolveAppearance({ theme: 'dusk' })).toEqual(THEMES.ink)
    })
})

describe('theme overrides + live refresh', () => {
    it('exposes a theme\'s non-field tokens by name', () => {
        setCustomThemesFeed(EXAMPLE_THEMES_FEED)
        const o = customThemeOverrides()
        expect(Object.keys(o)).toEqual(['dusk'])
        expect(o.dusk).not.toHaveProperty('accent')
        expect(customThemeOverrides()).toBe(o) // cached per feed
    })

    it('an empty-paths change (the /version poll fallback) refreshes', () => {
        expect(changeTouchesThemes([])).toBe(true)
        expect(changeTouchesThemes(['notes/a.md'])).toBe(false)
        expect(changeTouchesThemes(['.themes/dusk.yaml'])).toBe(true)
    })

    it('a failed boot fetch retries at 1s, 2s, 4s then stops', async () => {
        const waits: number[] = []
        let calls = 0
        await bootRefresh(
            async ms => void waits.push(ms),
            async () => (calls++, false),
        )
        expect(waits).toEqual([1000, 2000, 4000])
        expect(calls).toBe(4)
    })

    it('stops retrying after a success', async () => {
        let calls = 0
        await bootRefresh(async () => {}, async () => ++calls === 2)
        expect(calls).toBe(2)
    })
})
