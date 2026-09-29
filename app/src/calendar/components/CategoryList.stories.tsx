// Visual spec for <CategoryList>. Holds real state: click a name to rename it (Enter commits),
// the swatch recolours, the x deletes.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import CategoryList from './CategoryList'
import NewCategoryForm from './NewCategoryForm'
import type { Category } from '../types'

const meta = {
    title: 'Calendar/CategoryList',
    component: CategoryList,
} satisfies Meta<typeof CategoryList>

export default meta
type Story = StoryObj<typeof meta>

const SEED: Category[] = [
    { name: 'Work', color: 'blue' },
    { name: 'Personal', color: 'green' },
    { name: 'Focus', color: 'violet' },
]

function Host(props: { composer?: boolean }) {
    const [list, setList] = createSignal(SEED)
    return (
        <CategoryList
            categories={list()}
            onRename={(n, next) =>
                next && setList(l => l.map(c => (c.name === n ? { ...c, name: next } : c)))
            }
            onRecolor={(n, color) =>
                setList(l => l.map(c => (c.name === n ? { ...c, color } : c)))
            }
            onDelete={n => setList(l => l.filter(c => c.name !== n))}
            composer={
                props.composer ? (
                    <NewCategoryForm
                        onAdd={async c => {
                            if (list().some(x => x.name === c.name)) return false
                            setList(l => [...l, c])
                            return true
                        }}
                    />
                ) : undefined
            }
        />
    )
}

export const Default: Story = { render: () => <Host /> }

/** With the add row as the list's last row — how CategoryPanel ships it. */
export const WithComposer: Story = { render: () => <Host composer /> }

/** No categories: the add row alone. */
export const EmptyWithComposer: Story = {
    render: () => (
        <CategoryList
            categories={[]}
            onRename={() => {}}
            onRecolor={() => {}}
            onDelete={() => {}}
            composer={<NewCategoryForm onAdd={async () => true} />}
        />
    ),
}

export const RenameAndDelete: Story = {
    render: () => <Host />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'Work' }))
        await userEvent.keyboard('{Control>}a{/Control}Deep work{Enter}')
        expect(await c.findByRole('button', { name: 'Deep work' })).toBeTruthy()
        await userEvent.click(c.getByLabelText('Delete Personal'))
        expect(c.queryByText('Personal')).toBeNull()
        // the name is a real button: Tab reaches it, Enter opens the editor
        c.getByRole('button', { name: 'Focus' }).focus()
        await userEvent.keyboard('{Enter}')
        expect(c.getByLabelText('Rename Focus')).toBeTruthy()
    },
}
