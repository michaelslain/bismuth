// Visual spec for <CardEditModal> — the focused edit modal opened by a tap on a kanban card
// (KanbanCard). Unlike the card face (KanbanCard.stories.tsx), which only shows properties that
// already have a value, this modal lists the title plus EVERY declared property — including
// empty ones — each with a type-aware control: a real Milkdown WYSIWYG surface for `markdown`
// (the SAME rich editor notes use, via MilkdownField), an instant Yes/No ChipToggle for `boolean`,
// and the shared PropertyValueEditor for everything else (text/number/date/select/multiselect).
// PropertyControl owns that dispatch (see PropertyControl.stories.tsx).
//
// Reuses the same sample dataset + config as KanbanCard/KanbanView's stories
// (ui/_baseFixtures.ts) so the property vocabulary (status/priority/done/due/tags) matches what
// the real board declares, rather than a story-invented shape.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, Show } from 'solid-js'
import { expect, userEvent, waitFor } from 'storybook/test'
import { CardEditModal } from './CardEditModal'
import { sampleBaseConfig, SAMPLE_ROWS } from '../ui/_baseFixtures'
import { metaColumns } from './kanbanMeta'
import { pressKey, tagsFieldView } from '../ui/_tagsFieldPlay'
import { dateFieldPresets } from './dateFieldPresets'
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
const footerButton = (label: string): HTMLButtonElement | null =>
    [...document.querySelectorAll('button')].find(
        b => b.textContent?.trim() === label,
    ) ?? null
const openNoteButton = () => footerButton('open note')

/** A modal wired to real state: every callback appends to a visible log (`data-testid="log"`),
 *  and a committed value writes back onto the row so the controls reflect it — what
 *  KanbanCard's optimistic commit does. The plays assert the log. */
const Live = (p: {
    row?: Row
    metaCols?: string[]
    config?: typeof config
    focusTarget?: string
    heading?: string
    emptyHint?: string
    hasFileIdentity?: boolean
}) => {
    const start = p.row ?? SAMPLE_ROWS[1]
    const [row, setRow] = createSignal<Row>(start)
    const [log, setLog] = createSignal<string[]>([])
    const push = (entry: string) => setLog(l => [...l, entry])
    return (
        <>
            <div data-testid="log">{log().join(' | ')}</div>
            <CardEditModal
                row={row()}
                titleCol="file.name"
                metaCols={p.metaCols ?? metaCols}
                config={p.config ?? config}
                focusTarget={p.focusTarget}
                heading={p.heading}
                emptyHint={p.emptyHint}
                hasFileIdentity={p.hasFileIdentity}
                siblingValues={id => SAMPLE_ROWS.map(r => r.note[id])}
                onRename={t => push(`rename ${t}`)}
                onSetMeta={(id, v) => {
                    push(`set ${id} ${JSON.stringify(v)}`)
                    setRow(r => ({ ...r, note: { ...r.note, [id]: v } }))
                }}
                onDelete={() => push('delete')}
                onClose={() => push('close')}
            />
        </>
    )
}
const logText = () =>
    document.querySelector('[data-testid="log"]')?.textContent ?? ""
const trigger = (): HTMLElement =>
    document.querySelector<HTMLElement>('[data-select-trigger]')!
const pointer = (el: Element) =>
    userEvent.pointer({ keys: '[MouseLeft>]', target: el })

/** Every declared property control at once: select (status), number (priority), boolean
 *  (done — the ChipToggle), date (due), multiselect (tags). No markdown property in the
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
        // No `onOpenNote` passed — the footer must show no "open note" button.
        expect(openNoteButton()).toBeNull()
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
        // `tags` (a genuinely declared multiselect) legitimately keeps its own TagsField,
        // reading the row's selected value ("frontend", from
        // SAMPLE_ROWS[1] via HAS_TITLE_ROW) — that control is correct and must NOT be
        // asserted away. The bug was a second row keyed `title`, never `tags`'s own
        // control; `titleLabels.length` above is what proves the second row is gone.
        const tagsField = await tagsFieldView(document.body)
        expect(tagsField.state.doc.toString()).toContain('frontend')
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
        // No `onOpenNote` passed — the footer must show no "open note" button.
        expect(openNoteButton()).toBeNull()
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

/** `onOpenNote` wired to visible state — proves the footer's `[open note]` button (rendered
 *  only when the prop is given; see the negative assertions in `Default`/`EmptyCard` above)
 *  closes the modal FIRST (the same `close` path `done` uses, so any pending title/markdown
 *  draft still commits) and only then calls `onOpenNote`. A line under the modal reads
 *  `opened: <path>` once clicked, standing in for the real mount sites' `bismuth-open`
 *  dispatch (openRowEditor.tsx / KanbanCard.tsx) without this story depending on a global
 *  event listener. */
