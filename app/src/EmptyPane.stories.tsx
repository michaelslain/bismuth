// Visual spec for <EmptyPane> — shown when a pane has no content yet: a row of icon buttons
// (open file, chat, terminal) that fill this pane, plus a faint drag hint. The host here records
// the last pick under the pane, the way App fills the pane with it.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { EmptyPane, type EmptyPaneAction } from './EmptyPane'
import Text from './ui/Text'

const meta = {
    title: 'App/EmptyPane',
    component: EmptyPane,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EmptyPane>

export default meta
type Story = StoryObj<typeof meta>

function Host(props: { width?: string }) {
    const [picked, setPicked] = createSignal<EmptyPaneAction | null>(null)
    return (
        <div>
            <div
                style={{
                    height: '260px',
                    width: props.width,
                    border: props.width ? '1px solid var(--border)' : undefined,
                }}
            >
                <EmptyPane onPick={setPicked} />
            </div>
            <Text size="ui" tone="faint" data-testid="picked">
                {picked() ? `picked: ${picked()}` : 'nothing picked'}
            </Text>
        </div>
    )
}

/** A normal-width pane; each action reports which one was picked. */
export const Default: Story = {
    render: () => <Host />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        for (const [name, id] of [
            ['open a file in this pane', 'file'],
            ['new chat in this pane', 'chat'],
            ['new terminal in this pane', 'terminal'],
        ] as const) {
            await userEvent.click(await c.findByRole('button', { name }))
            await expect(c.getByTestId('picked').textContent).toBe(`picked: ${id}`)
        }
    },
}

/** A narrow split — the icons stay inside the pane and the hint still reads instead of overflowing. */
export const NarrowPane: Story = {
    render: () => <Host width="160px" />,
    play: async ({ canvasElement }) => {
        const pane = canvasElement.querySelector<HTMLElement>('[data-empty-pane-action]')!
            .closest<HTMLElement>('div[style]')!
        const box = pane.getBoundingClientRect()
        for (const b of canvasElement.querySelectorAll<HTMLElement>('[data-empty-pane-action]')) {
            const r = b.getBoundingClientRect()
            await expect(r.left).toBeGreaterThanOrEqual(box.left)
            await expect(r.right).toBeLessThanOrEqual(box.right)
        }
    },
}
