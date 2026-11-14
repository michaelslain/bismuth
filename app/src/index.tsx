/* @refresh reload */
import { render } from 'solid-js/web'
import { lazy } from 'solid-js'
// KaTeX CSS is now loaded lazily alongside the katex JS chunk (see editor/katexLoader.ts),
// so it no longer ships in the entry bundle.
import './fonts'
import { isTauri } from './platform'
import { createErrorReporter, installErrorReporter } from './errorReport'

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
// Uncaught errors and unhandled rejections go to core's error log (`bismuth errors`) and raise one
// toast each. Installed before anything else boots so a throw during boot is caught too; api and
// the toast store load on the first error, so the entry chunk stays small. First run has no backend.
if (!firstRun) {
    installErrorReporter(
        window,
        createErrorReporter({
            send: r => import('./api').then(({ api }) => api.reportAppError(r)),
            notify: text =>
                void import('./ui/toastStore').then(({ pushToast }) =>
                    pushToast(text, { tone: 'danger', ttl: 10_000 }),
                ),
        }),
    )
}

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

import { installExternalLinkGuard } from './externalLinks'
import { openExternalUrl } from './appWindow'

installExternalLinkGuard(url => void openExternalUrl(url))

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
