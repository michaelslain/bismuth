// bench/pdfMergeFit.ts — fit the two cuts a PDF merge rests on (core/src/pdfMergePlan.ts) on real
// scanned PDFs, then check them on a real pair of versions held out of the fit:
//   SAME_MIN   the likeness above which two pages can be the same page scanned again
//   ADDED_MIN  the patch of new ink at which the same page counts as written on
//
// For every page of the scan given (each page one JPEG, as a phone scanner writes them) it makes:
//   rescan   the page as a scanner exports it again: cropped 0-4% a side, turned up to 0.8 degrees,
//            greyer or cleaner, smaller, re-encoded as JPEG
//   one line a rescan with one line of another page's writing under the page's last line (pages
//            whose writing runs to the foot have no room and are left out)
// and scores each against the page (pageMatch). --fit-pair adds a real pair of versions whose pages are
// known (--truth, `old:new` page numbers from 1; `old:new?` marks a page written on past matching,
// counted on neither side), with half-empty pages on both sides: its pairs of different pages are what
// a likeness that trusts blank paper gets wrong.
// SAME_MIN is the lowest likeness any page shows against itself, a rescan or a known pair, so every
// page can still match; pairs of different pages at or over it are counted (the scan's pages within 3
// of each other, the fit pair's), since the plan lines pages up in order rather than trusting one
// score. A pair missed costs more than a pair of different pages over the cut: a missed page is read
// as written on, or pairs with the wrong page. ADDED_MIN is the added-ink cut with the fewest pages on
// the wrong side between rescans and one-line pages; ties take the middle of the widest gap.
// The held-out check plans another real pair with the fitted cuts and compares the plan with --expect,
// one word per merged page (keep update add only), in order.
// Usage: bun bench/pdfMergeFit.ts <scan.pdf> --fit-pair <old.pdf> <new.pdf> --truth "4:2 5:3 3:1? ..."
//            --pair <old.pdf> <new.pdf> --expect "add add keep ..."
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type * as Canvas from '@napi-rs/canvas'
import type * as PdfLib from 'pdf-lib'
import { pageInk } from '../core/src/pdfMerge'
import { ADDED_MIN, INK_H, INK_W, pageMatch, planMerge, SAME_MIN } from '../core/src/pdfMergePlan'

// both live in core's dependencies, not the repo root's
const fromCore = createRequire(join(import.meta.dir, '../core/package.json'))
const { createCanvas, loadImage } = fromCore('@napi-rs/canvas') as typeof Canvas
const { PDFDocument, PDFName } = fromCore('pdf-lib') as typeof PdfLib
type PDFDict = PdfLib.PDFDict
type PDFRawStream = PdfLib.PDFRawStream

const argv = process.argv.slice(2)
const pairAt = argv.indexOf('--pair')
const expectAt = argv.indexOf('--expect')
const fitAt = argv.indexOf('--fit-pair')
const truthAt = argv.indexOf('--truth')
const file = argv[0]
if (!file || file.startsWith('--') || pairAt < 0 || expectAt < 0 || fitAt < 0 || truthAt < 0) {
    console.error(
        'usage: bun bench/pdfMergeFit.ts <scan.pdf> --fit-pair <old.pdf> <new.pdf> --truth "4:2 5:3 3:1? ..." --pair <old.pdf> <new.pdf> --expect "add add keep ..."',
    )
    process.exit(2)
}
const [pairOld, pairNew] = [argv[pairAt + 1]!, argv[pairAt + 2]!]
const expected = argv[expectAt + 1]!.trim().split(/\s+/)
const [fitOld, fitNew] = [argv[fitAt + 1]!, argv[fitAt + 2]!]
// known pairs of the fit pair, 0-based; `?` pairs are the same page written on past matching
const truth = argv[truthAt + 1]!
    .trim()
    .split(/\s+/)
    .map(t => {
        const m = /^(\d+):(\d+)(\?)?$/.exec(t)
        if (!m) throw new Error(`--truth: ${t} is not old:new`)
        return { old: +m[1]! - 1, new: +m[2]! - 1, past: !!m[3] }
    })

/** The cut between `low` (should fall under it) and `high` (should reach it) with the fewest values on
 *  the wrong side; among equal ones, the middle of the widest gap. */
function fewestWrong(low: number[], high: number[]): { cut: number; wrong: number } {
    const values = [...low, ...high].sort((x, y) => x - y)
    let best = { cut: values[0]!, wrong: Infinity }
    let widest = -1
    for (let k = 0; k + 1 < values.length; k++) {
        const cut = (values[k]! + values[k + 1]!) / 2
        const wrong = low.filter(v => v >= cut).length + high.filter(v => v < cut).length
        const gap = values[k + 1]! - values[k]!
        if (wrong < best.wrong || (wrong === best.wrong && gap > widest)) [best, widest] = [{ cut, wrong }, gap]
    }
    return best
}

