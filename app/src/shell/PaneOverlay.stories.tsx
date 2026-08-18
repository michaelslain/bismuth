// Visual spec for <PaneOverlay> — the always-mounted terminal/chat overlay shell, positioned over
// a pane's host placeholder so a PTY or a chat WS survives tab/pane switches without a remount.
//
// WHY THIS FILE EXISTS: recorded BEFORE `.terminal-overlay`/`.chat-overlay` moved from the global
// App.css into PaneOverlay.module.css — see the plan's THE RECIPE for why the recording order is
// load-bearing.
//
// THREE STORIES: `Terminal` and `Chat` — a real `rect`, so `display: block` and the four geometry
// properties resolve to pixel values. `Hidden` — no `rect` at all, the existing behaviour
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

/** A chat overlay positioned over a real host rect — no context-menu override, unlike Terminal. */
export const Chat: Story = {
    render: () => (
        <Wrap>
            <PaneOverlay kind="chat" rect={rect}>
                <div style={{ padding: '8px', color: 'var(--text-muted)' }}>
                    [chat]
                </div>
            </PaneOverlay>
        </Wrap>
    ),
}

/** No `rect` — the "no host in the active tab" case: `display: none`, still mounted (not
 *  unmounted), which is what preserves the PTY/WS across a tab switch. */
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
