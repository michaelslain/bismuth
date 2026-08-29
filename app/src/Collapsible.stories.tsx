// The height-animating disclosure wrapper the file tree uses for folder contents.
//
// No story existed until 2026-08-28 — it was one of five components inside FileTree.tsx. That
// matters more here than for most extractions, because what this component does is a TRANSITION,
// and a transition is invisible to every other kind of check in this repo: a DOM count, a computed
// style read and a unit test all see the same thing whether it animates smoothly or snaps.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import Collapsible from './Collapsible'
import { TextButton } from './ui/TextButton'
import Text from './ui/Text'

const meta = {
    title: 'App/Collapsible',
    component: Collapsible,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof Collapsible>

export default meta
type Story = StoryObj<typeof meta>

const Body = () => (
    <div
        style={{
            background: 'var(--surface-1)',
            border: 'var(--rule)',
            padding: 'var(--sp-5)',
            display: 'flex',
            'flex-direction': 'column',
            gap: 'var(--sp-2)',
        }}
    >
        {['first child', 'second child', 'third child'].map(t => (
            <Text>{t}</Text>
        ))}
    </div>
)

const Frame = (props: { children: any }) => (
    <div style={{ background: 'var(--bg)', padding: 'var(--sp-6)', width: '320px' }}>
        {props.children}
    </div>
)

/** Open at rest. */
export const Open: Story = {
    render: () => (
        <Frame>
            <Collapsible open>
                <Body />
            </Collapsible>
        </Frame>
    ),
}

/**
 * Closed at rest — and the thing to check is that it occupies ZERO height, not merely that its
 * contents are hidden. A collapsed section that still reserves space is the failure mode, and it
 * looks identical to a working one in a screenshot of the open state.
 */
export const Closed: Story = {
    render: () => (
        <Frame>
            <Collapsible open={false}>
                <Body />
            </Collapsible>
        </Frame>
    ),
}

/**
 * The one that earns its keep: toggle it and watch. Two things can only be judged here — that the
 * open/close transition is smooth rather than a snap (the two-signal dance in the component exists
 * solely for that), and that the children survive for the whole of the collapse instead of
 * vanishing the instant it starts.
 */
export const Interactive: Story = {
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <Frame>
                <TextButton onClick={() => setOpen(o => !o)}>
                    {open() ? 'collapse' : 'expand'}
                </TextButton>
                <Collapsible open={open()}>
                    <Body />
                </Collapsible>
            </Frame>
        )
    },
}
