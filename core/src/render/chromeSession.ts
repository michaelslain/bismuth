// bench/chromeSession.ts — the one place that launches a headless Chrome and tears it down.
//
// WHY EVERY TOOL IN bench/ DRIVES ITS OWN CHROME, and why this is the most re-forgotten fact about
// this setup: a browser-automation tab that is not foregrounded reports `visibilityState: "hidden"`.
// Bismuth's GraphView gates its rAF loop on exactly that (`setVisible(props.visible !== false &&
// !docHidden())`), so in a background tab it never paints — the canvas samples 0% inked, which is
// indistinguishable from a broken renderer. Chrome also throttles timers and rAF in occluded windows
// on its own. The three --disable-*background* flags below give a live rAF loop with no foreground
// window, which is what makes any of this runnable unattended. Remove them and every canvas
// measurement in this directory silently becomes a measurement of nothing.
//
// WHY THIS FILE EXISTS. Three tools (cssBaseline, probeStory, visual) each grew their own copy of
// launch + port-poll + CDP-attach + teardown, and all three got the teardown wrong in three DIFFERENT
// ways: visual.ts created a profile dir and never deleted it at all; cssBaseline.ts deleted it but
// after a SIGTERM that leaves Chrome still writing, so rmSync lost the race, threw ENOTEMPTY, and a
// swallowing catch made it look clean — 20 profiles / 600 MB before anyone measured it, against ~2 MB
// leaked by the entire rest of the repo's suite; probeStory.ts shipped the same SIGTERM bug and had it
// caught mid-build. That is not three bugs, it is one missing abstraction, and the fourth tool would
// have got it wrong too.
//
// WHAT IT OWNS: the Chrome binary path, the flag set, the random port + poll-for-/json/version loop,
// the CDP WebSocket and its request/response plumbing, the browser- and page-scoped call helpers, and
// a teardown that runs on EVERY exit path.
//
// WHAT IT DELIBERATELY DOES NOT OWN — per-tool setup stays in the tool, because sharing it would
// change what a tool measures:
//   * `Emulation.setDeviceMetricsOverride` — visual.ts renders at deviceScaleFactor 2 for legible
//     screenshots; the two style-reading tools use 1. Baked in here, one of them would silently
//     change resolution.
//   * `Emulation.setTimezoneOverride` and the Date-freezing `Page.addScriptToEvaluateOnNewDocument` —
//     cssBaseline.ts's determinism requirements. visual.ts deliberately does NOT freeze the clock
//     (its readiness loop waits for animation to settle, which needs time to actually advance), so
//     forcing that on it would change its screenshots.
//   * `--force-prefers-reduced-motion` — passed by the four style-reading tools (probeStory.ts,
//     cssBaseline.ts x2, storyAudit.ts, iconFontProbe.ts), NOT by visual.ts, for the same reason.
//     It is a caller-supplied flag, never a default. It is also deliberately NOT passed by
//     playCheck.ts, which is the one tool this flag actually matters for: playCheck runs
//     INTERACTION assertions (play() functions), and forcing reduced motion there would make the
//     run less faithful to a real user AND hide the exact bug class it exists to catch — a story
//     reading a computed value immediately after a class flip on a transitioning property, which
//     reads green under a flag-passing tool and red under playCheck (`shell-tabrail--expanded`
//     sampled a transition's start value, 46px instead of 232px, in exactly this way).
//   * Anything about stories, baselines, ink probes, or output formats.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Deadline for a single CDP request. Generous — a heavy story's Runtime.evaluate is legitimately
 *  slow — but finite, so a dead socket surfaces as an error naming the method instead of a silent
 *  wedge. Override per call site if a tool genuinely needs longer. */
export const CALL_TIMEOUT_MS = Number(
    process.env.BISMUTH_CDP_TIMEOUT_MS ?? 90_000,
)

export const CHROME =
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** A CDP call. Resolves with `result`, rejects if the protocol returned an `error` — callers rely on
 *  being able to catch that (cssBaseline.ts catches a dead session to name the story it died on). */
export type Cdp = (
    method: string,
    params?: Record<string, unknown>,
) => Promise<any>

export type ChromeSession = {
    /** Browser-scoped CDP (no sessionId). */
    browser: Cdp
    /** Page-scoped CDP, attached to a blank target with Page + Runtime already enabled. */
    page: Cdp
    /** Open ANOTHER independent page in the same browser, with Page + Runtime enabled.
     *
     *  This is what makes a sweep parallel. One Chrome with N tabs costs far less than N Chromes
     *  (one profile, one socket, one process tree), and the work being parallelised is almost all
     *  waiting on page loads, so it overlaps well. Each returned Cdp carries its own sessionId, and
     *  the shared id counter already prevents cross-scope reply collisions.
     *
     *  CALLER BEWARE: events arrive on the SHARED socket. Anything listening for
     *  Network or Runtime events must filter on `sessionId` or it will attribute one page's
     *  events to another — the reason cssBaseline's network-quiescence gate cannot simply be reused
     *  across pages without being made per-session first. */
    newPage: () => Promise<Cdp>
    ws: WebSocket
    port: number
    profile: string
    /** Kill Chrome, close the socket, delete the profile. Idempotent, and already registered to run on
     *  process exit — call it explicitly only to release the browser early. */
    close: () => void
}

