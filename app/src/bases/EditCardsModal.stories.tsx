// Visual spec for <EditCardsModal> — the deck-wide flashcard manager opened from the
// review view's "Cards" button.
//
// The draft (inline-add) row's Front field moves focus to the Back field on Enter. That used
// to be done by walking the DOM: `e.currentTarget.closest('.cards-draft')!.querySelector('.cell-back
// textarea')`. `.cards-draft`/`.cell-back` are plain className strings — invisible to every tool
// — and this repo is migrating its CSS to CSS Modules, where a class becomes a hashed local and
// the selector would silently match nothing (Enter would then do nothing instead of moving focus).
// Fixed to a direct Solid ref (`draftBackRef`) so the wiring no longer depends on any class name
// surviving hashing.
//
// The `play` below is the only way to prove this at all: Solid components can't mount under
// Bun's test runner (`solid-js/web` resolves to its server build there), so a real-browser
// Storybook `play` is the sole instrument for this behaviour.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import { EditCardsModal } from './EditCardsModal'
import type { FileMeta, Row } from '../../../core/src/bases/types'

const noop = () => {}

function file(name: string): FileMeta {
    return {
        name,
        basename: name,
        path: `cards/${name}.md`,
        folder: 'cards',
        ext: 'md',
        size: 128,
        ctime: Date.now(),
        mtime: Date.now(),
        tags: [],
        links: [],
    }
}

const ROWS: Row[] = [
    {
        file: file('capital-of-france'),
        note: { front: 'Capital of France?', back: 'Paris' },
        formula: {},
    },
    {
        file: file('capital-of-japan'),
        note: { front: 'Capital of Japan?', back: 'Tokyo' },
        formula: {},
    },
]

const meta = {
    title: 'Bases/EditCardsModal',
    component: EditCardsModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EditCardsModal>

export default meta
type Story = StoryObj<typeof meta>

/** Resting state: two existing cards + the trailing draft row. */
export const Default: Story = {
    args: {
        rows: ROWS,
        basePath: 'cards/geography.md',
        frontField: 'front',
        backField: 'back',
        deckName: 'Geography',
        onClose: noop,
        onChanged: noop,
    },
}

/** Typing into the draft row's Front field and pressing Enter moves focus straight to the
 *  Back field's textarea — proving the sibling lookup (now a Solid ref, not a
 *  `closest('.cards-draft')` + `querySelector('.cell-back textarea')` DOM walk) still finds the
 *  right element. Revert the ref back to the class-selector walk under CSS Modules (hashed class
 *  names) and this assertion fails: focus never moves because the selector matches nothing. */
export const DraftEnterMovesFocusToBack: Story = {
    args: {
        rows: ROWS,
        basePath: 'cards/geography.md',
        frontField: 'front',
        backField: 'back',
        deckName: 'Geography',
        onClose: noop,
        onChanged: noop,
    },
    play: async () => {
        // <Modal> renders through a Solid <Portal> straight onto document.body (see Modal.tsx),
        // outside canvasElement/#storybook-root entirely — so this queries the document, not the
        // canvas. Scoped to `.cards-draft` (the trailing add row): the existing cards above it
        // also render a "Back…"-placeholder textarea, so a bare placeholder query would be
        // ambiguous.
        const draftRow = document.querySelector('.cards-draft')
        if (!(draftRow instanceof HTMLElement))
            throw new Error('.cards-draft not found')
        const front = draftRow.querySelector('.cell-front textarea')
        const back = draftRow.querySelector('.cell-back textarea')
        if (!(front instanceof HTMLTextAreaElement))
            throw new Error('draft front textarea not found')
        if (!(back instanceof HTMLTextAreaElement))
            throw new Error('draft back textarea not found')

        await userEvent.click(front)
        await userEvent.type(front, 'Capital of Italy?')
        await userEvent.keyboard('{Enter}')

        await expect(document.activeElement).toBe(back)
    },
}

/** Bulk-add preview — no other story reaches `.cards-bulk-*`/`.cards-pv*`/`.cards-warn*`
 *  (CSS-module migration, 2026-08) since they only render in bulk mode. Two pasted lines: one
 *  with a separator (a normal preview card) and one without (the "no back" warning path, which
 *  also exercises `.cards-warn-em` — rewritten from a bare literal to interpolate the module's
 *  hashed class inside a JS template string; see Flashcards.module.css's header). */
export const BulkAddPreview: Story = {
    args: {
        rows: ROWS,
        basePath: 'cards/geography.md',
        frontField: 'front',
        backField: 'back',
        deckName: 'Geography',
        onClose: noop,
        onChanged: noop,
    },
    play: async () => {
        const bulkToggle = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent?.includes('BULK ADD'),
        )
        if (!bulkToggle) throw new Error('BULK ADD toggle not found')
        await userEvent.click(bulkToggle)

        const textarea = document.querySelector(
            'textarea[placeholder*="Spanish word"]',
        )
        if (!(textarea instanceof HTMLTextAreaElement))
            throw new Error('bulk paste textarea not found')
        await userEvent.click(textarea)
        await userEvent.type(
            textarea,
            'capital of Italy :: Rome\nno separator here',
        )
    },
}
