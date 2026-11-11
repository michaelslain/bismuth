// bench/pdfMergeE2E.ts — end-to-end probe for merging a newer version into a PDF read as a book:
// boots core + Vite on their own ports over a temp vault holding the PDF (and its companion note),
// opens it in headless Chrome, switches to pages, opens the page sorter, picks the newer version
// through `merge a new version`, checks the head's summary and that every tile is drawn, saves, and
// reads the merged PDF and its transcript back from disk.
// Usage: bun bench/pdfMergeE2E.ts --old <a.pdf> --new <b.pdf> [--companion <a.pdf.md>]
//        [--expect "<summary after merging>"] [--core 6302] [--vite 6303] [--out <dir>]
// Without --old/--new it builds a 3-page PDF and a newer 4-page one whose third page gained a line.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { arg } from './args'
import { launchChrome } from './chromeSession'
import { pageCountOf, pdfOfBars } from '../core/test/pdfFixtures'

const ROOT = join(import.meta.dir, '..')
const CORE = Number(arg('core', '6302'))
const VITE = Number(arg('vite', '6303'))
const OUT = arg('out', join(ROOT, '.claude', 'run', 'pdf-merge-e2e'))
const VAULT = join(ROOT, '.claude', 'e2e-merge-vault')
const TOKEN = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
const OLD = arg('old', '')
const NEW = arg('new', '')
const COMPANION = arg('companion', '')
const EXPECT = arg('expect', '')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const results: { step: string; pass: boolean; note: string }[] = []
const step = (name: string, pass: boolean, note = '') => {
    results.push({ step: name, pass, note })
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${note}`)
}
const procs: ChildProcess[] = []
const barsPdf = pdfOfBars
const pageCount = pageCountOf
const transcriptPages = (md: string) => [...md.matchAll(/^### Page (\d+)$/gm)].map(m => Number(m[1]))

async function main() {
    rmSync(VAULT, { recursive: true, force: true })
    mkdirSync(join(VAULT, 'scans'), { recursive: true })
    mkdirSync(join(VAULT, 'incoming'), { recursive: true })
    mkdirSync(OUT, { recursive: true })
    const pdf = join(VAULT, 'scans', 'notebook.pdf')
    // the newer version sits in the vault too, so `bismuth pdf merge` can plan it for comparison
    const newerRel = `incoming/${NEW ? basename(NEW) : 'notebook v2.pdf'}`
    const newer = join(VAULT, newerRel)
    if (OLD) copyFileSync(OLD, pdf)
    else writeFileSync(pdf, await barsPdf([{ id: 1 }, { id: 2 }, { id: 3 }]))
    if (NEW) copyFileSync(NEW, newer)
    else writeFileSync(newer, await barsPdf([{ id: 1 }, { id: 2 }, { id: 3, extra: true }, { id: 4 }]))
    if (COMPANION) copyFileSync(COMPANION, `${pdf}.md`)
    else writeFileSync(`${pdf}.md`, ['<!-- bismuth:transcript:start -->', '### Page 1', '', 'one', '', '### Page 2', '', 'two', '', '### Page 3', '', 'three', '<!-- bismuth:transcript:end -->', ''].join('\n'))
    writeFileSync(join(VAULT, '.settings'), 'transcription:\n  auto: false\n  engine: on-device\n')
    const before = { pages: await pageCount(pdf), text: transcriptPages(readFileSync(`${pdf}.md`, 'utf8')) }
    const plan = spawnSync('bun', [join(ROOT, 'cli/src/index.ts'), 'pdf', 'merge', 'scans/notebook.pdf', newerRel, '--vault', VAULT], { encoding: 'utf8', timeout: 120_000 })
    const planned = JSON.parse(plan.stdout || 'null') as { updated: number; added: number; pages: number; steps: { kind: string; page?: number; from?: number }[] } | null

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

    const chrome = await launchChrome({ label: 'pdfMergeE2E', width: 1400, height: 900 })
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
    const waitFor = async (fn: () => Promise<any>, ms = 30_000) => {
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
    const clickButton = async (name: string) => {
        if (await pressButton(name)) return true
        if (!(await pressButton('display'))) return false
        await sleep(300)
        const pressed = await pressButton(name)
        await sleep(300)
        await pressButton('display')
        return pressed
    }
    const bodyText = () => ev(`document.body.innerText`) as Promise<string>

    await cdp('Page.navigate', { url: `http://localhost:${VITE}/?api=http://localhost:${CORE}` })
    await sleep(3000)
    await waitFor(() => ev(`(() => { const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^scans$/.test(e.textContent.trim())); if (el) { el.click(); return true } return false })()`))
    const opened = await waitFor(() => ev(`(() => { const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^notebook(\\.pdf)?$/.test(e.textContent.trim())); if (el) { el.click(); return true } return false })()`))
    step('1 pdf opens', !!opened)
    // a lone pdf opens as pages that scroll (the viewer); flipping them is the book
    await waitFor(() => clickButton('flip'))
    step('2 pages mode shows the book', !!(await waitFor(() => ev(`!!document.querySelector('[data-book] [data-book-page="right"]')`))))
    await sleep(1000)
    step('3 edit pages opens', !!(await clickButton('edit pages')))
    const drawn = await waitFor(() => ev(`document.querySelectorAll('[data-book-edit-tile] canvas').length === ${before.pages}`))
    step('4 sorter draws every page', !!drawn)
    await shot('1-sorter')

    // pick the newer version through the merge button's file input
    const doc = await cdp('DOM.getDocument', { depth: -1 })
    const input = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file][accept="application/pdf,.pdf"]' })
    await cdp('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [newer] })
    const want = EXPECT || (planned ? `merging ${basename(newer)} // ${planned.updated} updated // ${planned.added} new` : '')
    const summary = await waitFor(async () => ((await bodyText()).includes(want) ? want : null), 60_000)
    step('5 head shows the merge summary', !!summary && !!want, want)
    const total = planned?.pages ?? 0
    const allDrawn = await waitFor(() => ev(`document.querySelectorAll('[data-book-edit-tile] canvas').length === ${total}`), 30_000)
    step('6 every merged tile is drawn, the newer ones from the picked file', !!allDrawn, `${total} tiles`)
    const captions = (await ev(`[...document.querySelectorAll('[data-book-edit-tile]')].map(t => t.innerText.trim().split('\\n').pop())`)) as string[]
    const tagged = planned?.steps.map((s, i) => (s.kind === 'update' ? `${i + 1} // updated` : s.kind === 'add' ? `${i + 1} // new` : `${i + 1}`))
    step('7 captions name updated and new pages', JSON.stringify(captions) === JSON.stringify(tagged), JSON.stringify(captions))
    await shot('2-merged')

    await clickButton('save')
    const closed = await waitFor(() => ev(`!document.querySelector('[data-book-page-editor]')`), 60_000)
    step('8 save closes the sorter', !!closed)
    const after = await waitFor(async () => ((await pageCount(pdf)) === total ? total : null), 30_000)
    step('9 pdf on disk has the merged page count', after === total, `${before.pages} -> ${await pageCount(pdf)}`)
    const kept = planned?.steps.flatMap((s, i) => (s.kind === 'keep' && before.text.includes((s.page ?? -1) + 1) ? [i + 1] : [])) ?? []
    const text = existsSync(`${pdf}.md`) ? transcriptPages(readFileSync(`${pdf}.md`, 'utf8')) : []
    step('10 kept pages keep their text, updated and new pages have none', JSON.stringify(text) === JSON.stringify(kept), `text on ${JSON.stringify(text)}`)
    await sleep(1500)
    await shot('3-after-save')
    const again = spawnSync('bun', [join(ROOT, 'cli/src/index.ts'), 'pdf', 'merge', 'scans/notebook.pdf', newerRel, '--vault', VAULT], { encoding: 'utf8', timeout: 120_000 })
    const re = JSON.parse(again.stdout || 'null') as { kept: number; pages: number } | null
    step('11 merging the same version again keeps every page', !!re && re.kept === re.pages, again.stdout.slice(0, 120))

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
