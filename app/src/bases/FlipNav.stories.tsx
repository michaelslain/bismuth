// Visual spec for <FlipNav>: prev / page / next under text or side by side read a page at a time.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import FlipNav from './FlipNav'

const meta = {
    title: 'Bases/FlipNav',
    component: FlipNav,
} satisfies Meta<typeof FlipNav>

export default meta
type Story = StoryObj<typeof meta>

const Flipping = (props: { start: number; pages: number }) => {
    const [page, setPage] = createSignal(props.start)
    return (
        <div style={{ width: '480px', display: 'flex', 'flex-direction': 'column' }}>
            <FlipNav page={page()} pages={props.pages} onStep={d => setPage(p => p + d)} onGo={i => setPage(i + 1)} />
        </div>
    )
}

/** A middle page: both ways open; a click moves one page. */
export const Default: Story = {
    render: () => <Flipping start={3} pages={10} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('p. 3 / 10')).toBeInTheDocument()
        await userEvent.click(c.getByRole('button', { name: 'next page' }))
        await expect(c.getByText('p. 4 / 10')).toBeInTheDocument()
        await userEvent.click(c.getByRole('button', { name: 'previous page' }))
        await expect(c.getByText('p. 3 / 10')).toBeInTheDocument()
    },
}

/** The first page: there is no page before it. */
export const FirstPage: Story = {
    name: 'First page',
    render: () => <Flipping start={1} pages={10} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByRole('button', { name: 'previous page' })).toBeDisabled()
        await expect(c.getByRole('button', { name: 'next page' })).toBeEnabled()
    },
}

/** The number takes a typed page; one past the end lands on the last page. */
export const TypeAPage: Story = {
    render: () => <Flipping start={3} pages={10} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: /go to page/i }))
        const input = c.getByRole('textbox')
        await userEvent.clear(input)
        await userEvent.type(input, '99{Enter}')
        await expect(c.getByText('p. 10 / 10')).toBeInTheDocument()
    },
}
