// app/src/bases/bookMath.ts
// The DOM half of math in the reader's text mode: KaTeX markup for a formula, its measured box for
// the typesetter (bookText.ts), and a canvas of it for the page curl (bookTextRaster.ts). KaTeX
// loads lazily, and its fonts load only when asked for; until both have landed a formula measures
// and draws as its source text. `mathReady` flips when they land, so the pages typeset again with
// the real boxes; nothing is measured in a fallback font and kept.
import { createRoot, createSignal } from 'solid-js'
import { renderMath, onMathReady } from '../editor/katexLoader'
import { sanitizeHtml } from '../sanitizeHtml'
import type { MathBox } from './bookText'

/** KaTeX's size against the text. Its own 1.21em matches Computer Modern to a smaller-eyed font;
 *  Georgia's large x-height wants less. global.css's --fs-rel-math sets the same on `.katex`. */
export const KATEX_EM = 1.1

/** The KaTeX faces a formula draws with; measured boxes wait for these. */
const KATEX_FACES = ['KaTeX_Main', 'KaTeX_Math', 'KaTeX_AMS', 'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Caligraphic']

// 0 until KaTeX and its fonts have loaded. Not bumped on later font loads: a bump clears every box
// and picture and typesets the book again.
const [version, setVersion] = createRoot(() => createSignal(0))
let asked = false

const bump = () => {
    boxes.clear()
    rasters.clear()
    setVersion(v => v + 1)
}

/** True once KaTeX and its fonts have loaded; reading it subscribes, and the first read starts the
 *  load. */
export function mathReady(): boolean {
    if (!asked) {
        asked = true
        onMathReady(() => {
            const fonts = typeof document !== 'undefined' ? document.fonts : undefined
            if (!fonts) return bump()
            void Promise.all(KATEX_FACES.map(f => fonts.load(`16px ${f}`).catch(() => []))).then(bump)
        })
    }
    return version() > 0
}

const htmls = new Map<string, string>()

/** KaTeX's markup for a formula, sanitised; empty until KaTeX has loaded or when it cannot parse.
 *  Rendered once a formula: a book typesets the same formulas again on every resize. */
export function mathHtml(tex: string, display: boolean): string {
    const key = `${display ? 'D' : 'I'}|${tex}`
    const hit = htmls.get(key)
    if (hit !== undefined) return hit
    let html = ''
    try {
        html = sanitizeHtml(renderMath(tex, display))
    } catch {
        html = ''
    }
    // an empty render before KaTeX loads is not kept
    if (html) {
        if (htmls.size > 4000) htmls.clear()
        htmls.set(key, html)
    }
    return html
}

const boxes = new Map<string, MathBox>()
let host: HTMLDivElement | undefined

/** A hidden element in the reader's font, holding a zero-size strut on the baseline. */
function measureHost(font: string): { el: HTMLDivElement; math: HTMLSpanElement; strut: HTMLSpanElement } {
    if (!host) {
        host = document.createElement('div')
        host.setAttribute('aria-hidden', 'true')
        Object.assign(host.style, { position: 'absolute', left: '-10000px', top: '0', visibility: 'hidden', whiteSpace: 'nowrap', lineHeight: '1.25' })
        host.innerHTML = '<span></span><span style="display:inline-block;width:0;height:0"></span>'
        document.body.appendChild(host)
    }
    host.style.font = font
    return { el: host, math: host.firstElementChild as HTMLSpanElement, strut: host.lastElementChild as HTMLSpanElement }
}

/** Put a formula's markup in `into` as TextSpread sets it: at KATEX_EM, and display math as an
 *  inline block on the line, so the strut beside it sits on its baseline. Returns its `.katex` box. */
function place(into: HTMLElement, html: string): HTMLElement {
    into.innerHTML = html
    const block = into.querySelector<HTMLElement>('.katex-display')
    if (block) Object.assign(block.style, { display: 'inline-block', margin: '0' })
    const katex = into.querySelector<HTMLElement>('.katex') ?? into
    katex.style.fontSize = `${KATEX_EM}em`
    return katex
}

