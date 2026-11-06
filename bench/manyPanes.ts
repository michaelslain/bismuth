/**
 * bench/manyPanes.ts — what a tab with many panes costs: notes, chats, previews and a base side by side.
 *
 *   bun run bench/manyPanes.ts --base <vite url> --api <core url> [--layout mix|notes|chats|previews]
 *       [--panes 8] [--seconds 15] [--profile <dir>]
 *
 * Seeds two pinned tabs (a cold launch restores only pinned tabs) through localStorage — tab A holds `--panes` panes of the chosen layout split into a
 * grid, tab B one note — in its own headless Chrome, then prints one JSON object:
 *   { switchInMs, switchOutMs, idleBusyMsPerSec, keystrokeMs, dragMoveMs, heapMB, domNodes,
 *     requestsPerMin }
 *
 * `--base` and `--api` are REQUIRED and never default: a defaulted base would silently measure
 * somebody else's server.
 *
 * Definitions:
 *  - switchInMs: tab B → tab A, from the click on A's rail row to every pane of A painted
 *    (`[data-pane-leaf]` count reached and two frames later), median of 5.
 *  - switchOutMs: tab A → tab B, same clock, median of 5.
 *  - idleBusyMsPerSec: CDP TaskDuration delta over `--seconds` of idle on tab A / wall seconds.
 *  - keystrokeMs: main-thread ms per typed character in the first note of tab A (TaskDuration delta
 *    over 60 characters, one per frame, / 60).
 *  - dragMoveMs: main-thread ms per pointer move while dragging tab A's root split divider, over 60
 *    moves, one per frame.
 *  - heapMB / domNodes: after the idle window, following a forced GC.
 *  - requestsPerMin: page-initiated requests during the idle window, by path, scaled to one minute.
 *  - --css <rules>: injected into every page before the app boots, to A/B a CSS change.
 *  - --profile <dir>: writes a .cpuprofile for the switch-in, typing and drag phases.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arg } from './args'
import { firstLeafId, paneGrid } from './paneGrid'

const BASE = arg('base')
const API = arg('api')
const LAYOUT = arg('layout', 'mix')
const PANES = Number(arg('panes', '8'))
const SECONDS = Number(arg('seconds', '15'))
const PROFILE = arg('profile', '')
/** Extra CSS injected at document start, for A/B-ing a layout change without an edit. */
const CSS = arg('css', '')
if (!BASE || !API) {
    console.error(
        'manyPanes: --base and --api are required\n' +
            'usage: bun run bench/manyPanes.ts --base <vite url> --api <core url> [--layout mix|notes|chats|previews] [--panes 8] [--seconds 15] [--profile <dir>]',
    )
    process.exit(2)
}

const POOLS: Record<string, string[]> = {
    notes: [
        'Welcome.md',
        'Knowledge Graph.md',
        'Tasks.md',
        'Spaced Repetition.md',
        'reading/Godel Escher Bach.md',
        'reading/The Book of Disquiet.md',
        'projects/Rewrite the parser.md',
        'projects/Plant the balcony.md',
    ],
    chats: Array.from({ length: 8 }, (_, i) => `::chat:bench-${i}`),
    previews: [
        'files/paper.pdf',
        'files/logo.png',
        'files/paper.pdf',
        'files/logo.png',
        'files/paper.pdf',
        'files/logo.png',
        'files/paper.pdf',
        'files/logo.png',
    ],
    mix: [
        'Welcome.md',
        '::chat:bench-0',
        'files/paper.pdf',
        'Knowledge Graph.md',
        '::chat:bench-1',
        'files/logo.png',
        'Tasks.md',
        'reading/Reading Table.md',
    ],
}
if (!(LAYOUT in POOLS) || !(PANES >= 1 && PANES <= 8)) {
    console.error(`manyPanes: --layout must be one of ${Object.keys(POOLS).join(', ')} and --panes 1 to 8`)
    process.exit(2)
}
const contents = POOLS[LAYOUT].slice(0, PANES)

