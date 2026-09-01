import { createSignal, createMemo, For, Show } from 'solid-js'
import { api } from '../api'
import type {
    BaseConfig,
    BasePropertyKind,
    NumberFormat,
    Row,
    ViewType,
} from '../../../core/src/bases/types'
import {
    BASE_PROPERTY_KINDS,
    NUMBER_FORMATS,
} from '../../../core/src/bases/types'
import { fileBasename as noteLabel } from '../../../core/src/pathUtils'
import { capitalize } from './renderValue'
import { columnLabel } from './columnLabel'
import { declaredPropertyKeys } from '../../../core/src/bases/properties'
import {
    blankPropertyRow,
    buildPropertiesYaml,
    moveRow,
    seedPropertyRows,
    type PropertyFormRow,
} from './basePropertiesForm'
import { Modal } from '../ui/Modal'
import { Icon } from '../icons/Icon'
import Select from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { TextButton } from '../ui/TextButton'
import { IconTextButton } from '../ui/IconTextButton'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalFooter } from '../ui/ModalFooter'
// Shares the calendar settings modal chrome (.evm-modal / .set-*) — the header/footer now come
// from ui/ModalHeader + ui/ModalFooter instead.
import styles from '../calendar/Calendar.module.css'

interface FieldDef {
    key: string
    /** Short role label shown next to the column dropdown. */
    role: string
    icon: string
    def: string
    /** Optional fields offer a "Not set" choice. */
    optional?: boolean
    span?: boolean
    hint: string
}

// Chart views (heatmap/bar/line/stat) all bind the same axis columns.
const CHART_FIELDS: FieldDef[] = [
    {
        key: 'x',
        role: 'X axis',
        icon: 'calendar',
        def: 'date',
        hint: 'Column plotted along the X axis — a date or a category.',
    },
    {
        key: 'y',
        role: 'Value',
        icon: 'hash',
        def: '',
        optional: true,
        hint: 'Numeric column to aggregate. Leave unset to count rows.',
    },
]

// Field-binding settings for non-tabular view types (which column means what).
const FIELDS_BY_TYPE: Partial<Record<ViewType, FieldDef[]>> = {
    flashcards: [
        {
            key: 'frontField',
            role: 'Front',
            icon: 'CircleHelp',
            def: 'front',
            hint: 'Column shown as the card front (the prompt).',
        },
        {
            key: 'backField',
            role: 'Back',
            icon: 'circle-check',
            def: 'back',
            hint: 'Column revealed as the answer.',
        },
        {
            key: 'dueField',
            role: 'Due',
            icon: 'Calendar',
            def: 'due',
            span: true,
            hint: "Column holding each card's next-review date.",
        },
    ],
    heatmap: CHART_FIELDS,
    bar: CHART_FIELDS,
    line: CHART_FIELDS,
    stat: CHART_FIELDS,
}

// Record view types get column-visibility + sort + group-by config.
const RECORD_TYPES: ViewType[] = [
    'table',
    'cards',
    'list',
    'bullets',
    'kanban',
    'map',
]

// Chart view types get aggregate + date-bucket config.
const CHART_TYPES: ViewType[] = ['heatmap', 'bar', 'line', 'stat']

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

const AGG_OPTS = [
    { value: 'sum', label: 'Sum' },
    { value: 'avg', label: 'Average' },
    { value: 'count', label: 'Count' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' },
]
const BIN_OPTS = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
]
const DIR_OPTS = [
    { value: 'ASC', label: 'Ascending' },
    { value: 'DESC', label: 'Descending' },
]

// Properties section (#104): kind + number-format pickers.
const KIND_OPTS = BASE_PROPERTY_KINDS.map(k => ({
    value: k,
    label: capitalize(k),
}))
const NUMBER_FORMAT_OPTS = NUMBER_FORMATS.map(f => ({
    value: f,
    label: capitalize(f),
}))

/**
 * Per-view settings as a modal overlay — same chrome as the calendar's
 * CalendarSettings (`.evm-modal`), so every base type shares one polished design:
 * header / sectioned body with `Select` dropdowns / footer with RESET + CANCEL + SAVE.
 * Floats over the live view instead of replacing it.
 */
