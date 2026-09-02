// bench/playCheck.ts — actually RUN every story's play() function and grade what happened.
//
// WHY THIS EXISTS. bench/storyAudit.ts screenshots stories and flags geometry; its own header says
// so plainly — "the signals are LEADS... it does not judge design" — and it never touches a play()
// function at all. There is no Storybook test runner in this repo (`grep -rn "test-runner"
// package.json app/package.json app/.storybook/` returns nothing). So before this tool existed,
// every `play()` assertion in every story in this codebase was executed by NOTHING: a story whose
// play() would throw looked identical, in every existing gate, to one whose play() passed. Stories
// render; nobody ever checked what their own assertions said. Several tasks in this repo's plans
// name a play-function assertion as their proof of a fix — this is what makes that proof real.
//
// THE SEAM, AND THE TRAP ALREADY PAID FOR. Storybook's preview exposes its addons channel at
// `window.__STORYBOOK_ADDONS_CHANNEL__`, reachable even when `iframe.html` is loaded standalone
// (no manager window watching) — confirmed empirically against Storybook 9.1.20. That channel emits
// lifecycle events, and TWO of them look like a pass/fail signal but are not:
//   * `StoryRender.phase` (surfaced via the `storyRenderPhaseChanged` event) ends at `"finished"`
//     whether play() passed OR threw. Never read it for pass/fail.
//   * `storyFinished`'s own `status` field ALSO lies: measured live, a story whose play() threw a
//     genuine AssertionError still emitted `storyFinished` with `status: "success"`, because the
//     thrown error is caught by Storybook's own internal try/catch around the play() call and never
//     reaches the window `error`/`unhandledrejection` listeners that `status` is actually keyed on.
// The one reliable FAIL signal is the `playFunctionThrewException` event itself, which carries the
// real `{name, message, stack}`. The one reliable "play() actually ran" signal is whether
// `storyRenderPhaseChanged` ever reports `newPhase: "playing"` — a story with no play function never
// enters that phase at all. `storyThrewException` (a render/mount failure, before play() is ever
// reached) is a separate, distinct outcome from a play() failure. `storyFinished` remains useful as
// the "the render lifecycle is done, stop waiting" signal — just not for grading it.
//
// THE FIVE OUTCOMES, never collapsed into each other:
//   SKIP   — rendered, no play function                    → phase never reaches "playing"
//   PASS   — rendered, play ran, nothing threw,             → reaches "playing" then "played",
//            tab was visible the whole time                   document.visibilityState never "hidden"
//   FAIL   — play() threw (an assertion failed)             → "playFunctionThrewException" fires
//   ERROR  — story never rendered at all (broken import,    → "storyThrewException" fires, OR the
//            a component that throws on mount, or a hang)     story never reaches "storyFinished"
//                                                                before --timeout (a genuine hang)
//   UNSAFE — play() ran and nothing threw, but the tab      → would otherwise classify PASS, but
//            was "hidden" at some point during the run —      window.__playcheck.hiddenSeen was set
//            Chrome fires no requestAnimationFrame in a
//            hidden tab, so a canvas/rAF-gated paint may
//            have been measured blank even though the
//            assertions reading it happened not to notice
// SKIP must never be counted as PASS, and neither must UNSAFE — that distinction (checked-and-correct
// vs nothing-checked-it, vs checked-but-the-checking-itself-was-unreliable) is this whole tool's
// reason to exist. UNSAFE should never actually fire (see bench/chromeSession.ts's `newPage()`); it
// exists so a regression in that mechanism is loud instead of a silent false PASS.
//
// WHAT THIS DOES NOT DO. It does not look at a single pixel — storyAudit.ts remains the tool for
// "is this visibly broken". A story can PASS here and still look wrong to a human eye; a story with
// no play function is not "broken", it simply has nothing here to grade (that is what SKIP means).
//
// MOTION IS DELIBERATELY NOT FORCED OFF HERE, unlike the four style-reading tools (see
// chromeSession.ts's flag-ownership comment) that launch with `--force-prefers-reduced-motion`.
// This tool runs INTERACTION assertions, so it needs real transitions to be faithful to what a
// user actually sees. If a story here is FAILing on a value read right after a class flip on a
// transitioning property (e.g. reading a width mid-animation instead of at rest), that is not a
// bug in this tool — add a wait for the transition to settle before asserting. Don't "fix" it by
// adding the flag; that would hide the exact class of bug this tool exists to catch.
//
// Usage:
//   bun bench/playCheck.ts                                    # every story
//   bun bench/playCheck.ts --story editor-editor               # a prefix (matches storyAudit.ts)
//   bun bench/playCheck.ts --story editor-editor--mixed-typography --base http://localhost:6017
//   bun bench/playCheck.ts --json
import { launchChrome } from './chromeSession'
import { poolSize } from './poolSize'

