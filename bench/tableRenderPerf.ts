// bench/tableRenderPerf.ts — the Bases table's perf gate for the typed cell grid: how long a cold
// 2000-row x 8-column table takes to reach the DOM (and its first painted frame), and how smoothly
// its scroller scrolls.
//
//   render  median of 5 loads: ms from Page.navigate to the LAST row being in the DOM AND one
//           painted frame after it (a double rAF) — style/layout/paint of the whole table is
//           what a per-cell overlay costs, and a bare "row exists" check would not see any of it.
//   fps     frames per second over a 2s programmatic scroll of the table's scroller, sweeping
//           top to bottom and back (headless Chrome caps at 60).
//
// Drives its own Chrome through bench/chromeSession.ts (three --disable-*background* flags keep rAF
// running in a tab nobody is looking at). `--port` is REQUIRED: bench tools that default to :6006
// silently measure the main checkout's Storybook from a worktree.
//
//   bun bench/tableRenderPerf.ts --port 6312
//   -> tableRenderPerf render=<ms> fps=<n>
import { launchChrome } from './chromeSession'

const argv = process.argv.slice(2)
const portAt = argv.indexOf('--port')
const port = portAt >= 0 ? Number(argv[portAt + 1]) : NaN
if (!Number.isInteger(port) || port <= 0) {
    console.error('usage: bun bench/tableRenderPerf.ts --port <n>   (--port is required)')
    process.exit(2)
}

const ID = 'bases-tableview--large-table'
const BASE = `http://localhost:${port}`
const LOADS = 5
const SCROLL_MS = 2000
const W = 1280
const H = 900
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const index = await fetch(`${BASE}/index.json`)
    .then(r => r.json() as Promise<{ entries?: Record<string, unknown> }>)
    .catch(e => {
        console.error(`cannot read ${BASE}/index.json — is Storybook running on :${port}? ${e}`)
        process.exit(2)
    })
if (!index.entries?.[ID]) {
    console.error(`unknown story id: ${ID} (checked ${BASE}/index.json)`)
    process.exit(2)
}

const session = await launchChrome({ label: 'tableperf', width: W, height: H }).catch(e => {
    console.error((e as Error).message)
    process.exit(2)
})
const { page } = session
await page('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: false,
})

const url = `${BASE}/iframe.html?id=${ID}&viewMode=story`
const LAST_ROW = `document.querySelector('[data-testid="large-table-scroller"] tbody tr:last-child td')?.textContent?.includes('row 2000')`
// Resolves after the last row is in the DOM and one full frame has been produced after it.
const untilPainted = `new Promise(res => {
  const tick = () => {
    if (${LAST_ROW}) requestAnimationFrame(() => requestAnimationFrame(() => res(true)))
    else setTimeout(tick, 2)
  }
  tick()
})`

const ok = (r: any) => {
    if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
}

const renders: number[] = []
for (let i = 0; i < LOADS; i++) {
    // a blank page between loads, so every load is cold (no reused DOM or style cache)
    await page('Page.navigate', { url: 'about:blank' })
    await sleep(150)
    const t0 = performance.now()
    await page('Page.navigate', { url })
    let done = false
    for (let tries = 0; tries < 60 && !done; tries++) {
        try {
            ok(
                await page('Runtime.evaluate', {
                    expression: untilPainted,
                    awaitPromise: true,
                    returnByValue: true,
                }),
            )
            done = true
        } catch {
            await sleep(50) // the execution context was replaced by the navigation; retry
        }
    }
    if (!done) throw new Error('the table never reached its last row')
    renders.push(performance.now() - t0)
}
renders.sort((a, b) => a - b)
const render = Math.round(renders[Math.floor(LOADS / 2)]!)

// the last load is still open: let it settle, then scroll it
await sleep(500)
const fps = ok(
    await page('Runtime.evaluate', {
        expression: `new Promise(res => {
  const el = document.querySelector('[data-testid="large-table-scroller"]')
  const max = el.scrollHeight - el.clientHeight
  const start = performance.now()
  let frames = 0
  const step = now => {
    const t = (now - start) / ${SCROLL_MS}
    if (t >= 1) return res(Math.round((frames * 1000) / ${SCROLL_MS}))
    // top -> bottom -> top, so the sticky header and both directions are exercised
    el.scrollTop = max * (t < 0.5 ? t * 2 : (1 - t) * 2)
    frames++
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
})`,
        awaitPromise: true,
        returnByValue: true,
    }),
)

console.log(`tableRenderPerf render=${render} fps=${fps}`)
process.exit(0)
