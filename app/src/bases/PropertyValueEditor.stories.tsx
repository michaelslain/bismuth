// Visual spec for <PropertyValueEditor> — the type-aware control a kanban meta chip swaps in
// on click (KanbanCard.tsx): text input, markdown textarea, typed number/date input, a `Select`
// for an enum, a chip add/remove picker for `multiselect`, and a comma-separated box for a
// plain (undeclared) tag list. No network, no theme fixture beyond the global tokens — purely a
// value in, callback out control, so every `PropertyEditKind` variant gets its own story.
//
// `boolean` is deliberately absent: the file-level comment on the component says the caller
// toggles booleans directly via a `Chip` and this component never sees that kind.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, fireEvent, userEvent, within } from 'storybook/test'
import { PropertyValueEditor } from './PropertyValueEditor'
import type { PropertyEditKind } from './propertyEdit'

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

/** A live harness so a story can show what got committed (or cancelled) — the component itself
 *  is uncontrolled-on-commit (calls back once and the caller decides what happens), so this
 *  mirrors what KanbanCard's `commitMeta` does: apply the value and re-render. */
function Harness(props: { kind: PropertyEditKind; initial: unknown }) {
    const [value, setValue] = createSignal<unknown>(props.initial)
    const [status, setStatus] = createSignal<
        'editing' | 'committed' | 'cancelled'
    >('editing')
    return (
        <Frame>
            <PropertyValueEditor
                kind={props.kind}
                value={value()}
                onCommit={v => {
                    setValue(v)
                    setStatus('committed')
                }}
                onCancel={() => setStatus('cancelled')}
            />
            <div
                style={{
                    'margin-top': '10px',
                    'font-size': 'var(--fs-ui)',
                    color: 'var(--text-muted)',
                }}
            >
                {status()}: {JSON.stringify(value())}
            </div>
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

/** Date-only input. */
export const DateOnly: Story = {
    render: () => <Harness kind={{ kind: 'date' }} initial="2026-08-10" />,
}

/** Date + time — renders a `datetime-local` input. */
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

/** Undeclared tags — a plain comma-separated box, not the chip picker (that's `multiselect`
 *  only, for a DECLARED options list). */
export const Tags: Story = {
    render: () => (
        <Harness kind={{ kind: 'tags' }} initial={['frontend', 'bug']} />
    ),
}

/** `multiselect` with two of three declared options already picked — chips + a "+ Add" Select
 *  offering only the remaining option. Static render; see `MultiselectAddRemove` below for the
 *  live add/remove interaction this kind supports (each write commits immediately and keeps
 *  the editor open — no natural "blur" for a set of chip buttons). */
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

/** `multiselect` with every declared option already selected — the "+ Add" Select doesn't
 *  render at all (`available().length > 0` gates it), only removable chips remain. */
export const MultiselectFull: Story = {
    render: () => (
        <Harness
            kind={{
                kind: 'multiselect',
                options: ['planning', 'frontend'],
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
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
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
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
            '"Original"',
        )
    },
}

/** Interactive: add a chip via the "+ Add" Select, then remove one by clicking it — each
 *  write commits immediately with `keepOpen: true`, so the editor stays mounted across both
 *  changes instead of closing after the first. */
export const MultiselectAddRemove: Story = {
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
        // Open the "+ Add" Select and pick "frontend".
        await userEvent.click(canvas.getByText('+ Add'))
        const option = await within(document.body).findByText('frontend')
        await fireEvent.click(option)
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
            '["planning","frontend"]',
        )
        // Remove "planning" by clicking its chip.
        await userEvent.click(canvas.getByText('planning'))
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
            '["frontend"]',
        )
    },
}
