// app/src/export/inkHtml.ts
//
// Turns a note's ```draw fences into real pictures in the exported document.
//
// Without this, everything outside app/src/editor/ treats a draw fence like any other fence:
// `renderMarkdown` hands it to marked, marked emits `<pre><code class="language-draw">`, and a
// note's ink exports to html/pdf/png as a WALL OF BASE64 in a grey code block. That is what the
// user was asking for when they said the CLI should "print the tpage into a pdf and look at it".
//
// ── How a fence becomes a picture ────────────────────────────────────────────────────────────
// Each fence is rasterized to a TRANSPARENT PNG (ExportDeps.drawingToPng's `box` argument) whose
// LOGICAL coordinate space is the same one the fence stores: INK_LOGICAL_W (680) wide. The
// document then places that raster with CSS, and the placement is where the whole design lives:
//
//   ATTACHED (```draw) — ink drawn OVER the block it annotates, so it must render over that
//     block, not after it. The annotated block is wrapped in a `position: relative` container
//     and the raster is absolutely positioned inside it. Per inkCommit.ts's coordinate contract
//     the geometry is ASYMMETRIC — x in the 680px logical column, y in UNSCALED PIXELS below the
//     block's TOP — so the raster is placed `width: 100%; height: <its own px>`:
//       * width:100%  maps logical x 0..680 onto the column, i.e. exactly the editor's own
//         `contentWidth / INK_LOGICAL_W` scale, WITHOUT this module having to know what the
//         column width is. That matters: the column is 624px-wide printable Letter in the PDF,
//         760px in the PNG, and whatever the window is in a .html export. A baked-in guess would
//         put an annotation near its paragraph instead of on it in two of those three.
//       * height:<px> keeps y unscaled, which is the half of the contract that stops ink walking
//         away from its words when the column is not 680px wide.
//   STANDALONE (```draw block) — a drawing of its own, in the flow, reserving the height
//     `standaloneHeight` describes. Both axes are on the logical scale here, so it is placed
//     `width: 100%; height: auto` and scales as one picture, uniformly.
//
// ACCEPTED COST, stated because it is not obvious: the attached placement is a NON-UNIFORM CSS
// scale (x by the column ratio, y by 1), so a round pen nib renders as a slight ellipse and
// attached ink is proportionally thicker vertically at a column narrower than 680px (~15% in the
// PDF). Fixing that means transforming the stroke POINTS at raster time the way InkOverlay does,
// which requires knowing the column width — the one thing this placement deliberately refuses to
// guess. Position beats nib roundness: the design's own out-of-scope line is "close and honest,
// not exact", and the bug class this plan spent three review rounds on was ink in the wrong
// place, never ink slightly out of round.
import {
    blockFirstLine,
    drawFenceLineSet,
    scanDrawBlocks,
} from '../../../core/src/drawing/drawBlocks'
import {
    INK_LOGICAL_W,
    type InkBox,
    type Stroke,
} from '../../../core/src/drawing/model'
import { inkBounds, standaloneHeight } from '../editor/drawBlockGeometry'
import { DEFAULT_STANDALONE_PAD } from '../editor/inkCommit'
import { frontmatterCloseLine } from '../editor/frontmatterUtils'
import { escapeAttr } from '../htmlEscape'
import type { ExportDeps, ExportTheme } from './types'

/** Logical slack left around ATTACHED ink so a nib on the raster's edge is not clipped in half.
 *  Costs nothing: an attached raster is absolutely positioned, so growing it moves no text. A
 *  standalone raster needs none — `standaloneHeight` already reserves DEFAULT_STANDALONE_PAD
 *  below the ink, and above it the widget top is the block boundary the ink was anchored to, so
 *  there is nothing there to slice a nib against. */
const ATTACHED_MARGIN = 12

/** How one fence is placed in the exported document. The three shapes differ in what they are
 *  positioned AGAINST, which is the only thing that decides whether ink lands on its words. */
export type InkShape =
    /** ```draw with a block above it: absolutely positioned over that block. */
    | 'attached'
    /** ```draw block: a picture in the document flow, reserving its own height. */
    | 'standalone'
    /** ```draw with NOTHING above it to decorate — a degenerate fence the editor paints from
     *  its own top on the uniform logical scale while reserving no height. Mirrored here as a
     *  zero-height overlay so the export neither drops the ink nor invents space for it. */
    | 'loose'

