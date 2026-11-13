// core/src/pdfMergePlan.ts
// Plan merging a newer version of a PDF into the one in the vault: which old page each newer page is
// (the same page scanned again, edited or not), which newer pages are new, and which old pages the
// newer version lacks. Pure: it takes each page's ink map (pdfMerge.ts draws them) and returns the
// merged order.

/** One page of the merged PDF, in order. Page numbers are 0-based. Every page the newer version has
 *  takes its picture from the newer version; `page` names the old page whose marks (and, when kept,
 *  text) it takes. */
export type MergeStep =
    | { kind: 'keep'; page: number; from: number } // the same page, nothing written since: the newer picture, keeping the old page's text and marks
    | { kind: 'update'; page: number; from: number } // the same page written on, or the page in its place: the newer picture and the old page's marks, its text read again
    | { kind: 'add'; from: number } // only the newer version has it
    | { kind: 'only'; page: number } // only the vault's copy has it: kept where it was

/** Side of a page's ink map: INK_W x INK_H cells, each the mean ink of its area, the page stretched
 *  to fill it. */
export const INK_W = 40
export const INK_H = 60

/** How two pages compare: `same`, how alike their ink is once the newer page is moved and scaled onto
 *  the old one (a correlation, -1..1); `added`, the largest patch of ink the newer page has where the
 *  old one has none, after that move (mean ink of a 3 x 3 cell patch, 0..1). */
export type PageMatch = { same: number; added: number }

/** The cut above which two pages can be the same page scanned again, and the added ink at which the
 *  same page counts as written on. Fit by `bench/pdfMergeFit.ts` on a 59-page scanned notebook, each
 *  page scanned again by simulation (cropped, turned, greyer or cleaner, re-encoded), and the 17
 *  pages with room left under their writing scanned again with one more line written there.
 *  SAME_MIN is the lowest likeness a rescan showed (0.575). ADDED_MIN is the cut with the fewest pages
 *  on the wrong side (0.073): one rescan reads as written on (a page half in shadow, 0.28), no
 *  one-line page reads as untouched (the least, 0.08). Held out, a real newer export of an 8-page
 *  notebook (2 pages before, 7 after, one page written on) plans right: its 7 untouched pages show
 *  0.020 to 0.055 added ink, the written one 0.232. */
export const SAME_MIN = 0.575
export const ADDED_MIN = 0.073

const N = INK_W * INK_H

/** `a` softened by a 3 x 3 box: a stroke a cell away still overlaps. */
function soften(a: ArrayLike<number>): Float32Array {
    const o = new Float32Array(N)
    for (let y = 0; y < INK_H; y++)
        for (let x = 0; x < INK_W; x++) {
            let s = 0
            let c = 0
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx
                    const yy = y + dy
                    if (xx >= 0 && xx < INK_W && yy >= 0 && yy < INK_H) {
                        s += a[yy * INK_W + xx]!
                        c++
                    }
                }
            o[y * INK_W + x] = s / c
        }
    return o
}

/** `a` grown by one cell: ink a cell away from a stroke still counts as the stroke. */
function grow(a: ArrayLike<number>): Float32Array {
    const o = new Float32Array(N)
    for (let y = 0; y < INK_H; y++)
        for (let x = 0; x < INK_W; x++) {
            let m = 0
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx
                    const yy = y + dy
                    if (xx >= 0 && xx < INK_W && yy >= 0 && yy < INK_H) m = Math.max(m, a[yy * INK_W + xx]!)
                }
            o[y * INK_W + x] = m
        }
    return o
}

type Move = { sx: number; sy: number; dx: number; dy: number }

/** `b` sampled as if scaled by (sx, sy) about its centre and shifted by (dx, dy) cells, read
 *  between cells by bilinear interpolation so a half-cell shift lines strokes up too. */
function moved(b: ArrayLike<number>, m: Move, out: Float32Array): Float32Array {
    const cell = (x: number, y: number) => (x >= 0 && x < INK_W && y >= 0 && y < INK_H ? b[y * INK_W + x]! : 0)
    for (let y = 0; y < INK_H; y++) {
        const fy = (y - INK_H / 2) * m.sy + INK_H / 2 + m.dy
        const y0 = Math.floor(fy)
        const ty = fy - y0
        for (let x = 0; x < INK_W; x++) {
            const fx = (x - INK_W / 2) * m.sx + INK_W / 2 + m.dx
            const x0 = Math.floor(fx)
            const tx = fx - x0
            out[y * INK_W + x] =
                (cell(x0, y0) * (1 - tx) + cell(x0 + 1, y0) * tx) * (1 - ty) +
                (cell(x0, y0 + 1) * (1 - tx) + cell(x0 + 1, y0 + 1) * tx) * ty
        }
    }
    return out
}

