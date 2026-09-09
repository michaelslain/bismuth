import {
    createSignal,
    createResource,
    createMemo,
    createEffect,
    onMount,
    on,
    useTransition,
    Show,
    Switch,
    Match,
    Index,
} from 'solid-js'
import { api } from '../api'
import { serverVersion, lastChange } from '../serverVersion'
import { changeAffectsView, type ViewDeps } from './changeRelevance'
import { reconcileViewResult } from './reconcileRows'
import { RowCache } from './rowCache'
import { BaseSkeleton } from './BaseSkeleton'
import { parseBase, parseBaseFile } from '../../../core/src/bases/parse'
import { runView } from '../../../core/src/bases/query'
import { refToPath } from '../../../core/src/bases/sourceSpec'
import { fileBasename as noteLabel } from '../../../core/src/pathUtils'
import type {
    BaseConfig,
    Row,
    ViewResult,
    ViewConfig,
    SourceSpec,
    QueryBlock,
    FileMeta,
} from '../../../core/src/bases/types'
import { TableView } from './TableView'
import { CardsView } from './CardsView'
import { ListView } from './ListView'
import { BulletsView } from './BulletsView'
import { KanbanView } from './KanbanView'
import { MapView } from './MapView'
import { HeatmapView } from './HeatmapView'
import { BarView } from './BarView'
import { LineView } from './LineView'
import { StatView } from './StatView'
import { CalendarView } from './CalendarView'
import { calendarSlots } from '../calendar/components/Toolbar'
import { showCalendarSettings } from '../calendar/state'
import { FlashcardsView } from './FlashcardsView'
import { BaseSettings } from './BaseSettings'
import { capitalize } from './renderValue'
import { TextButton } from '../ui/TextButton'
import { IconButton } from '../ui/IconButton'
import { SegmentedToggle } from '../ui/SegmentedToggle'
import ViewBar, { Crumb, VBtn, type ViewBarSlots } from '../ui/ViewBar'
import Badge from '../ui/Badge'
import { Loading } from '../ui/EmptyState'
import styles from './BaseView.module.css'

/** A minimal FileMeta for the host note, exposed to an embedded base as `this.file`
 *  so filters like `file.hasLink(this.file)` (match notes linking back to the host)
 *  and `this.file.name` resolve. tags/links are left empty — `this.file` is used to
 *  identify the host by name/path, not to read its own tags. */
function hostFileMeta(path: string): FileMeta {
    const name = noteLabel(path)
    const slash = path.lastIndexOf('/')
    const folder = slash >= 0 ? path.slice(0, slash) : ''
    const dot = path.lastIndexOf('.')
    const ext = dot > slash ? path.slice(dot + 1) : ''
    return {
        name,
        basename: name,
        path,
        folder,
        ext,
        size: 0,
        ctime: 0,
        mtime: 0,
        tags: [],
        links: [],
    }
}

/** The base's parsed document: its config plus whatever rows are intrinsic to the file
 *  itself. Reading + parsing the file is the one HTTP round-trip in resolving a base, so
 *  this stays keyed on the view's identity (path/source/view) alone — never on the active
 *  view index, or clicking a view tab would re-read the file on every click. */
interface Doc {
    config: BaseConfig
    // The base's OWN inline rows — a `type: base` md file's own table body, parsed
    // client-side. Empty for a flat ```query block or an inline ```query YAML fence,
    // neither of which has a table of its own to fall back to.
    rows: Row[]
    basePath?: string
}

/** A fully resolved base for the ACTIVE view: the document plus the source spec that view
 *  resolves to (`views[activeView].source ?? config.source`, see `activeSpec` below) and
 *  the rows that spec produced — the document's own rows for an own-rows base, else a
 *  server-resolved `/rows` fetch. */
interface LoadedRows {
    config: BaseConfig
    spec?: SourceSpec // undefined for a view block with no of:/tasks: → empty state
    basePath?: string
    rows: Row[]
}

/** Module-level SWR cache of parsed base documents (config + own rows), shared across
 *  every BaseView instance (and across tabs/splits) so reopening a base paints instantly.
 *  Keyed by the view signature (path/source/view) alone — see `Doc`. */
