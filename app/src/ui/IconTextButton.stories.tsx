// Visual spec for <IconTextButton> — a text <Button> with a leading icon, rendered as the
// bracket register: `[ icon label ]`.
//
// Props: icon (required), iconSize (default 12), variant ("normal" default | "selected"
// | "unselected"), danger, primary, plus native <button> attributes. Labels must be
// lowercase (dev warns otherwise — same rule as TextButton). `size`/`bracket` are deprecated
// and ignored.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { IconTextButton } from './IconTextButton'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/IconTextButton',
    component: IconTextButton,
    parameters: { layout: 'centered' },
    argTypes: {
        icon: { control: 'text' },
        variant: {
            control: 'inline-radio',
            options: ['normal', 'selected', 'unselected'],
        },
        danger: { control: 'boolean' },
        primary: { control: 'boolean' },
        disabled: { control: 'boolean' },
        children: { control: 'text' },
    },
    args: {
        icon: 'Check',
        variant: 'normal',
        danger: false,
        primary: false,
        disabled: false,
        children: 'approve',
    },
} satisfies Meta<typeof IconTextButton>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single button. */
export const Playground: Story = {}

/** `[✓ approve]` in every state — the three selection states, plus danger + disabled. */
export const States: Story = {
    render: () => (
        <Row>
            <IconTextButton icon="Check" variant="normal">
                approve
            </IconTextButton>
            <IconTextButton icon="Check" variant="unselected">
                approve
            </IconTextButton>
            <IconTextButton icon="Check" variant="selected">
                approve
            </IconTextButton>
            <IconTextButton icon="Check" danger>
                approve
            </IconTextButton>
            <IconTextButton icon="Check" disabled>
                approve
            </IconTextButton>
        </Row>
    ),
}

/** A few representative real labels from call sites (new note, saved, sync). */
export const Examples: Story = {
    render: () => (
        <Row>
            <IconTextButton icon="Plus" variant="normal">
                new note
            </IconTextButton>
            <IconTextButton icon="Check" variant="selected">
                saved
            </IconTextButton>
            <IconTextButton icon="RefreshCw" variant="unselected">
                sync
            </IconTextButton>
        </Row>
    ),
}
