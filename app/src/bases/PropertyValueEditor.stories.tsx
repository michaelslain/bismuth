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
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { PropertyValueEditor } from './PropertyValueEditor'
import type { PropertyEditKind } from './propertyEdit'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'

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

/** Undeclared tags — a `MultiSelect` (`creatable`), options built from the sibling/own
 *  values (propertyEdit.ts's `tagsOptions`); this story stands in for that with a fixed
 *  list. `open` on the underlying editor is unconditional (the kanban chip swaps this in
 *  already open), so the dropdown is visible immediately. */
export const Tags: Story = {
    render: () => (
        <Harness
            kind={{
                kind: 'tags',
                options: ['frontend', 'bug', 'backend', 'docs'],
            }}
            initial={['frontend', 'bug']}
        />
    ),
}

/** `multiselect` with two of three declared options already picked — the trigger shows them
 *  joined, and the dropdown (open by default) lists every option, selected ones first, each
 *  prefixed `[x]`/`[ ]`. Static render; see `MultiselectToggle` below for the live
 *  toggle interaction (each write commits immediately with `keepOpen: true` — no natural
 *  "blur" for a set of checkboxes). */
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

/** `multiselect` with every declared option already selected — every row shows `[x]`, none
 *  `[ ]`. */
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

/** Interactive: Escape must reach `window` from a plain field (so the card modal's own
 *  Escape listener — `ui/Modal.tsx` — closes the whole card, not just this field), but must
 *  NOT reach `window` while a multiselect's own dropdown is open (that Escape belongs to the
 *  list: it closes the list and stops there, same as any other open popover). */
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

        // Multiselect FIRST, before anything else on the page is clicked — its editor mounts
        // already open (the kanban chip swaps it in open), so a stray outside pointerdown from
        // interacting with the text field below (userEvent focuses a target via a real click)
        // would otherwise close it before this assertion runs. Its filter input already has
        // focus, so an Escape there closes ONLY the dropdown and must not reach window.
        await within(document.body).findByPlaceholderText('filter')
        await userEvent.keyboard('{Escape}')
        await expect(windowEscapes).toEqual([])

        // Plain text field: Escape reverts the draft, THEN the keydown bubbles to window.
        const input = canvas.getByDisplayValue('Original')
        await userEvent.type(input, ' edited')
        await userEvent.keyboard('{Escape}')
        await expect(canvas.getAllByText(/committed:/)[0]).toHaveTextContent(
            '"Original"',
        )
        await expect(windowEscapes).toEqual(['window'])

        window.removeEventListener('keydown', onWindowKeyDown)
    },
}

/** Interactive: toggle two rows in the dropdown (it opens already, since the kanban chip
 *  swaps this editor in open) — each write commits immediately with `keepOpen: true`, so the
 *  editor stays mounted across both changes instead of closing after the first. */
export const MultiselectToggle: Story = {
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
        const popover = await waitFor(() => {
            const el = document.querySelector('.bismuth-popover') as HTMLElement | null
            if (!el) throw new Error('popover did not open')
            return el
        })
        const body = within(popover)
        // Add "frontend".
        await userEvent.click(await body.findByText('frontend'))
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
            '["planning","frontend"]',
        )
        // Remove "planning" by clicking its row again.
        await userEvent.click(await body.findByText('planning'))
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
            '["frontend"]',
        )
    },
}

/** Interactive (`tags`, `creatable`): typing a value that matches no existing option and
 *  pressing Enter adds it as a new selected value. */
export const TagsCreatable: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'tags', options: ['frontend', 'bug'] }}
            initial={['bug']}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const filterInput = await within(document.body).findByPlaceholderText(
            'filter or add',
        )
        await userEvent.type(filterInput, 'brand-new{Enter}')
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
            '["bug","brand-new"]',
        )
    },
}

/** Interactive (`tags`): suggestions include every tag in the VAULT — the graph's tag nodes, the
 *  same source the note editor's tag completion reads — after the column's own values. Typing
 *  `ch` narrows to the vault-only `#chicken` (highlighted), Tab autofills it, and the closed
 *  trigger shows it as a `#` tag. */
export const TagsSuggestVaultTags: Story = {
    render: () => {
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
                kind={{ kind: 'tags', options: ['frontend', 'bug'] }}
                initial={['bug']}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const filterInput = (await within(document.body).findByPlaceholderText(
            'filter or add',
        )) as HTMLInputElement
        const labels = () =>
            [...document.querySelectorAll<HTMLElement>('.bismuth-popover-label')].map(
                l => (l.textContent ?? '').trim(),
            )
        // Column values first, then the vault's (deduped: frontend appears once).
        await waitFor(() =>
            expect(labels()).toEqual(['#bug', '#frontend', '#chicken', '#chores']),
        )
        await userEvent.type(filterInput, 'ch')
        await waitFor(() => expect(labels()).toEqual(['#chicken', '#chores']))
        const active = document.querySelector('.bismuth-popover-row--selected')
        expect(active?.textContent).toContain('#chicken')
        await userEvent.keyboard('{Tab}')
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
            '["bug","chicken"]',
        )
        await userEvent.keyboard('{Escape}')
        await waitFor(() =>
            expect(document.querySelector('.bismuth-popover')).toBeNull(),
        )
        expect(canvasElement.querySelector('button')?.textContent).toContain(
            '#bug#chicken',
        )
    },
}
