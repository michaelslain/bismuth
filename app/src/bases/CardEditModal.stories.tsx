// Visual spec for <CardEditModal> — the focused edit modal opened by a tap on a kanban card
// (KanbanCard). Unlike the card face (KanbanCard.stories.tsx), which only shows properties that
// already have a value, this modal lists the title plus EVERY declared property — including
// empty ones — each with a type-aware control: a real Milkdown WYSIWYG surface for `markdown`
// (the SAME rich editor notes use, via MilkdownField), an instant Yes/No Chip for `boolean`, and
// the shared PropertyValueEditor for everything else (text/number/date/select/multiselect).
//
// Reuses the same sample dataset + config as KanbanCard/KanbanView's stories
// (ui/_baseFixtures.ts) so the property vocabulary (status/priority/done/due/tags) matches what
// the real board declares, rather than a story-invented shape.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import { CardEditModal } from './CardEditModal'
import { sampleBaseConfig, SAMPLE_ROWS } from '../ui/_baseFixtures'
import { metaColumns } from './kanbanMeta'
import type { Row } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/CardEditModal',
    component: CardEditModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CardEditModal>

export default meta
type Story = StoryObj<typeof meta>

const config = sampleBaseConfig()
const noop = () => {}
const metaCols = ['status', 'priority', 'done', 'due', 'tags']

/** Every declared property control at once: select (status), number (priority), boolean
 *  (done — the Chip toggle), date (due), multiselect (tags). No markdown property in the
 *  curated sample config, so `CardEditModal.tsx`'s Milkdown branch is exercised separately —
 *  see `MilkdownField.stories.tsx` for that surface on its own. */
export const Default: Story = {
    render: () => (
        <CardEditModal
            row={SAMPLE_ROWS[1]}
            titleCol="file.name"
            metaCols={metaCols}
            config={config}
            siblingValues={id => SAMPLE_ROWS.map(r => r.note[id])}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            onClose={noop}
        />
    ),
    play: async () => {
        // <Modal> renders via a solid-js/web <Portal> to document.body (see ui/Modal.tsx),
        // OUTSIDE canvasElement — the same reason SymbolGallery.stories.tsx's own tests and
        // GalleryHost.stories.tsx's `GalleryOpen` read `document.body` instead.
        // The title field is seeded from the row (SAMPLE_ROWS[1] = "Ship storybook coverage"),
        // not left blank — the thing `EmptyCard` below exists to contrast against.
        const titleInput = document.querySelector<HTMLInputElement>(
            'input[placeholder="Untitled"]',
        )
        expect(titleInput).not.toBeNull()
        expect(titleInput!.value).toBe('Ship storybook coverage')
        // The `due` property (a declared `date` kind) renders DateFieldEditor — one trigger that opens the app's DatePicker
        // (editor/DatePicker.tsx, its header date input under the hood) seeded from the row's
        // value ("2026-08-05") — proves the "every declared property, populated" half of this
        // modal's whole reason to exist, and that DUE no longer falls back to the bare native
        // date input PropertyValueEditor renders for every other declared date property.
        const dueTrigger = document.querySelector<HTMLButtonElement>(
            '[data-testid="date-field-trigger"]',
        )
        expect(dueTrigger).not.toBeNull()
        expect(dueTrigger!.textContent).toBe('2026-08-05')
    },
}

// Reproduces the reported bug (#106): a board whose `order:` lists `title` (a stale/hand-
// written spelling of "the card's title", not a second property) alongside a declared
// `multiselect` property. `metaCols` here is computed through the REAL `metaColumns()` —
// the same call `KanbanView.metaCols()` makes — so this story exercises the actual fix
// (in kanbanMeta.ts), not a hand-picked array that would mask it.
const titleOrderConfig = sampleBaseConfig({
    properties: {
        tags: {
            type: {
                kind: 'multiselect',
                options: ['feature', 'bug', 'change'],
            },
        },
    },
    declaredProperties: ['tags'],
})
const titleOrderMetaCols = metaColumns(
    ['title', 'tags', 'description'],
    'file.name',
)
// Two sibling rows: one with no `title:` frontmatter, one that has it set to a plain
// string — the exact "some notes have it, some don't" shape the bug report's board had.
const NO_TITLE_ROW: Row = {
    file: { ...SAMPLE_ROWS[0].file, name: 'No Title Frontmatter' },
    note: { ...SAMPLE_ROWS[0].note },
    formula: {},
}
const HAS_TITLE_ROW: Row = {
    file: { ...SAMPLE_ROWS[1].file, name: 'Has Title Frontmatter' },
    note: { ...SAMPLE_ROWS[1].note, title: 'A stray title value' },
    formula: {},
}
const TITLE_ORDER_ROWS = [NO_TITLE_ROW, HAS_TITLE_ROW]

