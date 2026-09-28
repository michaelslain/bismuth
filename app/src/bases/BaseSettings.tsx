import {
    createSignal,
    createMemo,
    createEffect,
    createResource,
    For,
    Index,
    Show,
    untrack,
} from 'solid-js'
import { parse as parseYaml } from 'yaml'
import { api } from '../api'
import type {
    BaseConfig,
    BasePropertyKind,
    NumberFormat,
    Row,
    SortSpec,
    ViewType,
} from '../../../core/src/bases/types'
import {
    BASE_PROPERTY_KINDS,
    NUMBER_FORMATS,
    viewMode,
} from '../../../core/src/bases/types'
import { FRONTMATTER_RE } from '../../../core/src/bases/parse'
import type { TreeEntry } from '../../../core/src/graph'
import { fileBasename as noteLabel } from '../../../core/src/pathUtils'
import { capitalize } from './columnKinds'
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
import {
    centerOrUndefined,
    diffPatch,
    limitOrUndefined,
    numberOrUndefined,
    orUndefined,
    planSettingsWrites,
    type WriteOp,
} from './baseSettingsPlan'
import { filterToForm, formToFilter } from './filterForm'
import { formToSource, sourceToForm, toWikilink } from './sourceForm'
import {
    buildFormulas,
    duplicateFormulaNames,
    formulaColumns,
    seedFormulaRows,
} from './formulasForm'
import { buildSummaries, seedSummaryChoices } from './summariesForm'
import {
    mergeColumns,
    orderOf,
    seedColumns,
    toggleColumn,
} from './columnsForm'
import { Icon } from '../icons/Icon'
import Select, { type SelectOption } from '../ui/Select'
import Text from '../ui/Text'
import { TextInput } from '../ui/TextInput'
import { TextButton } from '../ui/TextButton'
import { IconButton } from '../ui/IconButton'
import { IconTextButton } from '../ui/IconTextButton'
import PlainButton from '../ui/PlainButton'
import InlineCode from '../ui/InlineCode'
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
import ViewIdentityFields from './ViewIdentityFields'
import SourceFields from './SourceFields'
import FiltersEditor from './FiltersEditor'
import SortFields from './SortFields'
import SummariesFields from './SummariesFields'
import FormulasEditor from './FormulasEditor'
import MapFramingFields, { type MapFraming } from './MapFramingFields'
import CardsFields, { type CardsLook } from './CardsFields'
// Composes the same FormModal/ModalBody/ModalHeader/ModalFooter chrome + Settings*/Toggle*
// primitives the calendar's CalendarSettings uses, so every base type still shares one polished
// design. Each larger section is its own component (ViewIdentityFields, SourceFields,
// FiltersEditor, SortFields, SummariesFields, FormulasEditor, MapFramingFields, CardsFields);
// BaseSettings.module.css holds only what has no primitive yet — the Properties editor's
// `.propset-*` rows — plus `.spaced` / `.error` helpers.
import styles from './BaseSettings.module.css'

interface FieldDef {
    key: string
    /** Short role label shown next to the column dropdown. */
    role: string
    def: string
    /** Optional fields offer a "none" choice, labelled `noneLabel`. */
    optional?: boolean
    noneLabel?: string
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
        noneLabel: 'count rows',
        hint: 'numeric column to aggregate. leave unset to count rows.',
    },
]

// Field-binding settings (which column means what), per view kind.
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
        {
            key: 'easeField',
            role: 'Ease',
            def: 'ease',
            hint: "column holding each card's SM-2 ease factor.",
        },
        {
            key: 'intervalField',
            role: 'Interval',
            def: 'interval',
            hint: "column holding each card's review interval, in days.",
        },
    ],
    map: [
        {
            key: 'lat',
            role: 'Latitude',
            def: 'lat',
            hint: 'column holding each place’s latitude, in decimal degrees.',
        },
        {
            key: 'lng',
            role: 'Longitude',
            def: 'lng',
            hint: 'column holding each place’s longitude, in decimal degrees.',
        },
    ],
    cards: [
        {
            key: 'image',
            role: 'Image',
            def: '',
            optional: true,
            noneLabel: 'text cover',
            hint: 'column holding a cover image — a url or a vault image path.',
        },
    ],
    heatmap: CHART_FIELDS,
    bar: CHART_FIELDS,
    line: CHART_FIELDS,
    stat: CHART_FIELDS,
}

