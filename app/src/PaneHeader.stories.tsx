// Visual spec for <PaneHeader> — the title row of a split pane whose view draws no bar of its own
// (notes, terminal, sheets, drawings). It is a name-only ui/ViewBar under its own pane chrome
// (ui/paneChrome.ts), so its height, hairline, [×] and drag handle are ViewBar's — the same as a
// neighbouring pane whose view's bar claimed the chrome (see App/PaneTree's RowSplitBarBesideNote).
// Unfocused, its title dims; focused (the default), it reads at --fg.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect } from 'storybook/test'
import { PaneHeader } from './PaneHeader'

const noop = () => {}

const meta = {
    title: 'App/PaneHeader',
    component: PaneHeader,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof PaneHeader>

export default meta
type Story = StoryObj<typeof meta>

/** Resting state: icon + label + close button, in the focused pane. */
export const Default: Story = {
    args: {
        icon: 'File',
        label: 'design-notes.md',
        onPointerDown: noop,
        onClose: noop,
    },
}

/** An unfocused pane: the title dims to --text-muted — a split's one focus cue. */
export const Unfocused: Story = {
    args: {
        icon: 'File',
        label: 'design-notes.md',
        focused: false,
        onPointerDown: noop,
        onClose: noop,
    },
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector('[data-viewbar]')!
        await expect(bar.hasAttribute('data-pane-dim')).toBe(true)
    },
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

/** A title long enough to ellipsize inside a fixed-width wrapper, with the [×] still showing. */
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

        const header = canvasElement.querySelector('[data-viewbar]')
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
