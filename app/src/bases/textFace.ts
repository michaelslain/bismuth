// app/src/bases/textFace.ts
// Draws what an element shows of its text onto a canvas, so a text page can be turned like a scan:
// the page curl wants a picture of each page. It reads the laid-out DOM (word boxes, computed styles)
// and paints with canvas text, which every engine allows; a drawn SVG `foreignObject` taints the
// canvas in WebKit and WebGL then refuses it. Images are left out: the picture lasts a page turn.

const CLEAR = /^(transparent|rgba\([^)]*,\s*0\))$/

type Ink = {
    font: string
    size: number
    letterSpacing: string
    alpha: number
    /** `line-through` / `underline`, inherited from any ancestor up to the page */
    decoration: { line: string; color: string } | undefined
    /** a plain colour, or the stops of `background-clip: text` lettering */
    fill: string | { stops: string[]; rect: DOMRect }
}

/** The colour stops of a CSS gradient, in order. */
const gradientStops = (image: string): string[] => image.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi) ?? []

/** The first solid background from `el` outward: what the page reads as sitting on. */
function paperOf(el: HTMLElement): string {
    for (let at: HTMLElement | null = el; at; at = at.parentElement) {
        const bg = getComputedStyle(at).backgroundColor
        if (!CLEAR.test(bg)) return bg
    }
    return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#000'
}

function inkOf(parent: Element, page: HTMLElement, cache: Map<Element, Ink>): Ink {
    const hit = cache.get(parent)
    if (hit) return hit
    const cs = getComputedStyle(parent)
    let alpha = 1
    let decoration: Ink['decoration']
    for (let at: Element | null = parent; at; at = at === page ? null : at.parentElement) {
        const up = getComputedStyle(at)
        alpha *= parseFloat(up.opacity) || 0
        const line = up.textDecorationLine
        if (!decoration && line && line !== 'none') decoration = { line, color: up.textDecorationColor }
    }
    const color = cs.webkitTextFillColor || cs.color
    const stops = CLEAR.test(color) ? gradientStops(cs.backgroundImage) : []
    const ink: Ink = {
        font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
        size: parseFloat(cs.fontSize) || 16,
        letterSpacing: cs.letterSpacing,
        alpha,
        decoration,
        fill: stops.length > 1 ? { stops, rect: parent.getBoundingClientRect() } : CLEAR.test(color) ? getComputedStyle(page).color : color,
    }
    cache.set(parent, ink)
    return ink
}

