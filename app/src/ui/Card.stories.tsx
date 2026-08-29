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
        variant: { control: 'inline-radio', options: ['default', 'proposal'] },
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

/** Both variants side by side. */
export const AllVariants: Story = {
    render: () => (
        <Row label="variant" column>
            <Card variant="default">default — flat, no accent edge</Card>
            <Card variant="proposal">proposal — 2px accent left edge</Card>
        </Row>
    ),
}
