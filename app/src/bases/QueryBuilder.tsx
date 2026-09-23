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
// as documented in queryGen.ts. Properties are discovered like BaseSettings:
// `columnsOf(await api.resolveRows({ kind: "notes" }))`, augmented with the
// `file.*` pseudo-props, and typed by sampling the resolved rows.

import { createStore, produce } from 'solid-js/store'
import {
    createMemo,
    createResource,
    createSignal,
    For,
    Show,
    createEffect,
} from 'solid-js'
import { api } from '../api'
import type { Row, ViewType } from '../../../core/src/bases/types'
import { VIEW_TYPES } from '../../../core/src/bases/types'
import type { TreeEntry } from '../../../core/src/graph'
import { fileBasename as noteLabel } from '../../../core/src/pathUtils'
import { capitalize } from './renderValue'
import { columnLabel } from './columnLabel'
import Select, { type SelectOption } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import Text from '../ui/Text'
import { IconButton } from '../ui/IconButton'
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
import {
    type BuilderState,
    type BuilderSource,
    type NotesRow,
    type NotesOp,
    type PropType,
    defaultBuilderState,
    buildQueryBlockBody,
} from './queryGen'
import qbStyles from './QueryBuilder.module.css'

// --------------------------------------------------------------------------------------
// Property discovery (mirrors BaseSettings.columnsOf, + file.* pseudo-props)
// --------------------------------------------------------------------------------------

/** Note columns present across the resolved rows (BaseSettings' algorithm). */
function columnsOf(rows: Row[]): string[] {
    const set = new Set<string>()
    let hasName = false
    for (const r of rows) {
        Object.keys(r.note).forEach(k => set.add(k))
        if (r.file?.name) hasName = true
    }
    const cols = [...set]
    return hasName ? ['file.name', ...cols] : cols
}

// The engine filters on these file pseudo-props even when no note frontmatter declares them.
const FILE_PSEUDO: { id: string; type: PropType }[] = [
    { id: 'tags', type: 'tag' },
    { id: 'file.folder', type: 'string' },
    { id: 'file.ext', type: 'string' },
    { id: 'file.path', type: 'string' },
    { id: 'file.ctime', type: 'date' },
    { id: 'file.mtime', type: 'date' },
]

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]|$)/

/** Infer a coarse PropType from the first non-null sample of `prop` across the rows. */
function inferType(prop: string, rows: Row[]): PropType {
    for (const p of FILE_PSEUDO) if (p.id === prop) return p.type
    if (prop === 'file.name') return 'string'
    for (const r of rows) {
        const v = r.note[prop]
        if (v == null) continue
        if (typeof v === 'number') return 'number'
        if (typeof v === 'boolean') return 'boolean'
        if (Array.isArray(v)) return prop === 'tags' ? 'tag' : 'list'
        if (typeof v === 'string')
            return ISO_DATE.test(v.trim()) ? 'date' : 'string'
    }
    return 'string'
}

// --------------------------------------------------------------------------------------
// Operator tables, keyed by PropType. value: NotesOp, label: human verb.
// --------------------------------------------------------------------------------------

type OpDef = { value: NotesOp; label: string }

const OPS_COMMON_TAIL: OpDef[] = [
    { value: 'is_set', label: 'is set' },
    { value: 'is_empty', label: 'is empty' },
]

const OPS_BY_TYPE: Record<PropType, OpDef[]> = {
    string: [
        { value: 'equals', label: 'equals' },
        { value: 'not_equals', label: 'does not equal' },
        { value: 'contains', label: 'contains' },
        { value: 'starts_with', label: 'starts with' },
        { value: 'ends_with', label: 'ends with' },
        { value: 'matches', label: 'matches regex' },
        ...OPS_COMMON_TAIL,
    ],
    number: [
        { value: 'equals', label: '=' },
        { value: 'not_equals', label: '≠' },
        { value: 'gt', label: '>' },
        { value: 'gte', label: '≥' },
        { value: 'lt', label: '<' },
        { value: 'lte', label: '≤' },
        ...OPS_COMMON_TAIL,
    ],
    date: [
        { value: 'date_before', label: 'is before' },
        { value: 'date_after', label: 'is on or after' },
        { value: 'date_within', label: 'is within N days' },
        { value: 'is_empty', label: 'is empty' },
    ],
    boolean: [
        { value: 'checked', label: 'is checked' },
        { value: 'unchecked', label: 'is unchecked' },
    ],
    tag: [
        { value: 'has_tag', label: 'has tag' },
        { value: 'not_tag', label: 'does not have tag' },
    ],
    list: [{ value: 'contains', label: 'contains' }, ...OPS_COMMON_TAIL],
    link: [
        { value: 'equals', label: 'links to' },
        { value: 'is_set', label: 'is set' },
    ],
}