export const WithOpenNote: Story = {
    render: () => {
        const [opened, setOpened] = createSignal<string | null>(null)
        const [closed, setClosed] = createSignal(false)
        return (
            <>
                <div data-testid="opened-readout">opened: {opened() ?? ''}</div>
                <Show when={!closed()}>
                    <CardEditModal
                        row={SAMPLE_ROWS[1]}
                        titleCol="file.name"
                        metaCols={metaCols}
                        config={config}
                        siblingValues={id => SAMPLE_ROWS.map(r => r.note[id])}
                        onRename={noop}
                        onSetMeta={noop}
                        onDelete={noop}
                        onClose={() => setClosed(true)}
                        onOpenNote={() => setOpened(SAMPLE_ROWS[1].file.path)}
                    />
                </Show>
            </>
        )
    },
    play: async () => {
        // Same Portal caveat as `Default` above: read document.body, not canvasElement.
        const button = openNoteButton()
        expect(button).not.toBeNull()
        button!.click()
        await waitFor(() => {
            expect(document.body.textContent).toMatch(
                `opened: ${SAMPLE_ROWS[1].file.path}`,
            )
        })
        // FormModal removes its content from the DOM once `closed()` flips — proving the
        // modal actually closed (the same `close` path `done` uses) rather than staying open
        // alongside the callback firing.
        expect(
            document.querySelector('input[placeholder="Untitled"]'),
        ).toBeNull()
    },
}

/** Every commit path, on real state: the title (Enter), a select, a number, the boolean toggle, a
 *  date, a tag list, then delete and done — each asserted in the log the harness keeps. */
export const CommitsEveryField: Story = {
    render: () => <Live />,
    play: async () => {
        // Title: Enter blurs, and the blur commits the trimmed draft.
        const title = document.querySelector<HTMLInputElement>('input[placeholder="Untitled"]')!
        await userEvent.clear(title)
        await userEvent.type(title, 'Renamed card{Enter}')
        await waitFor(() => expect(logText()).toContain('rename Renamed card'))

        // Select (status): open the menu, pick Done.
        await userEvent.click(trigger())
        await userEvent.click(
            await waitFor(() => {
                const el = [...document.querySelectorAll('*')].find(
                    e => e.children.length === 0 && e.textContent === 'Done',
                )
                expect(el).toBeTruthy()
                return el!
            }),
        )
        await waitFor(() => expect(logText()).toContain('set status "Done"'))

        // Number (priority): edit, Enter.
        const priority = document.querySelector<HTMLInputElement>('input[type="number"]')!
        await userEvent.clear(priority)
        await userEvent.type(priority, '5{Enter}')
        await waitFor(() => expect(logText()).toContain('set priority 5'))

        // Boolean (done): the ChipToggle flips false -> true.
        const chip = document.querySelector<HTMLElement>('[aria-pressed]')!
        await expect(chip.getAttribute('aria-pressed')).toBe('false')
        await userEvent.click(chip)
        await waitFor(() => expect(logText()).toContain('set done true'))

        // Date (due): the shared picker, preset Today.
        await userEvent.click(document.querySelector('[data-testid="date-field-trigger"]')!)
        const popover = await waitFor(() => {
            const el = document.querySelector('[data-testid="date-field-popover"]')
            expect(el).not.toBeNull()
            return el!
        })
        await pointer([...popover.querySelectorAll('span')].find(e => e.textContent === 'Today')!)
        await waitFor(() =>
            expect(logText()).toContain(`set due "${dateFieldPresets()[0].date}"`),
        )

        // Tags: replace the line, Enter commits the list once.
        const view = await tagsFieldView(document.body)
        view.focus() // leaving the field is what commits, so it has to hold focus first
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: 'frontend, docs, ' },
            userEvent: 'input.type',
        })
        pressKey(view, 'Enter')
        await waitFor(() => expect(logText()).toContain('set tags ["frontend","docs"]'))

        // Footer: delete reports once, done flushes and closes.
        footerButton('delete')!.click()
        await waitFor(() => expect(logText()).toContain('| delete'))
        footerButton('done')!.click()
        await waitFor(() => expect(logText().endsWith('close')).toBe(true))
    },
}

// A declared `markdown` property: the modal renders a Milkdown surface for it, not a textarea.
const markdownConfig = sampleBaseConfig({
    properties: { notes: { type: { kind: 'markdown' } } },
    declaredProperties: ['notes'],
})

/** A markdown property is the rich Milkdown surface. Typing only drafts; closing (done) flushes the
 *  draft through onSetMeta exactly once. */
export const MarkdownPropertyFlushesOnClose: Story = {
    render: () => (
        <Live
            row={{ ...SAMPLE_ROWS[1], note: { ...SAMPLE_ROWS[1].note, notes: '' } }}
            metaCols={['notes']}
            config={markdownConfig}
        />
    ),
    play: async () => {
        const editable = await waitFor(() => {
            const el = document.querySelector<HTMLElement>('[contenteditable="true"]')
            expect(el).not.toBeNull()
            return el!
        })
        expect(document.querySelector('textarea')).toBeNull()
        editable.focus()
        await userEvent.type(editable, 'Ship the picker')
        // A draft only: nothing is written until blur or close.
        expect(logText()).not.toContain('set notes')
        footerButton('done')!.click()
        await waitFor(() => expect(logText()).toContain('set notes "Ship the picker'))
        await waitFor(() => expect(logText().endsWith('close')).toBe(true))
        expect(logText().match(/set notes/g)!.length).toBe(1)
    },
}