const docCache = new RowCache<Doc>()

/** Module-level SWR cache of resolved bases, keyed by (view signature, active source), so
 *  reopening a base OR switching back to a previously-active view paints instantly from
 *  the last resolution while it revalidates. Invalidated by the SSE server version — see
 *  `rowCache.ts`. */
const rowCache = new RowCache<LoadedRows>()

/** Raw source editor for a base file — a textarea + Save, used by the per-view Source
 *  toggle. (Embedded ```query blocks edit their fence inline in the editor instead.) */
function SourceEditor(props: { path: string; onClose: () => void }) {
    const [text, setText] = createSignal<string | null>(null)
    let gutter: HTMLDivElement | undefined
    onMount(async () => setText(await api.read(props.path)))
    // 1-based line numbers for the gutter. A <textarea> can't carry per-line ::before,
    // so we render a parallel gutter column and keep its scroll synced to the textarea.
    const lines = createMemo(() =>
        Array.from(
            { length: (text() ?? '').split('\n').length },
            (_, i) => i + 1,
        ),
    )
    const save = async () => {
        if (text() != null) await api.write(props.path, text()!)
        props.onClose()
    }
    return (
        <div class={styles.source}>
            <Show when={text() != null} fallback={<Loading />}>
                <div class={styles.sourceEditor}>
                    <div
                        class={styles.sourceGutter}
                        ref={gutter}
                        aria-hidden="true"
                    >
                        <Index each={lines()}>{n => <div>{n()}</div>}</Index>
                    </div>
                    <textarea
                        class={styles.sourceArea}
                        value={text()!}
                        spellcheck={false}
                        onInput={e => setText(e.currentTarget.value)}
                        onScroll={e => {
                            if (gutter)
                                gutter.scrollTop = e.currentTarget.scrollTop
                        }}
                    />
                </div>
            </Show>
            <div class={styles.sourceBar}>
                <TextButton onClick={save}>SAVE</TextButton>
                <TextButton onClick={props.onClose}>CANCEL</TextButton>
            </div>
        </div>
    )
}

/**
 * Unified view host. Renders any source (base / notes / tasks) as any view type.
 * Inputs (priority order): `view` (a flat ```query block spec), `path` (a `type: base` md file),
 * or `source` (inline ```query YAML).
 */
