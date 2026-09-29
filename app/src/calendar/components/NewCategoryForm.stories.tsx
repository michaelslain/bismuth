// Visual spec for <NewCategoryForm>. Holds a real list: Enter adds one row and resets the field;
// a repeat name is refused and leaves the field alone.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, For } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import NewCategoryForm from './NewCategoryForm'
import type { Category } from '../types'

const meta = {
    title: 'Calendar/NewCategoryForm',
    component: NewCategoryForm,
} satisfies Meta<typeof NewCategoryForm>

export default meta
type Story = StoryObj<typeof meta>

function Host() {
    const [list, setList] = createSignal<Category[]>([{ name: 'Work', color: 'blue' }])
    return (
        <>
            <NewCategoryForm
                onAdd={async c => {
                    if (list().some(x => x.name === c.name)) return false
                    setList(l => [...l, c])
                    return true
                }}
            />
            <ul data-testid="added">
                <For each={list()}>{c => <li>{c.name}</li>}</For>
            </ul>
        </>
    )
}

export const Empty: Story = { render: () => <Host /> }

export const EnterAddsOne: Story = {
    render: () => <Host />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const input = c.getByPlaceholderText('category name') as HTMLInputElement
        await userEvent.type(input, 'Reading{Enter}')
        expect(c.getAllByRole('listitem')).toHaveLength(2)
        expect(input.value).toBe('')
        await userEvent.type(input, 'Work{Enter}')
        expect(c.getAllByRole('listitem')).toHaveLength(2)
        expect(input.value).toBe('Work')
    },
}
