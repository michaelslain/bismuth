// Visual spec for <GroupHeader> — the `● label // N` header List, Table, Cards and Bullets share.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import GroupHeader from './GroupHeader'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/GroupHeader',
    component: GroupHeader,
    parameters: { layout: 'centered' },
    args: { label: 'reading' },
} satisfies Meta<typeof GroupHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithCount: Story = {
    args: { label: 'to read', count: 12 },
    // Catches: the label being case-transformed (nothing in the design system shouts), or the dot
    // and label painting different colours.
    play: async ({ canvasElement }) => {
        const label = within(canvasElement).getByText('to read')
        expect(getComputedStyle(label).textTransform).toBe('none')
        const dot = label.parentElement!.querySelector('span')!
        expect(getComputedStyle(dot).backgroundColor).toBe(getComputedStyle(label).color)
    },
}

export const CustomColor: Story = {
    args: { label: 'ideas', count: 3, color: 'var(--violet)' },
}

export const NoDot: Story = { args: { label: 'finished', count: 4, dot: false } }

/** A dotless header keeps the dot's 6px slot, so its label starts at the same x as a dotted one's. */
export const DotAlignment: Story = {
    render: () => (
        <Row label="dot // no dot" column gap="8px">
            <GroupHeader label="reading" count={2} />
            <GroupHeader label="reading" count={2} dot={false} />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const [dotted, dotless] = Array.from(canvasElement.querySelectorAll('span')).filter(
            el => el.textContent === 'reading',
        )
        expect(dotless.getBoundingClientRect().left).toBe(dotted.getBoundingClientRect().left)
    },
}

/** Known statuses take their category colour; an unknown key falls back to neutral muted ink —
 *  not the accent, which two unrelated groups would otherwise share. */
export const AllColors: Story = {
    render: () => (
        <Row label="groupColor" column gap="8px">
            <GroupHeader label="reading" count={2} />
            <GroupHeader label="to read" count={5} />
            <GroupHeader label="finished" count={9} />
            <GroupHeader label="abandoned" count={1} />
            <GroupHeader label="something else" count={7} />
        </Row>
    ),
}
