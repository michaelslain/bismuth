// Visual spec for <PropertyValueEditor> — the type-aware control a kanban meta chip swaps in
// on click (KanbanCard.tsx): text input, markdown textarea, typed number/date input, a `Select`
// for an enum, and a TagsField (one line of text with the note editor's completion popup) for a
// plain (undeclared) tag list or a declared `multiselect`. No network, no theme fixture beyond the global tokens — purely a
// value in, callback out control, so every `PropertyEditKind` variant gets its own story.
//
// `boolean` is deliberately absent: the file-level comment on the component says the caller
// toggles booleans directly via a `Chip` and this component never sees that kind.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { PropertyValueEditor, resetVaultTagsCache } from './PropertyValueEditor'
import type { PropertyEditKind } from './propertyEdit'
import { setTransport } from '../api'
import { dateFieldPresets } from './dateFieldPresets'
import { fakeTransport } from '../ui/_fakeTransport'
import {
    completionLabels,
    expectCompletions,
    pressKey,
    selectedCompletion,
    tagsFieldView,
    typeInto,
} from '../ui/_tagsFieldPlay'

const meta = {
    title: 'Bases/PropertyValueEditor',
    component: PropertyValueEditor,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof PropertyValueEditor>

export default meta
type Story = StoryObj<typeof meta>

function Frame(props: { children: unknown }) {
    return (
        <div
            style={{
                width: '220px',
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                'border-radius': '8px',
                padding: '10px 12px',
            }}
        >
            {props.children as never}
        </div>
    )
}

/** A live harness that holds what got committed (or cancelled), for the plays to read — the component itself
 *  is uncontrolled-on-commit (calls back once and the caller decides what happens), so this
 *  mirrors what KanbanCard's `commitMeta` does: apply the value and re-render. */
function Harness(props: {
    kind: PropertyEditKind
    initial: unknown
    inline?: boolean
    autofocus?: boolean
}) {
    const [value, setValue] = createSignal<unknown>(props.initial)
    const [status, setStatus] = createSignal<
        'editing' | 'committed' | 'cancelled'
    >('editing')
    return (
        <Frame>
            <PropertyValueEditor
                kind={props.kind}
                value={value()}
                inline={props.inline}
                autofocus={props.autofocus}
                onCommit={v => {
                    setValue(v)
                    setStatus('committed')
                }}
                onCancel={() => setStatus('cancelled')}
            />
            {/* Read by the plays only — not shown: the field itself is what a person looks at. */}
            <span hidden data-testid="status">
                {status()}
            </span>
            <span hidden data-testid="committed">
                {status() === 'committed' ? JSON.stringify(value()) : ''}
            </span>
        </Frame>
    )
}

/** Plain text — the fallback branch for any kind not otherwise special-cased. */
export const Text: Story = {
    render: () => (
        <Harness kind={{ kind: 'text' }} initial="Draft the roadmap" />
    ),
}

/** Multiline markdown — Enter inserts a newline (does NOT commit); only blur/Escape leave it. */
export const Markdown: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'markdown' }}
            initial={'First line.\nSecond line with **bold**.'}
        />
    ),
}

/** Number, plain format — renders/accepts the value as-is. */
export const NumberPlain: Story = {
    render: () => (
        <Harness kind={{ kind: 'number', format: 'plain' }} initial={3} />
    ),
}

/** Number, percent format — storage convention is a 0..1 fraction; the edit box shows/accepts
 *  the ×100 EDIT-space value (numberFormat.ts), so `0.42` here shows as `42`. */
export const NumberPercent: Story = {
    render: () => (
        <Harness kind={{ kind: 'number', format: 'percent' }} initial={0.42} />
    ),
}

/** Number, currency format with a unit label. */
export const NumberCurrency: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'number', format: 'currency', unit: 'USD' }}
            initial={1200}
        />
    ),
}

/** Date-only: the shared DateFieldEditor trigger (the card modal's picker), not a native input. */
export const DateOnly: Story = {
    render: () => <Harness kind={{ kind: 'date' }} initial="2026-08-10" />,
}

