import { describe, expect, test } from 'bun:test'
import {
    INK_CSS,
    inkMarkdown,
    inkifyMarkdown,
    planInkPlacements,
} from './inkHtml'
import { encodeStrokes } from '../../../core/src/drawing/inkCodec'
import { INK_LOGICAL_W, type Stroke } from '../../../core/src/drawing/model'
import { DEFAULT_STANDALONE_PAD } from '../editor/inkCommit'
import type { ExportDeps, InkBox } from './types'

/** A two-point stroke spanning the given box, so a test can state the geometry it expects
 *  rather than deriving it from a blob. */
const stroke = (x0: number, y0: number, x1: number, y1: number): Stroke => ({
    t: 'pen',
    c: '#e6007a',
    w: 4,
    pts: [x0, y0, 180, x1, y1, 180],
})

const fence = (info: string, strokes: Stroke[]) =>
    '```' + info + '\n' + encodeStrokes(strokes) + '\n```'

const ANNOTATION = [stroke(40, 4, 520, 18)]
const SKETCH = [stroke(80, 24, 600, 260)]

const NOTE =
    'The mitochondria is the powerhouse\nof the cell.\n' +
    fence('draw', ANNOTATION) +
    '\n\n' +
    fence('draw block', SKETCH) +
    '\n\nTail paragraph.\n'

/** Records every box the rewrite asks the rasterizer for, so a test can assert the geometry
 *  that actually reaches the raster rather than only what the markup says. */
function recordingDeps(): { deps: ExportDeps; boxes: (InkBox | undefined)[] } {
    const boxes: (InkBox | undefined)[] = []
    const deps = {
        drawingToPng: async (_text: string, _theme: string, box?: InkBox) => {
            boxes.push(box)
            return {
                bytes: new Uint8Array([1]),
                dataUrl: `data:image/png;base64,BOX${boxes.length}`,
            }
        },
    } as unknown as ExportDeps
    return { deps, boxes }
}

describe('planInkPlacements', () => {
    test('a note with no draw fence plans nothing', () => {
        expect(planInkPlacements('# Title\n\nJust prose.\n')).toEqual([])
        expect(planInkPlacements('```ts\nconst x = 1\n```\n')).toEqual([])
    })

    test('an attached fence wraps the WHOLE run it decorates, not just its last line', () => {
        const [attached] = planInkPlacements(NOTE)
        expect(attached.shape).toBe('attached')
        // "of the cell." is line 2 and is what the fence hangs off; the paragraph BEGINS on
        // line 1, and that is the edge attached y is stored against.
        expect(attached.wrapFromLine).toBe(1)
        expect(attached.fromLine).toBe(3)
    })

    test('an attached raster is a 680-wide box around the ink, anchored in pixels', () => {
        const [attached] = planInkPlacements(NOTE)
        // ink spans y 4..18; the raster keeps 12px of slack so a nib is not sliced in half.
        expect(attached.box).toEqual({ width: INK_LOGICAL_W, height: 38 })
        expect(attached.top).toBe(-8)
        // Strokes are translated into the raster's own space: stored y 4 sits 12 below its top.
        expect(attached.strokes[0].pts.slice(0, 2)).toEqual([40, 12])
    })

    test('a standalone raster reserves exactly the height the editor widget does', () => {
        const [, standalone] = planInkPlacements(NOTE)
        expect(standalone.shape).toBe('standalone')
        // standaloneHeight runs from the widget top to a pad past the ink (`maxY + pad`), and
        // the strokes go in untranslated because the fence already stores them inside that box.
        // This fixture's ink starts at exactly `pad`, the normalized shape, so the number is the
        // same one the older `span + 2*pad` rule produced.
        expect(standalone.box).toEqual({
            width: INK_LOGICAL_W,
            height: 260 - 24 + DEFAULT_STANDALONE_PAD * 2,
        })
        expect(standalone.strokes[0].pts.slice(0, 2)).toEqual([80, 24])
    })

    test('an attached fence with nothing above it is loose, not anchored to a block', () => {
        const [only] = planInkPlacements(fence('draw', ANNOTATION) + '\n')
        expect(only.shape).toBe('loose')
    })

    test('an annotation on the first paragraph never anchors to the frontmatter', () => {
        // NO blank line after the closing `---`: a blank line would stop the run walk on its
        // own and the frontmatter guard would never be reached, which is exactly what made an
        // earlier version of this test unable to fail.
        const text =
            '---\ntitle: A\ntags: [x]\n---\nFirst paragraph.\n' +
            fence('draw', ANNOTATION) +
            '\n'
        const [attached] = planInkPlacements(text)
        expect(attached.shape).toBe('attached')
        expect(attached.wrapFromLine).toBe(5) // "First paragraph.", not "---" or "title: A"
    })

    test('an empty fence plans no strokes, so it is deleted rather than drawn', () => {
        const [empty] = planInkPlacements('Para.\n' + fence('draw', []) + '\n')
        expect(empty.strokes).toEqual([])
    })
})

