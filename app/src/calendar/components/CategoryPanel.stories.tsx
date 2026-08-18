// Visual spec for <CategoryPanel> — the modal listing calendar categories (colour chip,
// inline rename, delete) plus a form to add a new one. Takes only `store: EventStore`; the
// category LIST and the panel's open/closed state are read from module-level signals in
// calendar/state.ts, so stories seed those directly (same pattern as Toolbar.stories.tsx).
//
// WHAT THE PLAY PROVES: each row's colour chip opens a small swatch popover, and clicking
// anywhere outside that popover closes it — previously decided by a window `mousedown`
// listener matching `e.target.closest('.cat-chipwrap')`. That string survives a CSS-module
// hash as text but stops matching anything once `.cat-chipwrap` becomes a hashed local
// (exactly the trap ui/Modal.tsx's own `panelRef` doc comment warns about), which would make
// EVERY mousedown look "outside" and close the popover before a swatch pick could land. The
// fix has the chip's own wrapper stop the `mousedown` from ever reaching the window listener,
// so the guard no longer depends on any class string. The play proves that directly: it
// renames the wrapper's class mid-test (standing in for the hash) and shows a press on the
// popover's own background still doesn't close it, then confirms a genuinely outside press
// still does — so the assertion isn't vacuously passing because nothing can ever close.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { CategoryPanel } from './CategoryPanel'
import { EventStore, MemoryBackend } from '../EventStore'
import { categories, showCategoryPanel } from '../state'
import '../Calendar.css'

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

function seed() {
    categories.value = [
        { name: 'Work', color: 'blue' },
        { name: 'Personal', color: 'green' },
    ]
    showCategoryPanel.value = true
}

/** Resting state: the panel open with two categories. */
export const Default: Story = {
    render: () => {
        seed()
        return <CategoryPanel store={new EventStore(new MemoryBackend())} />
    },
}

/** Regression cover for the outside-click guard described above. */
export const PopoverIgnoresInsideClicks: Story = {
    render: () => {
        seed()
        return <CategoryPanel store={new EventStore(new MemoryBackend())} />
    },
    play: async () => {
        const canvas = within(document.body)

        // Open the first row's colour popover.
        const chip = document.querySelector('[aria-label="Choose colour"]')
        if (!(chip instanceof HTMLElement)) throw new Error('chip not found')
        await userEvent.click(chip)
        const popover = document.querySelector('.cat-pop')
        if (!(popover instanceof HTMLElement))
            throw new Error('popover did not open')

        // Stand in for the CSS-module hash: rename the wrapper's class to something a
        // `.cat-chipwrap` selector would never match again. The fix's guard doesn't look
        // at this class at all, so this must have no effect on what happens next.
        const wrapper = chip.closest('.cat-chipwrap')
        if (!(wrapper instanceof HTMLElement))
            throw new Error('wrapper not found')
        wrapper.className = '_simulated_hashed_local_abc123'

        // A press on the popover's own background (not a swatch, so nothing explicitly
        // closes it) must not be treated as "outside".
        fireEvent.mouseDown(popover)
        fireEvent.click(popover)
        await waitFor(() =>
            expect(document.querySelector('.cat-pop')).not.toBeNull(),
        )

        // Sanity check: a press that IS genuinely outside the chip/popover still closes
        // it — proves the assertion above is testing something real, not a guard that
        // never closes at all.
        const title = canvas.getByText('Categories')
        fireEvent.mouseDown(title)
        await waitFor(() =>
            expect(document.querySelector('.cat-pop')).toBeNull(),
        )
    },
}
