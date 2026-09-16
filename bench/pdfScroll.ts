// bench/pdfScroll.ts — Task 5's measurement tool for continuous PDF scrolling: does a page that is
// about to enter the scrollport already have a painted raster, or does the reader see it blank?
//
// WHY THIS EXISTS. "Scrolling is really not smooth" has no number attached until something samples
// frame timing AND per-frame paint state together — a slow frame alone isn't the complaint (a
// still page can render slowly with nobody noticing), and a blank page alone isn't either (one
// frame of blank while a scroll is still moving is invisible). What's reported is a blank page the
// reader's eye lands ON, which is exactly "a `.pdf-page` intersecting the scrollport whose canvas
// hasn't painted yet, sustained across consecutive frames".
//
// WHY IT DRIVES ITS OWN CHROME (via bench/chromeSession.ts, which re-exports core/src/render/chromeSession — one launcher, two import paths): a backgrounded
// automation tab reports `visibilityState: "hidden"`, and this repo has more than one rAF-gated
// renderer that goes fully dark under that condition. `chromeSession.ts`'s three `--disable-
// *background*` flags plus `newPage()`'s `Emulation.setFocusEmulationEnabled` are what keep the
// canvas raster loop actually running while nothing is on screen.
//
// WHY THE SCROLL IS DRIVEN THROUGH CDP `Input.dispatchMouseEvent`, NOT A SYNTHETIC DOM EVENT: the
// PDF page stack's own scroll container (`PdfPages.module.css`'s `.pdf-scroll`) is a plain
// `overflow: auto` div with no wheel handler of its own (Task 5 does not touch PreviewView.tsx,
// which is where the app's own wheel listener lives) — it scrolls only because a REAL, TRUSTED
// wheel event reaches it. `scroller.dispatchEvent(new WheelEvent(...))` is untrusted and the
// browser silently ignores it for native scrolling; CDP's Input domain generates a trusted event
// exactly the way a real trackpad would, which is what makes this tool measure the actual scroll
// path instead of a synthetic stand-in for it.
//
// HOW SAMPLING AND SCROLLING OVERLAP. The in-page rAF sampler and the wheel-dispatch loop below run
// CONCURRENTLY on the one CDP websocket: the sampler's `Runtime.evaluate` call is fired and NOT
// awaited until the end, so the socket is free to carry `Input.dispatchMouseEvent` calls for the
// full duration while the page-side rAF loop records its own frames independently. This is what
// lets both "drive input" and "record what painted" happen on their own clocks rather than
// serializing scroll steps behind each measurement.
//
// WHAT COUNTS AS BLANK. A `.pdf-page` box (found by the `data-pdf-page` attribute — never a class
// name, which a CSS-module migration hashes) that geometrically intersects the scrollport is
// checked for a `<canvas>` child. No canvas at all (unmounted — outside `visiblePageRange`) is
// blank. A canvas is sampled at 4 interior points (25%/75% of each axis); if every sampled pixel is
// fully transparent (never painted) OR all four are pixel-identical (the initial cleared state, or
// a stray blank fill), the page counts as blank. A real rendered page — this tool's `ManyPages`
// fixture gives every page a near-full-bleed coloured rect plus text — will disagree across those
// four points once painted, by construction.
//
// WHAT THIS DOES NOT PROVE.
//   * ONE STORY, ONE VIEWPORT, ONE SCROLL SHAPE. Two passes (continuous 120Δ, fast-fling 400Δ) at
//     one fixed viewport size. It says nothing about touch/trackpad momentum scrolling, a resize
//     mid-scroll, or a slower/faster machine than the one this ran on.
//   * NOT A SUBSTITUTE FOR THE GATE. `bun run verify` is what proves the stories still pass; this
//     tool has no baseline file and holds no history — "before" and "after" are two runs a human
//     (or the report this backs) diffs by eye.
//   * NOTHING ABOUT PreviewView.tsx. This measures PdfPages in isolation, deliberately — Task 5 is
//     scoped away from PreviewView's own wheel listener and `scrollTick` signal (Task 4's file).
//     If those turn out to matter, that shows up as a gap between this tool's numbers and what the
//     app itself feels like, not as something this tool can see.
//
//   cd app && BROWSER=none bun run storybook -- -p 6435 --no-open   # must already be running
//   bun bench/pdfScroll.ts                                          # defaults to ManyPages @ :6435
//   bun bench/pdfScroll.ts preview-pdfpages--many-pages --base http://localhost:6006
import { launchChrome } from './chromeSession'

const VALUE_FLAGS = new Set(['base', 'duration'])
const argv = process.argv.slice(2)
const opts = new Map<string, string>()
const positional: string[] = []
for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) {
        positional.push(a)
        continue
    }
    const name = a.slice(2)
    opts.set(name, VALUE_FLAGS.has(name) ? (argv[++i] ?? '') : '1')
}