/** Escape on the open date popover cancels the whole edit — a cell editor must not stay stuck open. */
export const DateEscapeCancels: Story = {
    render: () => <Harness kind={{ kind: 'date' }} initial="2026-08-10" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        await expect(canvas.getByTestId('status')).toHaveTextContent('editing')
        await userEvent.click(canvas.getByTestId('date-field-trigger'))
        await waitFor(() => body.getByTestId('date-field-popover'))
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(canvas.getByTestId('status')).toHaveTextContent('cancelled'))
        await expect(canvas.getByTestId('committed')).toHaveTextContent('')
    },
}

/** Date + time — the same trigger, showing `date time`. */
export const DateTime: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'date', time: true }}
            initial="2026-08-10T14:30:00"
        />
    ),
}

/** A declared `select` (enum) property — dropdown of the declared options, plus a "(clear)"
 *  entry. Current value is Doing, one of SAMPLE_STATUS_OPTIONS' vocabulary. */
export const SelectEnum: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'select', options: ['Todo', 'Doing', 'Done'] }}
            initial="Doing"
        />
    ),
}

/** A `select` value NOT in the declared options — the legacy-tolerance path (#101): a stored
 *  value the base's `options:` list doesn't (or no longer) declare still shows as the current
 *  selection, prepended to the menu rather than silently reading as cleared. */
export const SelectLegacyValue: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'select', options: ['Todo', 'Doing', 'Done'] }}
            initial="Blocked"
        />
    ),
}

/** Undeclared tags — a TagsField reading `frontend, bug, ` with the caret at the end, like a
 *  frontmatter `tags:` line. Suggestions (propertyEdit.ts's `tagsOptions` + the vault's tags)
 *  appear only once you type. */
export const Tags: Story = {
    render: () => (
        <Harness
            kind={{
                kind: 'tags',
                options: ['frontend', 'bug', 'backend', 'docs'],
                tag: true,
            }}
            initial={['frontend', 'bug']}
        />
    ),
}

/** `multiselect` with two of three declared options picked — the same field, comma-separated
 *  (declared options may contain spaces): `planning, frontend, `. */
export const MultiselectPartial: Story = {
    render: () => (
        <Harness
            kind={{
                kind: 'multiselect',
                options: ['planning', 'frontend', 'docs'],
            }}
            initial={['planning', 'frontend']}
        />
    ),
}

/** Interactive: type into the text box and press Enter — commits and blurs (proves Enter does
 *  NOT insert a newline in the plain-text branch, unlike Markdown above). */
export const TextEnterCommits: Story = {
    render: () => <Harness kind={{ kind: 'text' }} initial="Old title" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = canvas.getByDisplayValue('Old title')
        await userEvent.clear(input)
        await userEvent.type(input, 'New title')
        await userEvent.keyboard('{Enter}')
        await expect(canvas.getByTestId('committed')).toHaveTextContent(
            '"New title"',
        )
    },
}

/** Interactive: edit the text, then press Escape — reverts the draft to the ORIGINAL value
 *  first, THEN blurs (PropertyValueEditor.tsx's onKeyDown: `setDraft(toDraft()); blur()`),
 *  and blur fires `onCommit`, not `onCancel` (its file-level comment: "Escape reverts the
 *  draft to the ORIGINAL value first, then blurs — so the no-op comparison in the caller's
 *  commit handler skips the write"). The real caller (KanbanCard.tsx's `commitMeta`)
 *  JSON-compares the incoming value against the current one and returns early when they
 *  match — the same idiom `commitRename` uses right above it — so in production this commit
 *  is a no-op write. This Harness has no such guard, so it visibly applies the callback:
 *  the edit is discarded (the committed value is the untouched original), just delivered via
 *  onCommit rather than onCancel. */
export const EscapeReverts: Story = {
    render: () => <Harness kind={{ kind: 'text' }} initial="Original" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = canvas.getByDisplayValue('Original')
        await userEvent.type(input, ' edited')
        await userEvent.keyboard('{Escape}')
        await expect(canvas.getByTestId('committed')).toHaveTextContent(
            '"Original"',
        )
    },
}

/** Interactive: Escape must reach `window` from a plain field (so the card modal's own
 *  Escape listener — `ui/Modal.tsx` — closes the whole card, not just this field), but must
 *  NOT reach `window` while a list field's completion popup is open (that Escape belongs to the
 *  popup: it closes it and stops there, as in the note editor). */
