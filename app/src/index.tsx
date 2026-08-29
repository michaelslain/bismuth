/* @refresh reload */
import { render } from 'solid-js/web'
import { lazy } from 'solid-js'
// KaTeX CSS is now loaded lazily alongside the katex JS chunk (see editor/katexLoader.ts),
// so it no longer ships in the entry bundle.
// One family does the whole interface: Monaspace, all five variants. Xenon is the
// canonical/default face; Neon/Argon/Krypton/Radon are user-selectable (see settings.ts
// FONT_STACKS) and metric-compatible, so switching never reflows the grid.
import '@fontsource/monaspace-xenon/400.css'
import '@fontsource/monaspace-xenon/500.css'
import '@fontsource/monaspace-xenon/700.css'
import '@fontsource/monaspace-neon/400.css'
import '@fontsource/monaspace-neon/500.css'
import '@fontsource/monaspace-neon/700.css'
import '@fontsource/monaspace-argon/400.css'
import '@fontsource/monaspace-argon/500.css'
import '@fontsource/monaspace-argon/700.css'
import '@fontsource/monaspace-krypton/400.css'
import '@fontsource/monaspace-krypton/500.css'
import '@fontsource/monaspace-krypton/700.css'
import '@fontsource/monaspace-radon/400.css'
import '@fontsource/monaspace-radon/500.css'
import '@fontsource/monaspace-radon/700.css'
// The one proportional serif in the app: Newsreader, for note prose and chat message bodies
// only (--prose-font in styles/tokens.css) — everything else stays on the Monaspace stack
// above. Self-hosted the same way as Monaspace (an @fontsource package, bundled offline by
// Vite, no runtime network fetch), not a Google Fonts <link> — this is a Tauri desktop app
// with no guaranteed network at runtime. `-variable` because Newsreader ships one variable
// file (weight axis 200-800) instead of eight static weights; `wght` + `wght-italic` cover
// upright and italic across the full weight range in two font-faces each (one per Unicode
// subset the package ships: latin, latin-ext, vietnamese) rather than the fixed per-weight
// files Monaspace uses, since Monaspace has no variable build on Fontsource.
// TRIAL (2026-08-29): Computer Modern, while the prose face is being chosen. Newsreader's imports
// stay below so switching back is a one-line --prose-font change with no reinstall.
import 'computer-modern/cmu-serif.css'
import '@fontsource-variable/newsreader/wght.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import { isTauri } from './nativeMenu'

// First-run takeover: when the bundled app launches with no vault yet, lib.rs injects
// `window.__BISMUTH_FIRST_RUN__` and does NOT start a backend — so we render the intro instead
// of App (which would fire API calls against a backend that isn't there). `?intro=1` forces
// it in dev/browser for previewing. The two branches are code-split so first-run never
// loads App, and a normal launch never loads the intro.
const firstRun =
    (isTauri() &&
        (window as unknown as { __BISMUTH_FIRST_RUN__?: boolean })
            .__BISMUTH_FIRST_RUN__ === true) ||
    new URLSearchParams(window.location.search).has('intro')

const Root = lazy(() =>
    firstRun ? import('./intro/VaultIntro') : import('./App'),
)

// serverVersion's SSE stream + fallback poll used to start as a module-load side effect, picked
// up transitively via App's import graph; that made the module impossible to import in a headless
// test (bun has no global EventSource, and a module-scope setInterval leaked a live timer into
// every later test). Now it's explicit: call start() once here, at real app boot. Dynamic import
// + the !firstRun gate preserve the original property that the intro takeover never loads
// serverVersion's chunk or talks to a backend that doesn't exist yet (see the comment above).
if (!firstRun) {
    import('./serverVersion')
        .then(({ start }) => start())
        .catch(e => {
            // A chunk-load failure here would silently disable ALL live updates (no SSE, no poll) —
            // exactly the outcome this whole refactor exists to avoid, and worse than leaving it an
            // unhandled rejection nobody sees in a packaged app's console. Surface it loudly instead.
            console.error(
                '[boot] failed to start serverVersion (SSE + poll) — live updates disabled',
                e,
            )
        })
}

render(() => <Root />, document.getElementById('root') as HTMLElement)

// First run renders the intro takeover instead of App, so App's boot-ready signal (which dismisses
// the index.html splash) never fires. The intro is its own full-screen themed takeover, so drop the
// splash shortly after it mounts. Normal launches let App dismiss it when its initial data lands.
if (firstRun) {
    setTimeout(
        () =>
            (
                window as unknown as { __bismuthBootReady?: () => void }
            ).__bismuthBootReady?.(),
        350,
    )
}
