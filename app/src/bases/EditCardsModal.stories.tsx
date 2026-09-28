// Visual spec for <EditCardsModal> — the deck-wide flashcard manager opened from the review view's
// "Cards" button: a shell over CardsListEditor (Cards mode) and BulkCardsEditor (Bulk add mode).
//
// Every interaction story asserts the WRITE the modal made, through `spyApi` (the fake transport
// answers only some row routes and keeps no log): the notes it sent, the index it addressed. The
// modal renders through a Solid <Portal> onto document.body, outside the canvas, so queries here go
// through `document`. Cells are told apart by the `data-cell` runtime hook, the draft row by
// `data-testid`. Solid components cannot mount under Bun's test runner, so a real-browser
// Storybook `play` is the sole instrument for this behaviour.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, Show } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { EditCardsModal } from './EditCardsModal'
import type { FileMeta, Row } from '../../../core/src/bases/types'
import { spyApi } from './_apiSpy'
import { toasts, dismissToast } from '../toastStore'

const noop = () => {}
let changed = 0

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

const args = {
    rows: ROWS,
    basePath: 'cards/geography.md',
    frontField: 'front',
    backField: 'back',
    deckName: 'Geography',
    onClose: noop,
    onChanged: noop,
}

const VERBS = ['rowUpdate', 'rowUpdateMany', 'rowCreate', 'rowDelete', 'rowReorder'] as const
let spy: ReturnType<typeof spyApi>
// What the base file holds once the first card is deleted — undo re-counts rows from it.
const AFTER_DELETE =
    '---\ntype: base\n---\n\n| front | back |\n| --- | --- |\n| Capital of Japan? | Tokyo |\n'
const install = () => {
    spy = spyApi([...VERBS, 'read'], { read: async () => AFTER_DELETE })
    for (const t of toasts()) dismissToast(t.id)
    return spy.restore
}

const body = () => within(document.body)
const cardRows = () => document.querySelectorAll('[data-testid="cards-row"]')
const footer = () => document.body.textContent ?? ''

/** Resting state: two existing cards + the trailing draft row. */
export const Default: Story = {
    args,
    beforeEach: install,
    play: async () => {
        expect(cardRows()).toHaveLength(2)
        expect(document.querySelector('[data-testid="draft-row"]')).not.toBeNull()
        expect(footer()).toContain('2 cards in deck')
    },
}

/** Typing into the draft row's Front field and pressing Enter moves focus straight to the Back
 *  field; Enter there creates the card — one `rowCreate` with the typed note, and the footer count
 *  moves. The focus hop is a Solid ref (`draftBackRef`), not a class-selector walk, so hashing
 *  cannot break it. */
export const DraftEnterMovesFocusToBack: Story = {
    args,
    beforeEach: install,
    play: async () => {
        const draft = document.querySelector('[data-testid="draft-row"]') as HTMLElement
        const front = draft.querySelector('[data-cell="front"] textarea')
        const back = draft.querySelector('[data-cell="back"] textarea')
        if (!(front instanceof HTMLTextAreaElement)) throw new Error('draft front not found')
        if (!(back instanceof HTMLTextAreaElement)) throw new Error('draft back not found')

        await userEvent.click(front)
        await userEvent.type(front, 'Capital of Italy?')
        await userEvent.keyboard('{Enter}')
        await expect(document.activeElement).toBe(back)

        await userEvent.type(back, 'Rome')
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(footer()).toContain('3 cards in deck'))
        expect(spy.named('rowCreate')[0].args).toEqual([
            'cards/geography.md',
            { front: 'Capital of Italy?', back: 'Rome' },
        ])
        expect(front.value).toBe('')
    },
}

/** Bulk-add preview: two pasted lines, one with a separator and one without. The preview shows two
 *  rows, the second flagged "no back"; adding writes both and returns to the list. */
export const BulkAddPreview: Story = {
    args,
    beforeEach: install,
    play: async () => {
        await userEvent.click(body().getByRole('button', { name: /bulk add/ }))
        const textarea = document.querySelector('textarea[placeholder*="Spanish word"]')
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('bulk paste textarea not found')
        await userEvent.click(textarea)
        await userEvent.type(textarea, 'capital of Italy :: Rome\nno separator here')

        await waitFor(() =>
            expect(document.querySelectorAll('[data-testid="bulk-preview-row"]')).toHaveLength(2),
        )
        const warnings = document.querySelectorAll('[data-testid="bulk-preview-warning"]')
        expect(warnings).toHaveLength(1)
        expect(warnings[0].textContent).toContain('no back')
        expect(
            document.querySelector('[data-testid="bulk-preview-count"]')!.textContent,
        ).toBe('2 cards')

        await userEvent.click(body().getByRole('button', { name: 'add 2 cards' }))
        await waitFor(() => expect(footer()).toContain('4 cards in deck'))
        expect(spy.named('rowCreate').map(c => c.args[1])).toEqual([
            { front: 'capital of Italy', back: 'Rome' },
            { front: 'no separator here', back: '' },
        ])
    },
}

const SCHEDULED: Row[] = ROWS.map((r, i) => ({
    ...r,
    note: {
        ...r.note,
        due: '2026-10-01',
        ease: 2.5,
        interval: 6 + i,
        dueBack: '2026-10-05',
        easeBack: 2.1,
        intervalBack: 3,
    },
}))

/** Bidirectional: resetting one card strips the forward triple AND its `*Back` companions, and
 *  leaves front/back alone. Only that card is written. */
