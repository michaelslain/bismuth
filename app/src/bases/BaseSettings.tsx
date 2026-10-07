import {
    createSignal,
    createMemo,
    createResource,
    Show,
    untrack,
} from 'solid-js'
import { api } from '../api'
import type {
    BaseConfig,
    Row,
    SortSpec,
    ViewType,
} from '../../../core/src/bases/types'
import { viewMode } from '../../../core/src/bases/types'
import type { TreeEntry } from '../../../core/src/graph'
import { fileBasename as noteLabel } from '../../../core/src/pathUtils'
import { columnLabel } from './columnLabel'
import { columnsOf } from './propertyColumns'
import { declaredPropertyKeys } from '../../../core/src/bases/properties'
import {
    buildPropertiesYaml,
    duplicatePropertyNames,
    seedPropertyRows,
    type PropertyFormRow,
} from './basePropertiesForm'
import {
    ALL_FIELDS,
    centerOrUndefined,
    diffPatch,
    fieldsFor,
    isChartKind,
    isRecordKind,
    limitOrUndefined,
    numberOrUndefined,
    orUndefined,
    planSettingsWrites,
    showsColumns,
    showsMode,
    viewKeysFor,
} from './baseSettingsPlan'
import { runOp } from './baseSettingsIO'
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
import Select, { type SelectOption } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { TextButton } from '../ui/TextButton'
import { IconTextButton } from '../ui/IconTextButton'
import InlineCode from '../ui/InlineCode'
import Text from '../ui/Text'
import ErrorText from '../ui/ErrorText'
import { ModalHeader } from '../ui/ModalHeader'
import { ModalFooter } from '../ui/ModalFooter'
import FormModal from '../ui/FormModal'
import ModalBody from '../ui/ModalBody'
import SettingsSection from '../ui/SettingsSection'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import SettingsHint from '../ui/SettingsHint'
import ToggleRow from '../ui/ToggleRow'
import ViewIdentityFields from './ViewIdentityFields'
import SourceFields from './SourceFields'
import FiltersEditor from './FiltersEditor'
import SortFields from './SortFields'
import SummariesFields from './SummariesFields'
import FormulasEditor from './FormulasEditor'
import MapFramingFields, { type MapFraming } from './MapFramingFields'
import CardsFields, { type CardsLook } from './CardsFields'
import ColumnMappingFields from './ColumnMappingFields'
import ChartFields from './ChartFields'
import ColumnsFields from './ColumnsFields'
import PropertiesFields from './PropertiesFields'
// Composes the same FormModal/ModalBody/ModalHeader/ModalFooter chrome + Settings*/Toggle*
// primitives the calendar's CalendarSettings uses, so every base type still shares one polished
// design. Each larger section is its own component (ViewIdentityFields, SourceFields,
// FiltersEditor, SortFields, SummariesFields, FormulasEditor, MapFramingFields, CardsFields,
// ColumnMappingFields, ChartFields, ColumnsFields, PropertiesFields); the pure decisions (which
// kind shows what, what SAVE writes) live in baseSettingsPlan.ts. BaseSettings.module.css holds
// only the `.spaced` / `.error` helpers.
import styles from './BaseSettings.module.css'

const DIR_OPTS = [
    { value: 'ASC', label: 'ascending' },
    { value: 'DESC', label: 'descending' },
]

const NO_TARGET_NOTE = 'no base file to save to'

/**
 * A base's settings as a modal overlay — same FormModal chrome as the calendar's
 * CalendarSettings, so every base type shares one polished design:
 * header / sectioned body / footer with RESET + CANCEL + SAVE. Floats over the live view.
 *
 * A base has ONE view, so the panel edits `config.view` and the base's own keys together.
 * Covers every key a base reads, so no base has to be configured by editing YAML:
 * the view's kind / mode, its source, filters, columns, sort, group, limit, per-kind field
 * bindings, table summaries, formulas and the declared property set.
 *
 * SAVE writes only the keys that changed (baseSettingsPlan.ts `diffPatch`), each as a plain
 * top-level frontmatter key — see `planSettingsWrites`.
 */