const ID = positional[0] ?? 'preview-pdfpages--many-pages'
const BASE = opts.get('base') ?? 'http://localhost:6006'
const DURATION_MS = Number(opts.get('duration') ?? 3000)
const W = 1280,
    H = 900
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Acceptance targets (task-5-brief.md Step 2) — checked against PASS 1 (120Δ, the "continuous
// scroll" case the brief's numbers are stated for). PASS 2 (400Δ fling) is reported for
// before/after comparison but has no standalone target of its own.
const TARGET_LONGEST_BLANK_MS = 250
const TARGET_BLANK_SHARE = 0.1
const TARGET_MAX_FRAME_GAP_MS = 100

if (!positional[0] && !opts.has('base')) {
    // Not an error — just make the default explicit, since a wrong-port run silently measures
    // nothing (an unreachable Storybook fails loudly below either way).
    console.error(`(no story id given — defaulting to ${ID} @ ${BASE})`)
}

let index: { entries?: Record<string, unknown> }
try {
    const r = await fetch(`${BASE}/index.json`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    index = await r.json()
} catch (e) {
    console.error(
        `cannot read ${BASE}/index.json — is Storybook running on this port?\n  ${(e as Error).message}`,
    )
    process.exit(2)
}
if (!index.entries?.[ID]) {
    console.error(`unknown story id: ${ID} (checked ${BASE}/index.json)`)
    process.exit(2)
}

let session
try {
    session = await launchChrome({ label: 'pdfscroll', width: W, height: H })
} catch (e) {
    console.error((e as Error).message)
    process.exit(2)
}
const { page } = session
await page('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: false,
})

await page('Page.navigate', {
    url: `${BASE}/iframe.html?id=${encodeURIComponent(ID)}&viewMode=story`,
})

/** Runs in the page: waits for the fixture to be laid out and its first page painted. Returns the
 *  page count and the scroll element's viewport-relative rect so Node knows where to aim the
 *  wheel. */
const waitReady = () => `(async () => {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const pages = document.querySelectorAll('[data-pdf-page]')
    const canvas = document.querySelector('[data-pdf-page="0"] canvas')
    if (pages.length > 0 && canvas && canvas.width > 0) {
      const ctx = canvas.getContext('2d')
      const d = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
      if (d[3] > 0) {
        const scroller = document.querySelector('[data-pdf-page="0"]').parentElement.parentElement
        const r = scroller.getBoundingClientRect()
        return JSON.stringify({ ok: true, pageCount: pages.length, rect: { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom } })
      }
    }
    await new Promise(res => setTimeout(res, 100))
  }
  return JSON.stringify({ ok: false })
})()`

const readyRes = await page('Runtime.evaluate', {
    expression: waitReady(),
    returnByValue: true,
    awaitPromise: true,
})
if (readyRes.exceptionDetails) {
    console.error(
        `readiness probe threw: ${readyRes.exceptionDetails.text ?? JSON.stringify(readyRes.exceptionDetails)}`,
    )
    process.exit(2)
}
const ready = JSON.parse(String(readyRes.result?.value ?? '{}'))
if (!ready.ok) {
    console.error(
        `story never rendered a painted first page within 15s — is ${ID} the right story?`,
    )
    process.exit(2)
}
const { x, y } = ready.rect as { x: number; y: number }
console.log(`story: ${ID}  pages: ${ready.pageCount}  scroll target: (${Math.round(x)}, ${Math.round(y)})`)

/** In-page rAF sampler. Records `{ t, blank }` per frame for `durationMs`, `blank` = the page is
 *  showing at least one `.pdf-page` intersecting the scrollport with no canvas or a canvas that
 *  hasn't painted (see the file header's "what counts as blank"). Started as a fire-and-forget
 *  `Runtime.evaluate` (see the file header) so the caller can dispatch wheel input while it runs. */
const samplerScript = (durationMs: number) => `(() => {
  const scroller = document.querySelector('[data-pdf-page="0"]').parentElement.parentElement
  function isBlank(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return true
    const ctx = canvas.getContext('2d')
    const w = canvas.width, h = canvas.height
    const pts = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]
    const samples = pts.map(([fx, fy]) => {
      const px = Math.min(w - 1, Math.max(0, Math.round(fx * w)))
      const py = Math.min(h - 1, Math.max(0, Math.round(fy * h)))
      return ctx.getImageData(px, py, 1, 1).data
    })
    const allTransparent = samples.every(s => s[3] === 0)
    const first = samples[0]
    const allSame = samples.every(s => s[0] === first[0] && s[1] === first[1] && s[2] === first[2] && s[3] === first[3])
    return allTransparent || allSame
  }
  function anyBlankInScrollport() {
    const vTop = scroller.getBoundingClientRect().top
    const vBottom = scroller.getBoundingClientRect().bottom
    const pages = document.querySelectorAll('[data-pdf-page]')
    for (const p of pages) {
      const r = p.getBoundingClientRect()
      if (r.bottom < vTop || r.top > vBottom) continue
      if (isBlank(p.querySelector('canvas'))) return true
    }
    return false
  }
  return new Promise(resolve => {
    const frames = []
    const start = performance.now()
    function tick(t) {
      frames.push({ t, blank: anyBlankInScrollport() })
      if (t - start < ${durationMs}) requestAnimationFrame(tick)
      else resolve(JSON.stringify(frames))
    }
    requestAnimationFrame(tick)
  })
})()`

type Frame = { t: number; blank: boolean }

/** Dispatches trusted wheel input at `x,y` roughly every 16ms (~60Hz) for `durationMs`, alongside
 *  the sampler above (fired concurrently, not sequentially — see the file header). */
async function runPass(deltaY: number): Promise<Frame[]> {
    const samplerPromise = page('Runtime.evaluate', {
        expression: samplerScript(DURATION_MS),
        returnByValue: true,
        awaitPromise: true,
    })
    const start = Date.now()
    while (Date.now() - start < DURATION_MS) {
        await page('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x,
            y,
            deltaX: 0,
            deltaY,
            pointerType: 'mouse',
        })
        await sleep(16)
    }
    const res = await samplerPromise
    if (res.exceptionDetails) {
        console.error(
            `sampler threw: ${res.exceptionDetails.text ?? JSON.stringify(res.exceptionDetails)}`,
        )
        process.exit(2)
    }
    return JSON.parse(String(res.result?.value ?? '[]'))
}

