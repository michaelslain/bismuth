// Visual spec for <WindowControls> — the typed `[-] [+] [x]` titlebar buttons at the right edge of
// the top strip on Windows and Linux, where the Tauri window ships fully undecorated.
//

import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import { WindowControls } from './WindowControls'

const noop = () => {}

const meta = {
    title: 'Shell/WindowControls',
    component: WindowControls,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof WindowControls>

export default meta
type Story = StoryObj<typeof meta>

/** The three buttons at rest: `[-] [+] [x]` in the button family's spacing. The play resolves each
 *  by role + name (the glyph is only `-`, `+`, `x`) and checks the close is the shared CloseButton's
 *  `x`. */
export const Default: Story = {
    render: () => (
        <WindowControls
            onMinimize={noop}
            onToggleMaximize={noop}
            onClose={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        for (const name of ['Minimize', 'Maximize', 'Close']) {
            const btn = c.getByRole('button', { name })
            expect(btn.tagName).toBe('BUTTON')
        }
        expect(c.getByRole('button', { name: 'Close' }).textContent).toContain('x')
    },
}
