// Reads a rendered intro slide into a MorphGrid: text (Range rects plus ::before/::after strings, laid
// out as monospace runs per rendered line), glyph art (the glyphs a GlyphCanvas drew, on their own
// footprint), other canvases (luminance per cell) and horizontal rules, each coloured by the nearest
// theme token. DOM-touching and thin; the maths lives in snapshotMath.ts.
import { drawnGlyphs } from '../../ui/ascii/glyphCanvas'
import { GLYPH_COLOR_VARS, GLYPH_COLORS, type GlyphColor } from '../../ui/ascii/glyphScene'
import type { MorphCell, MorphGrid } from './morphGrid'
import {
    layoutText,
    lumaToChar,
    nearestGlyphColor,
    pseudoContentText,
    type TextAlign,
    type TextGlyph,
} from './snapshotMath'

export type SnapshotMetrics = {
    originX: number
    originY: number
    cellW: number
    cellH: number
    cols: number
    rows: number
}

type Rgb = [number, number, number]

/** Resolves a length custom property (possibly a calc) to px by measuring a probe. */
function measureVar(root: HTMLElement, name: string, fallback: number): number {
    const probe = document.createElement('div')
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:0;width:var(${name}, ${fallback}px)`
    root.appendChild(probe)
    const w = probe.getBoundingClientRect().width
    probe.remove()
    return w > 0 ? w : fallback
}

/** Reads --cell-w / --row-h and the root's box into metrics. */
export function readMetrics(root: HTMLElement): SnapshotMetrics {
    const box = root.getBoundingClientRect()
    const cellW = measureVar(root, '--cell-w', 6.3)
    const cellH = measureVar(root, '--row-h', 18)
    return {
        originX: box.left,
        originY: box.top,
        cellW,
        cellH,
        cols: Math.max(0, Math.floor(box.width / cellW)),
        rows: Math.max(0, Math.floor(box.height / cellH)),
    }
}

const parseRgba = (css: string): [number, number, number, number] | null => {
    const m = css.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null
    return [p[0], p[1], p[2], p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1]
}

/** Computed-style colour of a CSS value, via a probe (handles var(), color-mix, oklch, ...). */
function resolveColor(root: HTMLElement, value: string): Rgb | null {
    const probe = document.createElement('span')
    probe.style.cssText = `position:absolute;visibility:hidden;color:${value}`
    root.appendChild(probe)
    const rgba = parseRgba(getComputedStyle(probe).color)
    probe.remove()
    return rgba ? [rgba[0], rgba[1], rgba[2]] : null
}

function readPalette(root: HTMLElement): Record<GlyphColor, Rgb> {
    const out = {} as Record<GlyphColor, Rgb>
    for (const name of GLYPH_COLORS) {
        out[name] = resolveColor(root, `var(${GLYPH_COLOR_VARS[name]})`) ?? [128, 128, 128]
    }
    return out
}

/** Whether `el` and its ancestors up to root paint at all (display, visibility, skip markers). */
function makeVisibility(root: HTMLElement) {
    const cache = new Map<Element, boolean>()
    // A canvas's own aria-hidden only hides it from the accessibility tree (glyph art sets it); it
    // still paints, so only its ancestors' markers skip it. For everything else aria-hidden marks
    // decoration such as the caret, which the snapshot leaves out.
    const visible = (el: Element | null): boolean => {
        if (!el) return false
        const hit = cache.get(el)
        if (hit !== undefined) return hit
        let ok = true
        const ariaHidden = el.tagName !== 'CANVAS' && el.getAttribute('aria-hidden') === 'true'
        if (ariaHidden || el.hasAttribute('data-morph-skip')) ok = false
        else {
            const cs = getComputedStyle(el)
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') ok = false
        }
        if (ok && el !== root && el.parentElement) ok = visible(el.parentElement)
        cache.set(el, ok)
        return ok
    }
    return visible
}

/** Every visible text char, every canvas, every horizontal rule -> a sparse MorphGrid. Given a
 *  `scope` selector, only what sits inside an element matching it is read: the parts of the slide
 *  that fade under the overlay, so chrome that stays on screen is never painted twice. */
export function snapshotSlide(root: HTMLElement, m: SnapshotMetrics, scope?: string): MorphGrid {
    const { cols, rows, cellW, cellH, originX, originY } = m
    const palette = readPalette(root)
    const shown = makeVisibility(root)
    const scoped = new Map<Element, boolean>()
    const inScope = (el: Element): boolean => {
        if (!scope) return true
        let hit = scoped.get(el)
        if (hit === undefined) {
            const at = el.closest(scope)
            hit = !!at && root.contains(at)
            scoped.set(el, hit)
        }
        return hit
    }
    const visible = (el: Element): boolean => shown(el) && inScope(el)
    const colorOf = new Map<Element, GlyphColor>()
    const tokenFor = (el: Element): GlyphColor => {
        let c = colorOf.get(el)
        if (!c) {
            const rgba = parseRgba(getComputedStyle(el).color)
            c = rgba ? nearestGlyphColor([rgba[0], rgba[1], rgba[2]], palette) : 'fg'
            colorOf.set(el, c)
        }
        return c
    }
    const inGrid = (col: number, row: number) => col >= 0 && row >= 0 && col < cols && row < rows
    const under = new Map<number, MorphCell>() // canvases + rules
    const text = new Map<number, MorphCell>()

    // canvases
    for (const canvas of root.querySelectorAll('canvas')) {
        if (!visible(canvas)) continue
        const r = canvas.getBoundingClientRect()
        if (r.width < 1 || r.height < 1 || canvas.width < 1 || canvas.height < 1) continue
        // Glyph art: its own glyphs on their own footprint, so the morph lands on exactly what the
        // real art draws (the same characters at the same size), not a luminance read of it.
        const art = drawnGlyphs(canvas)
        if (art) {
            const { frame, cellW: aw, cellH: ah } = art
            for (let fr = 0; fr < frame.rows; fr++) {
                for (let fc = 0; fc < frame.cols; fc++) {
                    const i = fr * frame.cols + fc
                    const code = frame.chars[i]
                    if (code === 32 || frame.alpha[i] === 0) continue
                    const left = r.left + art.left + fc * aw
                    const cy = r.top + art.top + fr * ah + ah / 2
                    if (left + aw > r.right + 0.5 || cy > r.bottom) continue
                    const col = Math.floor((left + aw / 2 - originX) / cellW)
                    const row = Math.floor((cy - originY) / cellH)
                    if (!inGrid(col, row)) continue
                    under.set(row * cols + col, {
                        col,
                        row,
                        ch: String.fromCharCode(code),
                        color: GLYPH_COLORS[frame.color[i]],
                        x: (left - originX) / cellW,
                        y: (cy - originY) / cellH,
                        scale: aw / cellW,
                    })
                }
            }
            continue
        }
        let data: Uint8ClampedArray
        try {
            data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        } catch {
            continue // tainted, or a non-2d context
        }
        const sx = canvas.width / r.width
        const sy = canvas.height / r.height
        const c0 = Math.floor((r.left - originX) / cellW)
        const c1 = Math.ceil((r.right - originX) / cellW)
        const r0 = Math.floor((r.top - originY) / cellH)
        const r1 = Math.ceil((r.bottom - originY) / cellH)
        for (let row = r0; row < r1; row++) {
            for (let col = c0; col < c1; col++) {
                if (!inGrid(col, row)) continue
                const x0 = Math.max(0, Math.floor((originX + col * cellW - r.left) * sx))
                const x1 = Math.min(canvas.width, Math.ceil((originX + (col + 1) * cellW - r.left) * sx))
                const y0 = Math.max(0, Math.floor((originY + row * cellH - r.top) * sy))
                const y1 = Math.min(canvas.height, Math.ceil((originY + (row + 1) * cellH - r.top) * sy))
                if (x1 <= x0 || y1 <= y0) continue
                let a = 0, rr = 0, gg = 0, bb = 0
                for (let y = y0; y < y1; y++) {
                    for (let x = x0; x < x1; x++) {
                        const i = (y * canvas.width + x) * 4
                        const al = data[i + 3]
                        a += al
                        rr += data[i] * al
                        gg += data[i + 1] * al
                        bb += data[i + 2] * al
                    }
                }
                if (a === 0) continue
                const n = (x1 - x0) * (y1 - y0)
                // Glyph strokes cover a fraction of a cell, so scale coverage up before ramping.
                const ch = lumaToChar(Math.min(1, (a / (255 * n)) * 3))
                if (ch === ' ') continue
                const color = nearestGlyphColor([rr / a, gg / a, bb / a], palette)
                under.set(row * cols + col, { col, row, ch, color })
            }
        }
    }

    // horizontal rules: <hr> and top/bottom borders wide enough to read as a line
    for (const el of root.querySelectorAll('*')) {
        const tag = el.tagName
        if (tag === 'CANVAS' || tag === 'SCRIPT' || tag === 'STYLE') continue
        const cs = getComputedStyle(el)
        const edges: Array<[number, string, string]> = []
        const r = el.getBoundingClientRect()
        if (r.width < cellW * 2) continue
        if (tag === 'HR') edges.push([r.top + r.height / 2, cs.borderTopColor, 'hr'])
        else {
            if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none')
                edges.push([r.top + parseFloat(cs.borderTopWidth) / 2, cs.borderTopColor, 'top'])
            if (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none')
                edges.push([r.bottom - parseFloat(cs.borderBottomWidth) / 2, cs.borderBottomColor, 'bottom'])
        }
        if (edges.length === 0 || !visible(el)) continue
        for (const [y, css, _kind] of edges) {
            const rgba = parseRgba(css)
            if (!rgba || rgba[3] === 0) continue
            const row = Math.floor((y - originY) / cellH)
            const color = nearestGlyphColor([rgba[0], rgba[1], rgba[2]], palette)
            const c0 = Math.floor((r.left - originX) / cellW)
            const c1 = Math.ceil((r.right - originX) / cellW)
            for (let col = c0; col < c1; col++) {
                if (inGrid(col, row)) under.set(row * cols + col, { col, row, ch: '─', color })
            }
        }
    }

    // text: every rendered glyph (text chars and ::before/::after strings such as the bracket
    // buttons' [ ]) with its box, then laid out line by line as runs of consecutive cells
    const alignCache = new Map<Element, TextAlign>()
    const alignOf = (el: Element): TextAlign => {
        let a = alignCache.get(el)
        if (!a) {
            const v = getComputedStyle(el).textAlign
            a = v === 'center' || v === '-webkit-center' ? 'center' : v === 'right' || v === 'end' ? 'right' : 'left'
            alignCache.set(el, a)
        }
        return a
    }
    const glyphs: TextGlyph[] = []
    const owner: Element[] = [] // the text node's parent, per glyph
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement
        const s = node.textContent ?? ''
        if (!parent || !s.trim() || !visible(parent)) continue
        const tag = parent.tagName
        if (tag === 'SCRIPT' || tag === 'STYLE') continue
        const color = tokenFor(parent)
        const align = alignOf(parent)
        for (let i = 0; i < s.length; i++) {
            range.setStart(node, i)
            range.setEnd(node, i + 1)
            const r = range.getBoundingClientRect()
            if (r.width <= 0 || r.height <= 0) continue
            glyphs.push({ ch: /\s/.test(s[i]) ? ' ' : s[i], l: r.left, r: r.right, t: r.top, b: r.bottom, color, align })
            owner.push(parent)
        }
    }
    const textGlyphs = glyphs.length
    for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'CANVAS' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
        for (const which of ['::before', '::after'] as const) {
            const cs = getComputedStyle(el, which)
            if (cs.display === 'none' || cs.visibility === 'hidden') continue
            const str = pseudoContentText(cs.content)
            if (!str.trim() || !visible(el)) continue
            const rgba = parseRgba(cs.color)
            const color = rgba ? nearestGlyphColor([rgba[0], rgba[1], rgba[2]], palette) : tokenFor(el)
            // a pseudo-element has no Range: put it beside the element's own first / last glyph
            let first: TextGlyph | undefined
            let last: TextGlyph | undefined
            for (let i = 0; i < textGlyphs; i++) {
                if (glyphs[i].ch === ' ' || !el.contains(owner[i])) continue
                first ??= glyphs[i]
                last = glyphs[i]
            }
            const box = el.getBoundingClientRect()
            if (!first && (box.width <= 0 || box.height <= 0)) continue
            const w = first ? first.r - first.l : cellW
            const t = first ? first.t : box.top
            const b = first ? first.b : box.bottom
            const k = str.length
            for (let i = 0; i < k; i++) {
                const l =
                    which === '::before'
                        ? (first ? first.l : box.left + k * w) - (k - i) * w
                        : (last ? last.r : box.right - k * w) + i * w
                glyphs.push({ ch: str[i], l, r: l + w, t, b, color, align: alignOf(el) })
            }
        }
    }
    for (const c of layoutText(glyphs, m)) text.set(c.row * cols + c.col, c)

    const merged = new Map(under)
    for (const [k, v] of text) merged.set(k, v)
    return { cols, rows, cells: [...merged.values()].sort((a, b) => a.row - b.row || a.col - b.col) }
}