/** Formulas are measured at this size and scaled: KaTeX's layout scales with its font size, so a
 *  new text size costs no measuring. */
const REF_PX = 100

const boxKey = (tex: string, display: boolean, family: string) => `${display ? 'D' : 'I'}|${family}|${tex}`

/** Measure every formula not measured yet in one layout pass: each in its own line with a
 *  baseline strut, all appended at once, then all read. */
export function primeMath(items: { tex: string; display: boolean }[], family: string): void {
    const todo = items.filter(i => !boxes.has(boxKey(i.tex, i.display, family)) && mathHtml(i.tex, i.display))
    if (todo.length === 0) return
    const { el } = measureHost(`${REF_PX}px ${family}`)
    const batch = document.createElement('div')
    const rows = todo.map(i => {
        const row = document.createElement('div')
        const math = document.createElement('span')
        const strut = document.createElement('span')
        strut.style.cssText = 'display:inline-block;width:0;height:0'
        row.append(math, strut)
        batch.append(row)
        return { i, target: place(math, mathHtml(i.tex, i.display)), strut }
    })
    el.append(batch)
    for (const { i, target, strut } of rows) {
        const r = target.getBoundingClientRect()
        const base = strut.getBoundingClientRect().top
        if (r.width > 0) boxes.set(boxKey(i.tex, i.display, family), { w: r.width, ascent: Math.max(0, base - r.top), descent: Math.max(0, r.bottom - base) })
    }
    el.removeChild(batch)
    if (boxes.size > 4000) boxes.clear()
}

/** The formula's width and its reach above and below the baseline, in px, at `fontPx` in `family`.
 *  Before KaTeX loads (or for a formula it cannot parse) it is the source's width at text height. */
export function measureMath(tex: string, display: boolean, fontPx: number, family: string, textWidth: (s: string) => number): MathBox {
    const scale = (b: MathBox) => ({ w: (b.w * fontPx) / REF_PX, ascent: (b.ascent * fontPx) / REF_PX, descent: (b.descent * fontPx) / REF_PX })
    const hit = boxes.get(boxKey(tex, display, family))
    if (hit) return scale(hit)
    primeMath([{ tex, display }], family)
    const box = boxes.get(boxKey(tex, display, family))
    return box ? scale(box) : { w: textWidth(display ? `$$${tex}$$` : `$${tex}$`), ascent: fontPx * 0.8, descent: fontPx * 0.2 }
}

type Raster = { canvas: HTMLCanvasElement; ascent: number }
const rasters = new Map<string, Raster | 'pending'>()
const rasterKey = (tex: string, display: boolean, fontPx: number, color: string) => `${display ? 'D' : 'I'}|${fontPx}|${color}|${tex}`

/** A drawn formula for the page curl, once `prepareMathRasters` has made it; undefined until then. */
export function mathRaster(tex: string, display: boolean, fontPx: number, color: string): Raster | undefined {
    const r = rasters.get(rasterKey(tex, display, fontPx, color))
    return r === 'pending' ? undefined : r
}

/** Draw a laid-out formula onto a canvas context, offset so `box`'s top left is 0,0: each run of
 *  text in its own KaTeX font at the place the browser laid it out, each rule (a fraction bar, an
 *  overline) as a rectangle, and each inline SVG (a root sign, a tall bracket) as an image. Plain
 *  canvas drawing, so the canvas stays clean for the page curl's WebGL texture; an SVG image with
 *  HTML inside (foreignObject) would taint it. */
