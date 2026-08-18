// Visual spec for <TabRailRow> — one row of the vertical tab rail: icon, label (or an inline
// rename input), and a trailing close-X / pin.
//
// WHY THIS FILE EXISTS: recorded BEFORE `.tab-rail-row`/`.tab-rail-icon`/`.tab-rail-label`/
// `.tab-x`/`.tab-pin`/`.tab-rename` move from the global App.css into the module TabRail.tsx and
// this file share. See TabRail.stories.tsx and TabRail.tsx's headers for why they share one module
// (Trap 4: descendant selectors span both components).
//
// SEVEN STORIES: `Default` (rest). `Active` — `.active` + its `::before` gradient bar. `Pinned` —
// the pin glyph replaces the close X. `Dragging` — `.dragging`. `Renaming` — the `.tab-rename`
// input in place of the label. `Colored` — a chat tint on the icon (`color` prop). `LongLabel` —
// the ellipsis. Rendered inside `Shell/TabRail`'s own `.tab-rail`/`.tab-rail-inner`/
// `.tab-rail-list` ancestry (not bare), since the row's own rules (icon column alignment, hover
// reveal) are written as descendants of `.tab-rail`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { TabRailRow } from './TabRailRow'

const noop = () => {}

const meta = {
    title: 'Shell/TabRailRow',
    component: TabRailRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TabRailRow>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div
        style={{
            width: '232px',
            border: '1px solid var(--border-soft)',
            background: 'var(--rail)',
        }}
    >
        <div class="tab-rail" style={{ position: 'static' }}>
            <div
                class="tab-rail-inner"
                style={{ position: 'static', width: '100%' }}
            >
                <div class="tab-rail-list">{props.children as never}</div>
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
export const LongLabel: Story = {
    render: () => (
        <Wrap>
            <TabRailRow
                {...base}
                label="a-very-long-note-title-that-should-be-truncated-with-an-ellipsis.md"
            />
        </Wrap>
    ),
}
