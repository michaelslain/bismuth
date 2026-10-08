// app/src/bases/QueryBuilder.tsx
//
// The NO-CODE visual query builder. A modal (composed from `ui/FormModal` +
// `ui/ModalBody` + `ui/SettingsSection`/`SettingsGrid`/`SettingsField`, the same
// form-modal primitives BaseSettings and the other calendar modals share) that
// edits a `BuilderState` and, on confirm, hands the caller the text BETWEEN the
// ```query fences via `buildQueryBlockBody(state)`.
// All codegen/parse lives in the pure, DOM-free `queryGen.ts`; this file is just
// the reactive form + a live preview.
//
// Source-gated into three unrelated query formats (Notes / Tasks / Base) exactly
// as documented in queryGen.ts. Each source's panel is its own component
// (NotesFilterPanel over the shared FiltersEditor, TasksFilterPanel, BaseSourcePanel), and
// sort is the shared SortFields. Properties are discovered like BaseSettings:
// `columnsOf(await api.resolveRows({ kind: "notes" }))`, augmented with the
// `file.*` pseudo-props.


import { createStore } from 'solid-js/store'
import {
    createMemo,
    createResource,
    createSignal,
    Show,
    createEffect,
} from 'solid-js'
import { api } from '../api'
import type { Row, SortSpec, ViewType } from '../../../core/src/bases/types'
import type { TreeEntry } from '../../../core/src/graph'
import { basePickerOptions } from './basePickerOptions'
import { columnLabel } from './columnLabel'
import { columnsOf } from './propertyColumns'
import { FILE_PSEUDO } from './filterOps'
import { VIEW_KIND_OPTIONS, type SelectOption } from './selectOptions'
import Select from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import CodeBlock from '../ui/CodeBlock'
import InlineCode from '../ui/InlineCode'
import { SegmentedToggle } from '../ui/SegmentedToggle'
import { TextButton } from '../ui/TextButton'
import { IconTextButton } from '../ui/IconTextButton'
import FormModal from '../ui/FormModal'
import ModalBody from '../ui/ModalBody'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalFooter } from '../ui/ModalFooter'
import SettingsSection from '../ui/SettingsSection'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import NotesFilterPanel from './NotesFilterPanel'
import TasksFilterPanel from './TasksFilterPanel'
import BaseSourcePanel from './BaseSourcePanel'
import SortFields from './SortFields'
import {
    type BuilderState,
    type BuilderSource,
    defaultBuilderState,
    buildQueryBlockBody,
} from './queryGen'
import qbStyles from './QueryBuilder.module.css'

const SOURCE_OPTS = [
    { id: 'notes' as BuilderSource, label: 'notes' },
    { id: 'tasks' as BuilderSource, label: 'tasks' },
    { id: 'base' as BuilderSource, label: 'base' },
]

// --------------------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------------------

/**
 * The no-code query builder modal.
 *
 * @prop hostPath  the note the ```query block lives in (host meta + the preview's render host).
 * @prop initial   a parsed `BuilderState` to seed editing an existing block; absent → fresh.
 * @prop onConfirm receives the generated block body (text between the ```query fences).
 * @prop onClose   dismiss without changes.
 *
 * Properties are fetched via `api.resolveRows({ kind: "notes" })` (same feed BaseSettings
 * discovers columns from), augmented with `file.*` pseudo-props.
 */