async function drawFormula(g: CanvasRenderingContext2D, el: HTMLElement, box: DOMRect, color: string): Promise<void> {
    g.fillStyle = color
    g.textBaseline = 'alphabetic'
    const range = document.createRange()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement
        if (!parent || parent.closest('.katex-mathml') || !(n.textContent ?? '').trim()) continue
        const cs = getComputedStyle(parent)
        g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
        range.selectNodeContents(n)
        const r = range.getBoundingClientRect()
        if (!r.width) continue
        const ascent = g.measureText(n.textContent!).fontBoundingBoxAscent
        g.fillText(n.textContent!, r.left - box.left, r.top - box.top + ascent)
    }
    // only KaTeX's rule-bearing parts draw a border: fraction bars, over- and underlines, rules
    for (const e of Array.from(el.querySelectorAll<HTMLElement>('.frac-line, .overline-line, .underline-line, .hline, .hdashline, .rule'))) {
        if (e.closest('.katex-mathml')) continue
        const cs = getComputedStyle(e)
        const r = e.getBoundingClientRect()
        const top = parseFloat(cs.borderTopWidth)
        const bottom = parseFloat(cs.borderBottomWidth)
        if (bottom > 0 && cs.borderBottomStyle !== 'none') g.fillRect(r.left - box.left, r.bottom - box.top - bottom, r.width, bottom)
        if (top > 0 && cs.borderTopStyle !== 'none') g.fillRect(r.left - box.left, r.top - box.top, r.width, top)
    }
    for (const svg of Array.from(el.querySelectorAll<SVGSVGElement>('svg'))) {
        if (svg.closest('.katex-mathml')) continue
        const r = svg.getBoundingClientRect()
        if (!r.width || !r.height) continue
        const copy = svg.cloneNode(true) as SVGSVGElement
        copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        copy.setAttribute('width', String(r.width))
        copy.setAttribute('height', String(r.height))
        copy.setAttribute('fill', color)
        const img = new Image()
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`
        try {
            await img.decode()
            g.drawImage(img, r.left - box.left, r.top - box.top, r.width, r.height)
        } catch {
            // a sign that will not draw is left out of the curl; the still page has it
        }
    }
}

/** Resolve when the browser is idle (or after a frame where it has no idle callback). */
const idle = () =>
    new Promise<void>(r => {
        const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
        if (w.requestIdleCallback) w.requestIdleCallback(() => r(), { timeout: 500 })
        else setTimeout(r, 16)
    })

/** Draw every formula not yet drawn, at 2x, in `color`, by walking KaTeX's laid-out markup onto a
 *  canvas (`drawFormula`). Fast enough that a spread's worth is ready before the reader turns.
 *  Resolves true when it drew any (false when all were drawn already); a formula that fails to draw
 *  stays undrawn and its place on the curl is blank. */
export async function prepareMathRasters(items: { tex: string; display: boolean }[], fontPx: number, family: string, color: string): Promise<boolean> {
    const todo = items.filter(i => !rasters.has(rasterKey(i.tex, i.display, fontPx, color)) && mathHtml(i.tex, i.display))
    if (todo.length === 0) return false
    for (const i of todo) rasters.set(rasterKey(i.tex, i.display, fontPx, color), 'pending')
    const { math, strut } = measureHost(`${fontPx}px ${family}`)
    for (const i of todo) {
        const key = rasterKey(i.tex, i.display, fontPx, color)
        // one formula a task, so a turn or a scroll never waits behind a page of them
        await idle()
        try {
            const el = place(math, mathHtml(i.tex, i.display))
            host!.style.visibility = 'visible'
            const box = el.getBoundingClientRect()
            const ascent = Math.max(0, strut.getBoundingClientRect().top - box.top)
            const canvas = document.createElement('canvas')
            canvas.width = Math.ceil(box.width + 2) * 2
            canvas.height = Math.ceil(box.height + 2) * 2
            const g = canvas.getContext('2d')!
            g.scale(2, 2)
            await drawFormula(g, el, box, color)
            host!.style.visibility = 'hidden'
            rasters.set(key, { canvas, ascent })
        } catch {
            host!.style.visibility = 'hidden'
            rasters.delete(key)
        }
    }
    if (rasters.size > 1000) rasters.clear()
    return true
}
