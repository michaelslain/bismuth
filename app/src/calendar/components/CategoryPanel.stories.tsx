// Visual spec for <CategoryPanel> — the modal listing calendar categories (colour chip,
// inline rename, delete) plus a form to add a new one. Takes only `store: EventStore`; the
// category LIST and the panel's open/closed state are read from module-level signals in
// calendar/state.ts, so stories seed those directly (same pattern as Toolbar.stories.tsx).
//
// WHAT THE PLAY PROVES: each row's colour chip opens a swatch popover (an AnchoredPopover,
// portaled and dismissed by its own outside-`pointerdown` listener). A press on the popover's own
// background must not close it; a genuinely outside press still does, so the first assertion is
// not vacuous. Elements are found by `data-testid` (`category-chip`/`category-palette`), never a
// class name.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { CategoryPanel } from './CategoryPanel'
import { EventStore, MemoryBackend } from '../EventStore'
import { categories, showCategoryPanel } from '../state'
import { ToastHost } from '../../Toast'

// <Modal> (which <CategoryPanel> renders through) mounts via a Solid <Portal> straight onto
// document.body — outside canvasElement/#storybook-root entirely (see Modal.tsx, and the same
// note in bases/EditCardsModal.stories.tsx). So the play below queries `document`, not
// `canvasElement`.

const meta = {
    title: 'Calendar/CategoryPanel',
    component: CategoryPanel,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CategoryPanel>

export default meta
type Story = StoryObj<typeof meta>

/** A store that really holds the seeded categories (addCategory pushes synchronously), so the
 *  panel's writes and the `categories` signal agree. */
function seededStore(names: [string, string][] = [['Work', 'blue'], ['Personal', 'green']]) {
    const store = new EventStore(new MemoryBackend())
    for (const [name, color] of names) void store.addCategory({ name, color })
    categories.value = store.getCategories()
    showCategoryPanel.value = true
    return store
}

function seed() {
    return seededStore()
}

/** Resting state: the panel open with two categories. */
export const Default: Story = {
    render: () => {
        const store = seed()
        return <CategoryPanel {...{ store }} />
    },
}

/** Regression cover for the outside-click guard described above. */
export const PopoverIgnoresInsideClicks: Story = {
    render: () => {
        const store = seed()
        return <CategoryPanel {...{ store }} />
    },
    play: async () => {
        const canvas = within(document.body)

        // Open the first row's colour popover.
        const chip = document.querySelector('[aria-label="Choose colour"]')
        if (!(chip instanceof HTMLElement)) throw new Error('chip not found')
        await userEvent.click(chip)
        const popover = document.querySelector(
            '[data-testid="category-palette"]',
        )
        if (!(popover instanceof HTMLElement))
            throw new Error('popover did not open')

        // Rename the wrapper's class to something not even the real hash — the fix's guard
        // doesn't look at any class at all, so this must have no effect on what follows.
        const wrapper = chip.closest('[data-testid="category-chip"]')
        if (!(wrapper instanceof HTMLElement))
            throw new Error('wrapper not found')
        wrapper.className = '_simulated_hashed_local_abc123'

        // A press on the popover's own background (not a swatch, so nothing explicitly
        // closes it) must not be treated as "outside".
        fireEvent.pointerDown(popover)
        fireEvent.click(popover)
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).not.toBeNull(),
        )

        // Sanity check: a press that IS genuinely outside the chip/popover still closes
        // it — proves the assertion above is testing something real, not a guard that
        // never closes at all.
        const title = canvas.getByText('categories')
        fireEvent.pointerDown(title)
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).toBeNull(),
        )
    },
}

const rows = () => document.querySelectorAll('[aria-label^="Delete "]')

/** Regression: Enter in the new-category input added the category TWICE (the input's own handler
 *  plus a window keydown listener both ran). Exactly one new row must appear. */
export const EnterAddsExactlyOne: Story = {
    render: () => {
        const store = seed()
        return <CategoryPanel {...{ store }} />
    },
    play: async () => {
        const before = rows().length
        const input = within(document.body).getByPlaceholderText('category name')
        await userEvent.type(input, 'Reading')
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(rows().length).toBe(before + 1))
        await new Promise(r => setTimeout(r, 150))
        expect(rows().length).toBe(before + 1)
        expect(categories.value.filter(c => c.name === 'Reading')).toHaveLength(1)
    },
}

/** Click a name to rename it inline; Enter commits. */
export const Rename: Story = {
    render: () => {
        const store = seed()
        return <CategoryPanel {...{ store }} />
    },
    play: async () => {
        const body = within(document.body)
        await userEvent.click(body.getByText('Work'))
        await userEvent.keyboard('{Control>}a{/Control}Deep work{Enter}')
        await waitFor(() =>
            expect(categories.value.map(c => c.name)).toContain('Deep work'),
        )
        expect(body.getByText('Deep work')).toBeTruthy()
    },
}

/** Delete removes at once and offers undo, which brings the category back. */
export const DeleteWithUndo: Story = {
    render: () => {
        const store = seed()
        return (
            <>
                <CategoryPanel {...{ store }} />
                <ToastHost />
            </>
        )
    },
    play: async () => {
        const body = within(document.body)
        await userEvent.click(body.getByLabelText('Delete Work'))
        await waitFor(() =>
            expect(categories.value.map(c => c.name)).not.toContain('Work'),
        )
        expect(body.getByText('deleted Work')).toBeTruthy()
        await userEvent.click(await body.findByRole('button', { name: 'undo' }))
        await waitFor(() =>
            expect(categories.value.map(c => c.name)).toContain('Work'),
        )
    },
}

/** No categories yet — only the add form shows. */
export const Empty: Story = {
    render: () => {
        const store = seededStore([])
        return <CategoryPanel {...{ store }} />
    },
}
