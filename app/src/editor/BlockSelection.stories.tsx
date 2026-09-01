// Visual spec for ONE invariant: a text selection must paint OVER a live-preview block fill,
// never under it.
//
// WHY THIS STORY EXISTS. The fenced-code and frontmatter "cards" are per-line CodeMirror
// decorations (`.cm-block-top`/`.cm-block-mid`/`.cm-block-bottom` in livePreview.ts), and they
// used to carry their surface as a plain `background` on the line. CodeMirror paints a selection
// into `.cm-selectionLayer` at `z-index: -1`, and in CSS painting order a negative-z-index child
// paints BEFORE in-flow block backgrounds — so the card's own fill covered the selection. Dragging
// across a note looked correct over prose (transparent lines let the layer show through) and then
// went blank for exactly the rows inside a code block or frontmatter panel.
//
// Nothing in the repo could see that. Every unit test passes either way (the bug is pure paint
// order, not state), and no other story renders an editor with a LIVE SELECTION — the default
// Editor story has a caret, not a range, so the selection layer has no markers to draw. This story
// is the one place the invariant is checked: select the whole document, then confirm the accent
// wash is continuous from the prose above the fence, through the fenced rows, to the prose below.
// A regression here looks like a clean rectangular hole punched through the middle of the wash.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createEffect } from 'solid-js'
import { EditorSelection } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { CmHarness } from '../ui/_cmHarness'
import { livePreview } from './livePreview'
import { foldBlocks } from './foldBlocks'

// The harness (ui/_cmHarness.tsx) deliberately themes almost nothing, and it does NOT colour
// `.cm-selectionBackground` — so without this the story falls back to CodeMirror's baseTheme
// default, `&light .cm-selectionBackground { background: #d9d9d9 }`: a near-opaque light slab that
// buries the text and shows a colour the product never renders. A spec that lies about the thing
// it exists to check is worse than no spec, so mirror the editor's REAL selection tint — these two
// rules are copied verbatim from Editor.tsx, tokens included. `var(--accent)` is the genuine
// source of truth (projected into `:root` for every story by .storybook/preview.ts), NOT a
// stand-in value invented here.
const selectionTheme = EditorView.theme({
    '.cm-selectionLayer .cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
        {
            backgroundColor:
                'color-mix(in srgb, var(--accent) 38%, transparent)',
        },
})

const meta = {
    title: 'Editor/Block Selection',
    parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const STORY_H = '420px'

// Frontmatter panel + prose + a fenced block: all three of the block classes, with ordinary
// transparent prose lines on both sides of the fence so a gap in the wash is obvious by eye.
// Array + join so the fence's own backticks never collide with the outer TS string.
const DOC = [
    '---',
    'tags: [probe]',
    'status: active',
    '---',
    '',
    '# Selection over a code block',
    '',
    'Prose above the fence.',
    '',
    '```ts',
    'const a = 1',
    'const b = 2',
    'export const sum = a + b',
    '```',
    '',
    'Prose below the fence.',
    // Trailing newline, as every real note file has. Without it the selection's final rect lands
    // ON the last line of text and overlaps the middle rect, compositing the wash to roughly double
    // alpha — a lighter band that reads as a rendering defect in a story whose whole job is to be
    // judged by eye. With it the last rect is zero-width, exactly as in the app.
    '',
].join('\n')

/**
 * The whole document selected. Every row from the frontmatter `---` to the last line of prose
 * must carry the same accent wash — the fenced rows and the frontmatter rows included.
 *
 * The selection is dispatched (not typed) so the story is deterministic and needs no interaction:
 * `drawSelection` renders `.cm-selectionBackground` markers purely from editor state, so a
 * dispatched range paints exactly like a dragged one. `cm-focused` is NOT required for the layer
 * to render — an unfocused editor draws the same markers at a slightly lower accent alpha
 * (Editor.tsx sets both), which is why this reads correctly in a screenshot where the story
 * iframe never took focus.
 */
export const WholeDocumentSelected: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness
                doc={DOC}
                extensions={[markdown(), livePreview, selectionTheme]}
            >
                {view => {
                    createEffect(() => {
                        const v = view() as EditorView | undefined
                        if (!v) return
                        v.dispatch({
                            selection: EditorSelection.single(
                                0,
                                v.state.doc.length,
                            ),
                        })
                    })
                    return null
                }}
            </CmHarness>
        </div>
    ),
}

// ── Invariant 2: a selection may never paint past the last line of text ─────────────────────
//
// WHY THIS STORY EXISTS. Reported as "weird highlighting glitch": a drag anchored on a nested
// bullet painted a solid accent slab from that line all the way down past the end of the note —
// hundreds of px of wash over empty space. The rect is not merely too tall, it is a SENTINEL.
//
// `drawSelection`'s `rectanglesForRange` builds a multi-line selection as three pieces, and the
// middle band is `piece(leftSide, top.bottom, rightSide, bottom.top)`. Both edges come from
// `drawForLine`, which seeds `top = 1e9 / bottom = -1e9` and only replaces them inside `addSpan`
// — and `addSpan` returns early when `view.coordsAtPos()` yields null. So one unmeasurable
// endpoint leaves a sentinel in the geometry and the band becomes 1e9px tall (Chrome clamps the
// element to 2^25 = 33,554,428px). A null at the range END runs the slab downward off the note
// (what the user saw); a null at the range START runs it upward. Both are this one defect.
//
// `coordsAtPos` returned null because live preview hid the run with `display: none`, which
// generates no boxes at all — see the `.cm-hidden-syntax` rule in livePreview.ts. On the CURSOR
// line a list item is rendered raw with its literal leading indent hidden by that mark, so the
// line's own `from` sits inside a zero-box run. That is why this needs a FOCUSED editor (live
// preview reveals nothing when `view.hasFocus` is false) and why a nested bullet is the trigger.
//
// Nothing else in the repo can see this. Every unit test passes either way — the decoration
// ranges are correct, only their measured geometry is not — and the defect is invisible in a
// screenshot of an unfocused editor. `foldBlocks` is included deliberately: the report's
// screenshot showed a fold chevron beside the anchored line and the collapser was the first
// suspect, so the story keeps it in frame and demonstrates it is innocent.
const TALL_H = '900px'

