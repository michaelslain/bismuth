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
import { expect } from 'storybook/test'
import NoteLink from './NoteLink'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/NoteLink',
    component: NoteLink,
    parameters: { layout: 'centered' },
    args: { path: 'projects/Roadmap.md', children: 'Draft the roadmap' },
} satisfies Meta<typeof NoteLink>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A row title: --fg at rest, accent + underline on hover. */
export const TitleTone: Story = { args: { tone: 'title' } }

/** `external`: a web address, opened in a new tab. Same ink and the same hover-only underline as the
 *  wikilink beside it — the two used to differ (an always-underlined button against an underline on
 *  hover) in one task line. */
export const External: Story = {
    args: { path: 'https://example.com/spec', external: true, children: 'the spec' },
    render: args => (
        <span style={{ 'font-family': 'var(--ui-font-stack)', 'font-size': 'var(--fs-ui)' }}>
            <NoteLink {...args} /> // <NoteLink path="projects/Roadmap.md">Roadmap</NoteLink>
        </span>
    ),
    play: async ({ canvasElement }) => {
        const [web, note] = [...canvasElement.querySelectorAll('a')]
        const a = getComputedStyle(web!)
        const b = getComputedStyle(note!)
        expect(a.textDecorationLine).toBe('none')
        expect(a.textDecorationLine).toBe(b.textDecorationLine)
        expect(a.color).toBe(b.color)
        expect(web!.getAttribute('title')).toBe('https://example.com/spec')
    },
}

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
            <Row label="before — table view (UA default)" column gap="4px">
                {/* Deliberately unstyled: this is the bug, reproduced. */}
                <a href="#" onClick={e => e.preventDefault()}>
                    Draft the roadmap
                </a>
            </Row>
            <Row
                label="before — list view (no link affordance at all)"
                column
                gap="4px"
            >
                <span>Draft the roadmap</span>
            </Row>
            <Row label="after — every view" column gap="4px">
                <NoteLink path="projects/Roadmap.md">
                    Draft the roadmap
                </NoteLink>
            </Row>
        </div>
    ),
}
