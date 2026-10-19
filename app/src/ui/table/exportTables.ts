// app/src/ui/table/exportTables.ts — the typed Bismuth table in an html/pdf/png export. An export is
// an HTML STRING wrapped into a standalone document (export/htmlTemplate.ts), which cannot reach the
// app's stylesheets or its Solid roots, so:
//   - typeExportTables types every table in the body with the app's own typer (typeTable.ts: the
//     `+ - | =` grid of AsciiCellEdges, the cell rules, column alignment) in a detached host,
//     serializes the result, and returns the CSS that paints it: the app's own `.bismuth-table` and
//     AsciiCellEdges rules read back from the live stylesheets, plus the custom properties they use,
//     resolved to literals. One thing differs from the app: the app paints a cell's glyphs as a
//     MASK over its ink, and WebKit's PDF output (the desktop app's native print) paints that mask
//     inverted — a solid block over the cell with the glyphs cut out. So in a document each overlay
//     paints the same glyph sprite, pre-tinted in its ink, as a nine-slice `border-image`: the same
//     slices, widths and `round` repeat, as an ordinary image every engine prints;
//   - bakeTableEdges is for the html2canvas rasterizer (export/htmlToPdf.ts), which paints no
//     `border-image` either: it draws each overlay's nine-slice into an image of the overlay's box
//     and paints that as its background instead. The native WebKit printer and a saved .html paint
//     the `border-image` themselves and never call it.
// A table in an export does not squeeze to fit (fitTable.ts needs the live frame's width).
import {
    EDGE_KEYS,
    edgeSelector,
    spriteVar,
    whenAsciiGlyphTilesInstalled,
} from '../ascii/asciiGlyphTiles'
import { typeTable } from './typeTable'

/** Type every table in `html`; `ink`, when given, replaces the app's grid ink (a light "paper"
 *  export over a dark app). Returns `html` untouched, with no CSS, when it holds no table. */
export async function typeExportTables(
    html: string,
    ink?: string,
): Promise<{ html: string; css: string }> {
    if (typeof document === 'undefined' || !/<table[\s>]/i.test(html))
        return { html, css: '' }
    await whenAsciiGlyphTilesInstalled()
    const host = document.createElement('div')
    host.innerHTML = html
    const typed = Array.from(host.querySelectorAll('table')).map(typeTable)
    const edges = host.querySelector('[data-edges]')
    const out = host.innerHTML
    const css =
        tableCss(edges?.classList[0]) + (await spriteCss(host, inkColor(ink)))
    typed.forEach(t => t.dispose())
    return { html: out, css }
}

/** `ink` (or the app's grid ink, --border-soft) as a colour a canvas can fill with. */
function inkColor(ink?: string): string {
    const probe = document.createElement('span')
    probe.style.color = ink ?? 'var(--border-soft)'
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
}

/** The overlay as a nine-slice `border-image` of its sprite, tinted `ink`, for each edge set in
 *  `host`. Geometry (insets, overhang) stays the app's own `.edges` rule. */
async function spriteCss(host: HTMLElement, ink: string): Promise<string> {
    const root = getComputedStyle(document.documentElement)
    const rules = [
        `[data-table-edges] > [data-edges] { -webkit-mask-box-image: none !important; ` +
            `background: none !important; border: solid transparent; ` +
            `border-width: var(--ascii-tile-h) var(--ascii-corner-w); ` +
            `border-image-slice: var(--ascii-slice-y) var(--ascii-slice-x); ` +
            `border-image-width: var(--ascii-tile-h) var(--ascii-corner-w); ` +
            `border-image-repeat: round; }`,
    ]
    for (const key of EDGE_KEYS) {
        const selector = `[data-table-edges] > ${edgeSelector(key)}`
        if (!host.querySelector(selector)) continue
        const src = urlOf(root.getPropertyValue(spriteVar(key)))
        if (!src) continue
        const img = await loadImage(src, document)
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.drawImage(img, 0, 0)
        ctx.globalCompositeOperation = 'source-in'
        ctx.fillStyle = ink
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        rules.push(
            `${selector} { border-image-source: url(${canvas.toDataURL('image/png')}); }`,
        )
    }
    return '\n' + rules.join('\n')
}

const urlOf = (value: string) => /url\(["']?(.*?)["']?\)/.exec(value)?.[1]

/** The live rules that paint a typed table, and the custom properties they read. */
function tableCss(edgesClass: string | undefined): string {
    const rules: string[] = []
    const wanted = (selector: string) =>
        selector.includes('.bismuth-table') ||
        (!!edgesClass && selector.includes(`.${edgesClass}`))
    const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
            if (rule instanceof CSSStyleRule) {
                if (wanted(rule.selectorText)) rules.push(rule.cssText)
            } else if (
                rule instanceof CSSLayerBlockRule ||
                rule instanceof CSSSupportsRule
            )
                walk(rule.cssRules)
        }
    }
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            walk(sheet.cssRules)
        } catch {
            // a cross-origin sheet cannot be read, and holds none of these rules
        }
    }
    const names = new Set<string>()
    for (const rule of rules)
        for (const m of rule.matchAll(/var\(\s*(--[\w-]+)/g)) names.add(m[1])
    const root = getComputedStyle(document.documentElement)
    const vars: string[] = []
    for (const name of names) {
        // a custom property's computed value has every var() it names substituted
        const value = root.getPropertyValue(name).trim()
        if (value) vars.push(`${name}:${value}`)
    }
    return `:root{${vars.join(';')}}\n${rules.join('\n')}`
}

