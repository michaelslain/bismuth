// Visual spec for <Caret> — the one blinking cursor glyph (terminal/chat/status/tree). It is an
// animated glyph driven by `@keyframes asc-blink` (var(--blink) step-end infinite), so a single
// still screenshot of it is ambiguous by nature: at any one sampled instant it may legitimately
// be in its "off" (opacity 0) half of the cycle, which would read identically to "didn't render
// at all". The `Sized` story below gives a DOM-probe-friendly way to prove it exists and is
// animating: a wide monospace glyph on a plain background whose computed style + animation-name
// can be asserted on directly, rather than relying on when the screenshot lands in the cycle.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Caret } from './Caret'

const meta = {
    title: 'UI/Caret',
    component: Caret,
} satisfies Meta<typeof Caret>

export default meta
type Story = StoryObj<typeof meta>

/** Bare caret at normal size, in context after a run of text — the terminal/chat placement. */
export const Default: Story = {
    render: () => (
        <div
            style={{
                padding: '24px',
                'font-family': 'var(--ui-font-stack)',
                'font-size': 'var(--fs-body)',
                color: 'var(--fg)',
            }}
        >
            some text<Caret />
        </div>
    ),
}

/** Enlarged + isolated on a plain background, so a DOM probe can assert the glyph exists,
 *  has non-zero size, and carries `animation-name: asc-blink` — that assertion is what proves
 *  the caret animates, independent of which half of the blink a screenshot happens to catch. */
export const Sized: Story = {
    render: () => (
        <div
            data-testid="caret-probe"
            style={{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                width: '120px',
                height: '80px',
                background: 'var(--bg)',
                'font-size': '32px',
            }}
        >
            <Caret />
        </div>
    ),
}