function correlation(a: Float32Array, b: Float32Array): number {
    let ma = 0
    let mb = 0
    for (let i = 0; i < N; i++) {
        ma += a[i]!
        mb += b[i]!
    }
    ma /= N
    mb /= N
    let ab = 0
    let aa = 0
    let bb = 0
    for (let i = 0; i < N; i++) {
        const da = a[i]! - ma
        const db = b[i]! - mb
        ab += da * db
        aa += da * da
        bb += db * db
    }
    if (aa < 1e-9 && bb < 1e-9) return 1 // two blank pages
    if (aa < 1e-9 || bb < 1e-9) return 0
    return ab / Math.sqrt(aa * bb)
}

/** A page scanned again comes out cropped and framed a little differently: these are the scales
 *  and shifts tried, a coarse pass, a finer one around its best, and a half-cell one around that. */
const COARSE_SCALE = [0.92, 1, 1.08]
const COARSE_SHIFT = [-4, -2, 0, 2, 4]

/** How newer page `b` compares with old page `a` (ink maps from pdfMerge.ts's `pageInk`). */
export function pageMatch(a: ArrayLike<number>, b: ArrayLike<number>): PageMatch {
    if (a.length !== N || b.length !== N) return { same: 0, added: 1 }
    const sa = soften(a)
    const sb = soften(b)
    const buf = new Float32Array(N)
    let best: Move = { sx: 1, sy: 1, dx: 0, dy: 0 }
    let bestR = -2
    const tryMove = (m: Move) => {
        const r = correlation(sa, moved(sb, m, buf))
        if (r > bestR) {
            bestR = r
            best = m
        }
    }
    for (const sx of COARSE_SCALE)
        for (const sy of COARSE_SCALE) for (const dx of COARSE_SHIFT) for (const dy of COARSE_SHIFT) tryMove({ sx, sy, dx, dy })
    const c = best
    for (const ex of [-0.04, 0, 0.04])
        for (const ey of [-0.04, 0, 0.04])
            for (const ox of [-1, 0, 1])
                for (const oy of [-1, 0, 1])
                    tryMove({
                        sx: c.sx + ex,
                        sy: c.sy + ey,
                        dx: c.dx + ox,
                        dy: c.dy + oy,
                    })
    const f = best
    for (const ex of [-0.02, 0, 0.02])
        for (const ey of [-0.02, 0, 0.02])
            for (const ox of [-0.5, 0, 0.5])
                for (const oy of [-0.5, 0, 0.5])
                    tryMove({
                        sx: f.sx + ex,
                        sy: f.sy + ey,
                        dx: f.dx + ox,
                        dy: f.dy + oy,
                    })

    // ink the newer page has where the old one (grown a cell) has none, in its densest 3 x 3 patch
    const nb = moved(b, best, new Float32Array(N))
    const ga = grow(a)
    let added = 0
    for (let y = 1; y < INK_H - 1; y++)
        for (let x = 1; x < INK_W - 1; x++) {
            let s = 0
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const k = (y + dy) * INK_W + x + dx
                    s += Math.max(0, nb[k]! - ga[k]!)
                }
            added = Math.max(added, s / 9)
        }
    return { same: bestR, added }
}

/** The merged order, given `match[i][j]`, how new page j compares with old page i. The pages that are
 *  the same page scanned again (`same` at least `sameMin`) are lined up in order, the best-matching
 *  order winning; each is kept, or updated when it has `addedMin` or more new ink. Between two of
 *  them the remaining old and new pages pair up by position as updates, extra new pages are added
 *  there, and extra old pages stay after the page they followed. A page left over on both sides that
 *  is the same page moved elsewhere takes its old page at its new place. With no page in common,
 *  every page pairs by order. The order follows the newer version. */
