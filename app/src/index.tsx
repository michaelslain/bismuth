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
// The one proportional face in the app: CMU Serif (Computer Modern, Knuth's LaTeX face), for note
// prose and chat message bodies only — everything else stays on the Monaspace grid. Chosen
// 2026-08-29 from a 21-candidate comparison; Newsreader was the previous pick and is uninstalled.
// Local @font-face rather than the package's own stylesheet: `computer-modern` ships
// `font-style: roman`, which is not a valid CSS value. Browsers recover by ignoring the invalid
// descriptor and defaulting to `normal`, so it happens to work — but that is error recovery, not
// correctness, and its regular face is declared at weight 500 rather than 400. styles/cmu.css
// re-declares the same four faces with valid descriptors so nothing depends on that recovery.
import './styles/cmu.css'
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