/** One fence, resolved into everything the rewrite needs. Pure data — no raster yet. */
export interface InkPlacement {
    /** 1-based inclusive line range of the fence, which the rewrite replaces. */
    fromLine: number
    toLine: number
    shape: InkShape
    /** `attached` only: the 1-based first line of the block being annotated. The opening
     *  wrapper `<div>` is inserted before it. */
    wrapFromLine: number
    /** `attached` only: the raster's top edge in px below the annotated block's top. Negative
     *  when ink overhangs upward, which is legal — the lasso allows it. */
    top: number
    /** The raster's logical box. `width` is always INK_LOGICAL_W; see the header. */
    box: InkBox
    /** The fence's strokes, translated into the raster's own space. Empty means "no ink": the
     *  fence is still deleted from the output (an empty base64 code block is not a picture),
     *  but nothing is drawn. */
    strokes: Stroke[]
}

/** The stylesheet the placements below need, injected through `bodyHtml`'s `css` slot. Emitted
 *  only for a document that actually has ink. */
export const INK_CSS = `
  /* A block carrying an annotation. position:relative is the anchor the ink is placed against;
     margins still collapse through it, so its top edge IS the annotated block's top edge —
     the same edge inkCommit.ts stores attached y against. break-inside keeps an annotated
     paragraph whole, because an absolutely positioned overlay lands on the FIRST fragment of a
     split box and would otherwise be left behind on the previous page. */
  .bismuth-ink-wrap { position: relative; break-inside: avoid; page-break-inside: avoid; }
  .bismuth-ink-attached { position: absolute; left: 0; right: 0; pointer-events: none; }
  /* max-width:none overrides the document's blanket "img { max-width: 100% }" rule, which
     would otherwise fight the explicit sizing. */
  .bismuth-ink-attached > img { display: block; width: 100%; height: 100%; max-width: none; }
  /* A drawing of its own: uniform scale, so height comes from the raster's aspect ratio and
     the reserved space tracks the column width exactly as the editor's widget does. */
  .bismuth-ink-standalone { break-inside: avoid; page-break-inside: avoid; }
  .bismuth-ink-standalone > img { display: block; width: 100%; height: auto; }
  .bismuth-ink-loose { position: relative; height: 0; }
  .bismuth-ink-loose > img { position: absolute; left: 0; top: 0; width: 100%; height: auto; max-width: none; }
`

/** Translate every point's y by `dy`, leaving x and the pressure byte alone. */
function shiftY(strokes: Stroke[], dy: number): Stroke[] {
    if (!dy) return strokes
    return strokes.map(s => ({
        ...s,
        pts: s.pts.map((n, i) => (i % 3 === 1 ? n + dy : n)),
    }))
}

/**
 * Resolve every ```draw fence in `text` into how the exported document should place it. Pure,
 * so the geometry that decides whether an annotation lands on its words is testable without a
 * browser, a raster or a rendered page.
 *
 * `text` may or may not still carry its frontmatter; the boundary is found here either way, so
 * callers do not have to keep line numbers and a stripped body in sync.
 */
export function planInkPlacements(text: string): InkPlacement[] {
    const blocks = scanDrawBlocks(text)
    if (!blocks.length) return []
    const lines = text.split('\n')
    const fenceLines = drawFenceLineSet(blocks, lines.length)
    // The floor the run walk must not cross, so an annotation on the first paragraph never
    // anchors itself to the note's metadata.
    const fmClose = frontmatterCloseLine(text)

    return blocks.map(b => {
        const bounds = inkBounds(b.strokes)
        const empty: InkPlacement = {
            fromLine: b.fromLine,
            toLine: b.toLine,
            shape: b.standalone ? 'standalone' : 'loose',
            wrapFromLine: b.fromLine,
            top: 0,
            box: { width: INK_LOGICAL_W, height: 0 },
            strokes: [],
        }
        if (!bounds) return empty

        if (b.standalone) {
            // The ink already sits inside its own reserved box: writeBand/planStrokeEdit keep
            // minY at or above 0 and the box runs from that same top (`maxY + pad`), so the
            // raster is that box exactly and the strokes go in untranslated.
            return {
                ...empty,
                shape: 'standalone',
                box: {
                    width: INK_LOGICAL_W,
                    height: standaloneHeight(b.strokes, DEFAULT_STANDALONE_PAD),
                },
                strokes: b.strokes,
            }
        }

        const top = Math.floor(bounds.minY - ATTACHED_MARGIN)
        const height = Math.ceil(bounds.maxY + ATTACHED_MARGIN) - top
        const strokes = shiftY(b.strokes, -top)
        if (b.attachedToLine === null) {
            // Nothing above to decorate. The editor paints this from the fence's own top on the
            // uniform logical scale and reserves no height; mirror that rather than inventing an
            // owner or reserving space the editor does not.
            return {
                ...empty,
                shape: 'loose',
                top: 0,
                box: {
                    width: INK_LOGICAL_W,
                    height: Math.ceil(bounds.maxY + ATTACHED_MARGIN),
                },
                strokes: b.strokes,
            }
        }
        return {
            fromLine: b.fromLine,
            toLine: b.toLine,
            shape: 'attached',
            wrapFromLine: blockFirstLine(
                b.attachedToLine,
                lines.length,
                n => lines[n - 1] ?? '',
                fenceLines,
                fmClose,
            ),
            top,
            box: { width: INK_LOGICAL_W, height },
            strokes,
        }
    })
}