/** #106: `order: [title, tags, description]` on a file-backed board must render exactly ONE
 *  title field — the dedicated rename input — never a second row for `title`/`note.title`/
 *  `file.basename`. Rendered for the row that DOES carry a `title:` frontmatter value (the
 *  half of the repro most likely to make a stray second field visible, since the FIRST row
 *  had nothing to show there even pre-fix). */
export const OrderListsTitle: Story = {
    render: () => (
        <CardEditModal
            row={HAS_TITLE_ROW}
            titleCol="file.name"
            metaCols={titleOrderMetaCols}
            config={titleOrderConfig}
            siblingValues={id => TITLE_ORDER_ROWS.map(r => r.note[id])}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            onClose={noop}
        />
    ),
    play: async () => {
        // Same Portal caveat as `Default` above: read document.body, not canvasElement.
        // Every field in this modal is a <SettingsField label="…">; the dedicated title
        // input's SettingsField AND (pre-fix) a stray `title` meta row both label
        // themselves the literal string "title" (columnLabel passes a bare id through
        // unchanged) — so counting labels named exactly "title" is the direct assertion
        // for "exactly one title field", independent of what CONTROL the stray row used.
        const titleLabels = [...document.querySelectorAll('label,span,div')].filter(
            el =>
                el.textContent?.trim().toLowerCase() === 'title' &&
                el.children.length === 0,
        )
        expect(titleLabels.length).toBe(1)
        const titleInput = document.querySelector<HTMLInputElement>(
            'input[placeholder="Untitled"]',
        )
        expect(titleInput).not.toBeNull()
        expect(titleInput!.value).toBe('Has Title Frontmatter')
        // `tags` (a genuinely declared multiselect) legitimately keeps its own "+ Add"
        // chip-picker row — that control is correct and must NOT be asserted away. The bug
        // was a second row keyed `title`, never `tags`'s own control; `titleLabels.length`
        // above is what proves the second row is gone.
        expect(document.body.textContent).toMatch(/\+ Add/)
    },
}

/** A brand-new card: every property still at its default/empty value — the exact gap this
 *  modal exists to close (KanbanCard's read-only face hides an empty property entirely, so a
 *  fresh card looked like it had nothing to edit until this modal listed every declared
 *  column regardless of value). */
export const EmptyCard: Story = {
    render: () => (
        <CardEditModal
            row={{
                file: { ...SAMPLE_ROWS[0].file, name: 'Untitled' },
                note: {},
                formula: {},
            }}
            titleCol="file.name"
            metaCols={metaCols}
            config={config}
            siblingValues={id => SAMPLE_ROWS.map(r => r.note[id])}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            onClose={noop}
        />
    ),
    play: async () => {
        // Same Portal caveat as `Default` above: read document.body, not canvasElement.
        // Falls back to the filename, not the (nonexistent) row title — same field `Default`
        // checks, now proving the OTHER value it can hold.
        const titleInput = document.querySelector<HTMLInputElement>(
            'input[placeholder="Untitled"]',
        )
        expect(titleInput).not.toBeNull()
        expect(titleInput!.value).toBe('Untitled')
        // `note: {}` — the `due` property has no value, so PropertyValueEditor's `toDraft()`
        // returns `''` (its `value == null` branch) rather than a formatted date. This is the
        // state distinction the story exists to demonstrate: a fresh card's declared
        // properties are all present and all EMPTY, not the row's real ("2026-08-05") value
        // `Default` asserts.
        const dueTrigger = document.querySelector<HTMLButtonElement>(
            '[data-testid="date-field-trigger"]',
        )
        expect(dueTrigger).not.toBeNull()
        expect(dueTrigger!.textContent).toBe('Set date…')
    },
}

