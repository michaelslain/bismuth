// Visual spec for <CardsSkeleton> — the grid of cover+text-line card outlines BaseSkeleton
// shows for the `cards` view kind. Standalone here (vs. BaseSkeleton's stories, which
// exercise it through the `type` prop) so the card outline itself is directly inspectable.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { CardsSkeleton } from './CardsSkeleton'
import { CardsView } from './CardsView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/CardsSkeleton',
    component: CardsSkeleton,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CardsSkeleton>

export default meta
type Story = StoryObj<typeof meta>

// A plain block frame, like BaseView's pane. It used to be `display: flex`, which shrank the
// skeleton to its content and collapsed ten cards into ~20px slivers.
const Frame = (props: { children: unknown }) => (
    <div
        style={{
            height: '360px',
            width: '720px',
            border: '1px solid var(--border-soft)',
            overflow: 'hidden',
        }}
    >
        {props.children as never}
    </div>
)

/** A grid of ten card outlines — cover bar over two placeholder text lines. */
export const Default: Story = {
    render: () => (
        <Frame>
            <CardsSkeleton />
        </Frame>
    ),
    // Ten cards, each a real card wide, not a sliver: the regression this frame used to show.
    play: async ({ canvasElement }) => {
        const cards = canvasElement.querySelectorAll<HTMLElement>(
            '[data-skeleton-grid] > *',
        )
        expect(cards.length).toBe(10)
        for (const c of cards) expect(c.getBoundingClientRect().width).toBeGreaterThan(100)
        const bars = canvasElement.querySelectorAll<HTMLElement>('[data-skeleton-grid] div')
        for (const b of bars) expect(b.scrollWidth).toBeLessThanOrEqual(b.clientWidth + 1)
    },
}

const gridOf = (root: Element): HTMLElement | undefined =>
    [...root.querySelectorAll<HTMLElement>('div')].find(
        el => getComputedStyle(el).display === 'grid',
    )

/** The skeleton and the loaded view side by side at one width. The defect this pins is a REFLOW:
 *  the pane is laid out one way while loading and another once rows arrive. So it asserts that the
 *  two grids resolve to the same column tracks, the same gap, the same cards-per-row, and the same
 *  cover height — a skeleton that merely renders proves none of that. */
export const MatchesLoadedLayout: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
            <div data-testid="skeleton-side">
                <Frame>
                    <CardsSkeleton />
                </Frame>
            </div>
            <div data-testid="loaded-side">
                <Frame>
                    <CardsView result={sampleViewResult()} config={sampleBaseConfig()} />
                </Frame>
            </div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const side = (id: string) =>
            canvasElement.querySelector(`[data-testid="${id}"]`) as HTMLElement
        await waitFor(() => expect(gridOf(side('loaded-side'))).toBeTruthy())
        const skel = gridOf(side('skeleton-side'))!
        const real = gridOf(side('loaded-side'))!
        const a = getComputedStyle(skel)
        const b = getComputedStyle(real)
        // Same column tracks (resolved px), same gap, same alignment.
        expect(a.gridTemplateColumns).toBe(b.gridTemplateColumns)
        expect(a.columnGap).toBe(b.columnGap)
        expect(a.rowGap).toBe(b.rowGap)
        // Same card width, and the cover is the real cover's height.
        const skelCard = skel.firstElementChild as HTMLElement
        const realCard = real.firstElementChild as HTMLElement
        expect(skelCard.getBoundingClientRect().width).toBeCloseTo(
            realCard.getBoundingClientRect().width,
            0,
        )
        const realCover = real.querySelector<HTMLElement>('[data-testid="card-cover"]')!
        const skelCover = skelCard.firstElementChild as HTMLElement
        expect(skelCover.getBoundingClientRect().height).toBeCloseTo(
            realCover.getBoundingClientRect().height,
            0,
        )
        // Same outer inset around the grid.
        expect(skel.getBoundingClientRect().left - side('skeleton-side').getBoundingClientRect().left).toBeCloseTo(
            real.getBoundingClientRect().left - side('loaded-side').getBoundingClientRect().left,
            0,
        )
    },
}
