// Visual spec for <PropertyRowEditor> — one declared-property row: the collapsed name / type /
// visibility line and the expanded editor for each property kind. The Interactive story holds
// real state and asserts the edit, the reorder and the remove reach the callbacks.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import PropertyRowEditor from './PropertyRowEditor'
import { blankPropertyRow, type PropertyFormRow } from './basePropertiesForm'

const meta = {
    title: 'Bases/PropertyRowEditor',
    component: PropertyRowEditor,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof PropertyRowEditor>

export default meta
type Story = StoryObj<typeof meta>

const row = (patch: Partial<PropertyFormRow>): PropertyFormRow => ({
    ...blankPropertyRow([]),
    name: 'status',
    ...patch,
})

function Harness(p: {
    initial: PropertyFormRow
    open: boolean
    duplicate?: boolean
    isFirst?: boolean
    isLast?: boolean
}) {
    const [r, setR] = createSignal(p.initial)
    const [open, setOpen] = createSignal(p.open)
    const [log, setLog] = createSignal<string[]>([])
    const note = (s: string) => setLog([...log(), s])
    return (
        <div style={{ width: '460px' }}>
            <PropertyRowEditor
                row={r()}
                open={open()}
                duplicate={!!p.duplicate}
                isFirst={!!p.isFirst}
                isLast={!!p.isLast}
                onToggleOpen={() => setOpen(!open())}
                onChange={patch => setR({ ...r(), ...patch })}
                onMove={dir => note(`move ${dir}`)}
                onRemove={() => note('remove')}
            />
            <output data-log>{log().join(',')}</output>
        </div>
    )
}

export const Collapsed: Story = {
    render: () => <Harness initial={row({})} open={false} />,
}

export const CollapsedHidden: Story = {
    render: () => <Harness initial={row({ hidden: true })} open={false} />,
}

export const Untitled: Story = {
    render: () => <Harness initial={row({ name: '' })} open={false} />,
}

export const OpenText: Story = {
    render: () => (
        <Harness initial={row({ name: 'title' })} open isFirst={false} />
    ),
}

export const OpenSelect: Story = {
    render: () => (
        <Harness
            initial={row({ kind: 'select', optionsText: 'todo, doing, done' })}
            open
        />
    ),
}

export const OpenNumberCurrency: Story = {
    render: () => (
        <Harness
            initial={row({
                name: 'price',
                kind: 'number',
                number: 'currency',
                unit: 'USD',
            })}
            open
        />
    ),
}

export const OpenFormula: Story = {
    render: () => (
        <Harness
            initial={row({
                name: 'total',
                kind: 'formula',
                expr: 'note.qty * note.price',
            })}
            open
            isLast
        />
    ),
}

export const DuplicateName: Story = {
    render: () => <Harness initial={row({})} open duplicate />,
}

/** Real state: rename keeps focus, the chevron row collapses, reorder + remove fire. */
export const Interactive: Story = {
    render: () => <Harness initial={row({})} open isFirst />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const name = (await c.findByPlaceholderText(
            'property name',
        )) as HTMLInputElement
        await userEvent.clear(name)
        await userEvent.type(name, 'abc')
        await expect(name.value).toBe('abc')
        // Disclosure's own `.disclosure { --disclosure-indent: calc(...) }` sits on the same element;
        // the row zeroes it so the body hangs off the tree line. Read the resolved value, not the
        // source order: an unzeroed indent resolves to the `calc(...)` text.
        await expect(
            getComputedStyle(
                name.closest('[data-testid="disclosure"]')!,
            ).getPropertyValue('--disclosure-indent').trim(),
        ).toBe('0px')
        await expect(document.activeElement).toBe(name)
        await expect(c.getByLabelText('Move up')).toBeDisabled()
        await userEvent.click(c.getByLabelText('Move down'))
        await userEvent.click(c.getByLabelText('Remove property'))
        await expect(
            canvasElement.querySelector('[data-log]')!.textContent,
        ).toBe('move 1,remove')
        await userEvent.click(c.getByRole('button', { name: /^abc/ }))
        // The body collapses over a short height animation, then unmounts.
        await waitFor(() =>
            expect(c.queryByPlaceholderText('property name')).toBeNull(),
        )
    },
}

/** The visibility eye sits BESIDE the disclosure button, not inside it: nested, it became part of the
 *  disclosure's accessible name, and a click on it had to fight the toggle. Clicking it flips
 *  visibility and does not open the row. */
export const EyeBesideTheHead: Story = {
    render: () => <Harness initial={row({ hidden: true })} open={false} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const head = canvasElement.querySelector<HTMLElement>('[aria-expanded]')!
        expect(head.querySelector('button')).toBeNull()
        const eye = c.getByLabelText(/^Show status/)
        expect(head.contains(eye)).toBe(false)
        expect(head.textContent).not.toContain('cards/table')
        // A real glyph, not the dashed `?` fallback of an unknown icon name.
        expect(eye.querySelector('svg')).toBeTruthy()
        await userEvent.click(eye)
        expect(head.getAttribute('aria-expanded')).toBe('false')
        expect(c.getByLabelText(/^Hide status/)).toBeTruthy()
    },
}