export function BaseView(props: {
    path?: string
    source?: string
    view?: QueryBlock
    hostPath?: string
    onOpen?: (path: string) => void
    // The `path` file body, already read by FileView to branch base-vs-editor. Seeds the
    // first load so we don't re-read /file; a later refetch (e.g. after a source-edit save)
    // re-reads from disk to pick up changes.
    body?: string
    // For an embedded ```query block: reveal the raw fence inline in the editor. When set,
    // the SOURCE icon appears even without a base file and triggers inline editing.
    embeddedSource?: { onReveal: () => void }
}) {
    // Consume the prefetched body exactly once: the initial render reuses it, any refetch
    // reads fresh from disk.
    let pendingBody = props.body
    const [hostMeta] = createResource(
        () => props.hostPath,
        async p => {
            if (!p) return undefined
            const fm = (await api.meta(p)) as Record<string, unknown>
            // Attach the host note's file identity so an embedded base can reference it as
            // `this.file` (e.g. `file.hasLink(this.file)` for back-link filters).
            return { ...fm, file: hostFileMeta(p) }
        },
    )

    // Reads the file (or parses the inline/query-block config) into the DOCUMENT — the part
    // of resolving a base that's an HTTP round-trip. Never reads the active view: a per-view
    // `source:` is carried onto `config.views[i].source` instead of being resolved here, so
    // switching view tabs can't accidentally re-trigger a file read. See `activeSpec` below
    // for where the active view's source is actually consulted.
    async function loadDocument(): Promise<Doc> {
        if (props.view) {
            const v = props.view
            const config: BaseConfig = {
                views: [
                    {
                        type: v.as,
                        name: capitalize(v.as),
                        filters: v.where,
                        sort: v.sort,
                        groupBy: v.group ? { property: v.group } : undefined,
                        limit: v.limit,
                        source: v.source,
                    },
                ],
            }
            return {
                config,
                rows: [],
                basePath:
                    v.source?.kind === 'base'
                        ? refToPath(v.source.ref)
                        : undefined,
            }
        }
        if (props.path) {
            // A base file is a `type: base` md note (no `.base` extension). Reuse the body
            // FileView already read on the first load; re-read on any subsequent refetch.
            const text = pendingBody ?? (await api.read(props.path))
            pendingBody = undefined
            const name = noteLabel(props.path)
            const { config, rows } = parseBaseFile(text, {
                name,
                path: props.path,
            })
            return { config, rows, basePath: props.path }
        }
        const config = parseBase(props.source ?? '')
        return { config, rows: [] }
    }

    const sig = createMemo(() =>
        JSON.stringify({ p: props.path, s: props.source, v: props.view }),
    )

    const [activeView, setActiveView] = createSignal(0)

    // Mark cached docs/rows stale whenever the backend version advances (a vault change) so
    // the next resolve revalidates. The cached values stay around for an instant paint.
    createEffect(() => {
        const version = serverVersion()
        docCache.invalidate(version)
        rowCache.invalidate(version)
    })

    // The document resource's source is the *identity* key only (path/source/view) — NOT the
    // active view index and NOT the server version. A key change is a genuinely different
    // base, so it's fine to suspend (show a skeleton). See `fetchedRows` below for the part
    // that DOES vary per view, and the revalidation effect further down for version bumps.
    const [fetchedDoc, { refetch: refetchDoc }] = createResource(
        sig,
        async key => {
            const version = serverVersion()
            if (docCache.isFresh(key, version)) return docCache.peek(key)!
            const doc = await loadDocument()
            docCache.set(key, doc, version)
            return doc
        },
    )
    // Effective document: the freshly fetched one when available, else the last cached parse
    // for this view (stale-while-revalidate) so a reopen/split paints instantly instead of
    // blanking while the file is re-read.
    const doc = createMemo<Doc | undefined>(
        () => fetchedDoc() ?? docCache.peek(sig()),
    )

    // The active view's own config object — read once here so activeType, fullPane and
    // activeSpec (below) don't each re-derive the same min(activeView(), …) index lookup.
    // Reads the DOCUMENT, not the resolved rows: `config.views` never depends on which
    // source resolved, so this stays valid even while `fetchedRows` is still in flight.
    const activeViewConfig = createMemo<ViewConfig | undefined>(() => {
        const d = doc()
        if (!d || d.config.views.length === 0) return undefined
        return d.config.views[Math.min(activeView(), d.config.views.length - 1)]
    })

    // The active view's resolved source: its own `source:` override, falling back to the
    // base-level `source:`, falling back to "use this base's own rows" when it has any, else
    // plain vault notes. This is the fix for the gap ViewConfig.source used to have: the
    // per-view value was parsed and typed but only ever read for the calendar's ownsRows
    // check, never actually used to fetch anything.
    const activeSpec = createMemo<SourceSpec | undefined>(() => {
        const d = doc()
        if (!d) return undefined
        const declared = activeViewConfig()?.source ?? d.config.source
        if (declared) return declared
        // A flat ```query block with neither of:/tasks: declared is a deliberate empty state
        // (undefined spec → no rows) — it must not silently fall back to "all vault notes".
        if (props.view) return undefined
        return d.rows.length ? { kind: 'base' } : { kind: 'notes' }
    })
    // Rows are keyed on the document's identity AND the active spec (JSON-compared, since two
    // views can carry equal-but-distinct SourceSpec objects) — so a tab switch that lands on a
    // different source refetches, and one that shares a source with the previous tab does not.
    const rowsKey = createMemo<string | undefined>(() => {
        const d = doc()
        return d ? `${sig()}::${JSON.stringify(activeSpec())}` : undefined
    })

    // A version bump is a background revalidation of the SAME base: we drive it through a
    // transition (below) so the current tree keeps rendering while the new rows load, instead
    // of suspending to the <Suspense> fallback. That fallback swap would unmount + remount
    // full-pane views like the calendar on their own writes — resetting scroll, flickering,
    // and re-running their onMount (which re-reads the file from disk and could race a
    // not-yet-landed write). The cache + in-flight dedup keep resolves cheap.
    const [, startRevalidate] = useTransition()
    const [fetchedRows, { refetch: refetchRows }] = createResource(
        rowsKey,
        async key => {
            const version = serverVersion()
            // Fresh cache hit (same version, not invalidated): skip the /rows round-trip.
            if (rowCache.isFresh(key, version)) return rowCache.peek(key)!
            const d = doc()!
            const spec = activeSpec()
            // Own-rows case: `{ kind: 'base' }` with no `ref` is the sentinel this base's
            // OWN table already parsed client-side — resolveSource would just return [] for
            // it server-side (no ref to follow), so it's read straight off the document
            // instead. A `ref` present means real composition (an embedded ```query block's
            // `of: [[Other]]`, or a base's own `source: base ref: …`) and resolves server-side
            // via /rows like notes/tasks, which follows base composition + scoped tasks.
            const rows =
                spec?.kind === 'base' && !spec.ref
                    ? d.rows
                    : spec
                      ? await api.resolveRows(spec)
                      : []
            const result: LoadedRows = {
                config: d.config,
                basePath: d.basePath,
                spec,
                rows,
            }
            rowCache.set(key, result, version)
            return result
        },
    )

    // A combined refetch for callers that force a full re-resolution after a mutation
    // (source edit, row reorder/move, settings save, …) — same shape as the single `refetch`
    // this replaced, now split across the document and the active view's rows.
    const refetchAll = async () => {
        await refetchDoc()
        await refetchRows()
    }

    // Revalidate on a server version bump, but ONLY when the change can actually affect this
    // view's rows. Otherwise a busy vault re-resolves + re-renders every open base continuously
    // and pegs CPU — e.g. the daemon rewrites DAEMON.md every ~2s, which bumps the
    // version with { paths:[DAEMON.md], dirty:{graph:false,tree:false} } even though no base
    // cares about it. Safe-by-default: anything we can't rule out triggers a refetch. Accepted
    // revalidations run in a transition (stale-while-revalidate: prior rows stay painted, no
    // Suspense flash / full-pane remount) until the fresh resolve lands. Refetches BOTH the
    // document and the rows (in that order) since a relevant change may be to the base's own
    // file — mirroring the single combined refetch this replaced.
    //   - no dirty (poll catch-up, unknown extent) → refetch
    //   - dirty.tree (new/renamed/removed/icon note may newly match the filter) → refetch
    //   - paths empty + !tree → memory-only (3rd brain); never affects vault rows → skip
    //   - dirty.graph (a vault tag/link edit may change filter membership) → refetch
    //   - else content-only vault edit → refetch only if it touched our own rows / base / host note
    createEffect(
        on(
            serverVersion,
            () => {
                const d = data()
                const deps: ViewDeps | null = d
                    ? {
                          baseFilters: d.config.filters,
                          viewFilters: d.config.views.map(v => v.filters),
                          spec: d.spec,
                          relevantPaths: new Set(
                              [
                                  ...d.rows.map(r => r.file.path),
                                  d.basePath,
                                  props.path,
                                  props.hostPath,
                              ].filter(Boolean) as string[],
                          ),
                      }
                    : null
                if (changeAffectsView(lastChange(), deps))
                    void startRevalidate(refetchAll)
            },
            { defer: true },
        ),
    )

    // Effective data: the freshly fetched result when available, else the last cached
    // resolution for this view (stale-while-revalidate) so a reopen/split paints instantly
    // from cache instead of blanking to a spinner while /rows runs.
    const data = createMemo<LoadedRows | undefined>(() => {
        const key = rowsKey()
        return fetchedRows() ?? (key ? rowCache.peek(key) : undefined)
    })

    const [sourceMode, setSourceMode] = createSignal(false)
    const [settingsMode, setSettingsMode] = createSignal(false)

    const activeType = createMemo(() => activeViewConfig()?.type ?? 'table')
    // Calendar is "full pane" (skips the runView/result pipeline below) ONLY in the
    // events register — that register renders through BaseBackend/EventStore instead of
    // resolved rows. The tasks register (calendarContent: 'tasks') renders resolved rows
    // exactly like every other row-based view, so it needs `result()` computed same as
    // table/cards/list/etc.
    const fullPane = () =>
        activeType() === 'flashcards' ||
        (activeType() === 'calendar' &&
            activeViewConfig()?.calendarContent !== 'tasks')

    // Reconcile each freshly-computed result against the PREVIOUS one (createMemo hands us its
    // prior return value) so groups/rows that didn't change keep their object identity. Solid's
    // `<For>` keys by identity, so this is what stops a revalidation (e.g. the SSE bump after a
    // task status toggle) from unmounting+remounting every card and flickering the whole grid —
    // only the row that actually changed repaints. See reconcileRows.ts.
    const result = createMemo<ViewResult | null>(prev => {
        const d = data()
        if (!d || fullPane()) return null
        const idx = Math.min(activeView(), d.config.views.length - 1)
        const next = runView(d.config, d.rows, idx, hostMeta())
        return reconcileViewResult(prev ?? undefined, next)
    }, null)

    const editPath = () => data()?.basePath
    const baseName = createMemo(() => {
        const p = editPath()
        return p ? noteLabel(p) : undefined
    })

    /** A view KIND that contributes controls to the base's bar returns ViewBarSlots rather than
     *  rendering a bar of its own — so the base owns the one bar and the kind only says WHICH
     *  REGION each of its controls belongs in. Replaces the old spacer/`<CalendarToolbar inline/>`
     *  fallback pair, where the calendar had to bring its own `flex: 1` region and BaseView had to
     *  remember not to render a second one beside it.
     *
     *  THE TWO ARMS REACH THEIR SLOTS DIFFERENTLY, and that asymmetry is real rather than sloppy.
     *  `calendarSlots()` is PULLED — the calendar's state is module-level signals (calendar/
     *  state.ts), so anyone may call it. A deck's queue, tally and cram flag are per-instance and
     *  restored per basePath, so `<FlashcardsView>` PUSHES its slots up through `onBarSlots` once
     *  it mounts, and clears them on unmount. Lifting a deck's session to a module store just to
     *  make the two arms symmetric would be a far larger change than deleting a header bar.
     *
     *  A MEMO, NOT A PLAIN FUNCTION, and this is not a micro-optimisation. It is read from four
     *  separate prop getters below (`locus`, `readouts`, `config`, `actions`), and JSX in Solid
     *  BUILDS DOM eagerly — so a plain function constructed the calendar's whole control set four
     *  times per bar and threw three away, each with its own live reactive subscriptions to
     *  currentView/currentDate/showCategoryPanel. That was survivable only while the calendar
     *  returned one effect-free block; splitting it across four regions is what makes it wrong. */
    const [flashcardsSlots, setFlashcardsSlots] = createSignal<
        ViewBarSlots | undefined
    >()
    const viewSlots = createMemo<ViewBarSlots | undefined>(() => {
        if (activeType() === 'calendar') {
            const vc = activeViewConfig()
            // "Owns its rows" mirrors source.ts's own fallback: a view-level `source:`
            // wins over the base-level one, and NEITHER present means the base's own
            // inline row table — the exact test resolveBaseRows uses to skip resolveSource
            // entirely. Getting this wrong either hides "+ task" on a real self-owned
            // tasks calendar or offers it on a sourced one with nowhere to write a row.
            const ownsRows = !(vc?.source ?? data()?.config.source)
            return calendarSlots({
                isTasks: vc?.calendarContent === 'tasks',
                basePath: editPath(),
                ownsRows,
                taskFile: vc?.taskFile,
            })
        }
        return activeType() === 'flashcards' ? flashcardsSlots() : undefined
    })

    /** SETTINGS gear sits next to SOURCE for every base type, including the calendar — which routes
     *  to its own settings modal (showCalendarSettings) instead of the generic BaseSettings
     *  overlay. Extracted verbatim from the old bar body so the `actions` slot stays readable. */
    const BaseSettingsAction = () => (
        <Show when={editPath()}>
            <VBtn
                icon="Settings"
                title="Settings"
                active={
                    activeType() === 'calendar'
                        ? showCalendarSettings.value
                        : settingsMode()
                }
                onClick={() => {
                    if (activeType() === 'calendar')
                        showCalendarSettings.value =
                            !showCalendarSettings.value
                    else {
                        setSettingsMode(true)
                        setSourceMode(false)
                    }
                }}
            />
        </Show>
    )

    /** SOURCE also shows for an embedded query (edits the fence body). Extracted verbatim; it is an
     *  IconButton where its neighbour is a VBtn — two button primitives side by side in one region.
     *  That is a known finding, reported rather than fixed: unifying them is a different change. */
    const BaseSourceAction = () => (
        <Show when={editPath() || props.embeddedSource}>
            <IconButton
                icon={editPath() && sourceMode() ? 'X' : 'Code'}
                label="Source"
                variant={editPath() && sourceMode() ? 'selected' : 'normal'}
                onClick={() => {
                    // Embedded query: reveal the fence inline in the editor. Base file: toggle
                    // the textarea source panel.
                    if (props.embeddedSource) props.embeddedSource.onReveal()
                    else {
                        setSourceMode(!sourceMode())
                        setSettingsMode(false)
                    }
                }}
            />
        </Show>
    )

    return (
        <div class={styles.host}>
            <Show
                when={
                    (data()?.config.views.length ?? 0) > 1 ||
                    editPath() ||
                    props.embeddedSource
                }
            >
                <ViewBar
                    class={props.embeddedSource ? styles.embeddedBar : ''}
                    identity={
                        <>
                            <Show when={baseName()}>
                                {n => <Crumb icon="Table">{n()}</Crumb>}
                            </Show>
                            <Show when={props.embeddedSource}>
                                <Badge>query</Badge>
                            </Show>
                        </>
                    }
                    locus={viewSlots()?.locus}
                    facet={
                        <Show when={(data()?.config.views.length ?? 0) > 1}>
                            <SegmentedToggle
                                class={styles.tabs}
                                value={activeView()}
                                onChange={setActiveView}
                                options={data()!.config.views.map((v, i) => ({
                                    id: i,
                                    label: v.name,
                                }))}
                            />
                        </Show>
                    }
                    readouts={viewSlots()?.readouts}
                    config={viewSlots()?.config}
                    actions={
                        <>
                            {viewSlots()?.actions}
                            <BaseSettingsAction />
                            <BaseSourceAction />
                        </>
                    }
                />
            </Show>

            <div class={styles.body}>
                <Show when={sourceMode() && editPath()}>
                    <SourceEditor
                        path={editPath()!}
                        onClose={() => {
                            setSourceMode(false)
                            refetchAll()
                        }}
                    />
                </Show>
                <Show when={!sourceMode()}>
                    {/* No cached/fetched data yet: show a shaped skeleton (default table outline —
              the view kind isn't known until the config parses) so the pane shows
              structure immediately instead of a bare spinner. */}
                    <Show
                        when={data()}
                        fallback={<BaseSkeleton type="table" />}
                    >
                        <Switch
                            fallback={
                                <div
                                    class={styles.base}
                                    classList={{
                                        [styles.baseKanban]:
                                            activeType() === 'kanban',
                                    }}
                                >
                                    <Show
                                        when={result()}
                                        fallback={
                                            <BaseSkeleton type={activeType()} />
                                        }
                                    >
                                        {res => (
                                            <Switch
                                                fallback={
                                                    <TableView
                                                        result={res()}
                                                        config={data()!.config}
                                                        onReorder={
                                                            data()!.basePath
                                                                ? c => {
                                                                      void api
                                                                          .setProperty(
                                                                              data()!
                                                                                  .basePath!,
                                                                              'order',
                                                                              c,
                                                                          )
                                                                          .then(
                                                                              refetchAll,
                                                                          )
                                                                  }
                                                                : undefined
                                                        }
                                                        widths={
                                                            res().view
                                                                .columnWidths
                                                        }
                                                        onWidthsChange={
                                                            data()!.basePath
                                                                ? cw => {
                                                                      void api.setProperty(
                                                                          data()!
                                                                              .basePath!,
                                                                          'columnWidths',
                                                                          cw,
                                                                      )
                                                                  }
                                                                : undefined
                                                        }
                                                    />
                                                }
                                            >
                                                <Match
                                                    when={
                                                        res().view.type ===
                                                        'kanban'
                                                    }
                                                >
                                                    <KanbanView
                                                        result={res()}
                                                        config={data()!.config}
                                                        basePath={
                                                            data()!.basePath
                                                        }
                                                        viewIndex={Math.min(
                                                            activeView(),
                                                            Math.max(
                                                                0,
                                                                data()!.config
                                                                    .views
                                                                    .length - 1,
                                                            ),
                                                        )}
                                                        onChange={refetchAll}
                                                    />
                                                </Match>
                                                <Match
                                                    when={
                                                        res().view.type ===
                                                        'cards'
                                                    }
                                                >
                                                    <CardsView
                                                        result={res()}
                                                        config={data()!.config}
                                                    />
                                                </Match>
                                                <Match
                                                    when={
                                                        res().view.type ===
                                                        'list'
                                                    }
                                                >
                                                    <ListView
                                                        result={res()}
                                                        config={data()!.config}
                                                        onChange={refetchAll}
                                                    />
                                                </Match>
                                                <Match
                                                    when={
                                                        res().view.type ===
                                                        'bullets'
                                                    }
                                                >
                                                    <BulletsView
                                                        result={res()}
                                                        config={data()!.config}
                                                    />
                                                </Match>
                                                <Match
                                                    when={
                                                        res().view.type ===
                                                        'map'
                                                    }
                                                >
                                                    <MapView
                                                        result={res()}
                                                        config={data()!.config}
                                                        onOpen={props.onOpen}
                                                    />
                                                </Match>
                                                <Match
                                                    when={
                                                        res().view.type ===
                                                        'heatmap'
                                                    }
                                                >
                                                    <HeatmapView
                                                        result={res()}
                                                        config={data()!.config}
                                                    />
                                                </Match>
                                                <Match
                                                    when={
                                                        res().view.type ===
                                                        'bar'
                                                    }
                                                >
                                                    <BarView
                                                        result={res()}
                                                        config={data()!.config}
                                                    />
                                                </Match>
                                                <Match
                                                    when={
                                                        res().view.type ===
                                                        'line'
                                                    }
                                                >
                                                    <LineView
                                                        result={res()}
                                                        config={data()!.config}
                                                    />
                                                </Match>
                                                <Match
                                                    when={
                                                        res().view.type ===
                                                        'stat'
                                                    }
                                                >
                                                    <StatView
                                                        result={res()}
                                                        config={data()!.config}
                                                    />
                                                </Match>
                                            </Switch>
                                        )}
                                    </Show>
                                </div>
                            }
                        >
                            <Match when={activeType() === 'flashcards'}>
                                <FlashcardsView
                                    rows={data()!.rows}
                                    config={data()!.config}
                                    basePath={data()!.basePath}
                                    onReviewed={refetchAll}
                                    onBarSlots={setFlashcardsSlots}
                                />
                            </Match>
                            <Match when={activeType() === 'calendar'}>
                                <CalendarView
                                    basePath={data()!.basePath}
                                    result={result() ?? undefined}
                                    config={data()!.config}
                                    onChange={refetchAll}
                                />
                            </Match>
                        </Switch>
                    </Show>
                </Show>
            </div>

            {/* Settings float over the live view as a modal (same chrome as the calendar's). */}
            <Show when={settingsMode() && !!data()}>
                <BaseSettings
                    type={activeType()}
                    config={data()!.config}
                    viewIdx={Math.min(
                        activeView(),
                        Math.max(0, data()!.config.views.length - 1),
                    )}
                    basePath={data()!.basePath}
                    rows={data()!.rows}
                    onClose={() => setSettingsMode(false)}
                    onSaved={() => {
                        setSettingsMode(false)
                        refetchAll()
                    }}
                />
            </Show>
        </div>
    )
}
