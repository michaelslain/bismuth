/**
 * bench/paneLoad.ts — end-to-end cost of two panes side by side: a huge PDF and the daemon page.
 *
 *   bun run bench/paneLoad.ts --base <vite url> --api <core url> --pdf <vault-relative path> [--seconds 60]
 *
 * Opens the PDF and `::daemon` in a split tab in its own headless Chrome, waits for the PDF's first
 * painted page, then idles `--seconds` and prints one JSON object:
 *   { requestsPerMin: { snapshot, pages, graph, tree }, mainThreadBusyMsPerSec, pdfFirstPaintMs,
 *     pdfBytesTransferred, coreCpuPct }
 *
 * `--base` and `--api` are REQUIRED and never default: a defaulted base would silently measure
 * somebody else's server (bench tools elsewhere default to :6006, the main checkout's Storybook).
 *
 * Definitions:
 *  - requestsPerMin counts page-initiated requests to /daemon/snapshot, /daemon/pages, /graph, /tree
 *    inside the idle window only (first paint excluded), scaled to one minute.
 *  - mainThreadBusyMsPerSec = CDP Performance.getMetrics TaskDuration delta over the idle window,
 *    in ms, divided by the window's wall seconds.
 *  - pdfFirstPaintMs = navigation to the first PDF canvas with a non-transparent pixel.
 *  - pdfBytesTransferred = body bytes received for /asset requests over the whole run.
 *  - coreCpuPct = core process CPU time (ps cputime of the pid listening on the --api port) delta
 *    over the idle window / wall time, so 100 means one full core.
 */
import { arg } from './args'

const BASE = arg('base')
const API = arg('api')
const PDF = arg('pdf')
const SECONDS = Number(arg('seconds', '60'))
const missing = [!BASE && '--base', !API && '--api', !PDF && '--pdf'].filter(Boolean)
if (missing.length || !(SECONDS > 0)) {
    console.error(
        `paneLoad: ${missing.length ? `missing required flag ${missing.join(', ')}` : '--seconds must be a positive number'}\n` +
            'usage: bun run bench/paneLoad.ts --base <vite url> --api <core url> --pdf <vault-relative path> [--seconds 60]',
    )
    process.exit(2)
}

const { launchChrome } = await import('./chromeSession')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const sh = (cmd: string[]) => new TextDecoder().decode(Bun.spawnSync(cmd).stdout).trim()

/** The pid listening on the api port, via lsof. */
const apiPort = new URL(API).port || '80'
const corePid = Number(sh(['lsof', '-nP', `-iTCP:${apiPort}`, '-sTCP:LISTEN', '-t']).split('\n')[0])
if (!corePid) {
    console.error(`paneLoad: nothing is listening on port ${apiPort} (--api ${API})`)
    process.exit(2)
}
/** ps cputime ("m:ss.cc", "h:mm:ss.cc") in seconds. */
const cpuSeconds = () =>
    sh(['ps', '-o', 'cputime=', '-p', String(corePid)])
        .split(':')
        .reduce((a, p) => a * 60 + Number(p), 0)

const leaf = (id: string, content: string) => ({ kind: 'leaf', id, content })
const root = { kind: 'split', id: 's1', dir: 'row', ratio: 0.5, a: leaf('l1', PDF), b: leaf('l2', '::daemon') }
const layout = JSON.stringify({ tabs: [{ id: 't1', root, focusId: 'l1', pinned: true }], activeTabId: 't1' })

const s = await launchChrome({ label: 'paneload', width: 1600, height: 1000 })
const { page, ws } = s
let code = 0
try {
    await page('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
    await page('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 })
    await page('Performance.enable', { timeDomain: 'timeTicks' })
    await page('Page.addScriptToEvaluateOnNewDocument', {
        source: `try { localStorage.setItem('bismuth-tabs-v1', ${JSON.stringify(layout)}) } catch {}`,
    })
    await page('Runtime.enable')

    const reqs = new Map<string, { path: string; at: number; bytes: number }>()
    ws.addEventListener('message', (ev: MessageEvent) => {
        const m = JSON.parse(String(ev.data))
        if (m.method === 'Network.requestWillBeSent') {
            let path = ''
            try { path = new URL(m.params.request.url).pathname } catch {}
            reqs.set(m.params.requestId, { path, at: Date.now(), bytes: 0 })
        } else if (m.method === 'Network.dataReceived') {
            const r = reqs.get(m.params.requestId)
            if (r) r.bytes += m.params.dataLength
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

    const url = `${BASE.replace(/\/$/, '')}/?api=${encodeURIComponent(API)}`
    await page('Page.navigate', { url })
    const paint = await evalJs(`(async () => {
        const deadline = Date.now() + 90000
        while (Date.now() < deadline) {
            const c = document.querySelector('[data-pdf-page="0"] canvas')
            if (c && c.width > 0) {
                const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 3), 1, 1).data
                if (d[3] > 0) return Math.round(performance.now())
            }
            await new Promise(r => setTimeout(r, 25))
        }
        return -1
    })()`)
    if (paint < 0) throw new Error('pdf never painted a first page within 90s')

    const w0 = Date.now()
    const [task0, cpu0] = [await taskSeconds(), cpuSeconds()]
    await sleep(SECONDS * 1000)
    const [task1, cpu1] = [await taskSeconds(), cpuSeconds()]
    const wall = (Date.now() - w0) / 1000

    const perMin = (path: string) =>
        +(([...reqs.values()].filter(r => r.at >= w0 && r.path === path).length / wall) * 60).toFixed(1)
    const out = {
        requestsPerMin: {
            snapshot: perMin('/daemon/snapshot'),
            pages: perMin('/daemon/pages'),
            graph: perMin('/graph'),
            tree: perMin('/tree'),
        },
        mainThreadBusyMsPerSec: +(((task1 - task0) * 1000) / wall).toFixed(1),
        pdfFirstPaintMs: paint,
        pdfBytesTransferred: [...reqs.values()].filter(r => r.path === '/asset').reduce((a, r) => a + r.bytes, 0),
        coreCpuPct: +(((cpu1 - cpu0) / wall) * 100).toFixed(1),
    }
    console.log(JSON.stringify(out))
} catch (e) {
    console.error(`paneLoad: ${(e as Error).message}`)
    code = 1
} finally {
    s.close()
}
process.exit(code)