const arg = (n: string, d = '') => {
    const i = process.argv.indexOf(`--${n}`)
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
        ? process.argv[i + 1]!
        : d
}
const has = (n: string) => process.argv.includes(`--${n}`)

const BASE = arg('base', 'http://localhost:6006')
const ONLY = arg('story')
const W = Number(arg('width', '1280'))
const H = Number(arg('height', '900'))
// A play() function can legitimately await real time (Editor.stories.tsx's Callout story waits
// ~370ms across two dispatched events) — generous, but finite, so a genuine hang is still reported
// rather than wedging the run forever.
const TIMEOUT = Number(arg('timeout', '10000'))
/* DERIVED, not the hardcoded 6 this used to carry — see bench/poolSize.ts. The reasoning above is
   preserved and is why the ceiling stays modest (8, not the core count): a CPU-starved story mounts
   late, and a late mount is what produced mid-mount captures in the snapshot gate. What the constant
   got wrong was the OTHER direction — it ran 6 on a 4-core machine, which is the thrash this comment
   was trying to avoid, and 6 on a 16-core machine, which left most of the box idle. */
const CONCURRENCY = Number(arg('concurrency', String(poolSize(8))))
// Recycle a tab's target after this many navigations. bench/invariants.ts already paid for this
// lesson: one page driven through hundreds of story loads accumulates renderer memory until Chrome
// stops answering CDP at all. Same fix here.
const RECYCLE_EVERY = Number(arg('recycle', '40'))

type Outcome = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR' | 'UNSAFE'
type Result = { id: string; outcome: Outcome; detail?: string }

/** Runs in the page BEFORE any of the page's own scripts, via Page.addScriptToEvaluateOnNewDocument
 *  — subscribing after navigation is too late, since a fast-mounting story's play() can finish
 *  before a post-navigation Runtime.evaluate would ever get to attach a listener. Polls for the
 *  channel (it does not exist at the very first tick) and hooks the five events that between them
 *  cover all four outcomes above. Re-runs fresh on every navigation, so no reset logic is needed
 *  between stories.
 *
 *  Also samples `document.visibilityState` on an interval for the page's whole lifetime — this is
 *  the UNSAFE guard's data feed (see classify()). bench/chromeSession.ts's `newPage()` now forces
 *  every concurrent target to report "visible" (`Emulation.setFocusEmulationEnabled`), so this
 *  should never actually fire; it exists so a regression in that mechanism (a Chrome update, a
 *  future refactor that drops the call) produces a loud, distinctly-labelled outcome instead of a
 *  silent PASS on a story that measured nothing. A `visibilitychange` listener alone would miss it:
 *  the CDP override changes what the property returns without ever firing that event, so this polls
 *  instead. */
const INJECT = `(function () {
    window.__playcheck = { events: [], done: false, hooked: false, hiddenSeen: document.visibilityState === 'hidden' };
    setInterval(function () {
        if (document.visibilityState === 'hidden') window.__playcheck.hiddenSeen = true;
    }, 50);
    ;(function poll() {
        var ch = window.__STORYBOOK_ADDONS_CHANNEL__;
        if (ch && !window.__playcheck.hooked) {
            window.__playcheck.hooked = true;
            var names = ['storyRenderPhaseChanged', 'playFunctionThrewException', 'storyThrewException', 'storyErrored', 'storyFinished'];
            names.forEach(function (n) {
                ch.on(n, function () {
                    var a = Array.prototype.slice.call(arguments);
                    window.__playcheck.events.push({ n: n, a: a });
                    if (n === 'storyFinished') window.__playcheck.done = true;
                });
            });
        } else if (!window.__playcheck.hooked) {
            setTimeout(poll, 10);
        }
    })();
})();`