async function resetScroll(): Promise<void> {
    await page('Runtime.evaluate', {
        expression: `(() => {
          const scroller = document.querySelector('[data-pdf-page="0"]').parentElement.parentElement
          scroller.scrollTop = 0
          scroller.dispatchEvent(new Event('scroll'))
        })()`,
    })
    await sleep(300)
}

type Stats = {
    totalFrames: number
    longestGapMs: number
    over32: number
    over100: number
    blankShare: number
    longestBlankStretchMs: number
}

function summarize(frames: Frame[]): Stats {
    let longestGapMs = 0
    let over32 = 0
    let over100 = 0
    for (let i = 1; i < frames.length; i++) {
        const gap = frames[i]!.t - frames[i - 1]!.t
        if (gap > longestGapMs) longestGapMs = gap
        if (gap > 32) over32++
        if (gap > 100) over100++
    }
    const blankCount = frames.filter(f => f.blank).length
    let longestBlankStretchMs = 0
    let runStart = -1
    for (let i = 0; i < frames.length; i++) {
        if (frames[i]!.blank) {
            if (runStart === -1) runStart = frames[i]!.t
            const dur = frames[i]!.t - runStart
            if (dur > longestBlankStretchMs) longestBlankStretchMs = dur
        } else {
            runStart = -1
        }
    }
    return {
        totalFrames: frames.length,
        longestGapMs,
        over32,
        over100,
        blankShare: frames.length ? blankCount / frames.length : 0,
        longestBlankStretchMs,
    }
}

function printStats(label: string, s: Stats): void {
    console.log(`\n${label}`)
    console.log(`  total frames:              ${s.totalFrames}`)
    console.log(`  longest frame gap:         ${s.longestGapMs.toFixed(1)} ms`)
    console.log(`  frames over 32ms:          ${s.over32}`)
    console.log(`  frames over 100ms:         ${s.over100}`)
    console.log(
        `  frames w/ blank page:      ${(s.blankShare * 100).toFixed(1)}%`,
    )
    console.log(
        `  longest blank stretch:     ${s.longestBlankStretchMs.toFixed(1)} ms`,
    )
}

await resetScroll()
const pass1 = summarize(await runPass(120))
printStats('PASS 1 — continuous scroll, deltaY 120 for 3s', pass1)

await resetScroll()
const pass2 = summarize(await runPass(400))
printStats('PASS 2 — fast fling, deltaY 400 for 3s', pass2)

session.close()

const pass1Ok =
    pass1.longestBlankStretchMs <= TARGET_LONGEST_BLANK_MS &&
    pass1.blankShare < TARGET_BLANK_SHARE &&
    pass1.longestGapMs <= TARGET_MAX_FRAME_GAP_MS
const pass2NoWorseGap = pass2.longestGapMs <= TARGET_MAX_FRAME_GAP_MS

console.log(
    `\nPASS 1 targets: longest blank stretch <= ${TARGET_LONGEST_BLANK_MS}ms (got ${pass1.longestBlankStretchMs.toFixed(1)}), ` +
        `blank share < ${(TARGET_BLANK_SHARE * 100).toFixed(0)}% (got ${(pass1.blankShare * 100).toFixed(1)}%), ` +
        `max frame gap <= ${TARGET_MAX_FRAME_GAP_MS}ms (got ${pass1.longestGapMs.toFixed(1)})`,
)
console.log(
    `PASS 2 frame-gap check: max frame gap <= ${TARGET_MAX_FRAME_GAP_MS}ms (got ${pass2.longestGapMs.toFixed(1)})`,
)
console.log(`\nRESULT: ${pass1Ok && pass2NoWorseGap ? 'PASS' : 'FAIL'}`)
process.exit(pass1Ok && pass2NoWorseGap ? 0 : 1)