// Date-op value presets (the value editor for date_before / date_after).
const DATE_PRESETS: SelectOption[] = [
    { value: 'today', label: 'Today' },
    { value: 'today+7d', label: 'In 7 days' },
    { value: 'today-7d', label: '7 days ago' },
    { value: 'today+1d', label: 'Tomorrow' },
    { value: 'today-1d', label: 'Yesterday' },
]

// Ops whose value is implied by the operator (no value editor).
const VALUELESS = new Set<NotesOp>([
    'checked',
    'unchecked',
    'is_set',
    'is_empty',
])

// --------------------------------------------------------------------------------------
// Task preset option tables
// --------------------------------------------------------------------------------------

const TASK_PRIORITY_OPTS: SelectOption[] = [
    { value: 'any', label: 'Any priority' },
    { value: 'highest', label: 'Highest' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
    { value: 'lowest', label: 'Lowest' },
    { value: 'none', label: 'None' },
]
const TASK_DUE_OPTS: SelectOption[] = [
    { value: 'any', label: 'Any' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'today', label: 'Due today' },
    { value: 'week', label: 'Due this week' },
    { value: 'has', label: 'Has a due date' },
]
const TASK_SORT_OPTS: SelectOption[] = [
    { value: '', label: 'None' },
    { value: 'priority', label: 'Priority' },
    { value: 'due', label: 'Due date' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'start', label: 'Start' },
    { value: 'done', label: 'Done date' },
    { value: 'created', label: 'Created' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'description', label: 'Description' },
]

const DIR_OPTS: SelectOption[] = [
    { value: 'ASC', label: 'Ascending' },
    { value: 'DESC', label: 'Descending' },
]

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
 * discovers columns from), augmented with `file.*` pseudo-props and typed by sampling.
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

    const propType = (prop: string): PropType => inferType(prop, sample())

    const propOptions = createMemo<SelectOption[]>(() =>
        allCols().map(c => ({ value: c, label: columnLabel(c, {} as never) })),
    )
    // None + every column (sort / group dropdowns).
    const propOptionsOptional = createMemo<SelectOption[]>(() => [
        { value: '', label: 'None' },
        ...propOptions(),
    ])

    // Distinct folder + tag values mined from the rows, for the in_folder / has_tag value pickers.
    const folderOptions = createMemo<SelectOption[]>(() => {
        const set = new Set<string>()
        for (const r of sample()) {
            const f = (r.note['file.folder'] ?? r.file?.folder) as
                string | undefined
            if (typeof f === 'string' && f) set.add(f)
        }
        return [...set].sort().map(f => ({ value: f, label: f }))
    })
    const tagOptions = createMemo<SelectOption[]>(() => {
        const set = new Set<string>()
        for (const r of sample()) {
            const t = r.note.tags ?? (r.file as { tags?: unknown })?.tags
            if (Array.isArray(t))
                t.forEach(
                    x => typeof x === 'string' && set.add(x.replace(/^#/, '')),
                )
        }
        return [...set].sort().map(t => ({ value: t, label: t }))
    })

    // Base picker: every .md note (label by basename, ref as [[basename]]).
    const [tree] = createResource<TreeEntry[]>(() => api.tree())
    const baseOptions = createMemo<SelectOption[]>(() => {
        const out: SelectOption[] = []
        for (const e of tree() ?? []) {
            if (
                (e as { kind?: string }).kind === 'dir' ||
                !e.path.endsWith('.md')
            )
                continue
            const name = noteLabel(e.path)
            out.push({ value: `[[${name}]]`, label: name })
        }
        out.sort((a, b) => a.label.localeCompare(b.label))
        return out
    })

    const viewOptions: SelectOption[] = VIEW_TYPES.map(v => ({
        value: v,
        label: capitalize(v),
    }))

    // --- live preview (debounced count via api.resolveRows) -------------------------------
    const [previewBody, setPreviewBody] = createSignal(
        buildQueryBlockBody(state),
    )
    createEffect(() => {
        // Recompute whenever any tracked store leaf changes.
        setPreviewBody(buildQueryBlockBody(unwrapState(state)))
    })

    // --- notes filter-row mutators --------------------------------------------------------
    const addRow = () => {
        const prop = allCols()[0] ?? 'tags'
        const type = propType(prop)
        const op = (OPS_BY_TYPE[type][0]?.value ?? 'equals') as NotesOp
        setState('notes', 'rows', r => [
            ...r,
            { prop, op, val: '', type } as NotesRow,
        ])
    }
    const removeRow = (i: number) =>
        setState('notes', 'rows', r => r.filter((_, idx) => idx !== i))

    // Changing the property re-types the row and snaps the op to the new type's first valid op
    // (unless the current op is still valid for the new type).
    const setRowProp = (i: number, prop: string) => {
        const type = propType(prop)
        setState(
            'notes',
            'rows',
            i,
            produce(row => {
                row.prop = prop
                row.type = type
                const valid = OPS_BY_TYPE[type].some(o => o.value === row.op)
                if (!valid)
                    row.op = (OPS_BY_TYPE[type][0]?.value ??
                        'equals') as NotesOp
            }),
        )
    }
    const setRowOp = (i: number, op: NotesOp) =>
        setState('notes', 'rows', i, 'op', op)
    const setRowVal = (i: number, val: string) =>
        setState('notes', 'rows', i, 'val', val)

    const reset = () => setState(defaultBuilderState())

    // Single-entry sort spec mutators (empty property → no sort).
    const setSortProp = (property: string) =>
        setState(
            'sort',
            property
                ? [{ property, direction: state.sort?.[0]?.direction ?? 'ASC' }]
                : undefined,
        )
    const setSortDir = (direction: 'ASC' | 'DESC') => {
        const property = state.sort?.[0]?.property
        setState('sort', property ? [{ property, direction }] : undefined)
    }

    const confirm = () =>
        props.onConfirm(buildQueryBlockBody(unwrapState(state)))

    // Per-row value editor, gated on the row's op + type.
    const valueEditor = (row: NotesRow, i: number) => {
        if (VALUELESS.has(row.op)) return null
        if (row.op === 'has_tag' || row.op === 'not_tag') {
            return (
                <Select
                    value={row.val}
                    options={tagOptions()}
                    placeholder="Pick a tag"
                    onChange={v => setRowVal(i, v)}
                />
            )
        }
        if (row.op === 'in_folder' || row.op === 'folder_is') {
            return (
                <Select
                    value={row.val}
                    options={folderOptions()}
                    placeholder="Pick a folder"
                    onChange={v => setRowVal(i, v)}
                />
            )
        }
        if (row.op === 'date_within') {
            return (
                <TextInput
                    type="number"
                    value={row.val}
                    placeholder="N days"
                    onInput={v => setRowVal(i, v)}
                />
            )
        }
        if (row.op === 'date_before' || row.op === 'date_after') {
            return (
                <Select
                    value={row.val || 'today'}
                    options={DATE_PRESETS}
                    onChange={v => setRowVal(i, v)}
                />
            )
        }
        return (
            <TextInput
                type={row.type === 'number' ? 'number' : 'text'}
                value={row.val}
                placeholder="Value"
                onInput={v => setRowVal(i, v)}
            />
        )
    }

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
                    <Show
                        when={state.notes.rawWhere}
                        fallback={
                            <>
                                <Show when={state.notes.rows.length > 1}>
                                    <div class={qbStyles['qb-connective']}>
                                        <Text
                                            as="span"
                                            size="inherit"
                                            tone="inherit"
                                            weight="inherit"
                                            class={qbStyles['qb-conn-lab']}
                                        >
                                            match
                                        </Text>
                                        <SegmentedToggle
                                            options={[
                                                { id: 'and', label: 'all' },
                                                { id: 'or', label: 'any' },
                                            ]}
                                            value={state.notes.connective}
                                            onChange={c =>
                                                setState(
                                                    'notes',
                                                    'connective',
                                                    c as 'and' | 'or',
                                                )
                                            }
                                            size="sm"
                                        />
                                        <Text
                                            as="span"
                                            size="inherit"
                                            tone="inherit"
                                            weight="inherit"
                                            class={qbStyles['qb-conn-lab']}
                                        >
                                            of these
                                        </Text>
                                    </div>
                                </Show>
                                <div class={qbStyles['qb-rows']}>
                                    <For each={state.notes.rows}>
                                        {(row, i) => (
                                            <div class={qbStyles['qb-row']}>
                                                <Select
                                                    class="qb-prop"
                                                    value={row.prop}
                                                    options={propOptions()}
                                                    onChange={v =>
                                                        setRowProp(i(), v)
                                                    }
                                                />
                                                <Select
                                                    class="qb-op"
                                                    value={row.op}
                                                    options={
                                                        OPS_BY_TYPE[row.type] ??
                                                        OPS_BY_TYPE.string
                                                    }
                                                    onChange={v =>
                                                        setRowOp(
                                                            i(),
                                                            v as NotesOp,
                                                        )
                                                    }
                                                />
                                                <div class={qbStyles['qb-val']}>
                                                    {valueEditor(row, i())}
                                                </div>
                                                <IconButton
                                                    icon="x"
                                                    label="Remove filter"
                                                    iconSize={14}
                                                    class={qbStyles['qb-rm']}
                                                    onClick={() =>
                                                        removeRow(i())
                                                    }
                                                />
                                            </div>
                                        )}
                                    </For>
                                </div>
                                <IconTextButton
                                    icon="Plus"
                                    iconSize={13}
                                    onClick={addRow}
                                >
                                    add filter
                                </IconTextButton>
                            </>
                        }
                    >
                        <SettingsField
                            label="advanced expression"
                            hint="this query uses an expression the visual editor can't reverse. editing it here keeps it verbatim; clear it to build filters visually."
                        >
                            <TextInput
                                value={state.notes.rawWhere ?? ''}
                                multiline
                                onInput={v => setState('notes', 'rawWhere', v)}
                            />
                        </SettingsField>
                    </Show>
                </Show>

                <Show when={state.source === 'tasks'}>
                    <SettingsSection>task filters</SettingsSection>
                    <SettingsGrid>
                        <SettingsField label="status">
                            <SegmentedToggle
                                options={[
                                    { id: 'open', label: 'open' },
                                    { id: 'done', label: 'done' },
                                    { id: 'all', label: 'all' },
                                ]}
                                value={state.tasks.status}
                                onChange={s =>
                                    setState(
                                        'tasks',
                                        'status',
                                        s as 'open' | 'done' | 'all',
                                    )
                                }
                                size="sm"
                            />
                        </SettingsField>
                        <SettingsField label="priority">
                            <Select
                                value={state.tasks.priority}
                                options={TASK_PRIORITY_OPTS}
                                onChange={v => setState('tasks', 'priority', v)}
                            />
                        </SettingsField>
                        <SettingsField label="due">
                            <Select
                                value={state.tasks.due}
                                options={TASK_DUE_OPTS}
                                onChange={v =>
                                    setState(
                                        'tasks',
                                        'due',
                                        v as BuilderState['tasks']['due'],
                                    )
                                }
                            />
                        </SettingsField>
                        <SettingsField label="recurring">
                            <SegmentedToggle
                                options={[
                                    { id: 'any', label: 'any' },
                                    { id: 'yes', label: 'yes' },
                                    { id: 'no', label: 'no' },
                                ]}
                                value={state.tasks.recurring}
                                onChange={r =>
                                    setState(
                                        'tasks',
                                        'recurring',
                                        r as 'any' | 'yes' | 'no',
                                    )
                                }
                                size="sm"
                            />
                        </SettingsField>
                        <SettingsField label="sort by">
                            <Select
                                value={state.tasks.sortKey}
                                options={TASK_SORT_OPTS}
                                placeholder="None"
                                onChange={v => setState('tasks', 'sortKey', v)}
                            />
                        </SettingsField>
                        <Show when={state.tasks.sortKey}>
                            <SettingsField label="direction">
                                <Select
                                    value={
                                        state.tasks.sortReverse ? 'DESC' : 'ASC'
                                    }
                                    options={DIR_OPTS}
                                    onChange={v =>
                                        setState(
                                            'tasks',
                                            'sortReverse',
                                            v === 'DESC',
                                        )
                                    }
                                />
                            </SettingsField>
                        </Show>
                        <SettingsField
                            label="scope to a base"
                            badge="optional"
                            span
                            hint="limit tasks to the notes inside another base."
                        >
                            <Select
                                value={state.tasks.from ?? ''}
                                options={[
                                    { value: '', label: 'Whole vault' },
                                    ...baseOptions(),
                                ]}
                                placeholder="Whole vault"
                                onChange={v =>
                                    setState('tasks', 'from', v || undefined)
                                }
                            />
                        </SettingsField>
                    </SettingsGrid>
                    <Show when={state.tasks.rawWhere}>
                        <SettingsField
                            label="advanced filter"
                            hint="extra Tasks-DSL filters that don't map to a preset, kept verbatim."
                        >
                            <TextInput
                                value={state.tasks.rawWhere ?? ''}
                                onInput={v => setState('tasks', 'rawWhere', v)}
                            />
                        </SettingsField>
                    </Show>
                </Show>

                <Show when={state.source === 'base'}>
                    <SettingsSection>base</SettingsSection>
                    <SettingsGrid>
                        <SettingsField
                            label="base to query"
                            span
                            hint="renders another base's rows; the view/sort/group below override its own."
                        >
                            <Select
                                value={state.baseRef ?? ''}
                                options={baseOptions()}
                                placeholder="Pick a base"
                                onChange={v => setState('baseRef', v)}
                            />
                        </SettingsField>
                        <SettingsField
                            label="filter"
                            badge="optional"
                            span
                            hint="an optional Bases expression to further filter the base's rows."
                        >
                            <TextInput
                                value={state.baseWhere ?? ''}
                                placeholder="e.g. rating >= 4"
                                onInput={v =>
                                    setState('baseWhere', v || undefined)
                                }
                            />
                        </SettingsField>
                    </SettingsGrid>
                </Show>

                {/* 3 — VIEW & SORT (shared) */}
                <SettingsSection>view</SettingsSection>
                <SettingsGrid>
                    <SettingsField label="show as">
                        <Select
                            value={state.view}
                            options={viewOptions}
                            onChange={v => setState('view', v as ViewType)}
                        />
                    </SettingsField>
                    <Show when={state.source !== 'tasks'}>
                        <SettingsField label="sort by">
                            <Select
                                value={state.sort?.[0]?.property ?? ''}
                                options={propOptionsOptional()}
                                placeholder="None"
                                onChange={setSortProp}
                            />
                        </SettingsField>
                        <Show when={state.sort?.[0]?.property}>
                            <SettingsField label="direction">
                                <Select
                                    value={state.sort?.[0]?.direction ?? 'ASC'}
                                    options={DIR_OPTS}
                                    onChange={v =>
                                        setSortDir(v as 'ASC' | 'DESC')
                                    }
                                />
                            </SettingsField>
                        </Show>
                    </Show>
                    <SettingsField label="group by">
                        <Select
                            value={state.group ?? ''}
                            options={propOptionsOptional()}
                            placeholder="None"
                            onChange={v => setState('group', v || undefined)}
                        />
                    </SettingsField>
                    <SettingsField label="limit" badge="optional">
                        <TextInput
                            type="number"
                            value={
                                state.limit != null ? String(state.limit) : ''
                            }
                            placeholder="No limit"
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

                {/* 4 — PREVIEW */}
                <SettingsSection>generated query</SettingsSection>
                <pre class={qbStyles['qb-preview']} data-testid="qb-preview">
                    <code>{previewBody()}</code>
                </pre>
            </ModalBody>

            <ModalFooter
                leading={
                    <IconTextButton
                        icon="RotateCcw"
                        iconSize={13}
                        onClick={reset}
                    >
                        reset
                    </IconTextButton>
                }
            >
                <TextButton onClick={props.onClose}>
                    cancel
                </TextButton>
                <IconTextButton
                    icon="Check"
                    primary
                    onClick={confirm}
                >
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
