// Visual spec for <PaneHeader> — the mini view-bar breadcrumb shown atop a pane leaf when its
// tab's tree has more than one pane (a split). A faint content icon, then the title; the whole
// header brightens to --fg when its pane is focused, via a `data-pane-focused` RUNTIME HOOK set
// on the ancestor pane leaf (PaneHeader.module.css's `[data-pane-focused] .pane-header
// .pane-header-label` rule) — not anything this component controls itself, hence the `Focused`
// story below wrapping it in that ancestor attribute rather than passing a prop.
//
// WHY THIS FILE EXISTS: recorded BEFORE `.pane-header`/`.pane-header-icon`/`.pane-header-label`/
// `.pane-header-x` move from the global App.css + colocated PaneTree.css into the shared
// PaneTree.module.css (Task 12's CSS half) — see the plan's THE RECIPE for why the recording order
// is load-bearing. `bench/cssBaseline.ts` is what actually verifies the migration; this file is
// its input.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect } from 'storybook/test'
import { PaneHeader } from './PaneHeader'
import styles from './PaneHeader.module.css'

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

/** Wrapped in the ancestor `data-pane-focused` attribute — the only story reaching
 *  `[data-pane-focused] .pane-header .pane-header-label` (PaneHeader.module.css), which brightens
 *  the title to --fg. PaneHeader itself has no `focused` prop; the brightening is entirely a
 *  cross-file descendant selector keyed off a data attribute, so this story exists specifically
 *  to keep that rule covered. */
export const Focused: Story = {
    render: () => (
        <div data-pane-focused style={{ display: 'inline-block' }}>
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

/** Proves the close button's pointerdown does NOT reach the header's own `onPointerDown` (which
 *  starts a pane drag in the real app — PaneLeaf's `onStartPaneDrag`). Counts both callbacks: a
 *  pointerdown dispatched on the close button must increment `closeCount` and leave `dragCount`
 *  at 0; the header's own pointerdown handler must still fire for a pointerdown anywhere else in
 *  the header (asserted second, so a handler that was accidentally removed entirely — rather than
 *  just guarded correctly — cannot pass this story by both counts staying 0). */
export const CloseDoesNotDrag: Story = {
    render: () => {
        const [dragCount, setDragCount] = createSignal(0)
        const [closeCount, setCloseCount] = createSignal(0)
        return (
            <div>
                <PaneHeader
                    icon="File"
                    label="design-notes.md"
                    onPointerDown={() => setDragCount(c => c + 1)}
                    onClose={() => setCloseCount(c => c + 1)}
                />
                <div data-testid="counts">
                    drag:{dragCount()} close:{closeCount()}
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        // The close button no longer carries a PaneHeader-local class (ds-bridges Task 1 dropped
        // `.pane-header-x` — its only rule was fully redundant with IconButton's own
        // `variant="unselected"` chrome). Target it by its accessible label instead.
        const closeBtn = canvasElement.querySelector('[aria-label="Close pane"]')
        if (!(closeBtn instanceof HTMLElement))
            throw new Error('close button not found')
        closeBtn.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
            }),
        )
        // The mousedown-driven close (see PaneHeader.tsx) also needs firing here to observe
        // closeCount move — mirror what a real click does.
        closeBtn.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        )

        const header = canvasElement.querySelector(`.${styles['pane-header']}`)
        if (!(header instanceof HTMLElement))
            throw new Error('header not found')
        header.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
            }),
        )

        // Read the live counters back off the rendered text rather than closures captured at
        // render time, so the assertion sees post-play state.
        const counts = canvasElement.querySelector(
            '[data-testid="counts"]',
        )?.textContent
        await expect(counts).toBe('drag:1 close:1')
    },
}
