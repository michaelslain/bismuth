// The file-tree visibility badge, in all three of its states.
//
// This component had NO story until 2026-08-28: it lived inside FileTree.tsx alongside four other
// components, so the only way to see it was to open a vault containing a restricted note. Its whole
// job is to communicate a security-adjacent fact at a glance — which is exactly the kind of thing
// that should be looked at rather than assumed.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import VisibilityBadge from './VisibilityBadge'
import { Label } from './ui/_storyKit'

const meta = {
    title: 'App/VisibilityBadge',
    component: VisibilityBadge,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof VisibilityBadge>

export default meta
type Story = StoryObj<typeof meta>

const Row = (props: { label: string; children: any }) => (
    <div
        style={{
            display: 'flex',
            'align-items': 'center',
            gap: 'var(--sp-5)',
            background: 'var(--bg)',
            padding: 'var(--sp-3) var(--sp-5)',
            'min-width': '320px',
        }}
    >
        <span style={{ 'min-width': '140px' }}>
            <Label>{props.label}</Label>
        </span>
        {props.children}
    </div>
)

/** Hidden from the daemon AND in-app chat — the strongest tier, in the danger tone. */
export const Hidden: Story = { args: { visibility: 'hidden' } }

/** Chat only — reachable by in-app chat, withheld from the daemon. */
export const ChatOnly: Story = { args: { visibility: 'chat-only' } }

/**
 * All three states together, which is the comparison that matters: the two badges must be
 * distinguishable from each other AT A GLANCE and not merely on hover, since the tooltip is the
 * only place the difference is spelled out. "all" renders nothing at all — that is correct, and it
 * is why an unrestricted row has no gap where a badge would sit.
 */
export const AllStates: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
            <Row label="hidden">
                <VisibilityBadge visibility="hidden" />
            </Row>
            <Row label="chat-only">
                <VisibilityBadge visibility="chat-only" />
            </Row>
            <Row label="all (renders nothing)">
                <VisibilityBadge />
            </Row>
        </div>
    ),
}