/** The `.draw` document shape `ExportDeps.drawingToPng` takes, for one fence's strokes. Reusing
 *  that seam rather than adding a second rasterizer is what keeps the browser export and
 *  `bismuth export` rendering ink through the same code. */
export function inkDocText(strokes: Stroke[]): string {
    return JSON.stringify({
        v: 1,
        kind: 'drawing',
        paper: { bg: 'blank' },
        pages: [{ strokes }],
    })
}

/** The HTML lines one placement contributes at the fence's position. `src` is the raster's
 *  data URL. */
function placementHtml(p: InkPlacement, src: string): string[] {
    const img = `<img src="${escapeAttr(src)}" alt="">`
    if (p.shape === 'standalone')
        return [`<div class="bismuth-ink-standalone">${img}</div>`]
    if (p.shape === 'loose')
        return [`<div class="bismuth-ink-loose">${img}</div>`]
    const style = `top:${p.top}px;height:${p.box.height}px`
    return [
        `<div class="bismuth-ink-attached" style="${escapeAttr(style)}">${img}</div>`,
        '</div>',
    ]
}

/**
 * Rewrite `text` so each fence becomes the markup `placementHtml` describes, with the annotated
 * block wrapped for the attached case. Pure over `srcFor`, which supplies each placement's
 * already-rasterized data URL (or `''` for a fence with no ink, which is simply deleted).
 *
 * The output is still MARKDOWN — marked passes a block-level HTML element through untouched and
 * resumes parsing markdown after the blank line that ends it, so the wrapped paragraph still
 * renders as a paragraph, with its emphasis and links intact. That is why the wrapper is opened
 * and closed as two separate HTML blocks around real markdown rather than by rewriting the
 * rendered HTML, where finding "the element before this one" means parsing HTML with a regex.
 */
export function inkMarkdown(
    text: string,
    placements: InkPlacement[],
    srcFor: (p: InkPlacement, index: number) => string,
): string {
    if (!placements.length) return text
    const lines = text.split('\n')
    // null = this line is deleted; a string array = these lines replace it.
    const out: (string | string[] | null)[] = lines.map(l => l)
    const before = new Map<number, string[]>()

    placements.forEach((p, i) => {
        for (let n = p.fromLine; n <= Math.min(p.toLine, lines.length); n++) {
            out[n - 1] = null
        }
        const src = srcFor(p, i)
        if (!src || !p.strokes.length) return
        // A blank line on each side so marked reads the markup as its own HTML block rather
        // than as a lazy continuation of the paragraph above it.
        out[p.fromLine - 1] = ['', ...placementHtml(p, src), '']
        if (p.shape === 'attached') {
            const at = p.wrapFromLine - 1
            const open = before.get(at)
            const lead = ['', '<div class="bismuth-ink-wrap">', '']
            before.set(at, open ? [...open, ...lead] : lead)
        }
    })

    const rendered: string[] = []
    out.forEach((line, i) => {
        const lead = before.get(i)
        if (lead) rendered.push(...lead)
        if (line === null) return
        if (Array.isArray(line)) rendered.push(...line)
        else rendered.push(line)
    })
    return rendered.join('\n')
}

/**
 * The whole step, wired: plan every fence, rasterize each one through the existing
 * `drawingToPng` seam, and hand back markdown that renders the ink as pictures plus the CSS
 * that places them (`''` when the note has no ink, so a note without drawings pays nothing and
 * its exported document is byte-identical to before).
 */
export async function inkifyMarkdown(
    text: string,
    deps: ExportDeps,
    theme: ExportTheme,
): Promise<{ text: string; css: string }> {
    const placements = planInkPlacements(text)
    if (!placements.length) return { text, css: '' }
    const srcs: string[] = []
    for (const p of placements) {
        if (!p.strokes.length || p.box.height <= 0) {
            srcs.push('')
            continue
        }
        const { dataUrl } = await deps.drawingToPng(
            inkDocText(p.strokes),
            theme,
            p.box,
        )
        srcs.push(dataUrl)
    }
    const drawn = srcs.some(s => s !== '')
    return {
        text: inkMarkdown(text, placements, (_p, i) => srcs[i]),
        css: drawn ? INK_CSS : '',
    }
}
