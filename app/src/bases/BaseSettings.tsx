import { createSignal, createMemo, createEffect, For, Index, Show } from 'solid-js'
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
    duplicatePropertyNames,
    moveRow,
    seedPropertyRows,
    type PropertyFormRow,
} from './basePropertiesForm'
import { Icon } from '../icons/Icon'
import Select from '../ui/Select'
import Text from '../ui/Text'
import { TextInput } from '../ui/TextInput'
import { TextButton } from '../ui/TextButton'
import { IconButton } from '../ui/IconButton'
import { IconTextButton } from '../ui/IconTextButton'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalFooter } from '../ui/ModalFooter'
import FormModal from '../ui/FormModal'
import ModalBody from '../ui/ModalBody'
import SettingsSection from '../ui/SettingsSection'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import SettingsHint from '../ui/SettingsHint'
import ToggleList from '../ui/ToggleList'
import ToggleRow from '../ui/ToggleRow'
// Composes the same FormModal/ModalBody/ModalHeader/ModalFooter chrome + Settings*/Toggle*
// primitives the calendar's CalendarSettings uses, so every base type still shares one polished
// design. BaseSettings.module.css holds only what has no primitive yet — the Properties editor's
// `.propset-*` rows — plus a `.spaced` helper for two standalone toggle rows.
import styles from './BaseSettings.module.css'

interface FieldDef {
    key: string
    /** Short role label shown next to the column dropdown. */
    role: string
    def: string
    /** Optional fields offer a "Not set" choice. */
    optional?: boolean
    hint: string
}

// Chart views (heatmap/bar/line/stat) all bind the same axis columns.
const CHART_FIELDS: FieldDef[] = [
    {
        key: 'x',
        role: 'X axis',
        def: 'date',
        hint: 'column plotted along the x axis — a date or a category.',
    },
    {
        key: 'y',
        role: 'Value',
        def: '',
        optional: true,
        hint: 'numeric column to aggregate. leave unset to count rows.',
    },
]

