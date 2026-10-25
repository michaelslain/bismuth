// Visual spec for <TextButton> — the thin, labels-only wrapper over the base
// <Button kind="text">: the default app button, always rendered `[ label ]`. Enforces
// lowercase labels (dev warns on non-lowercase input) and exposes only `variant`
// (selection state) + `danger` + `primary` — everything else is layout the caller
// supplies via `style`. `size`/`bracket` are deprecated and ignored.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
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
        quiet: { control: 'boolean' },
        disabled: { control: 'boolean' },
        children: { control: 'text' },
    },
    args: {
        variant: 'normal',
        danger: false,
        primary: false,
        quiet: false,
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

/** Danger + disabled. `play` pins the cursor contract every button in the app inherits from
 *  here: `pointer` on an enabled button, `not-allowed` on a disabled one — never `default`,
 *  which reads as "nothing happens" rather than "this control is off". */
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const enabled = canvas.getAllByRole('button', { name: 'delete' })[0]
        const disabledDelete = canvas.getAllByRole('button', { name: 'delete' })[1]
        const disabledCancel = canvas.getByRole('button', { name: 'cancel' })
        expect(getComputedStyle(enabled).cursor).toBe('pointer')
        expect(getComputedStyle(disabledDelete).cursor).toBe('not-allowed')
        expect(getComputedStyle(disabledCancel).cursor).toBe('not-allowed')
    },
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

/** Primary — accent + bold, no box, the view's one emphasized action. Max one per view. */
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

/** `quiet`: a one-shot command in a bar. At rest it is muted ink (the icons' tone) with `[ ]` laid
 *  out but unpainted; hover paints the brackets and lifts the ink to paper; it never changes width.
 *  A disabled quiet button keeps the --faint recipe, and `quiet` beside `selected` is ignored. */
export const Quiet: Story = {
    render: () => (
        <Row>
            <TextButton>normal</TextButton>
            <TextButton>fit</TextButton>
            <TextButton quiet>fit</TextButton>
            <TextButton quiet disabled>
                reset
            </TextButton>
            <TextButton quiet variant="selected">
                on
            </TextButton>
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const color = (css: string) => {
            const probe = document.createElement('span')
            probe.style.color = css
            canvasElement.appendChild(probe)
            const c = getComputedStyle(probe).color
            probe.remove()
            return c
        }
        const [plain, quiet] = canvas.getAllByRole('button', { name: 'fit' })
        expect(getComputedStyle(quiet).color).toBe(color('var(--text-muted)'))
        expect(getComputedStyle(quiet, '::before').visibility).toBe('hidden')
        expect(getComputedStyle(quiet, '::after').visibility).toBe('hidden')
        // the bracket room is still laid out: hovering paints the brackets and moves nothing
        expect(getComputedStyle(quiet, '::before').content).toContain('[')
        const rest = quiet.getBoundingClientRect().width
        expect(rest).toBe(plain.getBoundingClientRect().width)
        await userEvent.hover(quiet)
        expect(quiet.getBoundingClientRect().width).toBe(rest)
        const reset = canvas.getByRole('button', { name: 'reset' })
        expect(getComputedStyle(reset).color).toBe(color('var(--faint)'))
        const on = canvas.getByRole('button', { name: 'on' })
        expect(getComputedStyle(on).color).toBe(color('var(--accent)'))
        expect(getComputedStyle(on, '::before').visibility).toBe('visible')
    },
}