/** Every field binding across every kind, once each (x/y are shared by the charts). */
const ALL_FIELDS: FieldDef[] = [
    ...new Map(
        Object.values(FIELDS_BY_TYPE)
            .flat()
            .map(f => [f!.key, f!]),
    ).values(),
]

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

async function runOp(path: string, o: WriteOp): Promise<void> {
    if (o.op === 'set') await api.setProperty(path, o.key, o.value)
    else if (o.op === 'delete') await api.deleteProperty(path, o.key)
    else if (o.op === 'setView')
        await api.setViewProperty(path, o.index, o.key, o.value)
    else await api.deleteViewProperty(path, o.index, o.key)
}

/** The base file's frontmatter as it is on disk right now. */
async function readFrontmatter(path: string): Promise<Record<string, unknown>> {
    const text = await api.read(path)
    const m = text.match(FRONTMATTER_RE)
    if (!m) return {}
    const data = parseYaml(m[2])
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
}

/**
 * Per-view settings as a modal overlay — same FormModal chrome as the calendar's
 * CalendarSettings, so every base type shares one polished design:
 * header / sectioned body / footer with RESET + CANCEL + SAVE. Floats over the live view.
 *
 * Covers every key a base or view reads, so no base has to be configured by editing YAML:
 * the view's name / kind / mode, its source, base + view filters, columns, sort, group, limit,
 * per-kind field bindings, table summaries, formulas and the declared property set.
 *
 * SAVE writes only the keys that changed (baseSettingsPlan.ts `diffPatch`), VIEW keys into
 * `views[viewIndex]` and BASE keys at the top level — see `planSettingsWrites` for the
 * flat-key traps it routes around.
 */
