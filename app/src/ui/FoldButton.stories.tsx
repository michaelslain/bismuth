// Visual spec for <FoldButton> — a fold control outside a note (a chat message's): the shared
// FoldArrow in a button hung in the left gutter of its line, hidden until that line
// (`data-fold-anchor`) is hovered, always shown while folded.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import FoldButton from './FoldButton'
import Text from './Text'

const meta = {
    title: 'UI/FoldButton',
    component: FoldButton,
    parameters: { layout: 'padded' },
    args: { open: true, onToggle: () => {}, what: 'message' },
} satisfies Meta<typeof FoldButton>

export default meta
type Story = StoryObj<typeof meta>

const Line = (p: { open: boolean; onToggle: () => void }) => (
    <div style={{ 'padding-left': '40px', width: '320px' }}>
        <div data-fold-anchor style={{ position: 'relative' }}>
            <FoldButton open={p.open} onToggle={p.onToggle} what="message" />
            <Text as="span" register="prose">
                A line that folds
            </Text>
        </div>
    </div>
)

/** Open and not hovered: in the gutter, not shown, wholly left of the text. */
export const OpenAtRest: Story = {
    render: () => <Line open onToggle={() => {}} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const button = canvas.getByRole('button', { name: 'Collapse message' })
        await expect(getComputedStyle(button).opacity).toBe('0')
        await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(
            canvas.getByText('A line that folds').getBoundingClientRect().left,
        )
    },
}

/** Folded: shown without a hover, the triangle pointing right; a click opens it. */
export const Folded: Story = {
    render: () => {
        const [open, setOpen] = createSignal(false)
        return <Line open={open()} onToggle={() => setOpen(!open())} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const button = canvas.getByRole('button', { name: 'Expand message' })
        await expect(getComputedStyle(button).opacity).toBe('1')
        await userEvent.click(button)
        await expect(
            canvas.getByRole('button', { name: 'Collapse message' }),
        ).toHaveAttribute('aria-expanded', 'true')
    },
}
