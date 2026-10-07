// Visual spec for <TabRailRow> — one row of the vertical tab rail: icon, label (or an inline
// rename input), and a trailing close-X / pin.
//
// `.tab-rail-row`/`.tab-rail-icon`/`.tab-rail-label`/`.tab-x`/`.tab-pin`/`.tab-rename` live in this
// component's own `TabRailRow.module.css` (task 11 of ds-conformance split TabRail.module.css in
// two). The `Wrap` below still reaches `.tab-rail`/`.tab-rail-inner`/`.tab-rail-list` through
// `TabRail.module.css`'s `styles`, since those three stay TabRail's, and mirrors the real
// `data-tab-rail` attribute TabRail.tsx sets on its root — the cross-module hover/focus/pinned
// reveal rules in `TabRailRow.module.css` key off that attribute, not a class.
//
// SEVEN STORIES: `Default` (rest). `Active` — `.active` + its `::before` gradient bar. `Pinned` —
// the pin glyph replaces the close X. `Dragging` — `.dragging`. `Renaming` — the `.tab-rename`
// input in place of the label. `Colored` — a chat tint on the icon (`color` prop). `LongLabel` —
// the ellipsis. Rendered inside `Shell/TabRail`'s own `.tab-rail`/`.tab-rail-inner`/
// `.tab-rail-list` ancestry (not bare), since the row's own rules (icon column alignment, hover
// reveal) are written as descendants of `.tab-rail`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { TabRailRow } from './TabRailRow'
import styles from './TabRail.module.css'

const noop = () => {}

const meta = {
    title: 'Shell/TabRailRow',
    component: TabRailRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TabRailRow>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown; side?: 'left' | 'right' }) => (
    <div
        style={{
            width: '232px',
            border: '1px solid var(--border-soft)',
            background: 'var(--rail)',
        }}
    >
        <div
            class={styles['tab-rail']}
            style={{ position: 'static' }}
            data-tab-rail="true"
            // The rail's PINNED state, which is what reveals a row's label, close X and pin
            // (TabRailRow.module.css keys every reveal off `[data-rail-pinned]`/`:hover`). Without it
            // each story drew an icon and nothing else — `LongLabel` had no label to truncate and
            // `Pinned` no pin to show, so neither proved a thing.
            data-rail-pinned="true"
            data-rail-side={props.side ?? 'right'}
        >
            <div
                class={styles['tab-rail-inner']}
                style={{ position: 'static', width: '100%' }}
            >
                <div class={styles['tab-rail-list']}>
                    {props.children as never}
                </div>
            </div>
        </div>
    </div>
)

const base = {
    label: 'design-notes.md',
    icon: 'File',
    active: false,
    pinned: false,
    dragging: false,
    renaming: false,
    onActivate: noop,
    onPointerDown: noop,
    onAuxClick: noop,
    onDblClick: noop,
    onContextMenu: noop,
    onClose: noop,
    onUnpin: noop,
    onCommitRename: noop,
    onCancelRename: noop,
}

/** Resting state. */
export const Default: Story = {
    render: () => (
        <Wrap>
            <TabRailRow {...base} />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        // The label is actually rendered — the rail is pinned, so it is revealed, not collapsed away.
        const label = within(canvasElement).getByText(base.label)
        await waitFor(() => expect(label.offsetWidth).toBeGreaterThan(0))
        expect(getComputedStyle(label).visibility).toBe('visible')
        expect(getComputedStyle(label).opacity).toBe('1')
    },
}

/** `.active` — the current tab, with its `::before` accent gradient bar. */
export const Active: Story = {
    render: () => (
        <Wrap>
            <TabRailRow {...base} active={true} />
        </Wrap>
    ),
}

/** `.pinned` — the pin glyph replaces the close X, and the row survives reload/sort-first. */
export const Pinned: Story = {
    render: () => (
        <Wrap>
            <TabRailRow {...base} pinned={true} />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const pin = c.getByRole('button', { name: 'Unpin tab' })
        // Shown at full strength with a real box — and the close X is NOT what this row carries.
        await waitFor(() => expect(getComputedStyle(pin).opacity).toBe('1'))
        expect(pin.getBoundingClientRect().width).toBeGreaterThan(0)
        expect(c.queryByRole('button', { name: 'Close tab' })).toBeNull()
    },
}

/** `.dragging` — mid tab-drag visual state. */
export const Dragging: Story = {
    render: () => (
        <Wrap>
            <TabRailRow {...base} dragging={true} />
        </Wrap>
    ),
}

/** `.tab-rename` input replaces the label span — the only story reaching it. */
export const Renaming: Story = {
    render: () => (
        <Wrap>
            <TabRailRow {...base} renaming={true} />
        </Wrap>
    ),
}

/** A chat tint on the icon — the `color` prop, sourced from `chatTabColor` in the real app. */
export const Colored: Story = {
    render: () => (
        <Wrap>
            <TabRailRow
                {...base}
                label="Chat with Bismuth"
                icon="MessageSquare"
                color="#e07a5f"
            />
        </Wrap>
    ),
}

/** A title long enough to exercise `.tab-rail-label`'s ellipsis. */
const LONG = 'a-very-long-note-title-that-should-be-truncated-with-an-ellipsis.md'
export const LongLabel: Story = {
    render: () => (
        <Wrap>
            <TabRailRow {...base} label={LONG} />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        // The label has a real width AND is cut short: its content is wider than its box.
        const label = within(canvasElement).getByText(LONG)
        await waitFor(() => expect(label.clientWidth).toBeGreaterThan(0))
        expect(label.scrollWidth).toBeGreaterThan(label.clientWidth)
        expect(getComputedStyle(label).textOverflow).toBe('ellipsis')
    },
}

/** LEFT RAIL (`data-rail-side="left"`) — the row's 1px-shifted margin keeps the icon on the same
 *  centred axis when the border moves to the rail's right. */
export const DefaultLeft: Story = {
    render: () => (
        <Wrap side="left">
            <TabRailRow {...base} />
        </Wrap>
    ),
}

/** Active row on a left rail — brackets still hang outside the icon axis. */
export const ActiveLeft: Story = {
    render: () => (
        <Wrap side="left">
            <TabRailRow {...base} active={true} />
        </Wrap>
    ),
}