/** `hasFileIdentity={false}` (a row with no file behind it): no title field and no delete button,
 *  but the properties still edit. */
export const NoFileIdentity: Story = {
    render: () => <Live hasFileIdentity={false} />,
    play: async () => {
        expect(document.querySelector('input[placeholder="Untitled"]')).toBeNull()
        expect(footerButton('delete')).toBeNull()
        const priority = document.querySelector<HTMLInputElement>('input[type="number"]')!
        await userEvent.clear(priority)
        await userEvent.type(priority, '9{Enter}')
        await waitFor(() => expect(logText()).toContain('set priority 9'))
        expect(logText()).not.toContain('rename')
        footerButton('done')!.click()
        await waitFor(() => expect(logText().endsWith('close')).toBe(true))
        expect(logText()).not.toContain('rename')
    },
}

/** No editable columns, with the caller's own `heading` and `emptyHint` (openRowEditor's row
 *  wording) instead of the kanban defaults. */
export const CustomHeadingEmptyColumns: Story = {
    render: () => (
        <Live
            metaCols={[]}
            heading="edit row"
            emptyHint="this row has no properties to edit."
        />
    ),
    play: async () => {
        await expect(document.body.textContent).toContain('edit row')
        await expect(document.body.textContent).toContain('this row has no properties to edit.')
        await expect(document.body.textContent).not.toContain('edit card')
        await expect(document.body.textContent).not.toContain('this board declares')
    },
}

/** The two-step Escape: the first Escape in a field cancels the FIELD only (the draft reverts and
 *  the keydown is consumed, `defaultPrevented`), so the modal stays open; the second Escape closes
 *  it. The seam is the harness log — `close` appears only once `onClose` ran. */
export const EscapeTwoStep: Story = {
    render: () => <Live />,
    play: async () => {
        // Title leg: Escape reverts the draft and keeps the modal open.
        const title = document.querySelector<HTMLInputElement>('input[placeholder="Untitled"]')!
        const originalTitle = title.value
        title.focus()
        await userEvent.type(title, 'xyz')
        expect(title.value).toBe(`${originalTitle}xyz`)
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(title.value).toBe(originalTitle))
        expect(logText()).not.toContain('close')
        const priority = document.querySelector<HTMLInputElement>('input[type="number"]')!
        const original = priority.value
        priority.focus()
        await userEvent.type(priority, '99')
        expect(priority.value).toBe(`${original}99`)
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(priority.value).toBe(original))
        // Still open: the field consumed the key.
        expect(document.querySelector('input[placeholder="Untitled"]')).not.toBeNull()
        expect(logText()).not.toContain('close')
        // Second Escape, no field editing: the modal closes.
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(logText()).toContain('close'))
    },
}

/** The status select lines up with its neighbours: its `▾` ends where the due field's calendar
 *  icon ends (right edge), and its LEADING edge starts where the priority input's text starts
 *  (left edge), each within 1px. A known status (the story's "Doing") keeps its dot while edited
 *  (SelectValue, commit 78edd725), so the leading edge is the dot and the text sits one dot + gap
 *  after it; the dot is asserted present so this cannot silently fall back to measuring the text.
 *  Elements are found by tag / `data-*`, never a module class. */
export const StatusChevronAligned: Story = {
    render: () => <Live />,
    play: async () => {
        const status = trigger()
        const caret = status.querySelector<HTMLElement>('[data-select-caret]')!
        const dueIcon = document
            .querySelector<HTMLElement>('[data-testid="date-field-trigger"]')!
            .querySelector('svg')!
        const priority = document.querySelector<HTMLInputElement>('input[type="number"]')!
        const valueSpan = status.querySelector('span')!
        const textNode = [...valueSpan.childNodes].find(n => n.nodeType === Node.TEXT_NODE)!
        const range = document.createRange()
        range.selectNodeContents(textNode)
        const statusTextLeft = range.getBoundingClientRect().left
        const priorityTextLeft =
            priority.getBoundingClientRect().left +
            parseFloat(getComputedStyle(priority).paddingLeft) +
            priority.clientLeft
        const caretRight = caret.getBoundingClientRect().right
        const iconRight = dueIcon.getBoundingClientRect().right
        expect(Math.abs(caretRight - iconRight)).toBeLessThanOrEqual(1)
        const dot = status.previousElementSibling as HTMLElement | null
        expect(dot?.hasAttribute('data-size')).toBe(true)
        const statusLeadLeft = dot!.getBoundingClientRect().left
        expect(Math.abs(statusLeadLeft - priorityTextLeft)).toBeLessThanOrEqual(1)
        // The text itself sits right of the dot, never left of it.
        expect(statusTextLeft).toBeGreaterThan(statusLeadLeft)
    },
}