export const Bidirectional: Story = {
    args: { ...args, rows: SCHEDULED, bidirectional: true },
    beforeEach: install,
    play: async () => {
        await userEvent.click(within(cardRows()[0] as HTMLElement).getByLabelText("Reset this card's progress"))
        await waitFor(() => expect(spy.named('rowUpdate')).toHaveLength(1))
        expect(spy.named('rowUpdate')[0].args).toEqual([
            'cards/geography.md',
            0,
            { front: 'Capital of France?', back: 'Paris' },
        ])
    },
}

/** Custom schedule columns, one-way deck: "reset all" is two-step (the first click arms it), and
 *  strips exactly the configured due/ease/interval columns from every card — a `dueBack` column
 *  the deck does not schedule survives. */
export const CustomScheduleFields: Story = {
    args: {
        ...args,
        rows: ROWS.map(r => ({
            ...r,
            note: { ...r.note, next: '2026-10-01', ef: 2.5, iv: 4, dueBack: 'keep' },
        })),
        dueField: 'next',
        easeField: 'ef',
        intervalField: 'iv',
    },
    beforeEach: install,
    play: async () => {
        await userEvent.click(body().getByRole('button', { name: 'reset all progress' }))
        expect(spy.named('rowUpdateMany')).toHaveLength(0)
        await userEvent.click(body().getByRole('button', { name: /click again to confirm/ }))
        await waitFor(() => expect(spy.named('rowUpdateMany')).toHaveLength(1))
        const updates = spy.named('rowUpdateMany')[0].args[1] as { index: number; note: object }[]
        expect(updates.map(u => u.index)).toEqual([0, 1])
        expect(updates[0].note).toEqual({ front: 'Capital of France?', back: 'Paris', dueBack: 'keep' })
    },
}

/** No cards: the empty hint, no reset-all, and the draft row still adds the first one. */
export const Empty: Story = {
    args: { ...args, rows: [] },
    beforeEach: install,
    play: async () => {
        expect(cardRows()).toHaveLength(0)
        expect(footer()).toContain('no cards yet')
        expect(footer()).toContain('0 cards in deck')
        expect(body().queryByRole('button', { name: /reset all/ })).toBeNull()
        expect(document.querySelector('[data-testid="draft-row"]')).not.toBeNull()
    },
}

/** Delete is immediate — no confirm — and the toast's `undo` puts the card back where it was:
 *  a `rowCreate` of the same note, then a `rowReorder` from the end to its old index. */
export const DeleteWithUndo: Story = {
    args,
    beforeEach: install,
    play: async () => {
        await userEvent.click(within(cardRows()[0] as HTMLElement).getByLabelText('Delete card'))
        await waitFor(() => expect(cardRows()).toHaveLength(1))
        expect(spy.named('rowDelete')[0].args).toEqual(['cards/geography.md', 0])
        const toast = toasts().at(-1)!
        expect(toast.message).toBe('deleted Capital of France?')
        expect(toast.action?.label).toBe('undo')

        toast.action!.onClick()
        await waitFor(() => expect(cardRows()).toHaveLength(2))
        expect(spy.named('rowCreate')[0].args[1]).toEqual({
            front: 'Capital of France?',
            back: 'Paris',
        })
        expect(spy.named('rowReorder')[0].args).toEqual(['cards/geography.md', 1, 0])
        const first = cardRows()[0].querySelector('[data-cell="front"] textarea') as HTMLTextAreaElement
        expect(first.value).toBe('Capital of France?')
    },
}

/** The `#` handle reorders from the keyboard: Down moves card 1 below card 2 and writes one
 *  `rowReorder(0 -> 1)`. */
export const ReorderByKeyboard: Story = {
    args,
    beforeEach: install,
    play: async () => {
        const handle = document.querySelector('[data-card-handle="0"]') as HTMLElement
        handle.focus()
        await userEvent.keyboard('{ArrowDown}')
        await waitFor(() => expect(spy.named('rowReorder')).toHaveLength(1))
        expect(spy.named('rowReorder')[0].args).toEqual(['cards/geography.md', 0, 1])
        const first = cardRows()[0].querySelector('[data-cell="front"] textarea') as HTMLTextAreaElement
        expect(first.value).toBe('Capital of Japan?')
    },
}

/** Undo AFTER the modal has closed: the toast outlives the modal, so the restore must re-count the
 *  rows on disk (one left after the delete), write the card back, and fire `onChanged` itself —
 *  the close already ran, so nothing else would tell the review queue. */
export const UndoAfterClose: Story = {
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <>
                <Show when={open()}>
                    <EditCardsModal
                        {...args}
                        onClose={() => setOpen(false)}
                        onChanged={() => {
                            changed += 1
                        }}
                    />
                </Show>
                <span data-testid="closed">{open() ? 'open' : 'closed'}</span>
            </>
        )
    },
    beforeEach: () => {
        changed = 0
        return install()
    },
    play: async () => {
        await userEvent.click(within(cardRows()[0] as HTMLElement).getByLabelText('Delete card'))
        await waitFor(() => expect(cardRows()).toHaveLength(1))
        await userEvent.click(body().getByText('done'))
        await waitFor(() => expect(cardRows()).toHaveLength(0))
        expect(changed).toBe(1)

        toasts().at(-1)!.action!.onClick()
        await waitFor(() => expect(changed).toBe(2))
        expect(spy.named('rowCreate')[0].args[1]).toEqual({
            front: 'Capital of France?',
            back: 'Paris',
        })
        expect(spy.named('rowReorder')[0].args).toEqual(['cards/geography.md', 1, 0])
    },
}
