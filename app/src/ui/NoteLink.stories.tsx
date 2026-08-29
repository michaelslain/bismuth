// Visual spec for <NoteLink> — the ONE "open this note" affordance.
//
// This primitive exists because the same affordance rendered three different ways in three views of
// the SAME dataset: Chrome's UA periwinkle (underlined) in Table view, accent teal with no
// underline in Bullets, and inert plain text in List. The "Three renderings this replaces" story
// below reproduces all three side by side, because a screenshot of the fix alone does not show what
// was wrong — and Table is the DEFAULT renderer for every base, so the worst of the three was the
// most-seen surface in the product.
//
// Props: path (the vault path to open), children (visible label, defaults to the path), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import NoteLink from './NoteLink'

const meta = {
    title: 'UI/NoteLink',
    component: NoteLink,
    parameters: { layout: 'centered' },
    args: { path: 'projects/Roadmap.md', children: 'Draft the roadmap' },
} satisfies Meta<typeof NoteLink>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** No children — the path itself is the label. */
export const PathAsLabel: Story = {
    args: { path: 'journal/2026-08-04.md', children: undefined },
}

/** In a row of ordinary text, to check it reads as a link without shouting. Underline is
 *  hover-only on purpose: in a dense table an always-underlined link rules every row. */
export const InProse: Story = {
    render: () => (
        <div style={{ 'max-width': '46ch', 'line-height': '1.6' }}>
            Two things are still open in{' '}
            <NoteLink path="journal/2026-08-04.md">2026-08-04</NoteLink> — the
            chat refactor and the vault-review digest. The layout benchmark is
            already checked off.
        </div>
    ),
}

/** The defect this component was extracted to remove. Top row is what shipped in Table view (a
 *  bare `<a href="#">` with no class, inheriting Chrome's dark-mode UA link colour, which belongs
 *  to no theme in this product); bottom row is <NoteLink>. */
export const ThreeRenderingsThisReplaces: Story = {
    render: () => (
        <div style={{ display: 'grid', gap: '14px', 'min-width': '30ch' }}>
            <div>
                <div
                    style={{
                        'font-size': '10.5px',
                        color: 'var(--faint)',
                        'text-transform': 'uppercase',
                        'letter-spacing': '.06em',
                        'margin-bottom': '4px',
                    }}
                >
                    before — table view (UA default)
                </div>
                {/* Deliberately unstyled: this is the bug, reproduced. */}
                <a href="#" onClick={e => e.preventDefault()}>
                    Draft the roadmap
                </a>
            </div>
            <div>
                <div
                    style={{
                        'font-size': '10.5px',
                        color: 'var(--faint)',
                        'text-transform': 'uppercase',
                        'letter-spacing': '.06em',
                        'margin-bottom': '4px',
                    }}
                >
                    before — list view (no link affordance at all)
                </div>
                <span>Draft the roadmap</span>
            </div>
            <div>
                <div
                    style={{
                        'font-size': '10.5px',
                        color: 'var(--faint)',
                        'text-transform': 'uppercase',
                        'letter-spacing': '.06em',
                        'margin-bottom': '4px',
                    }}
                >
                    after — every view
                </div>
                <NoteLink path="projects/Roadmap.md">
                    Draft the roadmap
                </NoteLink>
            </div>
        </div>
    ),
}