/** Paints `el`'s visible box, at the screen's resolution, opaque on the colour it sits on. */
export function drawTextFace(el: HTMLElement): HTMLCanvasElement {
    const box = el.getBoundingClientRect()
    const scale = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(box.width * scale))
    canvas.height = Math.max(1, Math.round(box.height * scale))
    const cx = canvas.getContext('2d')!
    cx.scale(scale, scale)
    cx.translate(-box.left, -box.top)
    cx.fillStyle = paperOf(el)
    cx.fillRect(box.left, box.top, box.width, box.height)
    const visible = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right

    // tints and rules first, so the words land on top of them
    for (const node of el.querySelectorAll('*')) {
        const cs = getComputedStyle(node)
        const tinted = !CLEAR.test(cs.backgroundColor)
        const top = parseFloat(cs.borderTopWidth) || 0
        const bottom = parseFloat(cs.borderBottomWidth) || 0
        if (!tinted && !top && !bottom) continue
        for (const r of node.getClientRects()) {
            if (!visible(r)) continue
            if (tinted) {
                cx.fillStyle = cs.backgroundColor
                cx.fillRect(r.left, r.top, r.width, r.height)
            }
            if (top) {
                cx.fillStyle = cs.borderTopColor
                cx.fillRect(r.left, r.top, r.width, top)
            }
            if (bottom) {
                cx.fillStyle = cs.borderBottomColor
                cx.fillRect(r.left, r.bottom - bottom, r.width, bottom)
            }
        }
    }

    const inks = new Map<Element, Ink>()
    const range = document.createRange()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const parent = node.parentElement
        // KaTeX's MathML copy is for screen readers: clipped out of sight, but its glyphs have real boxes
        if (!parent || !node.data.trim() || getComputedStyle(parent).visibility !== 'visible' || parent.closest('.katex-mathml')) continue
        const ink = inkOf(parent, el, inks)
        cx.font = ink.font
        cx.globalAlpha = ink.alpha
        if ('letterSpacing' in cx) cx.letterSpacing = ink.letterSpacing === 'normal' ? '0px' : ink.letterSpacing
        const metrics = cx.measureText('x')
        const ascent = metrics.fontBoundingBoxAscent
        const baselineOf = (r: DOMRect) => r.top + (r.height - ascent - metrics.fontBoundingBoxDescent) / 2 + ascent
        if (typeof ink.fill === 'string') cx.fillStyle = ink.fill
        else {
            const g = cx.createLinearGradient(ink.fill.rect.left, 0, ink.fill.rect.right, 0)
            ink.fill.stops.forEach((c, i, all) => g.addColorStop(i / (all.length - 1), c))
            cx.fillStyle = g
        }
        // a word at a time, so wrapped lines and the page's own spacing come from the layout
        for (const word of node.data.matchAll(/\S+/g)) {
            range.setStart(node, word.index)
            range.setEnd(node, word.index + word[0].length)
            const rects = range.getClientRects()
            if (rects.length === 1) {
                if (visible(rects[0])) cx.fillText(word[0], rects[0].left, baselineOf(rects[0]))
                continue
            }
            // a word broken across lines goes letter by letter
            for (let i = 0; i < word[0].length; i++) {
                range.setStart(node, word.index + i)
                range.setEnd(node, word.index + i + 1)
                const r = range.getClientRects()[0]
                if (r && visible(r)) cx.fillText(word[0][i], r.left, baselineOf(r))
            }
        }
        if (ink.decoration) {
            range.selectNodeContents(node)
            cx.fillStyle = ink.decoration.color
            const thickness = Math.max(1, ink.size / 14)
            for (const r of range.getClientRects()) {
                if (!visible(r)) continue
                const base = baselineOf(r)
                if (ink.decoration.line.includes('line-through')) cx.fillRect(r.left, base - metrics.actualBoundingBoxAscent / 2, r.width, thickness)
                if (ink.decoration.line.includes('underline')) cx.fillRect(r.left, base + thickness, r.width, thickness)
            }
        }
    }
    cx.globalAlpha = 1
    range.detach()
    return canvas
}

/** Paints a side by side row as one open spread: its picture and its text where they sit. */
export function drawSpreadFace(row: HTMLElement, text: HTMLElement): HTMLCanvasElement {
    const box = row.getBoundingClientRect()
    const scale = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(box.width * scale))
    canvas.height = Math.max(1, Math.round(box.height * scale))
    const cx = canvas.getContext('2d')!
    cx.scale(scale, scale)
    cx.translate(-box.left, -box.top)
    cx.fillStyle = paperOf(row)
    cx.fillRect(box.left, box.top, box.width, box.height)
    for (const picture of row.querySelectorAll('canvas')) {
        const r = picture.getBoundingClientRect()
        if (picture.width > 0 && r.width > 0) cx.drawImage(picture, r.left, r.top, r.width, r.height)
    }
    const t = text.getBoundingClientRect()
    if (t.width > 0 && t.height > 0) cx.drawImage(drawTextFace(text), t.left, t.top, t.width, t.height)
    return canvas
}

/** One spread picture as its two pages, cut at the spine. */
export function splitSpread(spread: HTMLCanvasElement): { left: HTMLCanvasElement; right: HTMLCanvasElement } {
    const half = (from: number) => {
        const page = document.createElement('canvas')
        page.width = Math.max(1, Math.floor(spread.width / 2))
        page.height = spread.height
        page.getContext('2d')!.drawImage(spread, -from, 0)
        return page
    }
    return { left: half(0), right: half(Math.floor(spread.width / 2)) }
}
