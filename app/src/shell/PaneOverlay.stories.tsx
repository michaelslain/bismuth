// Visual spec for <PaneOverlay> — the always-mounted terminal overlay shell, positioned over a
// pane's host placeholder so a PTY survives tab/pane switches without a remount.
//
// WHY THIS FILE EXISTS: recorded BEFORE `.terminal-overlay`/`.chat-overlay` moved from the global
// App.css into PaneOverlay.module.css — see the plan's THE RECIPE for why the recording order is
// load-bearing.
//
// TWO STORIES: `Terminal` — a real `rect`, so `display: block` and the four geometry properties
// resolve to pixel values. (A `Chat` story went with the chat overlay: the chat tab renders inline.) `Hidden` — no `rect` at all, the existing behaviour
// (`display: none`, still mounted) that a future caller must not accidentally lose.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { PaneOverlay } from './PaneOverlay'

const noop = () => {}

const meta = {
    title: 'Shell/PaneOverlay',
    component: PaneOverlay,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof PaneOverlay>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div
        style={{
            position: 'relative',
            width: '320px',
            height: '220px',
            border: '1px solid var(--border-soft)',
        }}
    >
        {props.children as never}
    </div>
)

const rect = { x: 10, y: 10, w: 260, h: 160 }

/** A terminal overlay positioned over a real host rect. */
export const Terminal: Story = {
    render: () => (
        <Wrap>
            <PaneOverlay kind="terminal" rect={rect} onContextMenu={noop}>
                <div style={{ padding: '8px', color: 'var(--text-muted)' }}>
                    [terminal]
                </div>
            </PaneOverlay>
        </Wrap>
    ),
}

/** No `rect` — the "no host in the active tab" case: `display: none`, still mounted (not
 *  unmounted), which is what preserves the PTY across a tab switch. */
export const Hidden: Story = {
    render: () => (
        <Wrap>
            <PaneOverlay kind="terminal" onContextMenu={noop}>
                <div style={{ padding: '8px', color: 'var(--text-muted)' }}>
                    [terminal]
                </div>
            </PaneOverlay>
        </Wrap>
    ),
}
