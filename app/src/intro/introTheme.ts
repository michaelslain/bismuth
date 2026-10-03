// app/src/intro/introTheme.ts
// The intro paints the chosen theme onto the whole takeover live. These helpers do that, and put
// :root back afterwards — the intro is a takeover that mounts and unmounts inside a running page
// (Storybook, replay), so a theme it paints must not outlive it.
import { DEFAULTS } from '../settings'
import { setCssVars, settingsToCssVars } from '../settingsCssVars'
import { THEME_NAMES, resolveAppearance, type ThemeName } from '../themes'

/** The full CSS-var map for a theme, exactly as the app would project it. */
export function introThemeVars(name: ThemeName): Record<string, string> {
    return settingsToCssVars({
        ...DEFAULTS,
        appearance: { ...DEFAULTS.appearance, theme: name },
    })
}

/** Paint `name` onto `root`: its CSS vars + the matching `color-scheme`. Not persisted — the
 *  caller commits a theme separately — so browsing the picker never pollutes the theme cache. */
export function applyIntroTheme(
    name: ThemeName,
    root: HTMLElement = document.documentElement,
): void {
    const vars = introThemeVars(name)
    if (root === document.documentElement) setCssVars(vars)
    else for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    root.style.colorScheme = resolveAppearance({ theme: name }).isLight
        ? 'light'
        : 'dark'
}

/** Every var any theme can make `applyIntroTheme` write. */
function writableVars(): string[] {
    const keys = new Set<string>()
    for (const n of THEME_NAMES) for (const k of Object.keys(introThemeVars(n))) keys.add(k)
    return [...keys]
}

/** Record `root`'s inline value for every var `applyIntroTheme` can write, plus `color-scheme`;
 *  the returned `restore()` puts each back — a var that had no inline value is removed, not
 *  blanked. */
export function snapshotRootTheme(
    root: HTMLElement = document.documentElement,
): () => void {
    const saved = writableVars().map(k => [k, root.style.getPropertyValue(k)] as const)
    const scheme = root.style.colorScheme
    return () => {
        for (const [k, v] of saved) {
            if (v === '') root.style.removeProperty(k)
            else root.style.setProperty(k, v)
        }
        root.style.colorScheme = scheme
    }
}