export function BaseSettings(props: {
    type: ViewType
    config: BaseConfig
    basePath?: string
    rows: Row[]
    onClose: () => void
    onSaved: () => void
}) {
    const view = () => props.config.view

    // ---- view identity ----
    const [kind, setKind] = createSignal<ViewType>(props.type)
    const [mode, setMode] = createSignal<'normal' | 'tasks'>(
        view() ? viewMode(view()!) : 'normal',
    )

    const isRecord = () => isRecordKind(kind())
    // Kanban gets column-visibility/reorder from the Properties section (declared
    // fields + their eye toggle + reorder), so the Columns section is suppressed for it.
    const showColumns = () => showsColumns(kind())
    const isChart = () => isChartKind(kind())
    const showMode = () => showsMode(kind())
    const fields = () => fieldsFor(kind())

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
        { value: '', label: 'none' },
        ...columnOptions(),
    ])
    const visibleCols = createMemo(() => orderOf(cols()))

    // ---- table summaries ----
    const [summaryChoices, setSummaryChoices] = createSignal(
        seedSummaryChoices(view()?.summaries, cols().map(c => c.col)),
    )

    // ---- filters ----
    const [filters, setFilters] = createSignal(
        filterToForm(props.config.filters),
    )

    // ---- source ----
    const [sourceForm, setSourceForm] = createSignal(
        sourceToForm(props.config.source),
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
    // Shown regardless of the kind. Seeded ONLY from an
    // existing list-form declaration (`declaredProperties`); a base using classic map-form
    // metadata (or no `properties:` at all) starts from an empty list so the panel never
    // surfaces entries it can't losslessly round-trip as a list. `hadDeclared` is captured
    // once so save() only rewrites `properties:` when there's something to write.
    const hadDeclared = props.config.declaredProperties !== undefined
    const [propRows, setPropRows] = createSignal<PropertyFormRow[]>(
        seedPropertyRows(props.config),
    )
    // Which row's full editor is open (null = all collapsed) — owned here so RESET collapses it.
    const [editingProp, setEditingProp] = createSignal<number | null>(null)
    // Row indexes whose name duplicates an earlier row's — buildPropertiesYaml silently drops
    // the later one on save, so PropertiesFields warns on the row and SAVE blocks here.
    const duplicateNames = createMemo(() => duplicatePropertyNames(propRows()))

    // ---- what SAVE would write: the full desired value of every managed key ----
    const desired = (): Record<string, unknown> => {
        const f = form()
        const out: Record<string, unknown> = {
            view: kind(),
            mode: mode(),
            filters: formToFilter(filters()),
            source: formToSource(sourceForm()),
            formulas: buildFormulas(formulaRows()),
            properties:
                hadDeclared || propRows().length > 0
                    ? buildPropertiesYaml(propRows())
                    : undefined,
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
        return out
    }
    const keys = (): string[] => [
        ...viewKeysFor(kind()),
        'formulas',
        'properties',
    ]
    // Captured once, from the seeded form — diffed against at SAVE.
    const initial = untrack(desired)

    const reset = () => {
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
        setFilters(filterToForm(props.config.filters))
        setSourceForm(sourceToForm(props.config.source))
        setFormulaRows(seedFormulaRows(props.config.formulas))
        setPropRows(seedPropertyRows(props.config))
        setEditingProp(null)
    }

    const [saving, setSaving] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    // With no `basePath` there is no file to write to. SAVE used to stay live and report success
    // (`onSaved`) while discarding every edit — now it is off, and the footer says why.
    const noTarget = () => !props.basePath
    const blocked = () =>
        noTarget() ||
        duplicateNames().size > 0 ||
        duplicateFormulas().size > 0 ||
        saving()

    // What the footer says beside SAVE when it is not an error: why SAVE is off, or that a write
    // is in flight.
    const footerNote = (): string | undefined =>
        noTarget() ? NO_TARGET_NOTE : saving() ? 'saving…' : undefined

    const save = async () => {
        const path = props.basePath
        // Never report a save that wrote nothing because there was nowhere to write.
        if (!path) return
        const patch = diffPatch(initial, desired(), keys())
        if (Object.keys(patch).length === 0) {
            props.onSaved()
            return
        }
        setSaving(true)
        setError(null)
        try {
            for (const o of planSettingsWrites(patch)) await runOp(path, o)
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
        >
            <ModalHeader
                title={`${kind()} settings`}
                subtitle={props.basePath ? noteLabel(props.basePath) : undefined}
                onClose={props.onClose}
            />

            <ModalBody>
                <SettingsSection>view</SettingsSection>
                <ViewIdentityFields
                    kind={kind()}
                    mode={mode()}
                    showMode={showMode()}
                    onKind={setKind}
                    onMode={setMode}
                />

                <SettingsSection>source</SettingsSection>
                <SourceFields
                    value={sourceForm()}
                    onChange={setSourceForm}
                    bases={baseOptions()}
                    properties={allCols()}
                    rows={props.rows}
                    config={props.config}
                />

                <SettingsSection>filters</SettingsSection>
                <SettingsField label="conditions" span>
                    <FiltersEditor
                        value={filters()}
                        onChange={setFilters}
                        properties={allCols()}
                        rows={props.rows}
                        config={props.config}
                        emptyHint="no conditions — every row is kept."
                    />
                </SettingsField>

                {/* Field bindings: flashcards / map / cards / chart axes */}
                <Show when={fields().length > 0}>
                    <SettingsSection>column mapping</SettingsSection>
                    <ColumnMappingFields
                        fields={fields()}
                        value={form()}
                        columns={allCols()}
                        onChange={(key, column) =>
                            setForm({ ...form(), [key]: column })
                        }
                        bidirectional={bidi()}
                        onBidirectional={
                            kind() === 'flashcards' ? setBidi : undefined
                        }
                    />
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
                    <ChartFields
                        kind={kind()}
                        aggregate={aggregate()}
                        bin={bin()}
                        limitText={limitText()}
                        onAggregate={setAggregate}
                        onBin={setBin}
                        onLimit={setLimitText}
                    />
                </Show>

                {/* Record types: columns + sort + group + limit */}
                <Show when={isRecord()}>
                    <Show when={showColumns()}>
                        <SettingsSection>columns</SettingsSection>
                        <ColumnsFields
                            columns={cols()}
                            config={props.config}
                            onToggle={toggle}
                        />
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
                                placeholder="none"
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
                    computed columns — use one as{' '}
                    <InlineCode>formula.name</InlineCode> in columns, sort,
                    group and filters.
                </SettingsHint>
                <FormulasEditor rows={formulaRows()} onChange={setFormulaRows} />

                {/* Properties: the base's OWN declared property set — base-level, shown for every
                    view type (#104). */}
                <SettingsSection>properties</SettingsSection>
                <SettingsHint>
                    declare this base's own fields — name, type, and whether it
                    shows on cards/table. order here drives card/table field
                    order. click a row to edit it.
                </SettingsHint>
                <PropertiesFields
                    rows={propRows()}
                    onChange={setPropRows}
                    editing={editingProp()}
                    onEditing={setEditingProp}
                />
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
                {/* Save's status lives HERE, beside the button it explains — the body scrolls and the
                    footer does not, so a failure written at the end of the body was off-screen on
                    any long base. */}
                <Show
                    when={error()}
                    fallback={
                        <Show when={footerNote()}>
                            {note => (
                                <Text
                                    as="span"
                                    size="ui"
                                    tone="muted"
                                    class={styles.note}
                                    data-testid="settings-save-note"
                                >
                                    {note()}
                                </Text>
                            )}
                        </Show>
                    }
                >
                    <ErrorText class={styles.note}>{error()}</ErrorText>
                </Show>
                <TextButton onClick={props.onClose}>
                    cancel
                </TextButton>
                <IconTextButton
                    icon="Check"
                    primary
                    disabled={blocked()}
                    title={noTarget() ? NO_TARGET_NOTE : undefined}
                    onClick={save}
                >
                    save
                </IconTextButton>
            </ModalFooter>
        </FormModal>
    )
}