export function BaseSettings(props: {
    type: ViewType
    config: BaseConfig
    /** Index of the view these settings edit — the active view, not always the first. */
    viewIdx: number
    basePath?: string
    rows: Row[]
    onClose: () => void
    onSaved: () => void
}) {
    const view = () => props.config.views[props.viewIdx]
    const isRecord = () => RECORD_TYPES.includes(props.type)
    // Kanban gets column-visibility/reorder from the Properties section (declared
    // fields + their eye toggle + reorder), so the Columns section (table-header-drag
    // language, redundant visibility toggle) is suppressed for it. Other record views
    // (table/list/cards/map/bullets) still have no per-property declarations driving
    // order, so they keep Columns.
    const showColumns = () => isRecord() && props.type !== 'kanban'
    const isChart = () => CHART_TYPES.includes(props.type)
    const fields = () => FIELDS_BY_TYPE[props.type] ?? []

    // Row-derived columns unioned with the base's own declared properties (list-form
    // `properties:`), so a declared-but-not-yet-populated field is still offerable.
    const allCols = createMemo(() => [
        ...new Set([
            ...columnsOf(props.rows),
            ...declaredPropertyKeys(props.config),
        ]),
    ])

    // Options for a column-binding dropdown: the available columns, always unioned
    // with the field's current value + default so an off-screen binding still shows.
    const colOptions = (f: FieldDef, current: string) => {
        const seen = new Set(allCols())
        const extra = [current, f.def].filter(c => c && !seen.has(c))
        return [
            ...(f.optional ? [{ value: '', label: 'Count rows' }] : []),
            ...allCols().map(c => ({ value: c, label: c })),
            ...extra.map(c => ({ value: c, label: c })),
        ]
    }

    // --- field-binding form (flashcards / chart axes) ---
    const seedFields = (): Record<string, string> => {
        const v = (view() ?? {}) as unknown as Record<string, unknown>
        const out: Record<string, string> = {}
        for (const f of fields()) out[f.key] = (v[f.key] as string) ?? f.def
        return out
    }
    const [form, setForm] = createSignal<Record<string, string>>(seedFields())
    // Flashcards: review every card both ways (front→back AND back→front), each direction
    // scheduled independently in `*Back` companion columns.
    const [bidi, setBidi] = createSignal<boolean>(!!view()?.bidirectional)
    // Kanban (#105): hide each card's meta-row label captions, showing values only.
    const [hideLabels, setHideLabels] = createSignal<boolean>(
        !!view()?.hideLabels,
    )

    // --- record form (columns / sort / group) ---
    const seedCols = (): { col: string; visible: boolean }[] => {
        const ord = view()?.order
        const all = allCols()
        if (ord && ord.length) {
            const inOrder = ord
                .filter(c => all.includes(c))
                .map(c => ({ col: c, visible: true }))
            const rest = all
                .filter(c => !ord.includes(c))
                .map(c => ({ col: c, visible: false }))
            return [...inOrder, ...rest]
        }
        return all.map(c => ({ col: c, visible: true }))
    }
    const [cols, setCols] = createSignal(seedCols())
    const [sortProp, setSortProp] = createSignal(
        view()?.sort?.[0]?.property ?? '',
    )
    const [sortDir, setSortDir] = createSignal(
        view()?.sort?.[0]?.direction ?? 'ASC',
    )
    const [groupProp, setGroupProp] = createSignal(
        view()?.groupBy?.property ?? '',
    )
    const [groupDir, setGroupDir] = createSignal(
        view()?.groupBy?.direction ?? 'ASC',
    )
    const [aggregate, setAggregate] = createSignal<
        'sum' | 'avg' | 'count' | 'min' | 'max'
    >(view()?.aggregate ?? (view()?.y ? 'sum' : 'count'))
    const [bin, setBin] = createSignal<'day' | 'week' | 'month'>(
        view()?.bin ?? 'day',
    )

    const visibleCount = () => cols().filter(c => c.visible).length

    const toggle = (i: number) => {
        const arr = [...cols()]
        // Never allow hiding the LAST visible column. A zero-column table is useless, and
        // because an empty `order` means "no preference → show all" (query.ts), hiding the
        // last column would paradoxically show every column instead of none.
        if (arr[i].visible && visibleCount() <= 1) return
        arr[i] = { ...arr[i], visible: !arr[i].visible }
        setCols(arr)
    }

    // None + every column, for sort/group dropdowns.
    const propOptions = createMemo(() => [
        { value: '', label: 'None' },
        ...allCols().map(c => ({
            value: c,
            label: columnLabel(c, props.config),
        })),
    ])

    // --- properties form (#104: define the base's OWN declared property set) ---
    // Base-level, not per-view — shown regardless of `props.type`. Seeded ONLY from an
    // existing list-form declaration (`declaredProperties`); a base using classic map-form
    // metadata (or no `properties:` at all) starts from an empty list so the panel never
    // surfaces entries it can't losslessly round-trip as a list. `hadDeclared` is captured
    // once (not reactive) so save() only rewrites `properties:` when there's something to
    // write — either the base already declared a list, or the user added one here — instead
    // of clobbering an untouched map-form base with an empty list on every unrelated save.
    const hadDeclared = props.config.declaredProperties !== undefined
    const [propRows, setPropRows] = createSignal<PropertyFormRow[]>(
        seedPropertyRows(props.config),
    )
    const updateRow = (i: number, patch: Partial<PropertyFormRow>) =>
        setPropRows(
            propRows().map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
        )
    // Progressive disclosure: at most one row's full editor is open at a time. `null` = every
    // row collapsed to its quiet name/type/visibility line (see the render below).
    const [editingProp, setEditingProp] = createSignal<number | null>(null)
    const addPropRow = () => {
        const next = [
            ...propRows(),
            blankPropertyRow(propRows().map(r => r.name)),
        ]
        setPropRows(next)
        setEditingProp(next.length - 1) // expand the new row for immediate editing
    }
    const removePropRow = (i: number) => {
        setPropRows(propRows().filter((_, idx) => idx !== i))
        setEditingProp(cur =>
            cur === null ? null : cur === i ? null : cur > i ? cur - 1 : cur,
        )
    }
    // Reorder keeps whichever row (if any) was open following its content, not its old index.
    const moveRowAt = (i: number, dir: -1 | 1) => {
        const j = i + dir
        if (j < 0 || j >= propRows().length) return
        setPropRows(moveRow(propRows(), i, dir))
        setEditingProp(cur => (cur === i ? j : cur === j ? i : cur))
    }

    const reset = () => {
        setForm(Object.fromEntries(fields().map(f => [f.key, f.def])))
        setCols(allCols().map(c => ({ col: c, visible: true })))
        setSortProp('')
        setSortDir('ASC')
        setGroupProp('')
        setGroupDir('ASC')
        setAggregate(view()?.y ? 'sum' : 'count')
        setBin('day')
        setHideLabels(false)
        setPropRows(seedPropertyRows(props.config))
        setEditingProp(null)
    }

    const save = async () => {
        if (props.basePath) {
            if (isRecord()) {
                // Kanban has no Columns UI (Properties supersedes it — see isRecordWithColumns
                // below), so its field order must come from the declared `properties:` list, not
                // a stale cols()-derived `order`. Writing `order` here would freeze whatever
                // order existed at modal-open time instead of following Properties reordering.
                if (props.type !== 'kanban') {
                    await api.setProperty(
                        props.basePath,
                        'order',
                        cols()
                            .filter(c => c.visible)
                            .map(c => c.col),
                    )
                }
                await api.setProperty(
                    props.basePath,
                    'sort',
                    sortProp()
                        ? [{ property: sortProp(), direction: sortDir() }]
                        : [],
                )
                await api.setProperty(
                    props.basePath,
                    'groupBy',
                    groupProp()
                        ? { property: groupProp(), direction: groupDir() }
                        : null,
                )
                if (props.type === 'kanban')
                    await api.setProperty(
                        props.basePath,
                        'hideLabels',
                        hideLabels(),
                    )
            } else {
                for (const f of fields())
                    await api.setProperty(props.basePath, f.key, form()[f.key])
                if (props.type === 'flashcards')
                    await api.setProperty(
                        props.basePath,
                        'bidirectional',
                        bidi(),
                    )
                if (isChart()) {
                    await api.setProperty(
                        props.basePath,
                        'aggregate',
                        aggregate(),
                    )
                    if (props.type !== 'heatmap')
                        await api.setProperty(props.basePath, 'bin', bin())
                }
            }
            if (hadDeclared || propRows().length > 0) {
                await api.setProperty(
                    props.basePath,
                    'properties',
                    buildPropertiesYaml(propRows()),
                )
            }
        }
        props.onSaved()
    }

    return (
        <Modal
            onClose={props.onClose}
            label={`${capitalize(props.type)} settings`}
            class={`${styles['base-settings']} ${styles['evm-modal']}`}
        >
            <ModalHeader
                icon="Settings2"
                title={`${capitalize(props.type)} settings`}
                subtitle={props.basePath ? noteLabel(props.basePath) : undefined}
                onClose={props.onClose}
            />

            <div class={styles['evm-body']}>
                {/* Field-binding types: flashcards / chart axes */}
                <Show when={fields().length > 0}>
                    <div class={styles['set-sect']}>Column mapping</div>
                    <div class={styles['set-grid']}>
                        <For each={fields()}>
                            {f => (
                                <div
                                    class={`${styles['set-field']}${f.span ? ` ${styles['span']}` : ''}`}
                                >
                                    <div class={styles['set-lab']}>
                                        <Icon
                                            value={f.icon}
                                            size={14}
                                            strokeWidth={2}
                                        />
                                        {f.role} column
                                        {f.optional ? (
                                            <span class={styles['opt']}>optional</span>
                                        ) : (
                                            <span class={styles['req']}>required</span>
                                        )}
                                    </div>
                                    <Select
                                        value={form()[f.key] ?? ''}
                                        options={colOptions(
                                            f,
                                            form()[f.key] ?? '',
                                        )}
                                        placeholder={
                                            f.optional
                                                ? 'Count rows'
                                                : 'Not set'
                                        }
                                        onChange={c =>
                                            setForm({ ...form(), [f.key]: c })
                                        }
                                    />
                    <div class={styles['set-hint']}>{f.hint}</div>
                                </div>
                            )}
                        </For>
                    </div>
                    <Show when={props.type === 'flashcards'}>
                        <div
                            class={`${styles['set-col']} ${styles['wrap']}`}
                            onClick={() => setBidi(!bidi())}
                            style={{ 'margin-top': '8px' }}
                        >
                            <span class={styles['set-col-name']}>
                                Bidirectional — review each card both ways
                                (front ↔ back)
                            </span>
                            <span class={`${styles['evm-toggle']}${bidi() ? ` ${styles['on']}` : ''}`}>
                                <i />
                            </span>
                        </div>
                        <div class={styles['set-hint']}>
                            Scheduling uses the standard SM-2 algorithm (fixed,
                            not configurable). Use <strong>Cram</strong> in the
                            deck to review everything without affecting
                            scheduling.
                            <Show when={bidi()}>
                                {' '}
                                Each direction is scheduled independently
                                (reverse state lives in <code>
                                    dueBack
                                </code> / <code>easeBack</code> /{' '}
                                <code>intervalBack</code>).
                            </Show>
                        </div>
                    </Show>
                </Show>

                {/* Chart types: aggregate + (non-heatmap) date bucket */}
                <Show when={isChart()}>
                    <div class={styles['set-sect']}>Aggregation</div>
                    <div class={styles['set-grid']}>
                        <div class={styles['set-field']}>
                            <div class={styles['set-lab']}>
                                <Icon value="sigma" size={14} strokeWidth={2} />
                                Aggregate
                            </div>
                            <Select
                                value={aggregate()}
                                options={AGG_OPTS}
                                onChange={v =>
                                    setAggregate(
                                        v as
                                            | 'sum'
                                            | 'avg'
                                            | 'count'
                                            | 'min'
                                            | 'max',
                                    )
                                }
                            />
                            <div class={styles['set-hint']}>
                                How values are combined per X-axis bucket.
                            </div>
                        </div>
                        <Show when={props.type !== 'heatmap'}>
                            <div class={styles['set-field']}>
                                <div class={styles['set-lab']}>
                                    <Icon
                                        value="Calendar"
                                        size={14}
                                        strokeWidth={2}
                                    />
                                    Date bucket
                                </div>
                                <Select
                                    value={bin()}
                                    options={BIN_OPTS}
                                    onChange={v =>
                                        setBin(v as 'day' | 'week' | 'month')
                                    }
                                />
                                <div class={styles['set-hint']}>
                                    Group date values by day, week, or month.
                                </div>
                            </div>
                        </Show>
                    </div>
                </Show>

                {/* Record types: columns + sort + group */}
                <Show when={isRecord()}>
                    <Show when={showColumns()}>
                        <div class={styles['set-sect']}>Columns</div>
                        <div class={styles['set-hint']}>
                            Toggle to show or hide. Drag the column headers in
                            the table to reorder.
                        </div>
                        <div class={styles['set-cols']}>
                            <For each={cols()}>
                                {(item, i) => {
                                    const locked = () =>
                                        item.visible && visibleCount() <= 1
                                    return (
                                        <div
                                            class={styles['set-col']}
                                            classList={{
                                                [styles['off']]: !item.visible,
                                                [styles['locked']]: locked(),
                                            }}
                                            title={
                                                locked()
                                                    ? 'At least one column must stay visible'
                                                    : undefined
                                            }
                                            onClick={() => toggle(i())}
                                        >
                                            <span class={styles['set-col-name']}>
                                                {columnLabel(
                                                    item.col,
                                                    props.config,
                                                )}
                                            </span>
                                            <span
                                                class={`${styles['evm-toggle']}${item.visible ? ` ${styles['on']}` : ''}`}
                                            >
                                                <i />
                                            </span>
                                        </div>
                                    )
                                }}
                            </For>
                        </div>
                    </Show>

                    <div class={styles['set-sect']}>Sort &amp; group</div>
                    <div class={styles['set-grid']}>
                        <div class={styles['set-field']}>
                            <div class={styles['set-lab']}>
                                <Icon
                                    value="ListOrdered"
                                    size={14}
                                    strokeWidth={2}
                                />
                                Sort by
                            </div>
                            <Select
                                value={sortProp()}
                                options={propOptions()}
                                placeholder="None"
                                onChange={setSortProp}
                            />
                        </div>
                        <Show when={sortProp()}>
                            <div class={styles['set-field']}>
                                <div class={styles['set-lab']}>
                                    <Icon
                                        value="arrow-down"
                                        size={14}
                                        strokeWidth={2}
                                    />
                                    Sort direction
                                </div>
                                <Select
                                    value={sortDir()}
                                    options={DIR_OPTS}
                                    onChange={v =>
                                        setSortDir(v as 'ASC' | 'DESC')
                                    }
                                />
                            </div>
                        </Show>
                        <div class={styles['set-field']}>
                            <div class={styles['set-lab']}>
                                <Icon value="Layers" size={14} strokeWidth={2} />
                                Group by
                            </div>
                            <Select
                                value={groupProp()}
                                options={propOptions()}
                                placeholder="None"
                                onChange={setGroupProp}
                            />
                        </div>
                        <Show when={groupProp()}>
                            <div class={styles['set-field']}>
                                <div class={styles['set-lab']}>
                                    <Icon
                                        value="arrow-down"
                                        size={14}
                                        strokeWidth={2}
                                    />
                                    Group direction
                                </div>
                                <Select
                                    value={groupDir()}
                                    options={DIR_OPTS}
                                    onChange={v =>
                                        setGroupDir(v as 'ASC' | 'DESC')
                                    }
                                />
                            </div>
                        </Show>
                    </div>

                    <Show when={props.type === 'kanban'}>
                        <div
                            class={styles['set-col']}
                            onClick={() => setHideLabels(!hideLabels())}
                            style={{ 'margin-top': '8px' }}
                        >
                            <span class={styles['set-col-name']}>
                                Hide meta labels — show property values only
                            </span>
                            <span
                                class={`${styles['evm-toggle']}${hideLabels() ? ` ${styles['on']}` : ''}`}
                            >
                                <i />
                            </span>
                        </div>
                    </Show>
                </Show>

                {/* Properties: the base's OWN declared property set — base-level, shown for every
            view type (#104). Progressive disclosure: every row collapses to a single quiet
            name/type/visibility line; clicking a row expands ONE full editor at a time
            (name/type/type-specific extras/reorder/delete), collapsing whichever else was
            open. Keeps a base with a dozen+ properties readable as a scannable list instead
            of a wall of controls. */}
                <div class={styles['set-sect']}>Properties</div>
                <div class={styles['set-hint']}>
                    Declare this base's own fields — name, type, and whether it
                    shows on cards/table. Order here drives card/table field
                    order. Click a row to edit it.
                </div>
                <Show when={propRows().length > 0}>
                    <div class={styles['propset-list']}>
                        <For each={propRows()}>
                            {(row, i) => {
                                const open = () => editingProp() === i()
                                return (
                                    <div
                                        class={styles['propset-row']}
                                        classList={{ [styles['open']]: open() }}
                                    >
                                        <div
                                            class={styles['propset-head']}
                                            role="button"
                                            tabIndex={0}
                                            aria-expanded={open()}
                                            onClick={() =>
                                                setEditingProp(
                                                    open() ? null : i(),
                                                )
                                            }
                                            onKeyDown={e => {
                                                if (
                                                    e.key === 'Enter' ||
                                                    e.key === ' '
                                                ) {
                                                    e.preventDefault()
                                                    setEditingProp(
                                                        open() ? null : i(),
                                                    )
                                                }
                                            }}
                                        >
                                            <Icon
                                                value="chevron-right"
                                                class={styles['propset-chev']}
                                                size={13}
                                                strokeWidth={2}
                                            />
                                            <span
                                                class={styles['propset-name-txt']}
                                                classList={{ [styles['empty']]: !row.name }}
                                            >
                                                {row.name ||
                                                    'Untitled property'}
                                            </span>
                                            <span class={styles['propset-kind']}>
                                                {row.kind}
                                            </span>
                                            <button
                                                type="button"
                                                class={styles['propset-eye']}
                                                aria-label={
                                                    row.hidden
                                                        ? `Show ${row.name || 'property'} on cards/table`
                                                        : `Hide ${row.name || 'property'} from cards/table`
                                                }
                                                title={
                                                    row.hidden
                                                        ? 'Hidden from cards/table — click to show'
                                                        : 'Visible on cards/table — click to hide'
                                                }
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    updateRow(i(), {
                                                        hidden: !row.hidden,
                                                    })
                                                }}
                                            >
                                                <Icon
                                                    value={
                                                        row.hidden
                                                            ? 'eye-off'
                                                            : 'eye'
                                                    }
                                                    size={15}
                                                    strokeWidth={1.75}
                                                />
                                            </button>
                                        </div>

                                        <Show when={open()}>
                                            <div class={styles['propset-body']}>
                                                <div class={styles['propset-fields']}>
                                                    <TextInput
                                                        class="propset-input"
                                                        value={row.name}
                                                        placeholder="Property name"
                                                        onInput={v =>
                                                            updateRow(i(), {
                                                                name: v,
                                                            })
                                                        }
                                                    />
                                                    <Select
                                                        class="propset-input"
                                                        value={row.kind}
                                                        options={KIND_OPTS}
                                                        onChange={v =>
                                                            updateRow(i(), {
                                                                kind: v as BasePropertyKind,
                                                            })
                                                        }
                                                    />
                                                </div>

                                                <Show
                                                    when={
                                                        row.kind === 'select' ||
                                                        row.kind ===
                                                            'multiselect'
                                                    }
                                                >
                                                    <TextInput
                                                        class={`${styles['propset-extra']} ${styles['propset-options']}`}
                                                        multiline
                                                        value={row.optionsText}
                                                        placeholder="Options — one per line or comma-separated (e.g. todo, doing, done)"
                                                        onInput={v =>
                                                            updateRow(i(), {
                                                                optionsText: v,
                                                            })
                                                        }
                                                    />
                                                </Show>

                                                <Show
                                                    when={row.kind === 'number'}
                                                >
                                                    <div class={`${styles['propset-extra']} ${styles['propset-numrow']}`}>
                                                        <Select
                                                            value={row.number}
                                                            options={
                                                                NUMBER_FORMAT_OPTS
                                                            }
                                                            onChange={v =>
                                                                updateRow(i(), {
                                                                    number: v as NumberFormat,
                                                                })
                                                            }
                                                        />
                                                        <Show
                                                            when={
                                                                row.number ===
                                                                    'unit' ||
                                                                row.number ===
                                                                    'currency'
                                                            }
                                                        >
                                                            <TextInput
                                                                value={row.unit}
                                                                placeholder={
                                                                    row.number ===
                                                                    'currency'
                                                                        ? 'Currency code (e.g. USD)'
                                                                        : 'Unit label (e.g. kg)'
                                                                }
                                                                onInput={v =>
                                                                    updateRow(
                                                                        i(),
                                                                        {
                                                                            unit: v,
                                                                        },
                                                                    )
                                                                }
                                                            />
                                                        </Show>
                                                    </div>
                                                </Show>

                                                <Show
                                                    when={
                                                        row.kind === 'formula'
                                                    }
                                                >
                                                    <TextInput
                                                        class={styles['propset-extra']}
                                                        value={row.expr}
                                                        placeholder="Expression, e.g. note.qty * note.price"
                                                        onInput={v =>
                                                            updateRow(i(), {
                                                                expr: v,
                                                            })
                                                        }
                                                    />
                                                </Show>

                                                <Show
                                                    when={
                                                        row.kind !== 'formula'
                                                    }
                                                >
                                                    <TextInput
                                                        class={styles['propset-extra']}
                                                        value={row.defaultText}
                                                        placeholder="Default value (optional)"
                                                        onInput={v =>
                                                            updateRow(i(), {
                                                                defaultText: v,
                                                            })
                                                        }
                                                    />
                                                </Show>

                                                <div class={styles['propset-foot']}>
                                                    <button
                                                        type="button"
                                                        class={styles['propset-btn']}
                                                        disabled={i() === 0}
                                                        aria-label="Move up"
                                                        onClick={() =>
                                                            moveRowAt(i(), -1)
                                                        }
                                                    >
                                                        <Icon
                                                            value="ArrowUp"
                                                            size={13}
                                                        />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class={styles['propset-btn']}
                                                        disabled={
                                                            i() ===
                                                            propRows().length -
                                                                1
                                                        }
                                                        aria-label="Move down"
                                                        onClick={() =>
                                                            moveRowAt(i(), 1)
                                                        }
                                                    >
                                                        <Icon
                                                            value="ArrowDown"
                                                            size={13}
                                                        />
                                                    </button>
                                                    <div class={styles['sp']} />
                                                    <IconTextButton
                                                        icon="Trash2"
                                                        size="sm"
                                                        iconSize={13}
                                                        danger
                                                        onClick={() =>
                                                            removePropRow(i())
                                                        }
                                                    >
                                                        DELETE
                                                    </IconTextButton>
                                                </div>
                                            </div>
                                        </Show>
                                    </div>
                                )
                            }}
                        </For>
                    </div>
                </Show>
                <div class={styles['propset-add']}>
                    <IconTextButton icon="Plus" size="sm" onClick={addPropRow}>
                        ADD PROPERTY
                    </IconTextButton>
                </div>
            </div>

            <ModalFooter
                hint="to close"
                leading={
                    <IconTextButton
                        icon="RotateCcw"
                        size="sm"
                        iconSize={13}
                        onClick={reset}
                    >
                        RESET
                    </IconTextButton>
                }
            >
                <TextButton size="sm" onClick={props.onClose}>
                    CANCEL
                </TextButton>
                <IconTextButton
                    icon="Check"
                    size="sm"
                    variant="selected"
                    onClick={save}
                >
                    SAVE
                </IconTextButton>
            </ModalFooter>
        </Modal>
    )
}
