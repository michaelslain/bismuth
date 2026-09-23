// Visual spec for <TextButton> — the thin, labels-only wrapper over the base
// <Button kind="text">: the default app button, always rendered `[ label ]`. Enforces
// lowercase labels (dev warns on non-lowercase input) and exposes only `variant`
// (selection state) + `danger` + `primary` — everything else is layout the caller
// supplies via `style`. `size`/`bracket` are deprecated and ignored.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect, within } from 'storybook/test'
import { TextButton } from './TextButton'

const meta = {
    title: 'UI/TextButton',
    component: TextButton,
    parameters: { layout: 'centered' },
    argTypes: {
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
        variant: 'normal',
        danger: false,
        primary: false,
        disabled: false,
        children: 'cancel',
    },
} satisfies Meta<typeof TextButton>

export default meta
type Story = StoryObj<typeof meta>

function Row(props: { children: JSX.Element }) {
    return (
        <div style={{ display: 'flex', 'align-items': 'center', gap: '14px' }}>
            {props.children}
        </div>
    )
}

/** Fully controllable single button. */
export const Playground: Story = {}

/** The three selection states. `play` proves the bracket look on the normal button: zero
 *  internal gap/padding/border (the `[`/`]` glyphs ARE the visual frame), a `::before` content
 *  containing `[`, and an accessible name of just the label text (the bracket glyphs use
 *  `content: '[' / ''`, so they don't leak into the accessible name). */
export const States: Story = {
    render: () => (
        <Row>
            <TextButton variant="normal">normal</TextButton>
            <TextButton variant="unselected">unselected</TextButton>
            <TextButton variant="selected">selected</TextButton>
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const btn = canvas.getByRole('button', { name: 'normal' })
        const style = getComputedStyle(btn)
        expect(style.columnGap).toBe('0px')
        expect(style.paddingLeft).toBe('0px')
        expect(style.borderTopWidth).toBe('0px')
        expect(getComputedStyle(btn, '::before').content).toContain('[')
    },
}

/** Danger + disabled. */
export const DangerAndDisabled: Story = {
    render: () => (
        <Row>
            <TextButton danger>delete</TextButton>
            <TextButton danger disabled>
                delete
            </TextButton>
            <TextButton disabled>cancel</TextButton>
        </Row>
    ),
}

/** A typical modal footer pairing (Cancel / Delete). */
export const ModalFooter: Story = {
    render: () => (
        <Row>
            <TextButton variant="unselected">cancel</TextButton>
            <TextButton danger>delete</TextButton>
        </Row>
    ),
}

/** Primary — selected + a glow rim, the view's one emphasized action. Max one per view. */
export const Primary: Story = {
    render: () => (
        <Row>
            <TextButton variant="unselected">cancel</TextButton>
            <TextButton primary>save</TextButton>
        </Row>
    ),
}

/** `accent` recolours a selected toggle in its own colour (e.g. a calendar category) instead
 *  of the view accent — `unselected` is untouched by `accent`, since only the selected state
 *  reads `--btn-accent`. */
export const Accent: Story = {
    render: () => (
        <Row>
            <TextButton variant="unselected">work</TextButton>
            <TextButton variant="selected" accent="var(--green)">
                personal
            </TextButton>
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const btn = canvas.getByRole('button', { name: 'personal' })
        expect(getComputedStyle(btn).color).toBe('rgb(163, 190, 140)')
    },
}