// Field-binding settings for non-tabular view types (which column means what).
const FIELDS_BY_TYPE: Partial<Record<ViewType, FieldDef[]>> = {
    flashcards: [
        {
            key: 'frontField',
            role: 'Front',
            def: 'front',
            hint: 'column shown as the card front (the prompt).',
        },
        {
            key: 'backField',
            role: 'Back',
            def: 'back',
            hint: 'column revealed as the answer.',
        },
        {
            key: 'dueField',
            role: 'Due',
            def: 'due',
            hint: "column holding each card's next-review date.",
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
 * Per-view settings as a modal overlay — same FormModal chrome as the calendar's
 * CalendarSettings, so every base type shares one polished design:
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
    // Row indexes whose name duplicates an earlier row's — buildPropertiesYaml silently drops
    // the later one on save, so warn on the row and block SAVE instead.
    const duplicateNames = createMemo(() => duplicatePropertyNames(propRows()))
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
        <FormModal
            onClose={props.onClose}
            label={`${props.type} settings`}
            class={styles.panel}
        >
            <ModalHeader
                title={`${props.type} settings`}
                subtitle={props.basePath ? noteLabel(props.basePath) : undefined}
                onClose={props.onClose}
            />

            <ModalBody>
                {/* Field-binding types: flashcards / chart axes */}
                <Show when={fields().length > 0}>
                    <SettingsSection>column mapping</SettingsSection>
                    <SettingsGrid>
                        <For each={fields()}>
                            {f => (
                                <SettingsField
                                    label={`${f.role.toLowerCase()} column`}
                                    badge={f.optional ? 'optional' : 'required'}
                                    hint={f.hint}
                                >
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
                                </SettingsField>
                            )}
                        </For>
                    </SettingsGrid>
                    <Show when={props.type === 'flashcards'}>
                        <ToggleRow
                            class={styles.spaced}
                            wrap
                            label="bidirectional — review each card both ways (front ↔ back)"
                            checked={bidi()}
                            onToggle={() => setBidi(!bidi())}
                        />
                        <SettingsHint>
                            scheduling uses the standard SM-2 algorithm (fixed,
                            not configurable). use <strong>cram</strong> in the
                            deck to review everything without affecting
                            scheduling.
                            <Show when={bidi()}>
                                {' '}
                                each direction is scheduled independently
                                (reverse state lives in <code>
                                    dueBack
                                </code> / <code>easeBack</code> /{' '}
                                <code>intervalBack</code>).
                            </Show>
                        </SettingsHint>
                    </Show>
                </Show>

                {/* Chart types: aggregate + (non-heatmap) date bucket */}
                <Show when={isChart()}>
                    <SettingsSection>aggregation</SettingsSection>
                    <SettingsGrid>
                        <SettingsField
                            label="aggregate"
                            hint="how values are combined per x-axis bucket."
                        >
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
                        </SettingsField>
                        <Show when={props.type !== 'heatmap'}>
                            <SettingsField
                                label="date bucket"
                                hint="group date values by day, week, or month."
                            >
                                <Select
                                    value={bin()}
                                    options={BIN_OPTS}
                                    onChange={v =>
                                        setBin(v as 'day' | 'week' | 'month')
                                    }
                                />
                            </SettingsField>
                        </Show>
                    </SettingsGrid>
                </Show>

                {/* Record types: columns + sort + group */}
                <Show when={isRecord()}>
                    <Show when={showColumns()}>
                        <SettingsSection>columns</SettingsSection>
                        <SettingsHint>
                            toggle to show or hide. drag the column headers in
                            the table to reorder.
                        </SettingsHint>
                        <ToggleList>
                            <Index each={cols()}>
                                {(item, i) => {
                                    const locked = () =>
                                        item().visible && visibleCount() <= 1
                                    return (
                                        <ToggleRow
                                            label={columnLabel(
                                                item().col,
                                                props.config,
                                            )}
                                            checked={item().visible}
                                            onToggle={() => toggle(i)}
                                            muted={!item().visible}
                                            locked={locked()}
                                            title={
                                                locked()
                                                    ? 'at least one column must stay visible'
                                                    : undefined
                                            }
                                        />
                                    )
                                }}
                            </Index>
                        </ToggleList>
                    </Show>

                    <SettingsSection>sort &amp; group</SettingsSection>
                    <SettingsGrid>
                        <SettingsField label="sort by">
                            <Select
                                value={sortProp()}
                                options={propOptions()}
                                placeholder="None"
                                onChange={setSortProp}
                            />
                        </SettingsField>
                        <Show when={sortProp()}>
                            <SettingsField label="sort direction">
                                <Select
                                    value={sortDir()}
                                    options={DIR_OPTS}
                                    onChange={v =>
                                        setSortDir(v as 'ASC' | 'DESC')
                                    }
                                />
                            </SettingsField>
                        </Show>
                        <SettingsField label="group by">
                            <Select
                                value={groupProp()}
                                options={propOptions()}
                                placeholder="None"
                                onChange={setGroupProp}
                            />
                        </SettingsField>
                        <Show when={groupProp()}>
                            <SettingsField label="group direction">
                                <Select
                                    value={groupDir()}
                                    options={DIR_OPTS}
                                    onChange={v =>
                                        setGroupDir(v as 'ASC' | 'DESC')
                                    }
                                />
                            </SettingsField>
                        </Show>
                    </SettingsGrid>

                    <Show when={props.type === 'kanban'}>
                        <ToggleRow
                            class={styles.spaced}
                            label="hide meta labels — show property values only"
                            checked={hideLabels()}
                            onToggle={() => setHideLabels(!hideLabels())}
                        />
                    </Show>
                </Show>

                {/* Properties: the base's OWN declared property set — base-level, shown for every
            view type (#104). Progressive disclosure: every row collapses to a single quiet
            name/type/visibility line; clicking a row expands ONE full editor at a time
            (name/type/type-specific extras/reorder/delete), collapsing whichever else was
            open. Keeps a base with a dozen+ properties readable as a scannable list instead
            of a wall of controls. */}
                <SettingsSection>properties</SettingsSection>
                <SettingsHint>
                    declare this base's own fields — name, type, and whether it
                    shows on cards/table. order here drives card/table field
                    order. click a row to edit it.
                </SettingsHint>
                <Show when={propRows().length > 0}>
                    <div class={styles['propset-list']}>
                        <Index each={propRows()}>
                            {(row, i) => {
                                const open = () => editingProp() === i
                                const dupe = () =>
                                    duplicateNames().has(i)
                                let rowEl: HTMLDivElement | undefined
                                // The list scrolls inside <ModalBody>, but nothing scrolled a
                                // newly-expanded row into that visible window — so expanding a
                                // row near the top left its freshly-grown body (name/type/extras/
                                // DELETE) sitting past the scroll container's own bottom, painted
                                // under the modal's pinned footer. Scroll the row itself into view
                                // whenever it opens, so its full body — including DELETE — lands
                                // above the footer instead of behind it.
                                createEffect(() => {
                                    if (!open()) return
                                    // Deferred a frame: this effect fires as soon as `open()`
                                    // flips, which is BEFORE the sibling <Show> below has
                                    // inserted/laid out the expanded body — scrolling now would
                                    // only reveal the still-collapsed head. Waiting a frame lets
                                    // that insertion (and its layout) land first.
                                    requestAnimationFrame(() => {
                                        if (open())
                                            rowEl?.scrollIntoView({
                                                block: 'nearest',
                                            })
                                    })
                                })
                                return (
                                    <div
                                        ref={rowEl}
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
                                                    open() ? null : i,
                                                )
                                            }
                                            onKeyDown={e => {
                                                if (
                                                    e.key === 'Enter' ||
                                                    e.key === ' '
                                                ) {
                                                    e.preventDefault()
                                                    setEditingProp(
                                                        open() ? null : i,
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
                                            <Text
                                                as="span"
                                                size="inherit"
                                                tone="inherit"
                                                weight="inherit"
                                                class={styles['propset-name-txt']}
                                                classList={{ [styles['empty']]: !row().name }}
                                            >
                                                {row().name ||
                                                    'untitled property'}
                                            </Text>
                                            <Text
                                                as="span"
                                                size="inherit"
                                                tone="inherit"
                                                weight="inherit"
                                                class={styles['propset-kind']}
                                            >
                                                {row().kind}
                                            </Text>
                                            <IconButton
                                                icon={
                                                    row().hidden
                                                        ? 'eye-off'
                                                        : 'eye'
                                                }
                                                label={
                                                    row().hidden
                                                        ? `Show ${row().name || 'property'} on cards/table`
                                                        : `Hide ${row().name || 'property'} from cards/table`
                                                }
                                                title={
                                                    row().hidden
                                                        ? 'Hidden from cards/table — click to show'
                                                        : 'Visible on cards/table — click to hide'
                                                }
                                                iconSize={15}
                                                class={styles['propset-eye']}
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    updateRow(i, {
                                                        hidden: !row().hidden,
                                                    })
                                                }}
                                            />
                                        </div>

                                        <Show when={open()}>
                                            <div class={styles['propset-body']}>
                                                <div class={styles['propset-fields']}>
                                                    <SettingsField
                                                        label="name"
                                                        class={styles['propset-field']}
                                                    >
                                                        <TextInput
                                                            value={row().name}
                                                            placeholder="Property name"
                                                            onInput={v =>
                                                                updateRow(i, {
                                                                    name: v,
                                                                })
                                                            }
                                                        />
                                                        <Show when={dupe()}>
                                                            <SettingsHint class={styles['propset-dupe']}>
                                                                duplicate name // only the first is saved
                                                            </SettingsHint>
                                                        </Show>
                                                    </SettingsField>
                                                    <SettingsField
                                                        label="kind"
                                                        class={styles['propset-kind-select']}
                                                    >
                                                        <Select
                                                            value={row().kind}
                                                            options={KIND_OPTS}
                                                            onChange={v =>
                                                                updateRow(i, {
                                                                    kind: v as BasePropertyKind,
                                                                })
                                                            }
                                                        />
                                                    </SettingsField>
                                                </div>

                                                <Show
                                                    when={
                                                        row().kind === 'select' ||
                                                        row().kind ===
                                                            'multiselect'
                                                    }
                                                >
                                                    <TextInput
                                                        class={`${styles['propset-extra']} ${styles['propset-options']}`}
                                                        multiline
                                                        value={row().optionsText}
                                                        placeholder="Options — one per line or comma-separated (e.g. todo, doing, done)"
                                                        onInput={v =>
                                                            updateRow(i, {
                                                                optionsText: v,
                                                            })
                                                        }
                                                    />
                                                </Show>

                                                <Show
                                                    when={row().kind === 'number'}
                                                >
                                                    <div class={`${styles['propset-extra']} ${styles['propset-numrow']}`}>
                                                        <SettingsField
                                                            label="format"
                                                            class={styles['propset-numrow-unit']}
                                                        >
                                                            <Select
                                                                value={row().number}
                                                                options={
                                                                    NUMBER_FORMAT_OPTS
                                                                }
                                                                onChange={v =>
                                                                    updateRow(
                                                                        i,
                                                                        {
                                                                            number: v as NumberFormat,
                                                                        },
                                                                    )
                                                                }
                                                            />
                                                        </SettingsField>
                                                        <Show
                                                            when={
                                                                row().number ===
                                                                    'unit' ||
                                                                row().number ===
                                                                    'currency'
                                                            }
                                                        >
                                                            <TextInput
                                                                value={row().unit}
                                                                placeholder={
                                                                    row().number ===
                                                                    'currency'
                                                                        ? 'Currency code (e.g. USD)'
                                                                        : 'Unit label (e.g. kg)'
                                                                }
                                                                onInput={v =>
                                                                    updateRow(
                                                                        i,
                                                                        {
                                                                            unit: v,
                                                                        },
                                                                    )
                                                                }
                                                                class={
                                                                    styles[
                                                                        'propset-numrow-unit'
                                                                    ]
                                                                }
                                                            />
                                                        </Show>
                                                    </div>
                                                </Show>

                                                <Show
                                                    when={
                                                        row().kind === 'formula'
                                                    }
                                                >
                                                    <TextInput
                                                        class={styles['propset-extra']}
                                                        value={row().expr}
                                                        placeholder="Expression, e.g. note.qty * note.price"
                                                        onInput={v =>
                                                            updateRow(i, {
                                                                expr: v,
                                                            })
                                                        }
                                                    />
                                                </Show>

                                                <Show
                                                    when={
                                                        row().kind !== 'formula'
                                                    }
                                                >
                                                    <TextInput
                                                        class={styles['propset-extra']}
                                                        value={row().defaultText}
                                                        placeholder="Default value (optional)"
                                                        onInput={v =>
                                                            updateRow(i, {
                                                                defaultText: v,
                                                            })
                                                        }
                                                    />
                                                </Show>

                                                <div class={styles['propset-foot']}>
                                                    <IconButton
                                                        icon="ArrowUp"
                                                        label="Move up"
                                                        iconSize={13}
                                                        class={styles['propset-btn']}
                                                        disabled={i === 0}
                                                        onClick={() =>
                                                            moveRowAt(i, -1)
                                                        }
                                                    />
                                                    <IconButton
                                                        icon="ArrowDown"
                                                        label="Move down"
                                                        iconSize={13}
                                                        class={styles['propset-btn']}
                                                        disabled={
                                                            i ===
                                                            propRows().length -
                                                                1
                                                        }
                                                        onClick={() =>
                                                            moveRowAt(i, 1)
                                                        }
                                                    />
                                                    <div class={styles['sp']} />
                                                    <IconTextButton
                                                        icon="Trash2"
                                                        iconSize={13}
                                                        danger
                                                        onClick={() =>
                                                            removePropRow(i)
                                                        }
                                                    >
                                                        delete
                                                    </IconTextButton>
                                                </div>
                                            </div>
                                        </Show>
                                    </div>
                                )
                            }}
                        </Index>
                    </div>
                </Show>
                <div class={styles['propset-add']}>
                    <IconTextButton icon="Plus" onClick={addPropRow}>
                        add property
                    </IconTextButton>
                </div>
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
                    disabled={duplicateNames().size > 0}
                    onClick={save}
                >
                    save
                </IconTextButton>
            </ModalFooter>
        </FormModal>
    )
}