/** A repeatable number in [0, 1) for page `i`, draw `k`. */
const rand = (i: number, k: number) => {
    const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
    return x - Math.floor(x)
}

const bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
const doc = await PDFDocument.load(bytes)
const sizes = doc.getPages().map(p => p.getSize())
const jpegs = doc.getPages().map((p, i) => {
    const xo = p.node.Resources()?.lookup(PDFName.of('XObject')) as PDFDict | undefined
    const first = xo?.entries()[0]?.[1]
    const s = first ? (doc.context.lookup(first) as PDFRawStream) : undefined
    if (!s || String(s.dict.get(PDFName.of('Filter'))) !== '/DCTDecode') throw new Error(`${file} page ${i + 1} is not one JPEG`)
    return s.contents
})
const imgs = await Promise.all(jpegs.map(j => loadImage(Buffer.from(j))))
const base = await pageInk(bytes)

/** Where page `i` has room for one more line under its writing (a share of its height), or null when
 *  its writing runs to the foot; and its inkiest band, a line of writing to copy. A row counts as
 *  written when it holds a twentieth of the inkiest row's ink. */
function bands(i: number): { under: number | null; inky: number } {
    const g = base[i]!
    const rows = Array.from({ length: INK_H }, (_, r) => g.slice(r * INK_W, (r + 1) * INK_W).reduce((s, v) => s + v, 0))
    const most = Math.max(...rows)
    let last = 0
    for (let r = 0; r < INK_H; r++) if (rows[r]! >= most / 20) last = r
    let inky = 4
    const band = (r: number) => rows[r - 1]! + rows[r]! + rows[r + 1]!
    for (let r = 4; r < INK_H - 4; r++) if (band(r) > band(inky)) inky = r
    const under = last + 3
    return {
        under: under <= INK_H - 3 ? under / INK_H : null,
        inky: inky / INK_H,
    }
}

/** Every page scanned again; with `line`, one line of another page's writing added first. */
async function rescanned(line: boolean): Promise<Uint8Array> {
    const out = await PDFDocument.create()
    for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i]!
        const scale = 0.6 + 0.4 * rand(i, 1)
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const c = createCanvas(w, h)
        const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        // the newer photo frames the page a little differently: cropped and turned
        const [l, t, r, b] = [2, 3, 4, 5].map(k => 0.04 * rand(i, k)) as [number, number, number, number]
        ctx.save()
        ctx.translate(w / 2, h / 2)
        ctx.rotate(((rand(i, 6) - 0.5) * 1.6 * Math.PI) / 180)
        ctx.translate(-w / 2, -h / 2)
        ctx.drawImage(img as never, img.width * l, img.height * t, img.width * (1 - l - r), img.height * (1 - t - b), 0, 0, w, h)
        ctx.restore()
        const at = bands(i).under
        if (line && at !== null) {
            const k = (i + 7) % imgs.length
            const other = imgs[k]!
            const from = bands(k).inky
            ctx.globalCompositeOperation = 'multiply'
            ctx.drawImage(
                other as never,
                0,
                other.height * (from - 0.02),
                other.width,
                other.height * 0.04,
                0,
                h * (at - 0.02),
                w,
                h * 0.04,
            )
            ctx.globalCompositeOperation = 'source-over'
        }
        // and develops it differently: greyer paper, or cleaned up with more contrast
        const gain = 0.82 + 0.3 * rand(i, 7)
        const lift = 30 * (rand(i, 8) - 0.5)
        const px = ctx.getImageData(0, 0, w, h)
        for (let p = 0; p < px.data.length; p += 4)
            for (let ch = 0; ch < 3; ch++) px.data[p + ch] = Math.max(0, Math.min(255, px.data[p + ch]! * gain + lift))
        ctx.putImageData(px, 0, 0)
        const e = await out.embedJpg(await c.encode('jpeg', Math.round(55 + 35 * rand(i, 9))))
        const { width, height } = sizes[i]!
        out.addPage([width, height]).drawImage(e, { x: 0, y: 0, width, height })
    }
    return out.save()
}

