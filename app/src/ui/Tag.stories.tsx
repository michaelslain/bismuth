// Visual spec for <Tag> — one `#tag`, as every value surface shows it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Tag from './Tag'

const meta = {
    title: 'UI/Tag',
    component: Tag,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Tag>

export default meta
type Story = StoryObj<typeof meta>

/** A single tag. A leading `#` in the name is not doubled. */
export const Single: Story = { args: { name: 'planning' } }

/** Several in a row, as a table cell lays them out. */
export const Row: Story = {
    render: () => (
        <span style={{ display: 'inline-flex', gap: 'var(--sp-5)' }}>
            <Tag name="planning" />
            <Tag name="#frontend" />
            <Tag name="area/research" />
        </span>
    ),
}
