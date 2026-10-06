// Visual spec for <Card> — the flat bordered surface primitive (formerly the bare `.asc-card`
// global class in ui/ui.css; see Card.tsx). Radius is --r-0 (square corners, §9.2).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Card from './Card'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/Card',
    component: Card,
    parameters: { layout: 'padded' },
    argTypes: {
        variant: { control: 'inline-radio', options: ['default', 'proposal', 'quiet'] },
        attention: { control: 'boolean' },
        children: { control: 'text' },
    },
    args: {
        variant: 'default',
        children: 'A flat bordered surface — --surface-1 fill, hairline border, square corners.',
    },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single card. */
export const Playground: Story = {}

/** The default surface: no accent edge. */
export const Default: Story = {
    args: { variant: 'default' },
}

/** The `proposal` variant: a 2px accent LEFT edge — the same treatment Callout and
 *  Frontmatter share. Used by VaultIntro's power-up rows. */
export const Proposal: Story = {
    args: {
        variant: 'proposal',
        children: 'A suggested item inside a list — the accent edge marks it as proposed.',
    },
}

/** `quiet`: the editor fill and the soft rule, for panels side by side on the page ground. */
export const Quiet: Story = {
    args: { variant: 'quiet', children: 'A quiet panel — --editor fill, --rule-soft outline.' },
}

/** `attention` on the default variant: warning-edge border plus a faint warning tint. */
export const Attention: Story = {
    render: () => (
        <Row label="default // default + attention" column>
            <Card variant="default">default</Card>
            <Card variant="default" attention>
                default + attention — waiting on you
            </Card>
        </Row>
    ),
}

/** The daemon inbox look: quiet fill, attention edge and tint. */
export const QuietAttention: Story = {
    args: {
        variant: 'quiet',
        attention: true,
        children: 'quiet + attention — 2 need you',
    },
}

/** Every variant side by side on the page ground. */
export const AllVariants: Story = {
    render: () => (
        <Row label="variant" column>
            <Card variant="default">default — flat, no accent edge</Card>
            <Card variant="proposal">proposal — 2px accent left edge</Card>
            <Card variant="quiet">quiet — editor fill, soft rule</Card>
            <Card variant="quiet" attention>
                quiet + attention — warning edge and tint
            </Card>
        </Row>
    ),
}