/** Classifies ONE story's captured events (+ whether the tab was ever caught `hidden` while this
 *  story ran) into an outcome. Order matters: a FAIL is checked before an ERROR-shaped signal
 *  because playFunctionThrewException is the more specific, more useful one when both could
 *  theoretically be present.
 *
 *  THE UNSAFE GUARD. `hiddenSeen` overrides ONLY a would-be PASS. A story whose play() actually
 *  threw or never rendered is already flagged as not-fine by FAIL/ERROR — downgrading a PASS to
 *  UNSAFE is the one case that matters, because PASS is the one outcome this tool lets a reader
 *  trust without reading the detail: a canvas story that silently measured a blank surface (Chrome
 *  fires no requestAnimationFrame in a hidden tab) must never report the same outcome as a story
 *  that genuinely rendered and was genuinely checked. See bench/chromeSession.ts's `newPage()` for
 *  why this should never actually trigger under normal operation. */
function classify(
    events: { n: string; a: any[] }[],
    hiddenSeen: boolean,
): Result['outcome'] | { outcome: 'FAIL' | 'ERROR' | 'UNSAFE'; detail: string } {
    const threwPlay = events.find(e => e.n === 'playFunctionThrewException')
    if (threwPlay) {
        const err = threwPlay.a[0] ?? {}
        return { outcome: 'FAIL', detail: `${err.name ?? 'Error'}: ${err.message ?? JSON.stringify(err)}` }
    }
    const threwStory = events.find(e => e.n === 'storyThrewException' || e.n === 'storyErrored')
    if (threwStory) {
        const err = threwStory.a[0] ?? {}
        const detail = err.message ?? err.description ?? JSON.stringify(err)
        return { outcome: 'ERROR', detail: `${err.name ?? err.title ?? 'Error'}: ${detail}` }
    }
    const played = events.some(e => e.n === 'storyRenderPhaseChanged' && e.a[0]?.newPhase === 'playing')
    if (!played) return 'SKIP'
    if (hiddenSeen) {
        return {
            outcome: 'UNSAFE',
            detail: 'document.visibilityState was "hidden" at some point while this story ran — Chrome fires no requestAnimationFrame in a hidden tab, so any canvas/rAF-gated paint this play() measured may have been blank. play() itself did not throw, but the focus-emulation fix in chromeSession.ts that should prevent this did not hold for this tab; investigate there before trusting this result.',
        }
    }
    return 'PASS'
}

const index = await (await fetch(`${BASE}/index.json`)).json()
const matches = (id: string) => !ONLY || id === ONLY || id.startsWith(ONLY)
const ids = Object.values(index.entries as Record<string, any>)
    .filter((e: any) => e.type === 'story' && matches(e.id))
    .map((e: any) => e.id as string)
    .sort()
if (!ids.length) throw new Error(`no stories matched (--story ${ONLY})`)

const session = await launchChrome({ label: 'playcheck', width: W, height: H })
const { newPage } = session
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const preparePage = async () => {
    const p = await newPage()
    await p('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
    await p('Page.addScriptToEvaluateOnNewDocument', { source: INJECT })
    return p
}

const results: Result[] = []
let next = 0
let done = 0
const t0 = Date.now()

const runOne = async (p: Awaited<ReturnType<typeof preparePage>>, id: string): Promise<Result> => {
    await p('Page.navigate', { url: `${BASE}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story` })
    const deadline = Date.now() + TIMEOUT
    for (;;) {
        const r: any = await p('Runtime.evaluate', {
            expression: `window.__playcheck && window.__playcheck.done`,
            returnByValue: true,
        })
        if (r.result?.value === true) break
        if (Date.now() > deadline) {
            return { id, outcome: 'ERROR', detail: `timed out waiting for the story to finish (${TIMEOUT}ms) — never saw storyFinished` }
        }
        await sleep(200)
    }
    const r: any = await p('Runtime.evaluate', {
        expression: `JSON.stringify({ events: window.__playcheck.events, hiddenSeen: window.__playcheck.hiddenSeen })`,
        returnByValue: true,
    })
    if (r.exceptionDetails) {
        return { id, outcome: 'ERROR', detail: `probe threw reading events: ${r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails)}` }
    }
    const { events, hiddenSeen } = JSON.parse(r.result?.value ?? '{"events":[],"hiddenSeen":false}')
    const c = classify(events, hiddenSeen)
    return typeof c === 'string' ? { id, outcome: c } : { id, outcome: c.outcome, detail: c.detail }
}

const pool = await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, ids.length)) }, preparePage))

