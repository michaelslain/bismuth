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
// THE FOUR OUTCOMES, never collapsed into each other:
//   SKIP  — rendered, no play function                    → phase never reaches "playing"
//   PASS  — rendered, play ran, nothing threw              → reaches "playing" then "played"
//   FAIL  — play() threw (an assertion failed)             → "playFunctionThrewException" fires
//   ERROR — story never rendered at all (broken import,    → "storyThrewException" fires, OR the
//           a component that throws on mount, or a hang)     story never reaches "storyFinished"
//                                                              before --timeout (a genuine hang)
// SKIP must never be counted as PASS — that distinction (checked-and-correct vs nothing-checked-it)
// is this whole tool's reason to exist.
//
// WHAT THIS DOES NOT DO. It does not look at a single pixel — storyAudit.ts remains the tool for
// "is this visibly broken". A story can PASS here and still look wrong to a human eye; a story with
// no play function is not "broken", it simply has nothing here to grade (that is what SKIP means).
//
// Usage:
//   bun bench/playCheck.ts                                    # every story
//   bun bench/playCheck.ts --story editor-editor               # a prefix (matches storyAudit.ts)
//   bun bench/playCheck.ts --story editor-editor--mixed-typography --base http://localhost:6017
//   bun bench/playCheck.ts --json
import { launchChrome } from './chromeSession'

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
const CONCURRENCY = Number(arg('concurrency', '6'))
// Recycle a tab's target after this many navigations. bench/invariants.ts already paid for this
// lesson: one page driven through hundreds of story loads accumulates renderer memory until Chrome
// stops answering CDP at all. Same fix here.
const RECYCLE_EVERY = Number(arg('recycle', '40'))

type Outcome = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR'
type Result = { id: string; outcome: Outcome; detail?: string }

/** Runs in the page BEFORE any of the page's own scripts, via Page.addScriptToEvaluateOnNewDocument
 *  — subscribing after navigation is too late, since a fast-mounting story's play() can finish
 *  before a post-navigation Runtime.evaluate would ever get to attach a listener. Polls for the
 *  channel (it does not exist at the very first tick) and hooks the five events that between them
 *  cover all four outcomes above. Re-runs fresh on every navigation, so no reset logic is needed
 *  between stories. */
const INJECT = `(function () {
    window.__playcheck = { events: [], done: false, hooked: false };
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

/** Classifies ONE story's captured events into an outcome. Order matters: a FAIL is checked before
 *  an ERROR-shaped signal because playFunctionThrewException is the more specific, more useful one
 *  when both could theoretically be present. */
function classify(events: { n: string; a: any[] }[]): Result['outcome'] | { outcome: 'FAIL' | 'ERROR'; detail: string } {
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
    return played ? 'PASS' : 'SKIP'
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
        expression: `JSON.stringify(window.__playcheck.events)`,
        returnByValue: true,
    })
    if (r.exceptionDetails) {
        return { id, outcome: 'ERROR', detail: `probe threw reading events: ${r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails)}` }
    }
    const events = JSON.parse(r.result?.value ?? '[]')
    const c = classify(events)
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

if (has('json')) {
    console.log(JSON.stringify({ results, counts: { pass: pass.length, fail: fail.length, skip: skip.length, error: error.length } }, null, 1))
} else {
    if (fail.length) {
        console.log(`\nFAIL — ${fail.length}`)
        for (const r of fail) console.log(`  ${r.id}\n    ${r.detail}`)
    }
    if (error.length) {
        console.log(`\nERROR — ${error.length}`)
        for (const r of error) console.log(`  ${r.id}\n    ${r.detail}`)
    }
    if (skip.length) {
        console.log(`\nSKIP — ${skip.length} (no play function — nothing was asserted, this is NOT a pass)`)
        if (skip.length <= 20) for (const r of skip) console.log(`  ${r.id}`)
    }
    console.log(`\nPASS=${pass.length}  FAIL=${fail.length}  SKIP=${skip.length}  ERROR=${error.length}  (${ids.length} stories checked)`)
}
process.exit(fail.length || error.length ? 1 : 0)
