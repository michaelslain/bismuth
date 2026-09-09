// app/src/export/drawingRaster.ts
// Rasterizes a drawing doc to a PNG in the browser using the core (browser-safe) render2d.
import {
    parseDoc,
    emptyDoc,
    PAGE_W,
    PAGE_H,
    type DrawingDoc,
    type InkBox,
} from '../../../core/src/drawing/model'
import {
    renderDocStacked,
    renderInkLayer,
    type Ctx2D,
} from '../../../core/src/drawing/render2d'
import { themeColors } from '../../../core/src/drawing/theme'

const SCALE = 2

function parse(text: string): DrawingDoc {
    try {
        return parseDoc(text)
    } catch {
        return emptyDoc()
    }
}

/** Pre-decode every distinct image src in the doc into HTMLImageElements so the synchronous
 *  render2d can blit them (placed images + image/markup backgrounds). Undecodable srcs are
 *  skipped (rendered as nothing) rather than failing the whole export. */
async function decodeImages(
    doc: DrawingDoc,
): Promise<Map<string, HTMLImageElement>> {
    const srcs = new Set<string>()
    for (const pg of doc.pages)
        for (const im of pg.images ?? []) srcs.add(im.src)
    const map = new Map<string, HTMLImageElement>()
    await Promise.all(
        [...srcs].map(
            src =>
                new Promise<void>(resolve => {
                    const img = new Image()
                    img.onload = () => {
                        map.set(src, img)
                        resolve()
                    }
                    img.onerror = () => resolve()
                    img.src = src
                }),
        ),
    )
    return map
}

/** PNG bytes + data URL for a canvas the caller has already painted. */
function encode(canvas: HTMLCanvasElement): {
    bytes: Uint8Array
    dataUrl: string
} {
    const dataUrl = canvas.toDataURL('image/png')
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), ch =>
        ch.charCodeAt(0),
    )
    return { bytes, dataUrl }
}

/** One page of strokes on a TRANSPARENT ground at a caller-chosen logical size — the note-ink
 *  raster (see inkHtml.ts). A canvas starts transparent, so this is `renderInkLayer` and
 *  nothing else: no paper fill, which would hide the very words an annotation is drawn on.
 *  The browser twin of core/src/drawing/export.ts's `inkLayerToPng` — both sides of
 *  `ExportDeps.drawingToPng` render the same document, so they must agree. */
function inkLayerToPng(doc: DrawingDoc, theme: 'dark' | 'light', box: InkBox) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(box.width * SCALE))
    canvas.height = Math.max(1, Math.round(box.height * SCALE))
    const ctx = canvas.getContext('2d')! as unknown as Ctx2D & {
        scale(x: number, y: number): void
    }
    ctx.scale(SCALE, SCALE)
    renderInkLayer(ctx, doc.pages[0]?.strokes ?? [], themeColors(theme))
    return encode(canvas)
}

export async function drawingToPng(
    docText: string,
    theme: 'dark' | 'light' = 'light',
    box?: InkBox,
): Promise<{ bytes: Uint8Array; dataUrl: string }> {
    const doc = parse(docText)
    if (box) return inkLayerToPng(doc, theme, box)
    const images = await decodeImages(doc)
    const n = Math.max(1, doc.pages.length)
    const canvas = document.createElement('canvas')
    canvas.width = PAGE_W * SCALE
    canvas.height = PAGE_H * n * SCALE
    const ctx = canvas.getContext('2d')! as unknown as Ctx2D & {
        scale(x: number, y: number): void
        translate(x: number, y: number): void
        save(): void
        restore(): void
    }
    ctx.scale(SCALE, SCALE)
    renderDocStacked(
        ctx,
        doc,
        themeColors(theme),
        PAGE_W,
        PAGE_H,
        (_c, dx, dy, body) => {
            ctx.save()
            ctx.translate(dx, dy)
            body()
            ctx.restore()
        },
        src => images.get(src),
    )
    return encode(canvas)
}
