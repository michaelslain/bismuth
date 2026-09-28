// Visual spec for <QueryBuilder> — the no-code visual query builder modal (```query fences).
// Source-gated into three unrelated formats (Notes / Tasks / Base — see queryGen.ts's file
// comment), sharing a View/Sort/Group/Limit section and a live-generated-query preview.
//
// Property discovery fetches `api.resolveRows({ kind: "notes" })` (POST /rows) on mount — same
// feed BaseSettings uses — plus `api.tree()` for the Base-source picker. The global fakeTransport
// (.storybook/preview.ts) answers /rows with an EMPTY array by default (no `rows` seed), which
// is itself a real state (a vault with nothing resolved yet / no notes) — see `NotesEmptyVault`
// below. Every other story layers a transport seeded with SAMPLE_ROWS so the property/folder/tag
// pickers have real vocabulary to offer, exactly like a populated vault.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { QueryBuilder } from './QueryBuilder'
import type { BuilderState } from './queryGen'
import { defaultBuilderState } from './queryGen'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/QueryBuilder',
    component: QueryBuilder,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof QueryBuilder>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** What the last confirm handed back — the builder's real output, asserted in play(). */
let confirmed: string | undefined
const capture = (body: string) => {
    confirmed = body
}

/** Property discovery + the Base-source picker both need real data — seed a transport with
 *  SAMPLE_ROWS answering /rows, and its paths answering /tree. */
function seedPopulated(): void {
    setTransport(
        fakeTransport({
            tree: SAMPLE_ROWS.map(r => ({ path: r.file.path, kind: 'file' })),
            rows: SAMPLE_ROWS,
        }),
    )
}

/** Fresh Notes-source builder: no filter rows yet, view defaults to table. `props.initial` is
 *  absent, so the header reads "New query" and the footer button "INSERT" (see the component's
 *  own header/footer, which key off `props.initial`). */
export const NotesFresh: Story = {
    render: () => {
        seedPopulated()
        return <QueryBuilder onConfirm={noop} onClose={noop} />
    },
    play: async () => {
        // Initial focus lands on the FIRST BODY control in DOM order — never the header's `[x]`,
        // and never a later form control the dialog would have to scroll down for (QueryBuilder's
        // `limit` input sits near the bottom). Both checks go in one `waitFor`: the dialog-contains
        // check on its own could pass transiently mid-pick, before the close-button check has a
        // chance to run against the settled result.
        await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]')
            expect(dialog?.contains(document.activeElement)).toBe(true)
            expect(
                document.activeElement?.matches('[data-modal-close]'),
            ).toBe(false)
            const body = document.querySelector('[data-modal-body]')
            expect(body?.contains(document.activeElement)).toBe(true)
            // The source toggle's first button ("notes") — the first focusable the body renders.
            expect(document.activeElement?.textContent).toBe('notes')
        })
        const initial = document.activeElement as HTMLElement
        // Was a <div role="button"> with no tabindex — present to a screen reader, unreachable by
        // keyboard (same defect BaseSettings had). ModalHeader makes it a real IconButton. ui/Modal
        // portals to document.body, so query there rather than canvasElement.
        const close = document.body.querySelector(
            '[aria-label="Close"]',
        ) as HTMLElement | null
        await expect(close).not.toBeNull()
        await expect(close!.tagName).toBe('BUTTON')
        // Prove the PROPERTY, not the tag: a <div role="button"> with no tabindex — which is
        // exactly what this used to be — cannot take focus, so activeElement would stay put.
        // A real <button> can. This is what makes the control keyboard-reachable at all.
        close!.focus()
        await expect(document.activeElement).toBe(close)
        // Hand focus back: left on `[x]`, anything reading activeElement after this play (a
        // focus probe, a screenshot of the focus ring) sees the play's own move, not the modal's
        // initial focus — which is exactly how this story once read as "[x] steals focus".
        initial.focus()
    },
}

/** A vault with nothing resolved (the DEFAULT global fakeTransport, no `rows` seed — `/rows`
 *  answers `[]`) — property/folder/tag dropdowns fall back to just the `file.*` pseudo-props,
 *  not a blank or broken panel. */
export const NotesEmptyVault: Story = {
    render: () => <QueryBuilder onConfirm={noop} onClose={noop} />,
}

/** Editing an existing Notes query: `props.initial` is set, so the header reads "Edit query"
 *  and the footer "SAVE". One filter row (status == "Doing"), sorted by priority, grouped by
 *  status, shown as a kanban board — exercising the filter-row value editor, the sort/group
 *  selects, and the live preview all showing real derived state instead of defaults. */
export const NotesEditingExisting: Story = {
    render: () => {
        seedPopulated()
        const initial: BuilderState = {
            ...defaultBuilderState(),
            view: 'kanban',
            sort: [{ property: 'priority', direction: 'ASC' }],
            group: 'status',
            notes: {
                connective: 'and',
                rows: [
                    {
                        prop: 'status',
                        op: 'equals',
                        val: 'Doing',
                        type: 'string',
                    },
                ],
            },
        }
        return (
            <QueryBuilder
                hostPath="projects/dashboard.md"
                initial={initial}
                onConfirm={noop}
                onClose={noop}
            />
        )
    },
}

/** Tasks source: the DSL-preset controls (status/priority/due/recurring/sort) replace the
 *  Notes filter-row builder entirely, and the shared View section hides its Sort field (Tasks
 *  sorts via its own `sortKey`/`sortReverse` — see `state.source !== 'tasks'` gating Sort). */
