// core/src/pdfMerge.ts
// Merge a newer version of a PDF into the one in the vault: draw every page of both small as a map of
// its ink, match the pages (pdfMergePlan.ts), and either return the plan or write it through
// rewritePdfPages. Desktop and CLI only: pdf.js and @napi-rs/canvas draw the pages, so the iPad's
// in-process core never imports this module.
import { createCanvas } from '@napi-rs/canvas'
import { AppError } from './error'
import { getFileAccess } from './fileAccess'
import { isPdfPath } from './fileKinds'
import { loadPdfjs, PdfjsCanvasFactory } from './drawing/pdfHighlightText'
import { rewritePdfPages, type PageSource, type WithPdf } from './pdfPages'
import { INK_H, INK_W, pageMatch, planMerge, type MergeStep } from './pdfMergePlan'

/** Width a page is drawn at before it is averaged down to its ink map: five pixels a cell. */
const DRAW_W = 200
/** Radius, in drawn pixels, of the patch whose brightest pixel stands for the paper under a pixel:
 *  wider than a pen stroke, narrower than the shading across a photographed page. */
const PAPER_R = 8
/** Darkness below the paper, as a share of it, that is still paper: scan noise and faint grain. */
const PAPER_GRAIN = 0.12

type PdfjsPage = {
    getViewport(o: { scale: number }): { width: number; height: number }
    render(o: unknown): { promise: Promise<void> }
    cleanup(): void
}

/** Every page of `bytes` as an INK_W x INK_H map of ink: how much darker than its paper each area is,
 *  so grey, shaded or cleaned-up scans of one page map alike. The page is stretched to the map. */
export async function pageInk(bytes: Uint8Array): Promise<Float32Array[]> {
    const pdfjs = await loadPdfjs()
    const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        verbosity: 0,
        disableFontFace: true,
        useWorkerFetch: false,
        CanvasFactory: PdfjsCanvasFactory,
    })
    try {
        const doc = (await task.promise) as unknown as { numPages: number; getPage(n: number): Promise<PdfjsPage> }
        const out: Float32Array[] = []
        for (let n = 1; n <= doc.numPages; n++) {
            const page = await doc.getPage(n)
            const vp = page.getViewport({ scale: DRAW_W / page.getViewport({ scale: 1 }).width })
            const w = Math.max(1, Math.ceil(vp.width))
            const h = Math.max(1, Math.ceil(vp.height))
            const canvas = createCanvas(w, h)
            const ctx = canvas.getContext('2d')
            ctx.fillStyle = '#fff'
            ctx.fillRect(0, 0, w, h)
            // annotations (highlights above all) are the reader's, not the page's: drawn, they would
            // make every highlighted page look written on
            await page.render({ canvasContext: ctx, viewport: vp, canvas, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise
            const px = ctx.getImageData(0, 0, w, h).data
            const grey = new Float32Array(w * h)
            for (let i = 0; i < w * h; i++) grey[i] = 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!
            const paper = brightestNear(grey, w, h, PAPER_R)
            const sum = new Float32Array(INK_W * INK_H)
            const count = new Float32Array(INK_W * INK_H)
            for (let y = 0; y < h; y++) {
                const row = Math.min(INK_H - 1, Math.floor((y * INK_H) / h)) * INK_W
                for (let x = 0; x < w; x++) {
                    const i = y * w + x
                    const k = row + Math.min(INK_W - 1, Math.floor((x * INK_W) / w))
                    sum[k] += Math.max(0, (paper[i]! - grey[i]!) / Math.max(paper[i]!, 1) - PAPER_GRAIN)
                    count[k]++
                }
            }
            for (let k = 0; k < sum.length; k++) sum[k] = count[k] ? sum[k]! / count[k]! : 0
            out.push(sum)
            page.cleanup()
        }
        return out
    } catch (e) {
        if (e instanceof AppError) throw e
        console.error('[pdf merge] drawing a page failed:', e)
        throw new AppError('PDF_UNREADABLE', 'cannot draw the pdf pages', 400)
    } finally {
        await (task as unknown as { destroy(): Promise<void> }).destroy().catch(() => {})
    }
}

/** Each pixel's brightest neighbour within `r` (a square), in two passes. */
function brightestNear(g: Float32Array, w: number, h: number, r: number): Float32Array {
    const t = new Float32Array(w * h)
    const o = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            let m = 0
            for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) m = Math.max(m, g[y * w + xx]!)
            t[y * w + x] = m
        }
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            let m = 0
            for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) m = Math.max(m, t[yy * w + x]!)
            o[y * w + x] = m
        }
    return o
}

export type MergePlan = {
    steps: MergeStep[]
    /** Pages in the merged pdf. */
    pages: number
    kept: number
    updated: number
    added: number
    /** Pages only the vault's copy has, kept where they were. */
    only: number
}


async function withBytes(root: string, w: WithPdf): Promise<Uint8Array> {
    if (!w || typeof w !== 'object') throw new AppError('EINVAL', 'with must be a file or data', 400)
    if ('data' in w) {
        if (typeof w.data !== 'string' || typeof w.name !== 'string' || !isPdfPath(w.name))
            throw new AppError('EINVAL', 'the newer version must be a pdf', 400)
        return Uint8Array.from(atob(w.data.replace(/^data:[^,]*,/, '')), c => c.charCodeAt(0))
    }
    if (typeof w.file !== 'string' || !isPdfPath(w.file)) throw new AppError('EINVAL', 'the newer version must be a pdf', 400)
    const fa = await getFileAccess()
    const b = await fa.readBinary(root, w.file).catch(() => null)
    if (!b) throw new AppError('ENOENT', `no such file: ${w.file}`, 404)
    return b
}

/** Which old page of `rel` each page of the newer version `w` is, kept or updated, and which pages are
 *  added. With no page in common, every page pairs by order (`kept` is 0). */
export async function planPdfMerge(root: string, rel: string, w: WithPdf): Promise<MergePlan> {
    if (!isPdfPath(rel)) throw new AppError('EINVAL', `not a pdf: ${rel}`, 400)
    const fa = await getFileAccess()
    const mine = await fa.readBinary(root, rel).catch(() => null)
    if (!mine) throw new AppError('ENOENT', `no such file: ${rel}`, 404)
    const [a, b] = await Promise.all([pageInk(mine), pageInk(await withBytes(root, w))])
    const steps = planMerge(a.map(g => b.map(h => pageMatch(g, h))), b.length)
    const count = (k: MergeStep['kind']) => steps.filter(s => s.kind === k).length
    return { steps, pages: steps.length, kept: count('keep'), updated: count('update'), added: count('add'), only: count('only') }
}

/** The rewrite order a plan stands for (1-based pages, as rewritePdfPages takes them). */
export function mergeOrder(steps: MergeStep[]): PageSource[] {
    return steps.map(s =>
        s.kind === 'only'
            ? { page: s.page + 1 }
            : s.kind === 'keep'
              ? { with: s.from + 1, marksOf: s.page + 1, textOf: s.page + 1 }
              : s.kind === 'update'
              ? { with: s.from + 1, marksOf: s.page + 1 }
              : { with: s.from + 1 },
    )
}

/** Plan the merge and write it: `rel` then holds the merged pages. */
export async function mergePdf(
    root: string,
    rel: string,
    w: WithPdf,
    opts: { mark?: (paths: string[]) => void } = {},
): Promise<MergePlan> {
    const plan = await planPdfMerge(root, rel, w)
    await rewritePdfPages(root, rel, mergeOrder(plan.steps), { ...opts, with: w })
    return plan
}