const rootA = paneGrid(contents)
const layout = JSON.stringify({
    tabs: [
        { id: 'tA', root: rootA, focusId: firstLeafId(rootA), pinned: true, name: 'many' },
        { id: 'tB', root: { kind: 'leaf', id: 'lb', content: 'daily/2026-08-19.md' }, focusId: 'lb', pinned: true, name: 'one' },
    ],
    activeTabId: 'tA',
})

const { launchChrome } = await import('./chromeSession')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const median = (a: number[]) => +[...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(1)

const s = await launchChrome({ label: 'manypanes', width: 1600, height: 1000 })
const { page, ws } = s
let code = 0
try {
    await page('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
    await page('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 })
    await page('Performance.enable', { timeDomain: 'timeTicks' })
    await page('Profiler.enable')
    await page('HeapProfiler.enable')
    await page('Page.addScriptToEvaluateOnNewDocument', {
        source: `try { if (!sessionStorage.getItem('bench-seeded')) { localStorage.setItem('bismuth-tabs-v1', ${JSON.stringify(layout)}); sessionStorage.setItem('bench-seeded', '1') } } catch {}`,
    })
    if (CSS) {
        await page('Page.addScriptToEvaluateOnNewDocument', {
            source: `document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = ${JSON.stringify(CSS)}; document.head.append(st) })`,
        })
    }
    await page('Runtime.enable')

    const reqs: { path: string; at: number }[] = []
    ws.addEventListener('message', (ev: MessageEvent) => {
        const m = JSON.parse(String(ev.data))
        if (m.method === 'Network.requestWillBeSent') {
            try {
                reqs.push({ path: new URL(m.params.request.url).pathname, at: Date.now() })
            } catch {}
        }
    })

    const evalJs = async (expression: string, timeout = 100000) => {
        const r = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout })
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400))
        return r.result?.value
    }
    const taskSeconds = async () =>
        ((await page('Performance.getMetrics')).metrics as { name: string; value: number }[]).find(
            m => m.name === 'TaskDuration',
        )!.value
    const profiled = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        if (!PROFILE) return fn()
        await page('Profiler.setSamplingInterval', { interval: 100 })
        await page('Profiler.start')
        const out = await fn()
        const { profile } = await page('Profiler.stop')
        mkdirSync(PROFILE, { recursive: true })
        writeFileSync(join(PROFILE, `${LAYOUT}-${name}.cpuprofile`), JSON.stringify(profile))
        return out
    }

    /** Every pane of the active tab mounted and settled: the leaf count matches and no pane is
     *  is still a bare Suspense placeholder (fewer than six elements); then two frames. */
    const settled = (count: number) => `(async () => {
        const raf = () => new Promise(r => requestAnimationFrame(r))
        const deadline = performance.now() + 30000
        while (performance.now() < deadline) {
            const leaves = document.querySelectorAll('[data-pane-leaf]')
            if (leaves.length === ${count} && [...leaves].every(l => l.getElementsByTagName('*').length >= 6)) break
            await raf()
        }
        await raf(); await raf()
        return performance.now()
    })()`

    const url = `${BASE!.replace(/\/$/, '')}/?api=${encodeURIComponent(API!)}`
    await page('Page.navigate', { url })
    await evalJs(settled(contents.length))
    await sleep(3000) // first-load chunk fetches, PDF first paint, graph boot

    /** Click a tab rail row: both seeded tabs are pinned, so `many` is the first row, `one` the second. */
    const clickTab = async (label: string) => {
        const pt = await evalJs(`(() => {
            const chip = document.querySelectorAll('[data-tab-chip]')[${JSON.stringify(label)} === 'many' ? 0 : 1]
            if (!chip) return null
            const r = chip.getBoundingClientRect()
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        })()`)
        if (!pt) throw new Error(`no tab rail row labelled ${label}`)
        await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
        await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
    }
    const timedSwitch = async (label: string, count: number) => {
        const t0 = await evalJs('performance.now()')
        await clickTab(label)
        const t1 = await evalJs(settled(count))
        return t1 - t0
    }

    // warm both directions once so lazy chunks are loaded
    await timedSwitch('one', 1)
    await timedSwitch('many', contents.length)
    const ins: number[] = []
    const outs: number[] = []
    for (let i = 0; i < 4; i++) {
        outs.push(await timedSwitch('one', 1))
        await sleep(300)
        ins.push(await timedSwitch('many', contents.length))
        await sleep(300)
    }
    await profiled('switch-in', async () => {
        await timedSwitch('one', 1)
        await sleep(300)
        ins.push(await timedSwitch('many', contents.length))
    })
    outs.push(await timedSwitch('one', 1))
    await sleep(300)
    await timedSwitch('many', contents.length)
    await sleep(1500)

    // idle
    const w0 = Date.now()
    const busy0 = await taskSeconds()
    await sleep(SECONDS * 1000)
    const busy1 = await taskSeconds()
    const wall = (Date.now() - w0) / 1000
    const idleReqs: Record<string, number> = {}
    for (const r of reqs.filter(r => r.at >= w0 && r.at <= w0 + wall * 1000)) {
        idleReqs[r.path] = (idleReqs[r.path] ?? 0) + 1
    }
    for (const k of Object.keys(idleReqs)) idleReqs[k] = +((idleReqs[k] / wall) * 60).toFixed(1)

    // typing in the first note editor
    let keystrokeMs: number | null = null
    const hasEditor = await evalJs(`(() => {
        const el = document.querySelector('[data-pane-leaf] .cm-content')
        if (!el) return false
        el.focus()
        const sel = window.getSelection(); sel.selectAllChildren(el); sel.collapseToEnd()
        return true
    })()`)
    if (hasEditor) {
        await profiled('typing', async () => {
            const k0 = await taskSeconds()
            for (let i = 0; i < 60; i++) {
                await page('Input.insertText', { text: i % 8 === 7 ? ' ' : 'x' })
                await evalJs('new Promise(r => requestAnimationFrame(() => r(0)))')
            }
            await evalJs('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))')
            keystrokeMs = +((((await taskSeconds()) - k0) * 1000) / 60).toFixed(2)
        })
        // undo what was typed so the vault stays as seeded
        for (let i = 0; i < 3; i++) {
            await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 })
            await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 })
        }
    }

    // dragging the root divider
    let dragMoveMs: number | null = null
    const div = await evalJs(`(() => {
        // the outermost split: an ancestor of the first leaf whose three children are child,
        // divider, child (the two children carry an inline flex-basis)
        let split = null
        for (let el = document.querySelector('[data-pane-leaf]'); el; el = el.parentElement) {
            const c = el.children
            if (c.length === 3 && c[0].style.flexBasis && c[2].style.flexBasis) split = el
        }
        if (!split) return null
        const d = split.children[1].getBoundingClientRect()
        return { x: d.left + d.width / 2, y: d.top + d.height / 2, w: split.getBoundingClientRect().width }
    })()`)
    if (div) {
        await profiled('drag', async () => {
            await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: div.x, y: div.y, button: 'left', clickCount: 1 })
            const d0 = await taskSeconds()
            for (let i = 0; i < 60; i++) {
                const dx = Math.sin(i / 6) * div.w * 0.15
                await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: div.x + dx, y: div.y, button: 'left', buttons: 1 })
                await evalJs('new Promise(r => requestAnimationFrame(() => r(0)))')
            }
            dragMoveMs = +((((await taskSeconds()) - d0) * 1000) / 60).toFixed(2)
            await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: div.x, y: div.y, button: 'left', clickCount: 1 })
        })
    }

    await page('HeapProfiler.collectGarbage')
    const heap = await evalJs('performance.memory ? performance.memory.usedJSHeapSize : 0')
    const domNodes = await evalJs('document.getElementsByTagName("*").length')

    console.log(
        JSON.stringify({
            layout: LAYOUT,
            panes: contents.length,
            switchInMs: median(ins),
            switchOutMs: median(outs),
            idleBusyMsPerSec: +(((busy1 - busy0) * 1000) / wall).toFixed(1),
            keystrokeMs,
            dragMoveMs,
            heapMB: +(heap / 1048576).toFixed(1),
            domNodes,
            requestsPerMin: idleReqs,
        }),
    )
} catch (e) {
    console.error(`manyPanes: ${(e as Error).message}`)
    code = 1
} finally {
    s.close()
}
process.exit(code)