export const EscapeBubbles: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
            <Harness kind={{ kind: 'text' }} initial="Original" />
            <Harness
                kind={{ kind: 'multiselect', options: ['planning', 'frontend'] }}
                initial={['planning']}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const windowEscapes: string[] = []
        const onWindowKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') windowEscapes.push('window')
        }
        window.addEventListener('keydown', onWindowKeyDown)

        // The list field: typing opens the completion popup; Escape closes ONLY the popup.
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'fr')
        await expectCompletions(['frontend'])
        pressKey(view, 'Escape')
        await waitFor(() => expect(completionLabels()).toEqual([]))
        await expect(windowEscapes).toEqual([])

        // Plain text field: Escape reverts the draft, THEN the keydown bubbles to window.
        const input = canvas.getByDisplayValue('Original')
        await userEvent.type(input, ' edited')
        await userEvent.keyboard('{Escape}')
        await expect(canvas.getAllByTestId('committed')[0]).toHaveTextContent(
            '"Original"',
        )
        await expect(windowEscapes).toEqual(['window'])

        window.removeEventListener('keydown', onWindowKeyDown)
    },
}

/** Interactive (`multiselect`): type the start of an option — the popup offers the matching
 *  unused options — Tab takes the highlighted one, Enter commits the whole list once. */
export const MultiselectTypeAndCommit: Story = {
    render: () => (
        <Harness
            kind={{
                kind: 'multiselect',
                options: ['planning', 'frontend', 'docs'],
            }}
            initial={['planning']}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'f')
        await expectCompletions(['frontend'])
        pressKey(view, 'Tab')
        await waitFor(() =>
            expect(view.state.doc.toString()).toBe('planning, frontend, '),
        )
        pressKey(view, 'Enter')
        await expect(canvas.getByTestId('committed')).toHaveTextContent(
            '["planning","frontend"]',
        )
    },
}

/** Interactive (`tags`): a word that matches no suggestion is kept as a new tag — Enter (no
 *  popup open) commits it. */
export const TagsCreatable: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'tags', options: ['frontend', 'bug'], tag: true }}
            initial={['bug']}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'brand-new')
        await waitFor(() => expect(completionLabels()).toEqual([]))
        pressKey(view, 'Enter')
        await expect(canvas.getByTestId('committed')).toHaveTextContent(
            '["bug","brand-new"]',
        )
    },
}

/** Interactive (`tags`): suggestions include every tag in the VAULT — the graph's tag nodes, the
 *  same source the note editor's tag completion reads — after the column's own values. Typing
 *  `ch` pops `#chicken` / `#chores` under the value with the first highlighted; Tab takes it;
 *  Enter commits. */
export const TagsSuggestVaultTags: Story = {
    render: () => {
        resetVaultTagsCache()
        setTransport(
            fakeTransport({
                graph: {
                    nodes: ['chicken', 'chores', 'frontend'].map(t => ({
                        id: `tag:${t}`,
                        label: `#${t}`,
                        kind: 'tag',
                    })),
                    edges: [],
                },
            }),
        )
        return (
            <Harness
                kind={{ kind: 'tags', options: ['frontend', 'bug'], tag: true }}
                initial={['bug']}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'ch')
        await expectCompletions(['#chicken', '#chores'])
        expect(selectedCompletion()).toBe('#chicken')
        pressKey(view, 'Tab')
        await waitFor(() => expect(view.state.doc.toString()).toBe('bug, chicken, '))
        pressKey(view, 'Enter')
        await expect(canvas.getByTestId('committed')).toHaveTextContent(
            '["bug","chicken"]',
        )
    },
}

/** A list that is NOT tags — `["Jane Doe"]` — is comma-separated (so the space survives), and
 *  opening the field and leaving it without typing writes NOTHING: the text is never re-parsed
 *  back into a (different) list unless the person changed it. */
export const UntouchedListWritesNothing: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'tags', options: [], tag: false }}
            initial={['Jane Doe']}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const view = await tagsFieldView(canvasElement)
        expect(view.state.doc.toString()).toBe('Jane Doe, ')
        view.contentDOM.blur()
        await waitFor(() => expect(canvas.getByTestId('status')).toHaveTextContent('cancelled'))
        expect(canvas.getByTestId('committed')).toHaveTextContent('')
        expect(view.state.doc.toString()).toBe('Jane Doe')
    },
}

/** A list the field could not round-trip (numbers, links, or a comma inside a value) is shown
 *  read-only — no editor, nothing to commit. */