export const TasksSource: Story = {
    render: () => {
        seedPopulated()
        const initial: BuilderState = {
            ...defaultBuilderState(),
            source: 'tasks',
            view: 'bullets',
            tasks: {
                status: 'open',
                priority: 'high',
                due: 'week',
                recurring: 'any',
                sortKey: 'due',
                sortReverse: false,
            },
        }
        confirmed = undefined
        return (
            <QueryBuilder
                initial={initial}
                onConfirm={capture}
                onClose={noop}
            />
        )
    },
    play: async () => {
        await pick('Ascending', 'Descending')
        await userEvent.click(within(document.body).getByText('save'))
        await expect(confirmed).toBe(
            'tasks: |-\n  not done AND priority is high AND due before in 7 days\n  sort by due reverse\nview: bullets',
        )
    },
}

/** Base source: renders another base's rows, picked from the note tree (`[[basename]]` refs),
 *  with an optional Bases-expression filter layered on top. */
export const BaseSource: Story = {
    render: () => {
        seedPopulated()
        const initial: BuilderState = {
            ...defaultBuilderState(),
            source: 'base',
            baseRef: '[[Draft the roadmap]]',
            baseWhere: 'priority >= 2',
        }
        return (
            <QueryBuilder initial={initial} onConfirm={noop} onClose={noop} />
        )
    },
}

/** Interactive: switch source from Notes to Tasks via the SegmentedToggle — proves the whole
 *  Notes filter-row section disappears and the Tasks preset controls appear in its place.
 *  <QueryBuilder> renders through <Modal>, which mounts via a solid-js/web <Portal> to
 *  document.body (ui/Modal.tsx) — canvasElement is the empty storybook-root the portal left
 *  behind, so every query here goes through document.body instead. */
export const SwitchSource: Story = {
    render: () => {
        seedPopulated()
        return <QueryBuilder onConfirm={noop} onClose={noop} />
    },
    play: async () => {
        const canvas = within(document.body)
        await expect(canvas.getByText('add condition')).toBeInTheDocument()
        await userEvent.click(canvas.getByText('tasks'))
        await expect(canvas.queryByText('add condition')).not.toBeInTheDocument()
    },
}

/** Choose `option` in the ui/Select whose trigger currently reads `current`. The popover
 *  portals to document.body, so both lookups go through it. */
async function pick(current: string, option: string) {
    const body = within(document.body)
    await userEvent.click(body.getByText(current))
    await userEvent.click(await body.findByText(option))
}

/** Interactive: add a Notes filter row via "add condition" (the shared FiltersEditor) and
 *  insert — `onConfirm` receives the real generated block for a row on the first column. */
export const AddFilterRow: Story = {
    render: () => {
        seedPopulated()
        confirmed = undefined
        return <QueryBuilder onConfirm={capture} onClose={noop} />
    },
    play: async () => {
        const canvas = within(document.body)
        await userEvent.click(await canvas.findByText('add condition'))
        await expect(canvas.getByText(/generated query/i)).toBeInTheDocument()
        await userEvent.click(canvas.getByText('insert'))
        await expect(confirmed).toBe(
            'source: notes where file.name == ""\nviews:\n  - type: table\n    name: Table',
        )
    },
}

/** A `where` the builder could not reverse into rows is one advanced field, kept verbatim —
 *  and what insert hands back is exactly that expression. */
export const NotesRawWhere: Story = {
    render: () => {
        seedPopulated()
        const initial: BuilderState = {
            ...defaultBuilderState(),
            notes: {
                connective: 'and',
                rows: [],
                rawWhere: 'priority > 1 && (status == "Todo" || done)',
            },
        }
        confirmed = undefined
        return (
            <QueryBuilder initial={initial} onConfirm={capture} onClose={noop} />
        )
    },
    play: async () => {
        const body = within(document.body)
        await expect(
            await body.findByDisplayValue(
                'priority > 1 && (status == "Todo" || done)',
            ),
        ).toBeInTheDocument()
        await expect(body.queryByText('add condition')).not.toBeInTheDocument()
        await userEvent.click(body.getByText('save'))
        await expect(confirmed).toBe(
            'source: notes where priority > 1 && (status == "Todo" || done)\nviews:\n  - type: table\n    name: Table',
        )
    },
}

/** Folder op, `date_within`, a tag, joined by "any", sorted by priority: flipping the sort
 *  direction rewrites the block's `direction:` and nothing else. */
export const NotesFiltersAndSort: Story = {
    render: () => {
        seedPopulated()
        const initial: BuilderState = {
            ...defaultBuilderState(),
            view: 'cards',
            sort: [{ property: 'priority', direction: 'DESC' }],
            group: 'status',
            limit: 5,
            notes: {
                connective: 'or',
                rows: [
                    {
                        prop: 'file.folder',
                        op: 'in_folder',
                        val: 'projects',
                        type: 'string',
                    },
                    { prop: 'due', op: 'date_within', val: '7', type: 'date' },
                    {
                        prop: 'tags',
                        op: 'has_tag',
                        val: 'planning',
                        type: 'tag',
                    },
                ],
            },
        }
        confirmed = undefined
        return (
            <QueryBuilder initial={initial} onConfirm={capture} onClose={noop} />
        )
    },
    play: async () => {
        const preview = () =>
            document.querySelector('[data-testid="qb-preview"] code')
                ?.textContent ?? ''
        await waitFor(() => expect(preview()).toContain('direction: DESC'))
        await pick('descending', 'ascending')
        await waitFor(() => expect(preview()).toContain('direction: ASC'))
        await userEvent.click(within(document.body).getByText('save'))
        await expect(confirmed).toBe(
            'source: notes where (file.inFolder("projects")) || (date(due) >= today() &&\n  date(due) < today() + "7d") || (file.hasTag("planning"))\nviews:\n  - type: cards\n    name: Cards\n    sort:\n      - property: priority\n        direction: ASC\n    groupBy:\n      property: status\n    limit: 5',
        )
    },
}
