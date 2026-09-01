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
import { expect, userEvent, within } from 'storybook/test'
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
        return (
            <QueryBuilder initial={initial} onConfirm={noop} onClose={noop} />
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
        await expect(canvas.getByText('ADD FILTER')).toBeInTheDocument()
        await userEvent.click(canvas.getByText('Tasks'))
        await expect(canvas.queryByText('ADD FILTER')).not.toBeInTheDocument()
    },
}

/** Interactive: add a Notes filter row via "Add filter" — proves the row mutator wires a real
 *  property/operator/value editor into the DOM rather than a story hand-building one.
 *  Same Portal caveat as SwitchSource above — <Modal> mounts to document.body, so this queries
 *  document.body/document, not canvasElement. */
export const AddFilterRow: Story = {
    render: () => {
        seedPopulated()
        return <QueryBuilder onConfirm={noop} onClose={noop} />
    },
    play: async () => {
        const canvas = within(document.body)
        await userEvent.click(canvas.getByText('ADD FILTER'))
        await expect(canvas.getByText(/generated query/i)).toBeInTheDocument()
        const pre = document.querySelector('.qb-preview code')
        await expect(pre?.textContent ?? '').not.toBe('')
    },
}