export const ReadonlyList: Story = {
    render: () => <Harness kind={{ kind: 'readonly' }} initial={[1, 2, 3]} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByText('1, 2, 3')).toBeInTheDocument()
        expect(canvasElement.querySelector('[data-testid="tags-field"]')).toBeNull()
        expect(canvasElement.querySelector('input, textarea')).toBeNull()
    },
}

const committed = (canvas: ReturnType<typeof within>) => canvas.getByTestId('committed')

/** `inline` (a table cell): the tags field drops its chrome and takes the host's font. Committing
 *  still writes the parsed list. */
export const InlineTags: Story = {
    render: () => (
        <Harness
            inline
            kind={{ kind: 'tags', options: ['frontend', 'bug'], tag: true }}
            initial={['bug']}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'brand-new')
        await waitFor(() => expect(completionLabels()).toEqual([]))
        pressKey(view, 'Enter')
        await expect(committed(canvas)).toHaveTextContent('["bug","brand-new"]')
    },
}

/** `autofocus={false}` (a form of several editors): mounting must not steal focus. */
export const NoAutofocus: Story = {
    render: () => <Harness autofocus={false} kind={{ kind: 'text' }} initial="Quiet" />,
    play: async ({ canvasElement }) => {
        const input = within(canvasElement).getByDisplayValue('Quiet')
        await new Promise(r => requestAnimationFrame(() => r(null)))
        await expect(document.activeElement).not.toBe(input)
    },
}

/** Markdown: Enter adds a line (no commit); blur commits the whole draft. */
export const MarkdownCommitsOnBlur: Story = {
    render: () => <Harness kind={{ kind: 'markdown' }} initial="one" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const area = canvas.getByDisplayValue('one') as HTMLTextAreaElement
        await waitFor(() => expect(document.activeElement).toBe(area))
        await userEvent.type(area, '{Enter}two')
        await expect(canvas.getByTestId('status')).toHaveTextContent('editing')
        area.blur()
        await waitFor(() => expect(committed(canvas)).toHaveTextContent('"one\\ntwo"'))
    },
}

/** Select: picking an option commits it; `(clear)` commits null. */
export const SelectCommits: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'select', options: ['Todo', 'Doing', 'Done'] }}
            initial="Doing"
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-select-trigger]')!)
        await userEvent.click(await body.findByText('Done'))
        await waitFor(() => expect(committed(canvas)).toHaveTextContent('"Done"'))
        await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-select-trigger]')!)
        await userEvent.click(await body.findByText('(clear)'))
        await waitFor(() => expect(committed(canvas)).toHaveTextContent('null'))
    },
}

/** Percent: the box shows the EDIT-space 42; typing 55 commits the stored fraction 0.55. */
export const NumberPercentCommits: Story = {
    render: () => <Harness kind={{ kind: 'number', format: 'percent' }} initial={0.42} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = canvas.getByDisplayValue('42')
        await userEvent.clear(input)
        await userEvent.type(input, '55{Enter}')
        await waitFor(() => expect(committed(canvas)).toHaveTextContent('0.55'))
    },
}

/** Currency: a typed amount commits the plain stored number. */
export const NumberCurrencyCommits: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'number', format: 'currency', unit: 'USD' }}
            initial={1200}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = canvas.getByDisplayValue('1200')
        await userEvent.clear(input)
        await userEvent.type(input, '1500{Enter}')
        await waitFor(() => expect(committed(canvas)).toHaveTextContent('1500'))
    },
}

/** Date: picking a preset in the popover commits the ISO date. */
export const DateCommits: Story = {
    render: () => <Harness kind={{ kind: 'date' }} initial="2026-08-10" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(canvas.getByTestId('date-field-trigger'))
        const popover = await waitFor(() => body.getByTestId('date-field-popover'))
        await userEvent.pointer({
            keys: '[MouseLeft>]',
            target: within(popover).getByText('Today'),
        })
        const today = dateFieldPresets()[0].date
        await waitFor(() => expect(committed(canvas)).toHaveTextContent(`"${today}"`))
    },
}

/** Readonly with an object value (a link): its display text, no editor, nothing committed. */
export const ReadonlyObject: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'readonly' }}
            initial={{ path: 'People/Jane.md', display: 'Jane' }}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Jane')).toBeInTheDocument()
        await expect(canvasElement.querySelector('input, textarea, button')).toBeNull()
        await expect(canvas.getByTestId('status')).toHaveTextContent('editing')
    },
}