describe('inkMarkdown', () => {
    const rewritten = () =>
        inkMarkdown(
            NOTE,
            planInkPlacements(NOTE),
            (_p, i) => `data:image/png;base64,SRC${i}`,
        )

    test('no draw fence survives into the rendered markdown', () => {
        const out = rewritten()
        expect(out).not.toContain('```draw')
        expect(out).not.toContain(encodeStrokes(ANNOTATION))
    })

    test('the prose is left byte-identical', () => {
        const out = rewritten()
        expect(out).toContain(
            'The mitochondria is the powerhouse\nof the cell.',
        )
        expect(out).toContain('Tail paragraph.')
    })

    test('the annotation is wrapped AROUND its paragraph, not emitted after it', () => {
        const lines = rewritten().split('\n')
        const open = lines.indexOf('<div class="bismuth-ink-wrap">')
        const para = lines.indexOf('The mitochondria is the powerhouse')
        const ink = lines.findIndex(l => l.includes('bismuth-ink-attached'))
        const close = lines.indexOf('</div>')
        expect(open).toBeGreaterThanOrEqual(0)
        // The order IS the feature: opening the wrapper after the paragraph would position the
        // annotation against an empty box and drop it below the words it annotates.
        expect(open).toBeLessThan(para)
        expect(para).toBeLessThan(ink)
        expect(ink).toBeLessThan(close)
    })

    test('the attached overlay carries its pixel offset and height inline', () => {
        expect(rewritten()).toContain(
            '<div class="bismuth-ink-attached" style="top:-8px;height:38px">',
        )
    })

    test('a standalone drawing is a block image in the flow', () => {
        const out = rewritten()
        expect(out).toContain('<div class="bismuth-ink-standalone">')
        // …and NOT inside a wrapper, which would overlay it on the paragraph above.
        expect(out).not.toContain(
            '<div class="bismuth-ink-wrap">\n\n<div class="bismuth-ink-standalone">',
        )
    })

    test('an ink-free fence leaves markup behind, only the fence', () => {
        const text = 'Para.\n' + fence('draw', []) + '\n'
        const out = inkMarkdown(text, planInkPlacements(text), () => '')
        expect(out).not.toContain('```')
        expect(out).not.toContain('bismuth-ink')
        expect(out).toContain('Para.')
    })
})

describe('inkifyMarkdown', () => {
    test('rasterizes each fence at the box its placement computed', async () => {
        const { deps, boxes } = recordingDeps()
        const out = await inkifyMarkdown(NOTE, deps, 'light')
        expect(boxes).toEqual([
            { width: INK_LOGICAL_W, height: 38 },
            {
                width: INK_LOGICAL_W,
                height: 260 - 24 + DEFAULT_STANDALONE_PAD * 2,
            },
        ])
        expect(out.text).toContain('data:image/png;base64,BOX1')
        expect(out.text).toContain('data:image/png;base64,BOX2')
        expect(out.css).toBe(INK_CSS)
    })

    test('a note with no ink is returned untouched and costs no stylesheet', async () => {
        const { deps, boxes } = recordingDeps()
        const plain = '# Title\n\nProse only.\n'
        const out = await inkifyMarkdown(plain, deps, 'light')
        expect(out.text).toBe(plain)
        expect(out.css).toBe('')
        expect(boxes).toEqual([])
    })
})
