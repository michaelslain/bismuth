// The reactive custom-theme registry. A vault's `.themes/<name>.yaml` files arrive as one
// ThemesFeed (GET /themes); this module keeps the last good feed in a signal so themes.ts's
// resolveTheme/resolveAppearance — and through them settingsToCssVars, GraphView, SheetView
// and every other caller — re-resolve reactively when a theme file is edited or created.
// Pure parse/validate lives in core (core/src/theme/customTheme.ts); only the signal is here.
import { createEffect, createRoot, createSignal, type Accessor } from 'solid-js'
import { api } from './api'
import { customOverrideMap, customTokenMap, isThemePath } from '../../core/src/theme/customTheme'
import type { ThemesFeed } from '../../core/src/theme/customTheme'
import type { ColorTokens } from '../../core/src/theme/tokens'
import type { TokenMap } from '../../core/src/theme/designTokens'

const EMPTY: ThemesFeed = { themes: [], invalid: [] }

const [feed, setFeed] = createSignal<ThemesFeed>(EMPTY)

// Same intro-mode skip as settings.ts: no backend yet, so the fetch would only fail loudly.
const introMode =
    typeof window !== 'undefined' &&
    ((window as unknown as { __BISMUTH_FIRST_RUN__?: boolean })
        .__BISMUTH_FIRST_RUN__ === true ||
        new URLSearchParams(window.location.search).has('intro'))

// True once the first boot refresh settled (success or final failed retry), or immediately when
// there is nothing to wait for (no window, intro mode). App gates the CSS-var projection on it so
// a custom theme never paints ink first. A plain signal, not a memo (see above).
const [loaded, setLoaded] = createSignal(typeof window === 'undefined' || introMode)
export const customThemesLoaded: Accessor<boolean> = loaded

/** VALID custom themes only, by name. An invalid or missing theme is absent, so it resolves to ink.
 *  A plain accessor (not a module-scope memo): it tracks `feed` at every call site, and the map is
 *  cached per feed object so identity is stable between feeds. */
let cachedFor: ThemesFeed | undefined
let cachedMap: Record<string, ColorTokens> = {}
let cachedOverridesFor: ThemesFeed | undefined
let cachedOverrides: Record<string, TokenMap> = {}
export const customThemes: Accessor<Readonly<Record<string, ColorTokens>>> = () => {
    const f = feed()
    if (f !== cachedFor) {
        cachedFor = f
        cachedMap = customTokenMap(f)
    }
    return cachedMap
}

/** name -> the theme's non-field token overrides, projected straight onto :root. Cached per feed
 *  object like `customThemes`. */
export const customThemeOverrides: Accessor<Readonly<Record<string, TokenMap>>> = () => {
    const f = feed()
    if (f !== cachedOverridesFor) {
        cachedOverridesFor = f
        cachedOverrides = customOverrideMap(f)
    }
    return cachedOverrides
}

/** name -> display label, for the Theme pickers. */
export const customThemeLabels: Accessor<Readonly<Record<string, string>>> = () =>
    Object.fromEntries(feed().themes.map(t => [t.name, t.label]))

/** Replace the feed. The test/story seam, and what the live sync calls on a good fetch. */
export function setCustomThemesFeed(next: ThemesFeed): void {
    setFeed(next)
    setLoaded(true)
}

/** Fetch the feed; true on success. A failed fetch keeps the last good feed. */
async function refresh(): Promise<boolean> {
    try {
        setFeed(await api.themes())
        return true
    } catch {
        // keep the last good feed — a failed fetch must never un-theme the app
        return false
    }
}

/** Boot fetch: on failure retry at 1s, 2s, 4s, then stop (the next change event still refreshes). */
export async function bootRefresh(
    wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
    fetchFeed: () => Promise<boolean> = refresh,
): Promise<void> {
    try {
        if (await fetchFeed()) return
        for (const ms of [1000, 2000, 4000]) {
            await wait(ms)
            if (await fetchFeed()) return
        }
    } finally {
        setLoaded(true)
    }
}

/** Does a change event warrant a theme refetch? An empty `paths` is the /version poll fallback,
 *  which means "something changed, no detail" — so yes. */
export function changeTouchesThemes(paths: readonly string[]): boolean {
    return paths.length === 0 || paths.some(isThemePath)
}

if (typeof window !== 'undefined') {
    // Dynamic import so pure `bun test` runs never load serverVersion.ts (EventSource at module scope).
    if (!introMode)
        void import('./serverVersion').then(({ lastChange }) => {
            createRoot(() => {
                void bootRefresh()
                createEffect(() => {
                    const change = lastChange()
                    if (change.version <= 0) return
                    if (changeTouchesThemes(change.paths)) void refresh()
                })
            })
        })
}
