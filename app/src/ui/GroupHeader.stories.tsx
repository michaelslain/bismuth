// Visual spec for <GroupHeader> — the `● LABEL // N` header List, Table, Cards and Bullets share.
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
    // Catches: the label not uppercased, or the dot and label painting different colours.
    play: async ({ canvasElement }) => {
        const label = within(canvasElement).getByText('to read')
        expect(getComputedStyle(label).textTransform).toBe('uppercase')
        const dot = label.parentElement!.querySelector('span')!
        expect(getComputedStyle(dot).backgroundColor).toBe(getComputedStyle(label).color)
    },
}

export const CustomColor: Story = {
    args: { label: 'ideas', count: 3, color: 'var(--violet)' },
}

export const NoDot: Story = { args: { label: 'finished', count: 4, dot: false } }

/** Known statuses take their category colour; an unknown key falls back to the accent. */
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