/** `focusTarget` set to a NON-title property (`due`) — proves CardEditModal's own
 *  render-time-queued microtask (which focuses `fieldRefs.get(t)`'s control) wins over
 *  Modal.tsx's initial-focus pick, which runs its OWN queueMicrotask afterward and used to
 *  unconditionally override whatever was already focused. This is the KanbanCard path
 *  (`KanbanCard.tsx:373` passes `focusTarget={e().target}` when a property cell is clicked):
 *  clicking the due-date cell on a kanban card must open this modal focused on THAT field, not
 *  reset to the title. Fails on the pre-fix Modal.tsx, whose microtask ran with no guard for
 *  focus a caller had already placed inside the panel — it would re-pick the first form control
 *  in DOM order (the `status` select, which precedes `due` in `metaCols`) and steal focus onto
 *  that instead. */
export const FocusesRequestedProperty: Story = {
    render: () => (
        <CardEditModal
            row={SAMPLE_ROWS[1]}
            titleCol="file.name"
            metaCols={metaCols}
            config={config}
            focusTarget="due"
            siblingValues={id => SAMPLE_ROWS.map(r => r.note[id])}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            onClose={noop}
        />
    ),
    play: async () => {
        // Same Portal caveat as `Default` above: read document.body, not canvasElement. Both
        // CardEditModal's own microtask and Modal.tsx's run as queued microtasks, so wait for
        // the dust to settle rather than asserting synchronously.
        await waitFor(() => {
            const dueTrigger = document.querySelector<HTMLButtonElement>(
                '[data-testid="date-field-trigger"]',
            )
            expect(dueTrigger).not.toBeNull()
            expect(document.activeElement).toBe(dueTrigger)
        })
    },
}

/** `focusTarget` set to a SELECT-typed property (`status`) — proves the post-hashing
 *  querySelector list (`input, textarea, [data-select-trigger], button`,
 *  ds-bridges Task 4) still lands focus on Select's trigger button once `.ui-select-trigger`
 *  stopped being a literal class this query could ever match (Review Focus 5). */
export const FocusesSelectProperty: Story = {
    render: () => (
        <CardEditModal
            row={SAMPLE_ROWS[1]}
            titleCol="file.name"
            metaCols={metaCols}
            config={config}
            focusTarget="status"
            siblingValues={id => SAMPLE_ROWS.map(r => r.note[id])}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            onClose={noop}
        />
    ),
    play: async () => {
        // Same Portal caveat as `Default` above: read document.body, not canvasElement.
        await waitFor(() => {
            const active = document.activeElement as HTMLElement | null
            expect(active).not.toBeNull()
            expect(active!.hasAttribute('data-select-trigger')).toBe(true)
        })
    },
}

/** Proves the read-only branch (`file.folder` — not writable per `writableKey`) stays
 *  reactive: with the modal open, changing `props.row` to a different row must update the
 *  displayed text. Regression for the bug where `renderControl`'s read-only branch read
 *  `value(id)` through `untrack`, so a read-only field froze at whatever it resolved to when
 *  the modal opened. The seam is the story's own `setRow` signal setter — no timeout. */
export const ReadonlyFieldUpdatesLive: Story = {
    render: () => {
        const [row, setRow] = createSignal(SAMPLE_ROWS[1])
        return (
            <>
                <button
                    type="button"
                    data-testid="swap-row"
                    onClick={() => setRow(SAMPLE_ROWS[3])}
                >
                    swap row
                </button>
                <CardEditModal
                    row={row()}
                    titleCol="file.name"
                    metaCols={[...metaCols, 'file.folder']}
                    config={config}
                    siblingValues={id => SAMPLE_ROWS.map(r => r.note[id])}
                    onRename={noop}
                    onSetMeta={noop}
                    onDelete={noop}
                    onClose={noop}
                />
            </>
        )
    },
    play: async () => {
        // Same Portal caveat as `Default` above: read document.body, not canvasElement.
        // SAMPLE_ROWS[1] is in folder "projects", SAMPLE_ROWS[3] is in folder "eng".
        const readonly = () =>
            [...document.querySelectorAll('span')].find(
                el => el.textContent === 'projects' || el.textContent === 'eng',
            )
        await waitFor(() => expect(readonly()?.textContent).toBe('projects'))
        document
            .querySelector<HTMLButtonElement>('[data-testid="swap-row"]')!
            .click()
        await waitFor(() => expect(readonly()?.textContent).toBe('eng'))
    },
}
