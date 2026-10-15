// bench/chatStreamPerf.ts — what one streamed chat token costs in a long transcript.
//
// Loads the ChatTranscript Long/Short stories (a store grown through applyChatFrame, as
// chatSession.ts does), streams `--deltas` assistant-text deltas one per frame through the story's
// `window.__chatStream` seam, and reports per-delta main-thread time (the store write, the DOM
// update and the layout the follow-bottom scroll forces) plus the frame interval while streaming.
// A token in a 400-exchange chat should cost about what it costs in a 10-exchange one.
//
//   cd app && bun run storybook -- -p <port> --ci --no-open
//   bun bench/chatStreamPerf.ts --base http://localhost:<port> [--deltas 200]
import { launchChrome } from './chromeSession'
import { arg, BASE } from './args'

const DELTAS = Number(arg('deltas', '200'))
/** Extra CSS injected before streaming, for A/B-ing a layout change without an edit. */
const CSS = arg('css', '')
const STORIES = [
    'chat-chattranscript--short-conversation',
    'chat-chattranscript--long-conversation',
]

const probe = (deltas: number) => `(async () => {
    const until = async f => { for (let i = 0; i < 300 && !f(); i++) await new Promise(r => setTimeout(r, 50)) }
    await until(() => window.__chatStream && document.querySelector('[data-chat-bubble]'))
    const raf = () => new Promise(r => requestAnimationFrame(r))
    await raf(); await raf()
    const list = document.querySelector('[data-chat-list]')
    list.setAttribute('data-probe-list', '')
    const css = ${JSON.stringify(CSS)}
    if (css) { const st = document.createElement('style'); st.textContent = css; document.head.append(st) }
    list.scrollTop = list.scrollHeight
    await raf(); await raf()
    const work = [], frames = [], write = [], layout = []
    let last = performance.now()
    for (let i = 0; i < ${deltas}; i++) {
        await raf()
        const now = performance.now()
        frames.push(now - last)
        last = now
        const t0 = performance.now()
        window.__chatStream('token ' + i + ' and some more streamed words, ')
        const t1 = performance.now()
        await Promise.resolve(); await Promise.resolve()
        void list.scrollHeight
        const t2 = performance.now()
        write.push(t1 - t0)
        layout.push(t2 - t1)
        work.push(t2 - t0)
    }
    const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(p * (s.length - 1))].toFixed(2) }
    return {
        nodes: document.querySelectorAll('*').length,
        bubbles: document.querySelectorAll('[data-chat-bubble]').length,
        atBottom: list.scrollHeight - list.scrollTop - list.clientHeight < 40,
        workMs: { p50: q(work, .5), p95: q(work, .95), max: q(work, 1) },
        writeMs: { p50: q(write, .5), p95: q(write, .95) },
        layoutMs: { p50: q(layout, .5), p95: q(layout, .95) },
        frameMs: { p50: q(frames.slice(1), .5), p95: q(frames.slice(1), .95) },
    }
})()`

const s = await launchChrome({ label: 'chatstream', width: 900, height: 800 })
// Storybook's highlight addon keeps a MutationObserver on the story root that runs getComputedStyle
// over every element on each mutation — in a 20k-node transcript that is most of a token's cost,
// and the app has no such observer. Marking it initialised before the preview loads keeps it out.
await s.page('Page.addScriptToEvaluateOnNewDocument', {
    source: 'globalThis.__STORYBOOK_HIGHLIGHT_INITIALIZED = true',
})
try {
    for (const id of STORIES) {
        const t0 = performance.now()
        await s.page('Page.navigate', {
            url: `${BASE}/iframe.html?id=${id}&viewMode=story`,
        })
        const r = await s.page('Runtime.evaluate', {
            expression: probe(DELTAS),
            returnByValue: true,
            awaitPromise: true,
        })
        const v = r.result?.value
        if (!v)
            throw new Error(`${id}: ${JSON.stringify(r.exceptionDetails ?? r)}`)
        console.log(
            JSON.stringify({
                id,
                loadAndRunS: +((performance.now() - t0) / 1000).toFixed(1),
                ...v,
            }),
        )
    }
} finally {
    s.close()
}
