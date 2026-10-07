// Visual spec for <EmptyState> + <Loading> — the "nothing here" / "all done" message
// block and the plain loading placeholder.
//
// Props (EmptyState): icon? (optional element rendered above the title), title?
// (optional heading), fill? (centre in the box it is placed in), compact? (the one muted line —
// no icon, no heading), action? (a CTA slot under the body), tone? ('default' | 'quiet' — upright
// vs muted italic), class?, children (the message body, rendered only when present). Titles are
// lowercase / sentence case and never transformed by CSS. Loading takes just optional children
// (defaults to "Loading…").
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import type { JSX } from 'solid-js'
import { Icon } from '../icons/Icon'
import EmptyState, { Loading } from './EmptyState'
import TextButton from './TextButton'

const meta = {
    title: 'UI/EmptyState',
    component: EmptyState,
    parameters: { layout: 'centered' },
    argTypes: {
        title: { control: 'text' },
        children: { control: 'text' },
    },
    args: {
        title: 'all done',
        children: 'Nothing left to review — check back later.',
    },
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single block. */
export const Playground: Story = {}

/** Title + message (the flashcards "review done" shape). */
export const TitleAndMessage: Story = {
    render: () => (
        <EmptyState title="review complete">
            Nice work — no cards are due right now.
        </EmptyState>
    ),
}

/** Message only, no heading (the bare `.deck-empty` shape used in base settings). */
export const MessageOnly: Story = {
    render: () => <EmptyState>No rows match the current filters.</EmptyState>,
}

/** Title only — no children means no `<p>` is rendered at all. */
export const TitleOnly: Story = {
    render: () => <EmptyState title="nothing here" />,
}

/** With an icon above the title — the switcher's ask-AI error panel shape
 *  (palette/SwitcherBar.tsx), restored via the `icon` prop. */
export const WithIcon: Story = {
    render: () => (
        <EmptyState
            icon={<Icon value="TriangleAlert" size={24} />}
            title="bismuth ai couldn’t complete the search"
        >
            Something went wrong talking to the model.
        </EmptyState>
    ),
}

/** The sibling <Loading> placeholder. */
export const LoadingDefault: Story = {
    render: () => <Loading />,
}

/** <Loading> with custom copy. */
export const LoadingCustom: Story = {
    render: () => <Loading>Fetching notes…</Loading>,
}

/** A sized box to place an EmptyState in — `kind` picks a flex-column or a plain block parent, the
 *  two shapes the app's view kinds actually use. */
function Box(props: { kind: 'flex' | 'block'; children: JSX.Element; testid: string }) {
    return (
        <div
            data-testid={props.testid}
            style={{
                display: props.kind === 'flex' ? 'flex' : 'block',
                'flex-direction': 'column',
                width: '320px',
                height: '200px',
                border: '1px solid var(--border)',
            }}
        >
            {props.children}
        </div>
    )
}

const centreOffset = (box: Element, content: Element) => {
    const b = box.getBoundingClientRect()
    const c = content.getBoundingClientRect()
    return {
        dx: Math.abs(c.left + c.width / 2 - (b.left + b.width / 2)),
        dy: Math.abs(c.top + c.height / 2 - (b.top + b.height / 2)),
    }
}

/** `fill` centres the block in its box on both axes — in a flex-column parent AND in a plain block
 *  parent, which is the disagreement the Bases view kinds had (centred / top-padded). */
export const Fill: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '16px' }}>
            <Box kind="flex" testid="fill-flex">
                <EmptyState fill title="no rows">
                    Nothing matches the current filters.
                </EmptyState>
            </Box>
            <Box kind="block" testid="fill-block">
                <EmptyState fill title="no rows">
                    Nothing matches the current filters.
                </EmptyState>
            </Box>
        </div>
    ),
    play: async ({ canvasElement }) => {
        for (const id of ['fill-flex', 'fill-block']) {
            const box = canvasElement.querySelector(`[data-testid="${id}"]`)!
            const block = box.querySelector('[data-testid="ui-empty-block"]')!
            const { dx, dy } = centreOffset(box, block)
            expect(dx, `${id} x`).toBeLessThan(2)
            expect(dy, `${id} y`).toBeLessThan(2)
            // the block fills the box, and its text sits at the centre of that
            expect(block.getBoundingClientRect().height).toBeGreaterThan(190)
            const text = block.querySelector('[data-testid="ui-empty"]')!
            expect(centreOffset(box, text).dy, `${id} text y`).toBeLessThan(40)
        }
    },
}

/** `fill` in a box SHORTER than its content (a table's empty body under its header rule). Plain
 *  `justify-content: center` splits the overflow equally and the top half spills ABOVE the box,
 *  clipped and unreachable by scrolling; `safe center` falls back to start alignment. The play
 *  asserts the title's top edge sits at or below the box's content top. */
export const FillInShortBox: Story = {
    render: () => (
        <div
            data-testid="short-box"
            style={{
                display: 'flex',
                'flex-direction': 'column',
                width: '260px',
                height: '40px',
                border: '1px solid var(--border)',
            }}
        >
            <EmptyState fill title="no rows">
                Nothing matches the current filters.
            </EmptyState>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const box = canvasElement.querySelector<HTMLElement>('[data-testid="short-box"]')!
        const title = box.querySelector<HTMLElement>('h2')!
        const contentTop = box.getBoundingClientRect().top + box.clientTop
        expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(contentTop - 0.5)
    },
}

/** `compact` — one muted line, no icon, no heading. A title with no body becomes the line. */
export const Compact: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px', width: '320px' }}>
            <EmptyState compact>No rows match the current filters.</EmptyState>
            <EmptyState compact title="nothing here" icon={<Icon value="TriangleAlert" size={16} />} />
            <Box kind="flex" testid="compact-fill">
                <EmptyState compact fill>
                    no rows
                </EmptyState>
            </Box>
        </div>
    ),
}

/** `action` — the CTA slot under the body ("unavailable + open in default app"). */
export const WithAction: Story = {
    render: () => (
        <EmptyState title="couldn’t load image" action={<TextButton onClick={() => {}}>open in default app</TextButton>}>
            The file may be missing or unreadable.
        </EmptyState>
    ),
}

/** `tone` — 'default' is a foreground title over a muted body; 'quiet' mutes the title too and
 *  sets both in italics, for a pause rather than a result. */
export const Tones: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '48px' }}>
            <EmptyState tone="default" title="no cards due">
                Check back later.
            </EmptyState>
            <EmptyState tone="quiet" title="no cards due">
                Check back later.
            </EmptyState>
        </div>
    ),
}
