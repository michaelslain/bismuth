// Visual spec for <Callout> — the accent-edge admonition block (formerly the bare
// `.asc-callout` global class in ui/ui.css; see Callout.tsx). Mirrors the editor's live-preview
// callout widget's visual recipe (editor/livePreview.ts's calloutThemeSpec) without sharing code
// with it — CodeMirror renders its own DOM and cannot import a Solid component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Callout from './Callout'

const meta = {
    title: 'UI/Callout',
    component: Callout,
    parameters: { layout: 'padded' },
    args: {
        children:
            'A 2px accent left edge on a flat --surface-1 fill — no full border, no darker fence band.',
    },
} satisfies Meta<typeof Callout>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single callout. */
export const Playground: Story = {}

/** A realistic multi-line body, the way a note's `> [!tip]` block renders. */
export const MultiLine: Story = {
    render: () => (
        <Callout>
            <div style={{ 'font-weight': 600, 'margin-bottom': '4px' }}>
                Tip
            </div>
            <div>
                Callouts share the same 2px accent edge as Card's "proposal"
                variant and Frontmatter — one visual family for "this block is
                set apart from the surrounding prose."
            </div>
        </Callout>
    ),
}