export function BaseSettings(props: {
    type: ViewType
    config: BaseConfig
    /** Index of the view these settings edit — the active view, not always the first. */
    viewIndex?: number
    /** Older spelling of `viewIndex`, still accepted. */
    viewIdx?: number
    basePath?: string
    rows: Row[]
    onClose: () => void
    onSaved: () => void
}) {
    const viewIndex = () => props.viewIndex ?? props.viewIdx ?? 0
    const view = () => props.config.views[viewIndex()]

    // ---- view identity ----
    const initialName = view()?.name ?? capitalize(props.type)
    const [name, setName] = createSignal(initialName)
    const [kind, setKind] = createSignal<ViewType>(props.type)
    const [mode, setMode] = createSignal<'normal' | 'tasks'>(
        view() ? viewMode(view()!) : 'normal',
    )

    const isRecord = () => RECORD_TYPES.includes(kind())
    // Kanban gets column-visibility/reorder from the Properties section (declared
    // fields + their eye toggle + reorder), so the Columns section is suppressed for it.
    const showColumns = () => isRecord() && kind() !== 'kanban'
    const isChart = () => CHART_TYPES.includes(kind())
    const showMode = () => isRecord() || kind() === 'calendar'
    const fields = () => FIELDS_BY_TYPE[kind()] ?? []

    // ---- formulas (base-level) — their columns join the columns list live ----
    const [formulaRows, setFormulaRows] = createSignal(
        seedFormulaRows(props.config.formulas),
    )
    const duplicateFormulas = createMemo(() =>
        duplicateFormulaNames(formulaRows()),
    )

    // Row-derived columns ∪ the base's declared properties ∪ its formulas, so a declared-but-
    // not-yet-populated field (or a brand-new formula) is still offerable.
    const allCols = createMemo(() => [
        ...new Set([
            ...columnsOf(props.rows),
            ...declaredPropertyKeys(props.config),
            ...formulaColumns(formulaRows()),
        ]),
    ])

    // Options for a column-binding dropdown: the available columns, always unioned
    // with the field's current value + default so an off-screen binding still shows.
    const colOptions = (f: FieldDef, current: string) => {
        const seen = new Set(allCols())
        const extra = [current, f.def].filter(c => c && !seen.has(c))
        return [
            ...(f.optional ? [{ value: '', label: f.noneLabel ?? 'none' }] : []),
            ...allCols().map(c => ({ value: c, label: c })),
            ...extra.map(c => ({ value: c, label: c })),
        ]
    }

    // ---- field bindings (flashcards / map / cards / chart axes) ----
    const seedFields = (): Record<string, string> => {
        const v = (view() ?? {}) as unknown as Record<string, unknown>
        const out: Record<string, string> = {}
        for (const f of ALL_FIELDS) out[f.key] = (v[f.key] as string) ?? f.def
        return out
    }
    const [form, setForm] = createSignal<Record<string, string>>(seedFields())
    // Flashcards: review every card both ways, each direction scheduled independently.
    const [bidi, setBidi] = createSignal<boolean>(!!view()?.bidirectional)
    // Kanban (#105): hide each card's meta-row label captions, showing values only.
    const [hideLabels, setHideLabels] = createSignal<boolean>(
        !!view()?.hideLabels,
    )
    const seedFraming = (): MapFraming => ({
        zoom: view()?.zoom != null ? String(view()!.zoom) : '',
        centerLat: view()?.center ? String(view()!.center!.lat) : '',
        centerLng: view()?.center ? String(view()!.center!.lng) : '',
    })
    const [framing, setFraming] = createSignal<MapFraming>(seedFraming())
    const seedLook = (): CardsLook => ({
        cardContent: view()?.cardContent ?? '',
        imageFit: view()?.imageFit ?? '',
        aspect:
            view()?.imageAspectRatio != null
                ? String(view()!.imageAspectRatio)
                : '',
    })
    const [look, setLook] = createSignal<CardsLook>(seedLook())

    // ---- columns / sort / group / limit ----
    // Every id already in `order:` stays listed (columnsForm.ts), even one no row carries.
    const [colState, setColState] = createSignal(
        seedColumns(view()?.order, allCols()),
    )
    const [colsTouched, setColsTouched] = createSignal(false)
    const cols = createMemo(() =>
        mergeColumns(colState(), [...(view()?.order ?? []), ...allCols()]),
    )
    const visibleCount = () => cols().filter(c => c.visible).length
    const toggle = (col: string) => {
        setColState(toggleColumn(cols(), col))
        setColsTouched(true)
    }
    const [sort, setSort] = createSignal<SortSpec[]>(view()?.sort ?? [])
    const [groupProp, setGroupProp] = createSignal(
        view()?.groupBy?.property ?? '',
    )
    const [groupDir, setGroupDir] = createSignal(
        view()?.groupBy?.direction ?? 'ASC',
    )
    const [limitText, setLimitText] = createSignal(
        view()?.limit != null ? String(view()!.limit) : '',
    )
    const [aggregate, setAggregate] = createSignal<
        'sum' | 'avg' | 'count' | 'min' | 'max'
    >(view()?.aggregate ?? (view()?.y ? 'sum' : 'count'))
    const [bin, setBin] = createSignal<'day' | 'week' | 'month'>(
        view()?.bin ?? 'day',
    )

    // Every column, for sort/group/summary pickers.
    const columnOptions = createMemo<SelectOption[]>(() =>
        cols().map(c => ({
            value: c.col,
            label: columnLabel(c.col, props.config),
        })),
    )
    const propOptions = createMemo(() => [
        { value: '', label: 'None' },
        ...columnOptions(),
    ])
    const visibleCols = createMemo(() => orderOf(cols()))

    // ---- table summaries ----
    const [summaryChoices, setSummaryChoices] = createSignal(
        seedSummaryChoices(view()?.summaries, cols().map(c => c.col)),
    )

    // ---- filters: this view's + every view's (base-level) ----
    const [viewFilters, setViewFilters] = createSignal(
        filterToForm(view()?.filters),
    )
    const [baseFilters, setBaseFilters] = createSignal(
        filterToForm(props.config.filters),
    )

    // ---- source: the view's own override when it has one, else the base's ----
    const sourceScope: 'base' | 'view' = view()?.source ? 'view' : 'base'
    const [sourceForm, setSourceForm] = createSignal(
        sourceToForm(view()?.source ?? props.config.source),
    )
    // Base pickers (`from` / `ref`): every note, as `[[name]]`.
    const [tree] = createResource<TreeEntry[]>(() => api.tree())
    const baseOptions = createMemo<SelectOption[]>(() =>
        (tree() ?? [])
            .filter(e => e.kind !== 'dir' && e.path.endsWith('.md'))
            .map(e => ({ value: toWikilink(e.path), label: noteLabel(e.path) }))
            .sort((a, b) => a.label.localeCompare(b.label)),
    )

    // ---- properties form (#104: define the base's OWN declared property set) ----
    // Base-level, not per-view — shown regardless of the kind. Seeded ONLY from an
    // existing list-form declaration (`declaredProperties`); a base using classic map-form
    // metadata (or no `properties:` at all) starts from an empty list so the panel never
    // surfaces entries it can't losslessly round-trip as a list. `hadDeclared` is captured
    // once so save() only rewrites `properties:` when there's something to write.
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

    // ---- what SAVE would write: the full desired value of every managed key ----
    const desiredView = (): Record<string, unknown> => {
        const f = form()
        const out: Record<string, unknown> = {
            name: name().trim() || initialName,
            type: kind(),
            mode: mode(),
            filters: formToFilter(viewFilters()),
            limit: limitOrUndefined(limitText()),
            order: colsTouched() ? orderOf(cols()) : view()?.order,
            sort: sort().length ? sort() : undefined,
            groupBy: groupProp()
                ? { property: groupProp(), direction: groupDir() }
                : undefined,
            hideLabels: hideLabels(),
            summaries: buildSummaries(
                view()?.summaries,
                visibleCols(),
                summaryChoices(),
            ),
            bidirectional: bidi(),
            aggregate: aggregate(),
            bin: bin(),
            zoom: numberOrUndefined(framing().zoom),
            center: centerOrUndefined(framing().centerLat, framing().centerLng),
            cardContent: orUndefined(look().cardContent),
            imageFit: orUndefined(look().imageFit),
            imageAspectRatio: numberOrUndefined(look().aspect),
        }
        for (const fd of ALL_FIELDS)
            out[fd.key] = fd.optional ? orUndefined(f[fd.key] ?? '') : f[fd.key]
        if (sourceScope === 'view') out.source = formToSource(sourceForm())
        return out
    }
    const desiredBase = (): Record<string, unknown> => ({
        filters: formToFilter(baseFilters()),
        formulas: buildFormulas(formulaRows()),
        properties:
            hadDeclared || propRows().length > 0
                ? buildPropertiesYaml(propRows())
                : undefined,
        ...(sourceScope === 'base'
            ? { source: formToSource(sourceForm()) }
            : {}),
    })
    // The keys the CURRENT kind manages — switching kind never deletes another kind's settings.
    const viewKeys = (): string[] => {
        const k = kind()
        const keys = ['name', 'type', 'filters']
        if (sourceScope === 'view') keys.push('source')
        if (showMode()) keys.push('mode')
        if (isRecord() || isChart()) keys.push('limit')
        if (isRecord()) keys.push('sort', 'groupBy')
        if (showColumns()) keys.push('order')
        if (k === 'kanban') keys.push('hideLabels')
        if (k === 'table') keys.push('summaries')
        keys.push(...fields().map(f => f.key))
        if (k === 'flashcards') keys.push('bidirectional')
        if (isChart()) keys.push('aggregate')
        if (isChart() && k !== 'heatmap') keys.push('bin')
        if (k === 'map') keys.push('zoom', 'center')
        if (k === 'cards') keys.push('cardContent', 'imageFit', 'imageAspectRatio')
        return keys
    }
    const BASE_KEYS = ['source', 'filters', 'formulas', 'properties']
    // Captured once, from the seeded form — diffed against at SAVE.
    const initialView = untrack(desiredView)
    const initialBase = untrack(desiredBase)

    const reset = () => {
        setName(initialName)
        setKind(props.type)
        setMode(view() ? viewMode(view()!) : 'normal')
        setForm(Object.fromEntries(ALL_FIELDS.map(f => [f.key, f.def])))
        setColState(allCols().map(c => ({ col: c, visible: true })))
        setColsTouched(true)
        setSort([])
        setGroupProp('')
        setGroupDir('ASC')
        setLimitText('')
        setAggregate(view()?.y ? 'sum' : 'count')
        setBin('day')
        setBidi(false)
        setHideLabels(false)
        setFraming({ zoom: '', centerLat: '', centerLng: '' })
        setLook({ cardContent: '', imageFit: '', aspect: '' })
        setSummaryChoices({})
        setViewFilters(filterToForm(view()?.filters))
        setBaseFilters(filterToForm(props.config.filters))
        setSourceForm(sourceToForm(view()?.source ?? props.config.source))
        setFormulaRows(seedFormulaRows(props.config.formulas))
        setPropRows(seedPropertyRows(props.config))
        setEditingProp(null)
    }

    const [saving, setSaving] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    const blocked = () =>
        duplicateNames().size > 0 || duplicateFormulas().size > 0 || saving()

    const save = async () => {
        const path = props.basePath
        const viewPatch = diffPatch(initialView, desiredView(), viewKeys())
        const basePatch = diffPatch(initialBase, desiredBase(), BASE_KEYS)
        if (
            !path ||
            (Object.keys(viewPatch).length === 0 &&
                Object.keys(basePatch).length === 0)
        ) {
            props.onSaved()
            return
        }
        setSaving(true)
        setError(null)
        try {
            const plan = planSettingsWrites({
                frontmatter: await readFrontmatter(path),
                viewIndex: viewIndex(),
                view: viewPatch,
                base: basePatch,
                current: { type: kind(), name: desiredView().name as string },
            })
            if ('error' in plan) {
                setError(plan.error)
                return
            }
            for (const o of plan.ops) await runOp(path, o)
            props.onSaved()
        } catch (e) {
            setError(
                `couldn't save // ${e instanceof Error ? e.message : String(e)}`,
            )
        } finally {
            setSaving(false)
        }
    }

    return (
        <FormModal
            onClose={props.onClose}
            label={`${kind()} settings`}
            class={styles.panel}
        >
            <ModalHeader
                title={`${kind()} settings`}
                subtitle={props.basePath ? noteLabel(props.basePath) : undefined}
                onClose={props.onClose}
            />

            <ModalBody>
                <SettingsSection>view</SettingsSection>
                <ViewIdentityFields
                    name={name()}
                    kind={kind()}
                    mode={mode()}
                    showMode={showMode()}
                    onName={setName}
                    onKind={setKind}
                    onMode={setMode}
                />

                <SettingsSection>source</SettingsSection>
                <SourceFields
                    value={sourceForm()}
                    onChange={setSourceForm}
                    bases={baseOptions()}
                    scope={sourceScope}
                    viewCount={props.config.views.length}
                    properties={allCols()}
                    rows={props.rows}
                    config={props.config}
                />

                <SettingsSection>filters</SettingsSection>
                <SettingsField label="this view" span>
                    <FiltersEditor
                        value={viewFilters()}
                        onChange={setViewFilters}
                        properties={allCols()}
                        rows={props.rows}
                        config={props.config}
                        emptyHint="no conditions — this view keeps every row."
                    />
                </SettingsField>
                <SettingsField label="every view" span>
                    <FiltersEditor
                        value={baseFilters()}
                        onChange={setBaseFilters}
                        properties={allCols()}
                        rows={props.rows}
                        config={props.config}
                        emptyHint="no conditions. these apply to every view of the base, on top of each view's own."
                    />
                </SettingsField>

                {/* Field bindings: flashcards / map / cards / chart axes */}
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
                                        placeholder={f.noneLabel ?? 'Not set'}
                                        onChange={c =>
                                            setForm({ ...form(), [f.key]: c })
                                        }
                                    />
                                </SettingsField>
                            )}
                        </For>
                    </SettingsGrid>
                    <Show when={kind() === 'flashcards'}>
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
                                (reverse state lives in <InlineCode>
                                    dueBack
                                </InlineCode> / <InlineCode>easeBack</InlineCode> /{' '}
                                <InlineCode>intervalBack</InlineCode>).
                            </Show>
                        </SettingsHint>
                    </Show>
                </Show>

                <Show when={kind() === 'map'}>
                    <SettingsSection>opening frame</SettingsSection>
                    <MapFramingFields value={framing()} onChange={setFraming} />
                </Show>

                <Show when={kind() === 'cards'}>
                    <SettingsSection>cards</SettingsSection>
                    <CardsFields
                        value={look()}
                        onChange={setLook}
                        hasImage={!!form().image}
                    />
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
                        <Show when={kind() !== 'heatmap'}>
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
                        <SettingsField
                            label="row limit"
                            badge="optional"
                            hint="only the first N rows are charted."
                        >
                            <TextInput
                                type="number"
                                min="1"
                                value={limitText()}
                                placeholder="no limit"
                                onInput={setLimitText}
                            />
                        </SettingsField>
                    </SettingsGrid>
                </Show>

                {/* Record types: columns + sort + group + limit */}
                <Show when={isRecord()}>
                    <Show when={showColumns()}>
                        <SettingsSection>columns</SettingsSection>
                        <SettingsHint>
                            toggle to show or hide. drag the column headers in
                            the table to reorder.
                        </SettingsHint>
                        <ToggleList>
                            <Index each={cols()}>
                                {item => {
                                    const locked = () =>
                                        item().visible && visibleCount() <= 1
                                    return (
                                        <ToggleRow
                                            label={columnLabel(
                                                item().col,
                                                props.config,
                                            )}
                                            checked={item().visible}
                                            onToggle={() => toggle(item().col)}
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
                        <SortFields
                            sort={sort()}
                            onChange={setSort}
                            options={columnOptions()}
                        />
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
                        <SettingsField
                            label="row limit"
                            badge="optional"
                            hint={
                                groupProp()
                                    ? 'at most N rows in each group.'
                                    : 'show at most N rows.'
                            }
                        >
                            <TextInput
                                type="number"
                                min="1"
                                value={limitText()}
                                placeholder="no limit"
                                onInput={setLimitText}
                            />
                        </SettingsField>
                    </SettingsGrid>

                    <Show when={kind() === 'kanban'}>
                        <ToggleRow
                            class={styles.spaced}
                            label="hide meta labels — show property values only"
                            checked={hideLabels()}
                            onToggle={() => setHideLabels(!hideLabels())}
                        />
                    </Show>
                </Show>

                <Show when={kind() === 'table'}>
                    <SettingsSection>summaries</SettingsSection>
                    <SettingsHint>
                        a footer row under the table, one aggregation per column.
                    </SettingsHint>
                    <SummariesFields
                        columns={visibleCols()}
                        choices={summaryChoices()}
                        onChange={setSummaryChoices}
                        config={props.config}
                    />
                </Show>

                <SettingsSection>formulas</SettingsSection>
                <SettingsHint>
                    computed columns for every view — use one as{' '}
                    <InlineCode>formula.name</InlineCode> in columns, sort,
                    group and filters.
                </SettingsHint>
                <FormulasEditor rows={formulaRows()} onChange={setFormulaRows} />

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
                                        <PlainButton
                                            class={styles['propset-head']}
                                            aria-expanded={open()}
                                            onClick={() =>
                                                setEditingProp(
                                                    open() ? null : i,
                                                )
                                            }
                                        >
                                            <Icon
                                                value="chevron-right"
                                                class={styles['propset-chev']}
                                                strokeWidth={2}
                                            />
                                            <Text
                                                as="span"
                                                inherit
                                                class={styles['propset-name-txt']}
                                                classList={{ [styles['empty']]: !row().name }}
                                            >
                                                {row().name ||
                                                    'untitled property'}
                                            </Text>
                                            <Text
                                                as="span"
                                                inherit
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
                                                class={styles['propset-eye']}
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    updateRow(i, {
                                                        hidden: !row().hidden,
                                                    })
                                                }}
                                            />
                                        </PlainButton>

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
                                                        class={styles['propset-btn']}
                                                        disabled={i === 0}
                                                        onClick={() =>
                                                            moveRowAt(i, -1)
                                                        }
                                                    />
                                                    <IconButton
                                                        icon="ArrowDown"
                                                        label="Move down"
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
                <Show when={error()}>
                    <SettingsHint class={styles.error}>{error()}</SettingsHint>
                </Show>
            </ModalBody>

            <ModalFooter
                leading={
                    <IconTextButton
                        icon="RotateCcw"
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
                    disabled={blocked()}
                    onClick={save}
                >
                    save
                </IconTextButton>
            </ModalFooter>
        </FormModal>
    )
}