export type LaunchOptions = {
    /** Goes into the temp profile name as `bismuth-<label>-XXXX`, so a leak can be traced to its tool. */
    label: string
    width: number
    height: number
    /** Tool-specific Chrome flags, e.g. `--force-prefers-reduced-motion`. Never defaulted here. */
    flags?: string[]
    /** How to turn a CDP protocol error into an Error. Tools differ in their message format and those
     *  messages are user-facing output, so the format stays the caller's choice. */
    rpcError?: (method: string, error: { message?: string }) => Error
}

/**
 * Launch Chrome, wait for its debugger, attach a page session. Throws
 * `chrome debugger port never opened` if the debugger never comes up — with the profile already
 * cleaned up, so a caller is free to report that however it likes and exit.
 */
export async function launchChrome(
    opts: LaunchOptions,
): Promise<ChromeSession> {
    const { label, width, height, flags = [] } = opts
    const rpcError = opts.rpcError ?? ((_m, e) => new Error(JSON.stringify(e)))

    const port = 9600 + Math.floor(Math.random() * 300)
    const profile = mkdtempSync(join(tmpdir(), `bismuth-${label}-`))

    const chrome = spawn(
        CHROME,
        [
            '--headless=new',
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${profile}`,
            // See the header. Removing any of these three turns rAF-gated rendering into a blank canvas.
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            `--window-size=${width},${height}`,
            '--hide-scrollbars',
            ...flags,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            'about:blank',
        ],
        { stdio: 'ignore' },
    )

    let socket: WebSocket | null = null
    let closed = false
    // SIGKILL, not the default SIGTERM, and then RETRY the delete. A gracefully-terminating Chrome keeps
    // writing to its profile after SIGTERM, so an immediately-following rmSync loses the race and throws
    // ENOTEMPTY — which, swallowed, looks exactly like successful cleanup. This is the bug that leaked
    // 600 MB from cssBaseline.ts and three profiles out of seven runs from probeStory.ts.
    const close = () => {
        if (closed) return
        closed = true
        try {
            socket?.close()
        } catch {}
        try {
            chrome.kill('SIGKILL')
        } catch {}
        for (let i = 0; i < 6; i++) {
            try {
                rmSync(profile, { recursive: true, force: true })
                return
            } catch {}
            // Synchronous spin on purpose: this also runs inside an "exit" handler, where nothing async will
            // ever be awaited, so there is no version of this wait that can be a promise.
            const until = Date.now() + 60
            while (Date.now() < until) {
                /* wait for Chrome to release the profile */
            }
        }
    }
    // "exit" covers every path out — the clean run, an exit(1) on drift, an unhandled throw. The signal
    // handlers cover Ctrl-C, which previously leaked in all three tools.
    process.on('exit', close)
    for (const sig of ['SIGINT', 'SIGTERM'] as const)
        process.on(sig, () => process.exit(130))

    let wsUrl = ''
    for (let i = 0; i < 100 && !wsUrl; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/json/version`)
            if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl
        } catch {
            /* not up yet */
        }
        if (!wsUrl) await sleep(100)
    }
    if (!wsUrl) {
        close()
        throw new Error('chrome debugger port never opened')
    }

    const ws = new WebSocket(wsUrl)
    socket = ws
    await new Promise(r => ws.addEventListener('open', r, { once: true }))

    // ONE id counter for the whole socket, shared by every scope. Per-scope counters (what two of the
    // three tools had) both start at 1 on the same socket, so a browser-scoped and a page-scoped call in
    // flight together can collide on an id and resolve each other's promise. It never bit — the
    // browser scope is only used for the two attach calls — but it is a real defect and one counter
    // removes it. Ids are internal to the protocol, so nothing observable changes.
    let nextId = 0
    // `rej` takes the RAW protocol error and is formatted by the per-request closure below, because a CDP
    // error reply does not echo the method back and one tool's message format names it.
    const pending = new Map<
        number,
        { res: (v: any) => void; rej: (e: { message?: string }) => void }
    >()
    ws.addEventListener('message', e => {
        const m = JSON.parse(String(e.data))
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id)!
            pending.delete(m.id)
            m.error ? p.rej(m.error) : p.res(m.result)
        }
    })
    // EVERY CALL HAS A DEADLINE. Without one, a CDP request whose reply never arrives leaves its
    // promise pending forever and the whole tool hangs at 0% CPU with no output — indistinguishable
    // from "still working" to anyone watching, including a human. That is not hypothetical: closing
    // the laptop lid suspends Chrome, the debugger socket dies without a close frame, and a 404-story
    // sweep sat wedged at story 233 for an hour and a half before anyone noticed. A hang is the worst
    // failure mode an unattended tool can have, because it burns time while looking healthy; failing
    // loudly is strictly better.
    const scoped =
        (sessionId?: string): Cdp =>
        (method, params = {}) =>
            new Promise((res, rej) => {
                const id = ++nextId
                const timer = setTimeout(() => {
                    if (!pending.has(id)) return
                    pending.delete(id)
                    rej(
                        new Error(
                            `CDP timeout after ${CALL_TIMEOUT_MS}ms: ${method} (the browser stopped answering — it may have been suspended or crashed)`,
                        ),
                    )
                }, CALL_TIMEOUT_MS)
                const done = (fn: (v: any) => void) => (v: any) => {
                    clearTimeout(timer)
                    fn(v)
                }
                pending.set(id, {
                    res: done(res),
                    rej: done(raw => rej(rpcError(method, raw))),
                })
                ws.send(
                    JSON.stringify({
                        id,
                        method,
                        params,
                        ...(sessionId ? { sessionId } : {}),
                    }),
                )
            })

    const browser = scoped()
    const { targetId } = await browser('Target.createTarget', {
        url: 'about:blank',
    })
    const { sessionId } = await browser('Target.attachToTarget', {
        targetId,
        flatten: true,
    })
    const page = scoped(sessionId)
    await page('Page.enable')
    await page('Runtime.enable')

    const newPage = async (): Promise<Cdp> => {
        const t = await browser('Target.createTarget', { url: 'about:blank' })
        const a = await browser('Target.attachToTarget', {
            targetId: t.targetId,
            flatten: true,
        })
        const p = scoped(a.sessionId)
        await p('Page.enable')
        await p('Runtime.enable')
        // WITHOUT THIS, EVERY PAGE AFTER THE FIRST RENDERS NOTHING. Chrome treats additional targets
        // as background tabs and freezes them, so the document parses and #storybook-root exists but
        // the framework never paints into it: measured 0 elements at 1.5s, 3s and 6s, versus 34 with
        // this call. The launch flags that stop rAF throttling do not cover it, and neither does
        // Emulation.setFocusEmulationEnabled (tested: still 0).
        //
        // The trap is that it is INVISIBLE to the obvious check — `document.visibilityState` reports
        // "visible" and `document.hidden` is false the whole time. A tool that probed visibility to
        // decide whether the page was ready would conclude everything was fine and record an empty
        // render, which is precisely the mid-mount failure mode this repo has been bitten by.
        await p('Page.setWebLifecycleState', { state: 'active' }).catch(() => {})
        // ABOVE, NOT INSTEAD: `Page.setWebLifecycleState` unfreezes DOM mounting but leaves the
        // ANIMATION CLOCK stopped. Measured directly with playCheck's own 6-way concurrency and this
        // very call already in place: navigate 6 newPage() targets to the same canvas story and only
        // ONE reports `visibilityState: "visible"` — the other 5 report "hidden", and a
        // requestAnimationFrame loop started on those 5 ticks ZERO times in 500ms (vs ~31 on the
        // visible one, i.e. a normal ~60fps clock). Every canvas-painting component (InkOverlay,
        // GraphView, DrawingCanvas) gates its repaint on exactly that rAF, so a story on any of those
        // 5 tabs samples a permanently blank canvas — indistinguishable from a broken renderer, and
        // in InkOverlay's case it also latches `rafPending` so no later repaint fires either.
        // `Emulation.setFocusEmulationEnabled` fixes BOTH symptoms at once: same test, same 6 targets,
        // all 6 report "visible" and all 6 tick ~31 times. It costs nothing (no serialization, no
        // concurrency drop) and needs no per-tool opt-in, unlike the three considered alternatives:
        // running canvas stories serially via `Target.activateTarget` correctly fixes it but only for
        // the subset that needs it, at the cost of a second code path; dropping CONCURRENCY to 1 fixes
        // it for everything but makes a multi-minute sweep six times slower; the three
        // `--disable-*background*` launch flags above are already applied and do NOT help here — they
        // throttle background *windows*, and every target here lives in the same headless window, so
        // Chrome's per-TAB occlusion state (which is what drives visibilityState) is untouched by them.
        await p('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
        return p
    }

    return { browser, page, newPage, ws, port, profile, close }
}
