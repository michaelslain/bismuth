// Visual spec for <ReadonlyValue> — a value no editor can round-trip, or a column that is not
// writable: muted text, never committed. Static stories, each asserting the text it derives.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ReadonlyValue from './ReadonlyValue'

const meta = {
    title: 'Bases/ReadonlyValue',
    component: ReadonlyValue,
} satisfies Meta<typeof ReadonlyValue>

export default meta
type Story = StoryObj<typeof meta>

/** A list holding numbers — joined with `, `. */
export const NumberList: Story = {
    render: () => <ReadonlyValue value={[1, 2, 3]} />,
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('1, 2, 3')).toBeInTheDocument()
    },
}

/** A link value shows its display text, falling back to its path. */
export const Links: Story = {
    render: () => (
        <ReadonlyValue
            value={[{ path: 'People/Jane.md', display: 'Jane' }, { path: 'People/Sam.md' }]}
        />
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('Jane, People/Sam.md'),
        ).toBeInTheDocument()
    },
}

/** An object with no display or path falls back to its JSON — never `[object Object]`. */
export const ObjectValue: Story = {
    render: () => <ReadonlyValue value={{ a: 1 }} />,
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('{"a":1}')).toBeInTheDocument()
    },
}

/** An empty value shows the caller's placeholder (CardEditModal passes an em dash). */
export const EmptyWithPlaceholder: Story = {
    render: () => <ReadonlyValue value={null} placeholder="—" />,
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('—')).toBeInTheDocument()
    },
}