// Short content in a TALL pane: the empty region under the text is where the slab shows.
const LIST_DOC = [
    '# Nested list',
    '',
    '- Parent item with children, so foldBlocks gives it a collapser triangle',
    '    - A nested child long enough that it wraps onto a second visual line inside the narrow reading column of a note',
    '        - A deeper leaf under the nested child',
    '- Another parent item',
    '',
    'Trailing prose after the list.',
    '',
].join('\n')

// The reading-column geometry from Editor.tsx's `editorTheme`, so the deep item wraps exactly as
// it does in the app. The bottom padding is the real `8px 0 80px` — it is not the cause (80px
// cannot make a 900px slab) but leaving it out would quietly change what "past the last line"
// means.
const proseTheme = EditorView.theme({
    '.cm-scroller': { justifyContent: 'center', padding: '0 40px' },
    '.cm-content': {
        padding: '8px 0 80px',
        maxWidth: '620px',
        width: '100%',
        boxSizing: 'border-box',
    },
})

/**
 * Selection anchored at a nested list item's own `from`, running to the end of the document.
 *
 * The assertions are geometric, because the bug is geometric: no marker may sit above the first
 * line, below the last line, or be taller than the editor itself. The reveal is asserted FIRST,
 * on the anchored line specifically —
 * without a focused editor live preview renders the bullet as a widget instead of hiding the raw
 * indent, there is no zero-box run for the selection to land in, and the whole story would pass
 * while checking nothing.
 */
export const SelectionPastLastLine: Story = {
    render: () => (
        <div style={{ height: TALL_H, width: '100%' }}>
            <CmHarness
                doc={LIST_DOC}
                extensions={[
                    markdown(),
                    livePreview,
                    foldBlocks(() => 'block-selection.stories.md'),
                    proseTheme,
                    selectionTheme,
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const view = EditorView.findFromDOM(canvasElement)
        await expect(view).not.toBe(null)
        const v = view as EditorView

        // Live preview only reveals raw source on a FOCUSED editor, and the reveal is what puts a
        // zero-advance run at the line's `from`. No focus, no defect, no test.
        v.focus()
        await new Promise(r => setTimeout(r, 80))

        const nested = v.state.doc.line(4) // the deep, wrapping child
        v.dispatch({
            selection: EditorSelection.single(nested.from, v.state.doc.length),
        })
        await new Promise(r =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
        )

        // PRECONDITION, not decoration. Everything below is vacuous without it, and it can fail
        // silently: CodeMirror's `hasFocus` is `dom.ownerDocument.hasFocus() && …`, which is FALSE
        // in a backgrounded browser window — the condition this repo's tooling is documented to run
        // in. Unfocused, live preview replaces line 4's prefix with a BulletWidget instead of hiding
        // it, `coordsAtPos` is non-null, and the defect simply does not exist to be caught.
        await expect(v.hasFocus).toBe(true)
        // Scoped to THIS line on purpose. A document-wide "some .cm-hidden-syntax exists" check is
        // always satisfied by line 1's heading `#`, which is hide-marked precisely BECAUSE that line
        // is not the cursor line — so it passes exactly when focus failed and the precondition is
        // absent. The run that matters is the one on the anchored line.
        const anchorNode = v.domAtPos(nested.from).node
        const anchorLine =
            anchorNode instanceof Element
                ? anchorNode.closest('.cm-line')
                : anchorNode.parentElement?.closest('.cm-line')
        await expect(
            anchorLine?.querySelector('.cm-hidden-syntax') ?? null,
        ).not.toBe(null)

        const lines = [
            ...canvasElement.querySelectorAll('.cm-line'),
        ] as HTMLElement[]
        const rects = [
            ...canvasElement.querySelectorAll('.cm-selectionBackground'),
        ].map(el => el.getBoundingClientRect())
        // A multi-line selection always draws markers; zero would mean the wash vanished instead.
        await expect(rects.length).toBeGreaterThan(0)

        const content = canvasElement.querySelector(
            '.cm-content',
        ) as HTMLElement
        const contentH = content.getBoundingClientRect().height
        const firstTop = lines[0].getBoundingClientRect().top
        const lastBottom = lines[lines.length - 1].getBoundingClientRect().bottom
        const lineH = parseFloat(getComputedStyle(lines[0]).lineHeight)

        // No marker taller than the editor itself. The sentinel measures 33,554,428px here.
        await expect(Math.max(...rects.map(r => r.height))).toBeLessThan(
            contentH,
        )
        // No wash below the last line of text — the reported symptom, stated directly. One line of
        // slack absorbs sub-pixel rounding without admitting a second row of empty wash.
        await expect(Math.max(...rects.map(r => r.bottom))).toBeLessThan(
            lastBottom + lineH,
        )
        // …nor above the first: the same sentinel with the null at the range's start instead.
        await expect(Math.min(...rects.map(r => r.top))).toBeGreaterThan(
            firstTop - lineH,
        )
        // The cause, asserted directly: an unmeasurable endpoint is what leaves the sentinel in
        // the geometry above. Checked last so a failure reports the symptom before the mechanism.
        await expect(v.coordsAtPos(nested.from)).not.toBe(null)
    },
}
