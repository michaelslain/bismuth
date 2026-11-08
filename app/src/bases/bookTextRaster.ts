// app/src/bases/bookTextRaster.ts
// Kept for the _bookPages.ts story fixture (with bookText.ts); the reader no longer draws text pages itself.
// Draws one typeset text page to a 2x canvas: the face the page curl shows in text mode.
import type { TextPage, TextRun } from './bookText'

/** How a formula draws on the curl: its width, and its picture once one is ready. Without a
 *  picture its place is left blank for the turn; the still page shows it. */
export type RasterMath = (tex: string, display: boolean) => { w: number; picture?: { canvas: CanvasImageSource & { width: number; height: number }; ascent: number } }

/** The TeX inside a math run's `$…$` or `$$…$$`. */
export const texOf = (run: TextRun): string => (run.math === 'display' ? run.text.slice(2, -2) : run.text.slice(1, -1))

export function rasterTextPage(
    page: TextPage,
    size: { w: number; h: number },
    colors: { bg: string; fg: string; mark: string; muted?: string },
    font: string,
    math?: RasterMath,
): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = size.w * 2
    c.height = size.h * 2
    const g = c.getContext('2d')!
    g.scale(2, 2)
    g.fillStyle = colors.bg
    g.fillRect(0, 0, size.w, size.h)
    g.textBaseline = 'alphabetic'
    const px = parseFloat(font) || 12
    const bold = `bold ${font}`
    for (const line of page.lines) {
        let x = line.x
        const ink = line.placeholder ? (colors.muted ?? colors.fg) : colors.fg
        for (const run of line.runs) {
            if (run.math) {
                const m = math?.(texOf(run), run.math === 'display')
                const w = m?.w ?? g.measureText(run.text).width
                if (run.mark) {
                    g.fillStyle = colors.mark
                    g.fillRect(x, line.y - px * 0.85, w, px * 1.1)
                }
                const k = line.scale ?? 1
                if (m?.picture) {
                    const p = m.picture
                    g.drawImage(p.canvas, x, line.y - p.ascent * k, (p.canvas.width / 2) * k, (p.canvas.height / 2) * k)
                }
                x += w * k
                continue
            }
            g.font = run.bold ? bold : font
            const tokens = run.text.split(/( )/).filter(t => t !== '')
            const start = x
            const spans: [string, number][] = []
            for (const t of tokens) {
                if (t === ' ') {
                    spans.push([t, line.gap])
                    x += line.gap
                } else {
                    const w = g.measureText(t).width
                    spans.push([t, w])
                    x += w
                }
            }
            if (run.mark) {
                // the tint covers the words and the gaps between them, not a gap at the run's edge
                const lead = tokens[0] === ' ' ? line.gap : 0
                const trail = tokens[tokens.length - 1] === ' ' ? line.gap : 0
                g.fillStyle = colors.mark
                g.fillRect(start + lead, line.y - px * 0.85, x - start - lead - trail, px * 1.1)
            }
            g.fillStyle = ink
            let cx = start
            for (const [t, w] of spans) {
                if (t !== ' ') g.fillText(t, cx, line.y)
                cx += w
            }
        }
    }
    return c
}
