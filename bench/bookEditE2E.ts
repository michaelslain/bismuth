// bench/bookEditE2E.ts — end-to-end probe for editing a PDF read as a book: boots core + Vite on their
// own ports over a temp vault holding a 3-page PDF, opens it in headless Chrome, switches to pages,
// checks the right-click menu holds the page rows and the pane rows, removes page 2 in the page sorter
// and saves (the PDF on disk has 2 pages after), turns the pages dark, then fixes a page's text in
// text mode and reads it back from the companion note.
// Usage: bun bench/bookEditE2E.ts [--core 6237] [--vite 6247] [--out <dir>]
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arg } from './args'
import { launchChrome } from './chromeSession'
import { pdfOfWidths, widthsOf } from '../core/test/pdfFixtures'

const ROOT = join(import.meta.dir, '..')
const CORE = Number(arg('core', '6237'))
const VITE = Number(arg('vite', '6247'))
const OUT = arg('out', join(ROOT, '.claude', 'sdd', 'book-edit', 'e2e'))
const VAULT = join(ROOT, '.claude', 'e2e-edit-vault')
const TOKEN = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const results: { step: string; pass: boolean; note: string }[] = []
const step = (name: string, pass: boolean, note = '') => {
    results.push({ step: name, pass, note })
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${note}`)
}
const procs: ChildProcess[] = []
const cli = (...a: string[]) =>
    spawnSync('bun', [join(ROOT, 'cli/src/index.ts'), ...a, '--vault', VAULT], {
        encoding: 'utf8',
        timeout: 100_000,
        env: { ...process.env, BISMUTH_OWNER_TOKEN: TOKEN },
    })

async function main() {
    rmSync(VAULT, { recursive: true, force: true })
    mkdirSync(join(VAULT, 'scans'), { recursive: true })
    mkdirSync(OUT, { recursive: true })
    // three pages told apart by width: 300, 320, 340 points
    writeFileSync(join(VAULT, 'scans', 'lecture.pdf'), await pdfOfWidths([300, 320, 340]))
    writeFileSync(join(VAULT, '.settings'), 'transcription:\n  auto: false\n  engine: on-device\n')
    const tr = cli('transcript', 'set', 'scans/lecture.pdf', '--page', '1', '--text', 'The first page, as the reader got it: teh quick brown fox.')
    step('0 transcript set via cli', tr.status === 0, tr.stderr.slice(0, 200))

    const env = { ...process.env, BROWSER: 'none', BISMUTH_OWNER_TOKEN: TOKEN, BISMUTH_VAULT: VAULT, BISMUTH_MEMORY: join(VAULT, '.daemon/memory') }
    procs.push(spawn('bun', [join(ROOT, 'core/src/server.ts'), '--port', String(CORE), '--vault', VAULT, '--memory', join(VAULT, '.daemon/memory')], { env, stdio: ['ignore', 'ignore', 'inherit'] }))
    procs.push(
        spawn('bun', ['x', 'vite', '--port', String(VITE), '--strictPort'], {
            cwd: join(ROOT, 'app'),
            env: { ...env, VITE_OWNER_TOKEN: TOKEN, VITE_API_BASE: `http://localhost:${CORE}` },
            stdio: ['ignore', 'ignore', 'inherit'],
        }),
    )
    for (let i = 0; i < 90; i++) {
        try {
            if ((await fetch(`http://localhost:${CORE}/tree`, { headers: { 'X-Bismuth-Token': TOKEN } })).ok && (await fetch(`http://localhost:${VITE}/`)).ok) break
        } catch {}
        await sleep(1000)
    }

    const chrome = await launchChrome({ label: 'bookEditE2E', width: 1400, height: 900 })
    const cdp = chrome.page
    const ev = async (expr: string) => {
        const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400))
        return r.result.value
    }
    const shot = async (name: string) => {
        const r = await cdp('Page.captureScreenshot', { format: 'png' })
        writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'))
    }
    const waitFor = async (fn: () => Promise<any>, ms = 20_000) => {
        const end = Date.now() + ms
        let v
        while (Date.now() < end) {
            v = await fn().catch(() => null)
            if (v) return v
            await sleep(300)
        }
        return v
    }
    const pressButton = (name: string) =>
        ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent.trim()) === ${JSON.stringify(name)} || b.textContent.trim() === ${JSON.stringify(name)}); if (!b) return false; b.click(); return true })()`)
    /** A button on the bar, or a row of the display panel, which is opened for it and closed after. */
    const clickButton = async (name: string) => {
        if (await pressButton(name)) return true
        if (!(await pressButton('display'))) return false
        await sleep(300)
        const pressed = await pressButton(name)
        await sleep(300)
        await pressButton('display')
        return pressed
    }
    const rightClick = async (sel: string) => {
        const p = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 3 } : null })()`)
        if (!p) return false
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 })
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 })
        return true
    }
    const menuRows = () => ev(`[...document.querySelectorAll('[data-popover-row]')].map(e => e.textContent.trim())`)

    await cdp('Page.navigate', { url: `http://localhost:${VITE}/?api=http://localhost:${CORE}` })
    await sleep(3000)
    await waitFor(() => ev(`(() => { const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^scans$/.test(e.textContent.trim())); if (el) { el.click(); return true } return false })()`))
    const opened = await waitFor(() => ev(`(() => { const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^lecture(\\.pdf)?$/.test(e.textContent.trim())); if (el) { el.click(); return true } return false })()`))
    step('1 pdf opens', !!opened)
    await waitFor(() => clickButton('pages'))
    const book = await waitFor(() => ev(`!!document.querySelector('[data-book] [data-book-page="right"]')`))
    step('2 pages mode shows the book', !!book)
    await sleep(1500)

    // switching lands where the reader was: book on page 3 → the viewer shows page 3; the viewer on
    // page 1 → the book opens on page 1, not the spread it was last on
    const viewerPage = () => ev(`(() => { const m = document.body.innerText.match(/p\\. (\\d+) \\/ \\d+/); return m ? Number(m[1]) : null })()`)
    const bookReadout = () => ev(`(() => { const m = document.body.innerText.match(/pp?\\. \\d+(–\\d+)? \\/ \\d+/); return m ? m[0] : null })()`)
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await waitFor(async () => ((await bookReadout()) ?? '').startsWith('pp. 2–3'))
    await clickButton('scroll')
    const vp = await waitFor(async () => ((await viewerPage()) === 2 ? 2 : null), 8000)
    step('2b pages 2–3 → scroll lands on page 2', vp === 2, String(await viewerPage()))
    await ev(`(() => { const all = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY !== 'visible'); const el = all.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; el.scrollTop = 0 })()`)
    await waitFor(async () => (await viewerPage()) === 1, 8000)
    await clickButton('pages')
    const br = await waitFor(async () => ((await bookReadout()) ?? '').startsWith('p. 1 /') && (await bookReadout()), 8000)
    step('2c scroll back on page 1 → pages opens page 1, not the 2–3 it left', !!br, String(await bookReadout()))
    await clickButton('pages')
    await sleep(800)

    // one right-click menu: the page's rows, then the pane's
    await rightClick('[data-book] [data-book-page="right"]')
    const rows = (await waitFor(async () => {
        const r = await menuRows()
        return r?.length ? r : null
    }, 5000)) as string[] | null
    step('3 right-click menu has page rows and pane rows', !!rows && rows.includes('read again with ai') && rows.some(r => /split right/i.test(r)), JSON.stringify(rows))
    await shot('3-menu')
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(300)

    // the page sorter: remove page 2, save, the pdf has pages 1 and 3
    step('4a edit pages opens', !!(await clickButton('edit pages')))
    const tiles = await waitFor(() => ev(`document.querySelectorAll('[data-book-edit-tile] canvas').length === 3`))
    step('4b sorter shows 3 drawn pages', !!tiles)
    await shot('4-sorter')
    await ev(`document.querySelectorAll('[data-book-edit-tile]')[1].querySelector('button[aria-label="remove page"]').click()`)
    await sleep(300)
    await clickButton('save')
    const closed = await waitFor(() => ev(`!document.querySelector('[data-book-page-editor]')`))
    step('4c save closes the sorter', !!closed)
    const widths = await waitFor(async () => {
        const w = await widthsOf(join(VAULT, 'scans', 'lecture.pdf'))
        return w.length === 2 ? w : null
    })
    step('4d pdf on disk is pages 1 and 3', JSON.stringify(widths) === '[300,340]', JSON.stringify(widths))
    const count = await waitFor(() => ev(`document.body.innerText.includes('1 of 2') || /page 1 \\/\\/ 2/.test(document.body.innerText)`))
    step('4e book shows 2 pages after save', !!count)
    await sleep(1000)
    await shot('4-after-save')

    // dark pages: the page's paper samples dark
    await clickButton('dark pages')
    await sleep(1500)
    const px = await ev(`(() => { const c = document.querySelector('[data-book] [data-book-page="right"] canvas'); if (!c) return null; const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), 6, 1, 1).data; return (d[0] + d[1] + d[2]) / 3 })()`)
    step('5 dark pages: paper samples dark', typeof px === 'number' && px < 60, String(px))
    await shot('5-dark')

    // text mode: fix the page's text by hand
    await clickButton('text')
    await waitFor(() => ev(`document.querySelectorAll('[data-page-key]').length > 0`))
    await sleep(800)
    await shot('6-text-dark')
    const editor = await waitFor(() => ev(`!!document.querySelector('[data-page-key] .cm-content')`))
    step('6a text mode shows the editable section', !!editor)
    await ev(`(() => { const cm = document.querySelector('[data-page-key] .cm-content'); cm.focus(); const s = getSelection(); s.selectAllChildren(cm); s.collapseToEnd() })()`)
    await cdp('Input.insertText', { text: ' Fixed by hand.' })
    await sleep(300)
    await shot('6-editor')
    const companion = join(VAULT, 'scans', 'lecture.pdf.md')
    const saved = await waitFor(async () => (existsSync(companion) && readFileSync(companion, 'utf8').includes('Fixed by hand.') ? true : null))
    step('6b companion note holds the fixed text', !!saved)
    const shown = await waitFor(() => ev(`document.querySelector('[data-text-spread]')?.textContent.includes('Fixed by hand.') ?? false`))
    step('6c text mode sets the fixed text', !!shown)
    await shot('6-text-fixed')

    chrome.close()
    writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
    const failed = results.filter(r => !r.pass).length
    console.log(`\n${results.length - failed}/${results.length} passed; shots in ${OUT}`)
    process.exitCode = failed ? 1 : 0
}

try {
    await main()
} finally {
    procs.forEach(p => p.kill('SIGTERM'))
    rmSync(VAULT, { recursive: true, force: true })
}
