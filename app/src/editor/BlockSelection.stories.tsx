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
import { createEffect } from 'solid-js'
import { EditorSelection } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { CmHarness } from '../ui/_cmHarness'
import { livePreview } from './livePreview'

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