const worker = async (initial: Awaited<ReturnType<typeof preparePage>>) => {
    let p = initial
    let handled = 0
    for (;;) {
        const i = next++
        if (i >= ids.length) return
        const id = ids[i]!
        if (handled >= RECYCLE_EVERY) {
            try { p = await preparePage(); handled = 0 } catch { /* keep the old page */ }
        }
        handled++
        try {
            results.push(await runOne(p, id))
        } catch (e) {
            results.push({ id, outcome: 'ERROR', detail: `navigation/probe failed: ${String(e).slice(0, 120)}` })
        }
        done++
        const rate = (Date.now() - t0) / done
        const left = Math.round((rate * (ids.length - done)) / 1000)
        process.stderr.write(`\r[${done}/${ids.length}] ~${left}s left  ${id.slice(0, 44).padEnd(46)}`)
    }
}
await Promise.all(pool.map(worker))
process.stderr.write('\n')
session.close()

const pass = results.filter(r => r.outcome === 'PASS')
const fail = results.filter(r => r.outcome === 'FAIL')
const skip = results.filter(r => r.outcome === 'SKIP')
const error = results.filter(r => r.outcome === 'ERROR')
const unsafe = results.filter(r => r.outcome === 'UNSAFE')

// A story's own thrown message can be enormous — a failed testing-library query embeds a full
// pretty-printed DOM tree in its .message, which turned one 17-failure run into ~3,700 lines of
// terminal output. The full message is still there in --json; the console summary shows only its
// first line, capped, so a human (or the next task's agent) can actually read the list of what
// broke instead of scrolling past a DOM dump per entry.
const oneLine = (s: string | undefined, max = 200) => {
    const first = (s ?? '').split('\n')[0] ?? ''
    return first.length > max ? first.slice(0, max) + '…' : first
}

if (has('json')) {
    console.log(
        JSON.stringify(
            { results, counts: { pass: pass.length, fail: fail.length, skip: skip.length, error: error.length, unsafe: unsafe.length } },
            null,
            1,
        ),
    )
} else {
    if (fail.length) {
        console.log(`\nFAIL — ${fail.length}`)
        for (const r of fail) console.log(`  ${r.id}\n    ${oneLine(r.detail)}`)
    }
    if (error.length) {
        console.log(`\nERROR — ${error.length}`)
        for (const r of error) console.log(`  ${r.id}\n    ${oneLine(r.detail)}`)
    }
    if (unsafe.length) {
        console.log(`\nUNSAFE — ${unsafe.length} (play() ran while the tab was hidden — this is NOT a pass, see --json for why)`)
        for (const r of unsafe) console.log(`  ${r.id}`)
    }
    if (skip.length) {
        console.log(`\nSKIP — ${skip.length} (no play function — nothing was asserted, this is NOT a pass)`)
        if (skip.length <= 20) for (const r of skip) console.log(`  ${r.id}`)
    }
    console.log(
        `\nPASS=${pass.length}  FAIL=${fail.length}  SKIP=${skip.length}  ERROR=${error.length}  UNSAFE=${unsafe.length}  (${ids.length} stories checked)`,
    )
    if (fail.length || error.length || unsafe.length) console.log(`(full messages: --json)`)
}
process.exit(fail.length || error.length || unsafe.length ? 1 : 0)