const loadImage = (src: string, doc: Document) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const img = doc.createElement('img')
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
    })

/** Draw `img` as a nine-slice over a `w` x `h` box: corners 1:1 at `cornerW` x `tileH`, edge
 *  slices repeated with CSS `round` (a whole number of tiles, stretched to fit) — what the
 *  overlay's `border-image` does with the same slice and widths. */
function nineSlice(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    slice: { x: number; y: number },
    cornerW: number,
    tileH: number,
    w: number,
    h: number,
) {
    const iw = img.naturalWidth
    const ih = img.naturalHeight
    const midW = iw - 2 * slice.x
    const midH = ih - 2 * slice.y
    const corners: [number, number, number, number][] = [
        [0, 0, 0, 0],
        [iw - slice.x, 0, w - cornerW, 0],
        [0, ih - slice.y, 0, h - tileH],
        [iw - slice.x, ih - slice.y, w - cornerW, h - tileH],
    ]
    for (const [sx, sy, dx, dy] of corners)
        ctx.drawImage(img, sx, sy, slice.x, slice.y, dx, dy, cornerW, tileH)
    const across = w - 2 * cornerW
    if (across > 0 && midW > 0) {
        const n = Math.max(1, Math.round(across / (midW * (tileH / slice.y))))
        const step = across / n
        for (let i = 0; i < n; i++) {
            const dx = cornerW + i * step
            ctx.drawImage(img, slice.x, 0, midW, slice.y, dx, 0, step, tileH)
            ctx.drawImage(
                img,
                slice.x,
                ih - slice.y,
                midW,
                slice.y,
                dx,
                h - tileH,
                step,
                tileH,
            )
        }
    }
    const down = h - 2 * tileH
    if (down > 0 && midH > 0) {
        const n = Math.max(1, Math.round(down / (midH * (cornerW / slice.x))))
        const step = down / n
        for (let i = 0; i < n; i++) {
            const dy = tileH + i * step
            ctx.drawImage(img, 0, slice.y, slice.x, midH, 0, dy, cornerW, step)
            ctx.drawImage(
                img,
                iw - slice.x,
                slice.y,
                slice.x,
                midH,
                w - cornerW,
                dy,
                cornerW,
                step,
            )
        }
    }
}

/** Replace every typed cell's glyph `border-image` in the laid-out `doc` with a background image of
 *  what it paints, at `scale` device pixels per CSS pixel. Leaves the layout untouched. */
export async function bakeTableEdges(doc: Document, scale: number) {
    const win = doc.defaultView
    const overlays = Array.from(
        doc.querySelectorAll<HTMLElement>('[data-table-edges] > [data-edges]'),
    )
    if (!win || !overlays.length) return
    const root = win.getComputedStyle(doc.documentElement)
    const num = (name: string) => parseFloat(root.getPropertyValue(name))
    const slice = { x: num('--ascii-slice-x'), y: num('--ascii-slice-y') }
    const cornerW = num('--ascii-corner-w')
    const tileH = num('--ascii-tile-h')
    if (!(slice.x > 0 && slice.y > 0 && cornerW > 0 && tileH > 0)) return
    const sprites = new Map<string, Promise<HTMLImageElement>>()
    const baked = new Map<string, string>()
    for (const el of overlays) {
        const src = urlOf(
            win.getComputedStyle(el).getPropertyValue('border-image-source'),
        )
        const w = el.offsetWidth
        const h = el.offsetHeight
        // html2canvas skips a `display: contents` box's children, so the overlay moves up into its
        // cell, the host it is positioned against anyway. Out of its `[data-table-edges]` mount the
        // document's overlay rule no longer matches it, so what that rule cleared is cleared inline.
        el.parentElement?.parentElement?.appendChild(el)
        el.style.borderImage = 'none'
        el.style.setProperty('-webkit-mask-box-image', 'none', 'important')
        el.style.setProperty('background-color', 'transparent', 'important')
        if (!src || !(w > 0 && h > 0)) continue
        const key = `${src.length}:${src.slice(-64)}:${w}x${h}`
        let url = baked.get(key)
        if (!url) {
            if (!sprites.has(src)) sprites.set(src, loadImage(src, doc))
            const img = await sprites.get(src)!
            const canvas = doc.createElement('canvas')
            canvas.width = Math.ceil(w * scale)
            canvas.height = Math.ceil(h * scale)
            const ctx = canvas.getContext('2d')
            if (!ctx) continue
            ctx.scale(scale, scale)
            nineSlice(ctx, img, slice, cornerW, tileH, w, h)
            url = canvas.toDataURL('image/png')
            baked.set(key, url)
        }
        el.style.backgroundImage = `url(${url})`
        el.style.backgroundSize = `${w}px ${h}px`
        el.style.backgroundRepeat = 'no-repeat'
    }
}
