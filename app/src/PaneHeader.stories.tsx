// Visual spec for <PaneHeader> — the mini view-bar breadcrumb shown atop a pane leaf when its
// tab's tree has more than one pane (a split). A faint content icon, then the title; the whole
// header brightens to --fg when its pane is focused, via the ANCESTOR class `.pane-leaf.focused`
// (PaneTree.css's `.pane-leaf.focused .pane-header .pane-header-label` rule) — not anything this
// component controls itself, hence the `Focused` story below wrapping it in that ancestor class
// rather than passing a prop.
//
// WHY THIS FILE EXISTS: recorded BEFORE `.pane-header`/`.pane-header-icon`/`.pane-header-label`/
// `.pane-header-x` move from the global App.css + colocated PaneTree.css into the shared
// PaneTree.module.css (Task 12's CSS half) — see the plan's THE RECIPE for why the recording order
// is load-bearing. `bench/cssBaseline.ts` is what actually verifies the migration; this file is
// its input.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { PaneHeader } from './PaneHeader'

const noop = () => {}

const meta = {
    title: 'App/PaneHeader',
    component: PaneHeader,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof PaneHeader>

export default meta
type Story = StoryObj<typeof meta>

/** Resting state: icon + label + close button, unfocused (muted text). */
export const Default: Story = {
    args: {
        icon: 'File',
        label: 'design-notes.md',
        onPointerDown: noop,
        onClose: noop,
    },
}

/** Wrapped in the ancestor class `.pane-leaf.focused` — the only story reaching
 *  `.pane-leaf.focused .pane-header .pane-header-label` (PaneTree.css), which brightens the
 *  title to --fg. PaneHeader itself has no `focused` prop; the brightening is entirely a
 *  cross-file descendant selector, so this story exists specifically to keep that rule covered. */
export const Focused: Story = {
    render: () => (
        <div class="pane-leaf focused" style={{ display: 'inline-block' }}>
            <PaneHeader
                icon="File"
                label="design-notes.md"
                onPointerDown={noop}
                onClose={noop}
            />
        </div>
    ),
}

/** No `icon` prop — the leading `<Icon>` is entirely absent (not a blank placeholder), per the
 *  `<Show when={props.icon}>` guard. */
export const WithIcon: Story = {
    args: {
        icon: 'Share2',
        label: 'Knowledge Graph',
        onPointerDown: noop,
        onClose: noop,
    },
}

/** A title long enough to exercise `.pane-header-label`'s `overflow:hidden; text-overflow:ellipsis`
 *  inside a fixed-width wrapper. */
export const LongLabel: Story = {
    render: () => (
        <div style={{ width: '220px', border: '1px solid var(--border-soft)' }}>
            <PaneHeader
                icon="File"
                label="a-very-long-note-title-that-should-be-truncated-with-an-ellipsis.md"
                onPointerDown={noop}
                onClose={noop}
            />
        </div>
    ),
}
