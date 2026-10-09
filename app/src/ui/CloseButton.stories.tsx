// Visual spec for <CloseButton> — the one `[x]` that closes, dismisses, removes or cancels.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, fn } from 'storybook/test'
import CloseButton from './CloseButton'
import IconButton from './IconButton'
import TextButton from './TextButton'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/CloseButton',
    component: CloseButton,
    parameters: { layout: 'centered' },
    argTypes: {
        variant: {
            control: 'inline-radio',
            options: ['normal', 'selected', 'unselected'],
        },
        danger: { control: 'inline-radio', options: [false, true, 'hover'] },
        disabled: { control: 'boolean' },
    },
    args: { label: 'close', onClick: fn() },
} satisfies Meta<typeof CloseButton>

export default meta
type Story = StoryObj<typeof meta>

/** The default — reads `[x]`, named by `label` for assistive tech and the tooltip. */
export const Default: Story = {
    play: async ({ canvas, args }) => {
        const button = canvas.getByRole('button', { name: 'close' })
        expect(button.textContent).toBe('x')
        expect(button.getAttribute('title')).toBe('close')
        await userEvent.click(button)
        expect(args.onClick).toHaveBeenCalledOnce()
    },
}

/** `unselected` — --text-muted at rest, --fg under the pointer: a tab's or a pane's close. */
export const Muted: Story = { args: { variant: 'unselected' } }

/** `danger="hover"` — --faint at rest, --danger under the pointer: a list row's remove. */
export const DangerOnHover: Story = {
    args: { danger: 'hover', label: 'remove row' },
}

/** Disabled — --faint, not clickable. */
export const Disabled: Story = { args: { disabled: true } }

/** Beside the controls it usually shares a row with: the `[x]` sits on the same centre line and
 *  bracket rhythm as a text action and an icon. */
export const InARow: Story = {
    render: () => (
        <Row>
            <TextButton>update</TextButton>
            <IconButton icon="Search" label="search" />
            <CloseButton label="dismiss" />
        </Row>
    ),
}