export function planMerge(match: PageMatch[][], newCount: number, cuts: { sameMin?: number; addedMin?: number } = {}): MergeStep[] {
    const sameMin = cuts.sameMin ?? SAME_MIN
    const addedMin = cuts.addedMin ?? ADDED_MIN
    const oldCount = match.length
    const at = (i: number, j: number) => match[i]?.[j] ?? { same: -1, added: 1 }
    const gain = (i: number, j: number) => {
        const s = at(i, j).same
        return s >= sameMin ? s - sameMin + 1e-3 : -1
    }

    // The order of matches with the most total likeness (a weighted longest common subsequence).
    const best: number[][] = Array.from({ length: oldCount + 1 }, () => new Array<number>(newCount + 1).fill(0))
    for (let i = oldCount - 1; i >= 0; i--)
        for (let j = newCount - 1; j >= 0; j--) {
            const g = gain(i, j)
            best[i]![j] = Math.max(best[i + 1]![j]!, best[i]![j + 1]!, g > 0 ? best[i + 1]![j + 1]! + g : -Infinity)
        }
    const anchors: [number, number][] = []
    for (let i = 0, j = 0; i < oldCount && j < newCount;) {
        const g = gain(i, j)
        if (g > 0 && best[i]![j] === best[i + 1]![j + 1]! + g) anchors.push([i++, j++])
        else if (best[i + 1]![j]! >= best[i]![j + 1]!) i++
        else j++
    }

    const oldOf = new Array<number | null>(newCount).fill(null) // the old page a new page is, matched
    const pairOf = new Array<number | null>(newCount).fill(null) // the old page a new page takes the place of
    const usedOld = new Set<number>()
    for (const [i, j] of anchors) {
        oldOf[j] = i
        usedOld.add(i)
    }
    // Between consecutive matches, pair the leftovers by position, counted from the match they follow.
    // Before the first match there is only the match after them, so they count back from it: a newer
    // copy that starts a few pages later pairs its first page with the old page just before the match,
    // not with the old first page. With no match at all, every page pairs by order from the start.
    const bounds: [number, number][] = [[-1, -1], ...anchors, [oldCount, newCount]]
    for (let k = 0; k + 1 < bounds.length; k++) {
        const [i0, j0] = bounds[k]!
        const [i1, j1] = bounds[k + 1]!
        const olds: number[] = []
        for (let i = i0 + 1; i < i1; i++) olds.push(i)
        const news: number[] = []
        for (let j = j0 + 1; j < j1; j++) news.push(j)
        const fromEnd = k === 0 && anchors.length > 0
        const pairs = Math.min(olds.length, news.length)
        for (let n = 0; n < pairs; n++) {
            const o = fromEnd ? olds[olds.length - pairs + n]! : olds[n]!
            const j = fromEnd ? news[news.length - pairs + n]! : news[n]!
            pairOf[j] = o
            usedOld.add(o)
        }
    }
    // Pages left over on both sides that are the same page moved: matched one to one, closest first.
    const loose: [number, number, number][] = []
    for (let i = 0; i < oldCount; i++)
        if (!usedOld.has(i))
            for (let j = 0; j < newCount; j++)
                if (oldOf[j] === null && pairOf[j] === null && gain(i, j) > 0) loose.push([at(i, j).same, i, j])
    loose.sort((a, b) => b[0] - a[0])
    for (const [, i, j] of loose) {
        if (usedOld.has(i) || oldOf[j] !== null) continue
        oldOf[j] = i
        usedOld.add(i)
    }

    const steps: MergeStep[] = []
    for (let j = 0; j < newCount; j++) {
        const same = oldOf[j]
        const pair = pairOf[j]
        if (same !== null && same !== undefined)
            steps.push({
                kind: at(same, j).added < addedMin ? 'keep' : 'update',
                page: same,
                from: j,
            })
        else if (pair !== null && pair !== undefined) steps.push({ kind: 'update', page: pair, from: j })
        else steps.push({ kind: 'add', from: j })
    }
    // Old pages the newer version has no counterpart for stay after the page they followed.
    const holds = (s: MergeStep, i: number) => s.kind !== 'add' && s.page === i
    for (let i = 0; i < oldCount; i++) {
        if (usedOld.has(i)) continue
        const after = i === 0 ? -1 : steps.findIndex(s => holds(s, i - 1))
        steps.splice(after + 1, 0, { kind: 'only', page: i })
    }
    return steps
}