const rescanPdf = await rescanned(false)
const linePdf = await rescanned(true)
if (process.env.FIT_DEBUG) {
    await Bun.write(join(process.env.FIT_DEBUG, 'rescan.pdf'), rescanPdf)
    await Bun.write(join(process.env.FIT_DEBUG, 'line.pdf'), linePdf)
}
const rescans = await pageInk(rescanPdf)
const lines = await pageInk(linePdf)
const rescan = rescans.map((g, i) => pageMatch(base[i]!, g))
// a page whose writing runs to its foot has no room for a line: it is left out of the one-line class
const roomy = base.map((_, i) => bands(i).under !== null)
const oneLine = lines.flatMap((g, i) => (roomy[i] ? [pageMatch(base[i]!, g)] : []))
const lineIndex = roomy.flatMap((r, i) => (r ? [i] : []))
const different: number[] = []
for (let a = 0; a < base.length; a++)
    for (let b = 0; b < base.length; b++) if (a !== b && Math.abs(a - b) <= 3) different.push(pageMatch(base[a]!, rescans[b]!).same)

const [fa, fb] = await Promise.all([
    pageInk(new Uint8Array(await Bun.file(fitOld).arrayBuffer())),
    pageInk(new Uint8Array(await Bun.file(fitNew).arrayBuffer())),
])
const fitMatch = fa.map(g => fb.map(h => pageMatch(g, h)))
const isKnown = (i: number, j: number) => truth.some(t => t.old === i && t.new === j)
const fitSame = truth.filter(t => !t.past).map(t => fitMatch[t.old]![t.new]!.same)
const fitDifferent: number[] = []
fitMatch.forEach((row, i) => row.forEach((m, j) => isKnown(i, j) || fitDifferent.push(m.same)))

const maxRescanAdded = Math.max(...rescan.map(m => m.added))
const minLineAdded = Math.min(...oneLine.map(m => m.added))
const sameMin = Math.min(...rescan.map(m => m.same), ...fitSame)
const addedMin = fewestWrong(
    rescan.map(m => m.added),
    oneLine.map(m => m.added),
).cut
const rescanWrong = rescan.flatMap((m, i) => (m.added >= addedMin ? [`p${i + 1}`] : []))
const lineWrong = oneLine.flatMap((m, k) => (m.added < addedMin ? [`p${lineIndex[k]! + 1}`] : []))
const r2 = (x: number) => x.toFixed(2)
console.log(`${file}: ${base.length} pages`)
console.log(
    `  rescan:   likeness ${r2(Math.min(...rescan.map(m => m.same)))}..${r2(Math.max(...rescan.map(m => m.same)))}, added ink at most ${r2(maxRescanAdded)}`,
)
console.log(
    `  one line (${oneLine.length} pages with room under their writing): likeness ${r2(Math.min(...oneLine.map(m => m.same)))}..${r2(Math.max(...oneLine.map(m => m.same)))}, added ink at least ${r2(minLineAdded)}`,
)
console.log(
    `  different pages (within 3 of each other): likeness up to ${r2(Math.max(...different))}, ${different.filter(s => s >= sameMin).length} of ${different.length} at or over the fitted SAME_MIN`,
)
console.log(`fit pair ${fitOld} -> ${fitNew}:`)
console.log(
    `  known pairs: likeness ${truth.map(t => `${t.old + 1}->${t.new + 1} ${r2(fitMatch[t.old]![t.new]!.same)}${t.past ? ' (written past matching)' : ''}`).join(', ')}`,
)
console.log(
    `  different pages: likeness up to ${r2(Math.max(...fitDifferent))}, ${fitDifferent.filter(s => s >= sameMin).length} of ${fitDifferent.length} at or over the fitted SAME_MIN`,
)
console.log(`fit: SAME_MIN ${sameMin.toFixed(3)} (code has ${SAME_MIN}), ADDED_MIN ${addedMin.toFixed(3)} (code has ${ADDED_MIN})`)
console.log(
    `  on the wrong side of ADDED_MIN: rescans read as written on ${rescanWrong.join(' ') || 'none'}; one-line pages read as untouched ${lineWrong.join(' ') || 'none'}`,
)
let ok = true

const [a, b] = await Promise.all([
    pageInk(new Uint8Array(await Bun.file(pairOld).arrayBuffer())),
    pageInk(new Uint8Array(await Bun.file(pairNew).arrayBuffer())),
])
const match = a.map(g => b.map(h => pageMatch(g, h)))
const steps = planMerge(match, b.length, { sameMin, addedMin })
const got = steps.map(s => s.kind)
const pass = got.join(' ') === expected.join(' ')
ok &&= pass
console.log(`held out ${pairOld} -> ${pairNew}: ${pass ? 'PASS' : 'FAIL'}`)
console.log(`  got    ${got.join(' ')}`)
if (!pass) console.log(`  wanted ${expected.join(' ')}`)
for (const s of steps)
    if (s.kind === 'keep' || s.kind === 'update')
        console.log(
            `  old ${s.page + 1} -> new ${s.from + 1}: likeness ${r2(match[s.page]![s.from]!.same)}, added ink ${match[s.page]![s.from]!.added.toFixed(3)} (${s.kind})`,
        )
process.exit(ok ? 0 : 1)
