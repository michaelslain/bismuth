// One terminal line per kind, on the panel's own background so the derived-ANSI tones read as they
// do in the intro. The panel body's font + line-height are applied by a wrapper here because
// TermLine inherits both from the panel.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import TermLine from './TermLine'

const meta = {
    title: 'Intro/TermLine',
    component: TermLine,
    parameters: { layout: 'centered' },
    decorators: [
        Story => (
            <div
                style={{
                    background: 'var(--term-bg, var(--bg))',
                    color: 'var(--term-fg, var(--fg))',
                    padding: 'var(--sp-6)',
                    width: '470px',
                    'font-size': 'var(--fs-body)',
                    'line-height': '1.85',
                    'white-space': 'nowrap',
                }}
            >
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof TermLine>

export default meta
type Story = StoryObj<typeof meta>

/** A shell prompt + command. */
export const Prompt: Story = {
    args: { line: { p: '~/vault', c: '❯ bismuth daemon status' } },
}

/** The user's turn in a chat transcript. */
export const UserTurn: Story = {
    args: { line: { user: 'make a base of my unread books, by rating' } },
}

/** The closing status line: green dot + muted text. */
export const Status: Story = {
    args: { line: { status: 'daemon online // tending the vault' } },
}

/** A detail line with an ok value: the dotted leader fills the gap, the ok sits at the end. */
export const DetailWithOk: Story = {
    args: { line: { d: '∴ crons', dd: '// 4 scheduled', ok: 'running' } },
    play: async ({ canvasElement }) => {
        const ok = canvasElement.querySelector('[data-term-ok]')
        expect(ok?.textContent).toBe('running')
    },
}

/** A detail line with an accented value and a trailing note. */
export const DetailWithAccent: Story = {
    args: {
        line: { d: '∴ surfaced', accent: '3 forgotten notes', dd: 'from “last spring”' },
    },
}