export function QueryBuilder(props: {
    hostPath?: string
    initial?: BuilderState
    onConfirm: (blockBody: string) => void
    onClose: () => void
}) {
    const [state, setState] = createStore<BuilderState>(
        props.initial ?? defaultBuilderState(),
    )

    // Property feed (BaseSettings' source). Same SWR-cached /rows call.
    const [rows] = createResource<Row[]>(() =>
        api.resolveRows({ kind: 'notes' }),
    )
    const sample = () => rows() ?? []

    // Discovered columns ∪ file pseudo-props ∪ any prop already referenced by a seeded row.
    const allCols = createMemo<string[]>(() => {
        const seen = new Set<string>()
        const out: string[] = []
        const add = (c: string) => {
            if (c && !seen.has(c)) {
                seen.add(c)
                out.push(c)
            }
        }
        columnsOf(sample()).forEach(add)
        FILE_PSEUDO.forEach(p => add(p.id))
        state.notes.rows.forEach(r => add(r.prop))
        return out
    })

    const propOptions = createMemo<SelectOption[]>(() =>
        allCols().map(c => ({ value: c, label: columnLabel(c, {} as never) })),
    )
    // None + every column (group dropdown).
    const propOptionsOptional = createMemo<SelectOption[]>(() => [
        { value: '', label: 'none' },
        ...propOptions(),
    ])

    // Base picker: every note and base, as a distinct `[[wikilink]]`.
    const [tree] = createResource<TreeEntry[]>(() => api.tree())
    const baseOptions = createMemo<SelectOption[]>(() =>
        basePickerOptions((tree() ?? []).filter(e => e.kind !== 'dir')),
    )

    // --- live preview ---------------------------------------------------------------------
    const [previewBody, setPreviewBody] = createSignal(
        buildQueryBlockBody(state),
    )
    createEffect(() => {
        // Recompute whenever any tracked store leaf changes.
        setPreviewBody(buildQueryBlockBody(unwrapState(state)))
    })

    const reset = () => setState(defaultBuilderState())

    // An emptied sort list means "no sort" (the generator omits an undefined sort).
    const setSort = (sort: SortSpec[]) =>
        setState('sort', sort.length ? sort : undefined)

    const confirm = () =>
        props.onConfirm(buildQueryBlockBody(unwrapState(state)))

    return (
        <FormModal
            onClose={props.onClose}
            label={props.initial ? 'edit query' : 'new query'}
            width={600}
            class={qbStyles.panel}
        >
            <ModalHeader
                title={props.initial ? 'edit query' : 'new query'}
                subtitle="build a query without writing any code"
                onClose={props.onClose}
            />

            <ModalBody maxHeight="min(72vh, 720px)">
                {/* 1 — SOURCE */}
                <SettingsSection>source</SettingsSection>
                <SegmentedToggle
                    options={SOURCE_OPTS}
                    value={state.source}
                    onChange={s => setState('source', s)}
                    class={qbStyles['qb-source']}
                />

                {/* 2 — FILTERS, gated on source */}
                <Show when={state.source === 'notes'}>
                    <SettingsSection>filters</SettingsSection>
                    <NotesFilterPanel
                        value={state.notes}
                        onChange={next => setState('notes', next)}
                        properties={allCols()}
                        rows={sample()}
                    />
                </Show>

                <Show when={state.source === 'tasks'}>
                    <SettingsSection>task filters</SettingsSection>
                    <TasksFilterPanel
                        value={state.tasks}
                        onChange={patch => setState('tasks', patch)}
                        bases={baseOptions()}
                    />
                </Show>

                <Show when={state.source === 'base'}>
                    <SettingsSection>base</SettingsSection>
                    <BaseSourcePanel
                        baseRef={state.baseRef}
                        baseWhere={state.baseWhere}
                        onChange={patch => setState(patch)}
                        bases={baseOptions()}
                    />
                </Show>

                {/* 3 — VIEW & SORT (shared) */}
                <SettingsSection>view</SettingsSection>
                <SettingsGrid>
                    <SettingsField label="show as">
                        <Select
                            value={state.view}
                            options={VIEW_KIND_OPTIONS}
                            onChange={v => setState('view', v as ViewType)}
                        />
                    </SettingsField>
                    <SettingsField label="group by">
                        <Select
                            value={state.group ?? ''}
                            options={propOptionsOptional()}
                            placeholder="none"
                            onChange={v => setState('group', v || undefined)}
                        />
                    </SettingsField>
                    <SettingsField label="limit" badge="optional">
                        <TextInput
                            type="number"
                            value={
                                state.limit != null ? String(state.limit) : ''
                            }
                            placeholder="no limit"
                            onInput={v => {
                                const n = Number(v)
                                setState(
                                    'limit',
                                    v.trim() !== '' && Number.isFinite(n)
                                        ? n
                                        : undefined,
                                )
                            }}
                        />
                    </SettingsField>
                </SettingsGrid>
                {/* Tasks sorts through its own sort key (above), not a view sort. */}
                <Show when={state.source !== 'tasks'}>
                    <SortFields
                        sort={state.sort ?? []}
                        onChange={setSort}
                        options={propOptions()}
                    />
                </Show>

                {/* 4 — PREVIEW */}
                <SettingsSection>generated query</SettingsSection>
                <CodeBlock
                    class={qbStyles['qb-preview']}
                    data-testid="qb-preview"
                >
                    <InlineCode>{previewBody()}</InlineCode>
                </CodeBlock>
            </ModalBody>

            <ModalFooter
                leading={
                    <IconTextButton icon="RotateCcw" onClick={reset}>
                        reset
                    </IconTextButton>
                }
            >
                <TextButton onClick={props.onClose}>cancel</TextButton>
                <IconTextButton icon="Check" primary onClick={confirm}>
                    {props.initial ? 'save' : 'insert'}
                </IconTextButton>
            </ModalFooter>
        </FormModal>
    )
}

// --------------------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------------------

/** A plain (non-proxy) deep copy of the store, so the pure codegen sees a stable snapshot
 *  AND so the preview effect deep-reads every leaf (triggering on any field change). */
function unwrapState(state: BuilderState): BuilderState {
    return JSON.parse(JSON.stringify(state)) as BuilderState
}
