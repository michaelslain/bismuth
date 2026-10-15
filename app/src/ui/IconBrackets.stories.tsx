// Visual spec for <IconBrackets> — the one owner of the `[▣]` icon-bracket recipe. Button's icon
// kind renders it inline; the tab rail's active row renders it anchored. Every state is shown here
// so the recipe can be read on its own, without a button around it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import IconBrackets from './IconBrackets'
import { Icon } from '../icons/Icon'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/IconBrackets',
    component: IconBrackets,
    parameters: { layout: 'centered' },
    argTypes: {
        state: { control: 'inline-radio', options: ['on', 'reserved', 'off'] },
        anchored: { control: 'boolean' },
    },
    args: { state: 'on', anchored: false, children: <Icon value="Star" /> },
} satisfies Meta<typeof IconBrackets>

export default meta
type Story = StoryObj<typeof meta>

/** Inline brackets are flex siblings of the icon, as inside a button: they need a flex parent. */
const flex = { display: 'inline-flex', 'align-items': 'center' } as const

/** Fully controllable group. */
export const Playground: Story = {
    render: args => (
        <Row wrap={false} gap="var(--sp-6)">
            <span style={flex}>
                <IconBrackets state={args.state} anchored={args.anchored}>
                    <Icon value="Star" />
                </IconBrackets>
            </span>
            <span style={flex}>
                <IconBrackets state={args.state} anchored={args.anchored}>
                    <Icon value="Search" />
                </IconBrackets>
            </span>
            <span style={flex}>
                <IconBrackets state={args.state} anchored={args.anchored}>
                    <Icon value="Settings" />
                </IconBrackets>
            </span>
        </Row>
    ),
}

/** The three states inline (in a flex parent, as inside a button): `on` paints the brackets in the surrounding ink, `reserved` lays them
 *  out unpainted (the width of an off toggle member), `off` draws neither. */
export const States: Story = {
    render: () => (
        <Row wrap={false} gap="var(--sp-6)">
            <span style={{ ...flex, color: 'var(--accent)' }} data-testid="on">
                <IconBrackets state="on">
                    <Icon value="Star" />
                </IconBrackets>
            </span>
            <span style={{ ...flex, color: 'var(--text-muted)' }} data-testid="reserved">
                <IconBrackets state="reserved">
                    <Icon value="Star" />
                </IconBrackets>
            </span>
            <span style={{ ...flex, color: 'var(--text-muted)' }} data-testid="off">
                <IconBrackets state="off">
                    <Icon value="Star" />
                </IconBrackets>
            </span>
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const on = canvasElement.querySelector('[data-testid="on"]')!
        const off = canvasElement.querySelector('[data-testid="off"]')!
        await expect(on.textContent).toContain('[')
        await expect(off.textContent).not.toContain('[')
    },
}

/** Anchored, as in the tab rail: the brackets hang outside the icon's box, so the glyph keeps the
 *  axis a bare icon has. The two rows' glyphs line up. */
export const Anchored: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: 'var(--sp-4)', padding: '0 var(--sp-6)' }}>
            <span style={{ color: 'var(--accent)' }}>
                <IconBrackets anchored state="on">
                    <Icon value="Star" />
                </IconBrackets>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
                <IconBrackets anchored state="off">
                    <Icon value="Star" />
                </IconBrackets>
            </span>
        </div>
    ),
}
