import {
    createSignal,
    createResource,
    createMemo,
    createEffect,
    onCleanup,
    on,
    useTransition,
    Show,
    Switch,
    Match,
} from 'solid-js'
import { api } from '../api'
import { serverVersion, lastChange } from '../serverVersion'
import { changeAffectsView, type ViewDeps } from './changeRelevance'
import { reconcileViewResult } from './reconcileRows'
import { RowCache } from './rowCache'
import { BaseSkeleton } from './BaseSkeleton'
import { parseBase, parseBaseFile, FRONTMATTER_RE } from '../../../core/src/bases/parse'
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
import { viewMode } from '../../../core/src/bases/types'
import { normalizeStoredTaskRow } from '../../../core/src/bases/taskRow'
import { buildChartData } from '../../../core/src/bases/chart'
import { todayISO } from '../../../core/src/dates'
import { appendTaskLine } from './taskCreate'
import { createTaskWrites } from './baseTaskWrites'
import { openTaskStatusMenu } from '../taskStatusMenu'
import { pushToast } from '../toastStore'
import { pushUndoToast } from '../undoToast'
import { parse as parseYaml } from 'yaml'
import {
    planSetValue,
    planToggle,
    type HeatmapOrigin,
    type HeatmapWriteSeam,
    type WriteRow,
} from './heatmapWrites'
import ChartConfigBar from './ChartConfigBar'
import { CalendarView } from './CalendarView'
import { calendarSlots } from '../calendar/components/Toolbar'
import { showCalendarSettings } from '../calendar/state'
import { FlashcardsView } from './FlashcardsView'
import { BaseSettings } from './BaseSettings'
import { capitalize } from './columnKinds'
import ViewTabs from './ViewTabs'
import {
    readViews,
    addView,
    duplicateView,
    removeView,
    renameView,
    moveView,
    changeViewType,
    toggleViewMode,
    type RawView,
} from './viewsEdit'
import AddRowAction from './AddRowAction'
import BaseSourceEditor from './BaseSourceEditor'
import BaseViewActions from './BaseViewActions'
import ViewRenderer from './ViewRenderer'
import ViewBar, { Crumb, type ViewBarSlots } from '../ui/ViewBar'
import Badge from '../ui/Badge'
import EmptyState from '../ui/EmptyState'
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

/** The four view kinds ChartConfigBar's pickers apply to. */
const CHART_VIEW_TYPES = new Set(['bar', 'line', 'stat', 'heatmap'])

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
    // The `path` file body, already read by FileView to branch base-vs-editor. Seeds at most
    // the FIRST resolve of this instance — dropped unused if that resolve is a fresh docCache
    // hit — and every later refetch (e.g. after a source-edit save) re-reads from disk. MUST
    // be the text of `path` — FileView proves that via `bases/prefetchedBody.ts`, and any
    // other caller passing `body` owns the same guarantee.
    body?: string
    // For an embedded ```query block: reveal the raw fence inline in the editor. When set,
    // the SOURCE icon appears even without a base file and triggers inline editing.
    // `onEditQuery` (optional) opens the no-code query builder seeded from this block's body —
    // absent when the block isn't builder-representable (queryBlock.ts gates it there).
    embeddedSource?: { onReveal: () => void; onEditQuery?: () => void }
}) {
    // Consume the prefetched body on at most the first resolve of this instance: it seeds
    // that resolve if the cache is stale, is dropped unused if the cache is fresh, and every
    // later refetch reads fresh from disk.
    let pendingBody = props.body
    // Set on disposal. The doc/row fetchers below are async and outlive a torn-down instance;
    // without this, a mount disposed mid-load still writes docCache/rowCache under its key, and
    // the next mount of the same path trusts that entry as fresh — rendering whatever the dead
    // instance parsed.
    let disposed = false
    onCleanup(() => {
        disposed = true
    })
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
            if (docCache.isFresh(key, version)) {
                pendingBody = undefined
                return docCache.peek(key)!
            }
            // Claimed BEFORE the async read, so a slower resolve that started earlier can be
            // told, once it settles, that a newer one has already landed for this key.
            const token = docCache.begin(key)
            const doc = await loadDocument()
            if (!disposed) docCache.set(key, doc, version, token)
            return doc
        },
    )
    // Effective document: the freshly fetched one when available, else the last cached parse
    // for this view (stale-while-revalidate) so a reopen/split paints instantly instead of
    // blanking while the file is re-read.
    const doc = createMemo<Doc | undefined>(
        () =>
            (fetchedDoc.state === 'errored' ? undefined : fetchedDoc()) ??
            docCache.peek(sig()),
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
            // Claimed BEFORE the resolve so a slower fetch that started earlier — at an older
            // version — can be told, once it settles, that a newer one already landed for this
            // key (see rowCache.ts's `begin`/`set(..., token)`).
            const token = rowCache.begin(key)
            const d = doc()!
            const spec = activeSpec()
            // Own-rows case: `{ kind: 'base' }` with no `ref` is the sentinel this base's
            // OWN table already parsed client-side — resolveSource would just return [] for
            // it server-side (no ref to follow), so it's read straight off the document
            // instead. A `ref` present means real composition (an embedded ```query block's
            // `of: [[Other]]`, or a base's own `source: base ref: …`) and resolves server-side
            // via /rows like notes/tasks, which follows base composition + scoped tasks. The
            // resolve is stamped with `version` so a call issued after a write can't dedupe
            // onto an in-flight request `api.resolveRows` issued before it (api.ts).
            const rows =
                spec?.kind === 'base' && !spec.ref
                    ? d.rows
                    : spec
                      ? await api.resolveRows(spec, version)
                      : []
            const result: LoadedRows = {
                config: d.config,
                basePath: d.basePath,
                spec,
                rows,
            }
            if (!disposed) rowCache.set(key, result, version, token)
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

    // The transitioned form of `refetchAll`, for callers that must NOT suspend (see
    // `revalidateAll` below for why a single outer `startRevalidate(refetchAll)` is not enough
    // on its own). Untransitioned callers (settings save, "+ task", a base-file write) keep
    // calling the plain `refetchAll` above unchanged — showing the Suspense fallback there is
    // fine, sometimes even expected (e.g. right after a modal closes).
    //
    // A SINGLE `startRevalidate(fn)` only protects whatever resource `fn` reads while Solid's
    // transition is still synchronously "running" — and Solid closes a transition the instant
    // its last tracked pending resource resolves, not when `fn`'s own promise resolves. Here
    // `fn` starts by calling `refetchDoc()` (tracked, since the transition is running at that
    // point) then `await`s it; nothing else is pending, so the moment that doc resolves, Solid
    // considers the transition DONE and tears it down — before this function's own continuation
    // ever reaches `refetchRows()`. That second refetch then runs with no transition active at
    // all, so it suspends exactly like an unwrapped call would (verified against BOTH the SSE
    // revalidation effect above and the calendar/flashcards `onChange`/`onReviewed` sites below,
    // via BaseView.stories.tsx's `CalendarTasksToggleKeepsPane`: neither avoided the remount
    // until this nested transition was added). Re-entering `startRevalidate` for the rows half,
    // in the continuation, opens a fresh transition (or joins one still pending on other
    // promises) exactly when it's needed — Solid's `startTransition` only reuses the CURRENT
    // transition when called synchronously while one is still running; called after the doc's
    // transition has already been torn down (the case here), it starts over.
    const revalidateAll = () =>
        void startRevalidate(async () => {
            await refetchDoc()
            await startRevalidate(refetchRows)
        })

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
                if (changeAffectsView(lastChange(), deps)) revalidateAll()
            },
            { defer: true },
        ),
    )

    // Effective data: the freshly fetched result when available, else the last cached
    // resolution for this view (stale-while-revalidate) so a reopen/split paints instantly
    // from cache instead of blanking to a spinner while /rows runs.
    const data = createMemo<LoadedRows | undefined>(() => {
        const key = rowsKey()
        const fresh = fetchedRows.state === 'errored' ? undefined : fetchedRows()
        return fresh ?? (key ? rowCache.peek(key) : undefined)
    })

    // A failed read/resolve with nothing cached to paint: say so instead of leaving the
    // skeleton up forever (a rejected resource read would otherwise throw out of the render).
    const loadError = createMemo<string | undefined>(() => {
        if (data()) return undefined
        const err = fetchedDoc.error ?? fetchedRows.error
        if (!err) return undefined
        return err instanceof Error ? err.message : String(err)
    })

    const [sourceMode, setSourceMode] = createSignal(false)
    const [settingsMode, setSettingsMode] = createSignal(false)

    const activeType = createMemo(() => activeViewConfig()?.type ?? 'table')
    // A view's mode with the legacy calendarContent spelling folded in, or "normal" when
    // there is no active view config yet.
    const activeMode = createMemo<'normal' | 'tasks'>(() => {
        const vc = activeViewConfig()
        return vc ? viewMode(vc) : 'normal'
    })

    // Calendar is "full pane" (skips the runView/result pipeline below) ONLY in the
    // events register — that register renders through BaseBackend/EventStore instead of
    // resolved rows. The tasks register (mode: tasks, or the legacy calendarContent: tasks
    // spelling) renders resolved rows exactly like every other row-based view, so it needs
    // `result()` computed same as table/cards/list/etc.
    const fullPane = () =>
        activeType() === 'flashcards' ||
        (activeType() === 'calendar' && activeMode() !== 'tasks')

    // Reconcile each freshly-computed result against the PREVIOUS one (createMemo hands us its
    // prior return value) so groups/rows that didn't change keep their object identity. Solid's
    // `<For>` keys by identity, so this is what stops a revalidation (e.g. the SSE bump after a
    // task status toggle) from unmounting+remounting every card and flickering the whole grid —
    // only the row that actually changed repaints. See reconcileRows.ts.
    const result = createMemo<ViewResult | null>(prev => {
        const d = data()
        if (!d || fullPane()) return null
        const idx = Math.min(activeView(), d.config.views.length - 1)
        // In tasks mode every row IS a task by declaration, so a row STORED in the base's own
        // body is given the fields a SCANNED row gets free from the parser (statusChar,
        // resolved, placed, recurring, plus the shape defaults) BEFORE anything sorts, groups
        // or renders it. Without this a stored-rows kanban with `groupBy: status` buckets every
        // untouched task under "". (Not the calendar: `placedDate` already falls back to
        // `note.scheduled` then `note.due`, so a stored task carrying a date was placed either
        // way — what it gains here is `resolved`, hence the done/cancelled register.) It only
        // fills keys that are ABSENT, so a row that already came from `taskToRow` passes through
        // untouched and a user's own column of the same name always wins — and `Row.derived`
        // records exactly what it added, which is what keeps those seven out of the column set
        // (deriveColumns) and out of the write (storedNote). See normalizeStoredTaskRow.
        const rows =
            activeMode() === 'tasks'
                ? d.rows.map(normalizeStoredTaskRow)
                : d.rows
        const next = runView(d.config, rows, idx, hostMeta())
        return reconcileViewResult(prev ?? undefined, next)
    }, null)

    const editPath = () => data()?.basePath
    /** True when the active view resolves NO declared `source:` — neither view-level nor
     *  base-level — which is `source.ts`'s own test for "this base owns its rows in its own
     *  inline table". Hoisted out of `viewSlots()` because the "+ task" action needs the same
     *  answer for every view KIND, not only the calendar. */
    const ownsRows = () => !(activeViewConfig()?.source ?? data()?.config.source)
    const baseName = createMemo(() => {
        const p = editPath()
        return p ? noteLabel(p) : undefined
    })

    // The active view's index, clamped to the DOCUMENT's view count (not the resolved rows') —
    // shared by every call site that used to inline this same `Math.min(activeView(), …)`
    // expression (the kanban/calendar viewIndex props, BaseSettings' viewIdx, and now the
    // column-reorder/width writes below and ViewTabs' `active`).
    const activeViewIdx = createMemo(() =>
        Math.min(activeView(), Math.max(0, (doc()?.config.views.length ?? 1) - 1)),
    )

    /** Reads the base file's raw frontmatter, applies a pure `viewsEdit.ts` transform to its
     *  `views:` array, and persists the result — materializing a `view:`-shorthand/flat-keys
     *  base into an explicit `views:` array on first structural edit (see viewsEdit.ts's
     *  module doc), so nothing the user already configured moves to a different view.
     *  `pickActive` computes the tab to land on from the POST-edit array, so e.g. duplicating
     *  view 0 lands on the new view 1, and deleting the active view lands on its left
     *  neighbor. Read-only bases (no `editPath()`) can't reach here — ViewTabs never wires
     *  these callbacks when `editable` is false. */
    const editViews = async (
        edit: (views: RawView[]) => RawView[],
        pickActive: (views: RawView[]) => number,
    ) => {
        const path = editPath()
        if (!path) return null
        const text = await api.read(path)
        const { views, removedKeys } = readViews(text)
        // The old value of every top-level key this edit deletes, read from the same text, so an
        // undo can put it back.
        let raw: Record<string, unknown> = {}
        try {
            const parsed = parseYaml(text.match(FRONTMATTER_RE)?.[2] ?? '')
            if (parsed && typeof parsed === 'object')
                raw = parsed as Record<string, unknown>
        } catch {
            // Malformed frontmatter reads as empty, as in readViews.
        }
        const values: Record<string, unknown> = {}
        for (const key of removedKeys) values[key] = raw[key]
        const next = edit(views)
        await api.setProperty(path, 'views', next)
        for (const key of removedKeys) await api.deleteProperty(path, key)
        setActiveView(pickActive(next))
        await refetchAll()
        return { views, removedKeys, values }
    }

    const handleAddView = (type: string) =>
        void editViews(
            views => addView(views, type),
            next => next.length - 1,
        ).catch(writeFailed('add the view'))

    const handleDuplicateView = (i: number) =>
        void editViews(
            views => duplicateView(views, i),
            () => i + 1,
        ).catch(writeFailed('duplicate the view'))

    const handleDeleteView = (i: number) =>
        void editViews(
            views => removeView(views, i),
            next => Math.min(Math.max(0, i - 1), next.length - 1),
        )
            .then(prev => {
                if (!prev) return
                const gone = prev.views[i]
                const name = String(gone?.name ?? gone?.type ?? 'view')
                const path = editPath()
                if (!path) return
                pushUndoToast(`deleted view ${name}`, async () => {
                    await api.setProperty(path, 'views', prev.views)
                    for (const key of prev.removedKeys)
                        await api.setProperty(path, key, prev.values[key])
                    setActiveView(i)
                    await refetchAll()
                })
            })
            .catch(writeFailed('delete the view'))

    const handleRenameView = (i: number, name: string) =>
        void editViews(
            views => renameView(views, i, name),
            () => i,
        ).catch(writeFailed('rename the view'))

    const handleMoveView = (i: number, dir: -1 | 1) =>
        void editViews(
            views => moveView(views, i, dir),
            next => Math.min(Math.max(0, i + dir), next.length - 1),
        ).catch(writeFailed('move the view'))

    const handleChangeViewType = (i: number, type: string) =>
        void editViews(
            views => changeViewType(views, i, type),
            () => i,
        ).catch(writeFailed('change the view kind'))

    const handleToggleViewMode = (i: number) =>
        void editViews(
            views => toggleViewMode(views, i),
            () => i,
        ).catch(writeFailed('change the view mode'))

    /** "view settings" from the tab menu ALWAYS opens the generic BaseSettings panel, for
     *  every view kind including calendar — unlike the bar's gear (BaseSettingsAction below),
     *  which keeps routing a calendar view to its own settings modal. This is the fix for
     *  calendar's settings being otherwise unreachable (filters/source/kind can't be edited). */
    const handleOpenViewSettings = (i: number) => {
        setActiveView(i)
        setSettingsMode(true)
        setSourceMode(false)
    }

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

    /** A chart kind's ViewBar contribution is just the `config` region — its x/y/aggregate/bin
     *  pickers, writing straight to the base file. Only shown when there's a file to write
     *  (`basePath` — Review Focus #5: an inline ```query block gets no pickers at all). Columns
     *  offered are the result's resolved columns plus the view's own current x/y, so a picker
     *  never drops the value it currently shows even when that property isn't in the row set. */
    const chartConfigSlot = createMemo<ViewBarSlots | undefined>(() => {
        if (!CHART_VIEW_TYPES.has(activeType())) return undefined
        const basePath = data()?.basePath
        const view = activeViewConfig()
        const res = result()
        if (!basePath || !view || !res) return undefined
        const columns = new Set(res.columns)
        if (view.x) columns.add(view.x)
        if (view.y) columns.add(view.y)
        const resolved = buildChartData(
            res.groups.flatMap(g => g.rows),
            view.type === 'heatmap' ? { ...view, bin: 'day' } : view,
        )
        const onSet = (
            changes: Partial<Record<'x' | 'y' | 'aggregate' | 'bin', string | undefined>>,
        ) => {
            const path = data()?.basePath
            if (!path) return
            void (async () => {
                for (const [key, value] of Object.entries(changes)) {
                    if (value === undefined)
                        await api.deleteViewProperty(path, activeViewIdx(), key)
                    else
                        await api.setViewProperty(path, activeViewIdx(), key, value)
                }
                await refetchAll()
            })().catch(writeFailed('update the chart axes'))
        }
        return {
            config: (
                <ChartConfigBar
                    view={view}
                    columns={[...columns]}
                    resolved={{
                        x: resolved.x,
                        y: resolved.y,
                        aggregate: resolved.aggregate,
                        bin: resolved.bin,
                    }}
                    onSet={onSet}
                />
            ),
        }
    })

    const viewSlots = createMemo<ViewBarSlots | undefined>(() => {
        if (activeType() === 'calendar') {
            // The tasks register's bar contributes no `actions` control any more — task
            // creation lives in the grid's own cells (see CalendarView.tsx's TasksCalendar) —
            // so `calendarSlots()` only needs to know which register is showing.
            return calendarSlots({ isTasks: activeMode() === 'tasks' })
        }
        if (activeType() === 'flashcards') return flashcardsSlots()
        return chartConfigSlot()
    })

    // ── The task write seam ───────────────────────────────────────────────────────────────
    // Toggle / status-menu / "+ task" writes live in baseTaskWrites.ts (pure, dependencies
    // injected); this only wires them to the resolved data and the refetches.
    const { toggleTaskRow, setTaskRowStatus, addTask, writeFailed } =
        createTaskWrites({
            api,
            appendTaskLine,
            openStatusMenu: openTaskStatusMenu,
            toast: pushToast,
            refetchAll,
            refetchRows,
            today: todayISO,
            editPath,
            config: () => data()?.config,
            view: activeViewConfig,
            ownsRows,
            rowCount: () => data()?.rows.length ?? 0,
        })

    // ── The heatmap write seam ────────────────────────────────────────────────
    /**
     * HeatmapView never calls `api` directly — it is handed a `HeatmapWriteSeam` (heatmapWrites.
     * ts) built here from the SAME resolved x/y/aggregate `buildChartData` produces for the
     * chart-axis pickers above, plus whichever origin `ownsRows()` says this view has. `undefined`
     * (no `basePath`, no resolved date x, or the view isn't a heatmap) means the view is
     * read-only — an inline ```query block with no base file has nowhere to write, same as the
     * chart config bar's own `basePath` gate above.
     *
     * `chart.points[].rows` are indices into THIS memo's own `rowsAll` flat array (buildChartData
     * bucketed exactly those rows), so resolving "what's on this day" never needs a second lookup
     * against `resolveProperty` — the bucketing HeatmapView itself does for rendering already
     * answered it.
     */
    const heatmapWrites = createMemo<HeatmapWriteSeam | undefined>(() => {
        if (activeType() !== 'heatmap') return undefined
        const path = data()?.basePath
        const view = activeViewConfig()
        const res = result()
        if (!path || !view || !res) return undefined
        const rowsAll = res.groups.flatMap(g => g.rows)
        const chart = buildChartData(rowsAll, { ...view, bin: 'day' })
        if (!chart.isDate || !chart.x) return undefined
        const xKey = chart.x
        const yKey = chart.y
        const isCount = chart.aggregate === 'count' || !yKey
        const origin: HeatmapOrigin = ownsRows() ? 'base' : 'query'

        const rowsFor = (date: string): WriteRow[] => {
            const pt = chart.points.find(p => p.date === date)
            if (!pt) return []
            return pt.rows.map(i => {
                const r = rowsAll[i]
                return { index: r.index, path: r.file.path, note: r.note }
            })
        }

        const onSetDay = async (date: string, entered: number | undefined) => {
            if (!yKey) return
            const row = rowsFor(date)[0]
            const intent = planSetValue({ origin, xKey, yKey, date, row, entered })
            try {
                switch (intent.kind) {
                    case 'none':
                        return
                    case 'create':
                        await api.rowCreate(path, intent.note)
                        break
                    case 'update':
                        await api.rowUpdate(path, intent.index, intent.note)
                        break
                    case 'delete':
                        await api.rowDelete(path, intent.index)
                        break
                    case 'set-property':
                        await api.setProperty(intent.path, intent.key, intent.value)
                        break
                }
                await refetchAll()
            } catch (err) {
                writeFailed('log the day')(err)
            }
        }

        const onToggleDay = async (date: string) => {
            const intent = planToggle({ xKey, date, rows: rowsFor(date) })
            try {
                switch (intent.kind) {
                    case 'none':
                        return
                    case 'create':
                        await api.rowCreate(path, intent.note)
                        break
                    case 'delete-many':
                        for (const index of intent.indices) await api.rowDelete(path, index)
                        break
                }
                await refetchAll()
            } catch (err) {
                writeFailed('toggle the day')(err)
            }
        }

        return { origin, isCount, onSetDay, onToggleDay }
    })

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
                                {n => (
                                    <Crumb
                                        icon={
                                            activeType() === 'calendar'
                                                ? 'Calendar'
                                                : 'Table'
                                        }
                                    >
                                        {n()}
                                    </Crumb>
                                )}
                            </Show>
                            <Show when={props.embeddedSource}>
                                <Badge>query</Badge>
                            </Show>
                        </>
                    }
                    locus={viewSlots()?.locus}
                    facet={
                        <Show
                            when={
                                (data()?.config.views.length ?? 0) > 1 ||
                                !!editPath()
                            }
                        >
                            <ViewTabs
                                class={styles.tabs}
                                views={(data()?.config.views ?? []).map(v => ({
                                    name: v.name,
                                    type: v.type,
                                    mode: viewMode(v),
                                }))}
                                active={activeViewIdx()}
                                onSelect={setActiveView}
                                editable={!!editPath()}
                                onAdd={handleAddView}
                                onRename={handleRenameView}
                                onDuplicate={handleDuplicateView}
                                onDelete={handleDeleteView}
                                onMove={handleMoveView}
                                onChangeType={handleChangeViewType}
                                onToggleMode={handleToggleViewMode}
                                onOpenSettings={handleOpenViewSettings}
                            />
                        </Show>
                    }
                    readouts={viewSlots()?.readouts}
                    config={viewSlots()?.config}
                    actions={
                        <>
                            {viewSlots()?.actions}
                            <BaseViewActions
                                action="add-task"
                                when={
                                    activeMode() === 'tasks' &&
                                    activeType() !== 'calendar' &&
                                    activeType() !== 'flashcards' &&
                                    (ownsRows()
                                        ? !!editPath()
                                        : !!activeViewConfig()?.taskFile)
                                }
                                onAct={() =>
                                    void addTask().catch(
                                        writeFailed('create the task'),
                                    )
                                }
                            />
                            <Show when={data()}>
                                {d => (
                                    <AddRowAction
                                        basePath={d().basePath}
                                        config={d().config}
                                        view={activeViewConfig()!}
                                        viewIndex={activeViewIdx()}
                                        ownsRows={ownsRows()}
                                        mode={activeMode()}
                                        onAdded={refetchAll}
                                    />
                                )}
                            </Show>
                            <BaseViewActions
                                action="settings"
                                when={!!editPath()}
                                active={
                                    activeType() === 'calendar'
                                        ? showCalendarSettings.value
                                        : settingsMode()
                                }
                                onAct={() => {
                                    // A calendar routes to its own settings modal.
                                    if (activeType() === 'calendar')
                                        showCalendarSettings.value =
                                            !showCalendarSettings.value
                                    else {
                                        setSettingsMode(true)
                                        setSourceMode(false)
                                    }
                                }}
                            />
                            <BaseViewActions
                                action="edit-query"
                                when={!!props.embeddedSource?.onEditQuery}
                                onAct={() => props.embeddedSource?.onEditQuery?.()}
                            />
                            <BaseViewActions
                                action="source"
                                when={!!(editPath() || props.embeddedSource)}
                                active={!!editPath() && sourceMode()}
                                onAct={() => {
                                    // Embedded query: reveal the fence inline in the editor.
                                    // Base file: toggle the textarea source panel.
                                    if (props.embeddedSource)
                                        props.embeddedSource.onReveal()
                                    else {
                                        setSourceMode(!sourceMode())
                                        setSettingsMode(false)
                                    }
                                }}
                            />
                        </>
                    }
                />
            </Show>

            <div class={styles.body}>
                <Show when={sourceMode() && editPath()}>
                    <BaseSourceEditor
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
                        fallback={
                            <Show
                                when={loadError()}
                                fallback={<BaseSkeleton type="table" />}
                            >
                                {message => (
                                    <EmptyState title="couldn't load this base">
                                        {message()}
                                    </EmptyState>
                                )}
                            </Show>
                        }
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
                                            <ViewRenderer
                                                result={res()}
                                                config={data()!.config}
                                                basePath={data()!.basePath}
                                                mode={activeMode()}
                                                ownsRows={ownsRows()}
                                                viewIndex={activeViewIdx()}
                                                onChange={refetchAll}
                                                onToggle={toggleTaskRow}
                                                onSetStatus={setTaskRowStatus}
                                                onOpen={props.onOpen}
                                                heatmapWrites={heatmapWrites()}
                                                onReorder={
                                                    data()!.basePath
                                                        ? c => {
                                                              void api
                                                                  .setViewProperty(
                                                                      data()!.basePath!,
                                                                      activeViewIdx(),
                                                                      'order',
                                                                      c,
                                                                  )
                                                                  .then(refetchAll)
                                                          }
                                                        : undefined
                                                }
                                                onWidthsChange={
                                                    data()!.basePath
                                                        ? cw => {
                                                              void api.setViewProperty(
                                                                  data()!.basePath!,
                                                                  activeViewIdx(),
                                                                  'columnWidths',
                                                                  cw,
                                                              )
                                                          }
                                                        : undefined
                                                }
                                            />
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
                                    // Deliberately the combined refetch: this callback fires for a
                                    // reviewed markdown card (a write to another note) AND for a
                                    // reviewed row card (a write to the base file's stored row),
                                    // and the callback does not say which. Narrowing it means
                                    // threading that discriminator up from the child. Runs the
                                    // same nested-transition revalidation as the SSE path (see
                                    // `revalidateAll`) so the pane does not suspend and remount.
                                    onReviewed={revalidateAll}
                                    onBarSlots={setFlashcardsSlots}
                                />
                            </Match>
                            <Match when={activeType() === 'calendar'}>
                                <CalendarView
                                    basePath={data()!.basePath}
                                    result={result() ?? undefined}
                                    config={data()!.config}
                                    ownsRows={ownsRows()}
                                    viewIndex={Math.min(
                                        activeView(),
                                        Math.max(
                                            0,
                                            data()!.config.views.length - 1,
                                        ),
                                    )}
                                    // Deliberately the combined refetch: this callback fires for a
                                    // task-line write (another note) AND for a stored-row write
                                    // (the base file itself), and the callback does not say which.
                                    // Narrowing it means threading that discriminator up from the
                                    // child. Runs the same nested-transition revalidation as the
                                    // SSE path (above, `revalidateAll`) so the pane does not
                                    // suspend and remount on its own write.
                                    onChange={revalidateAll}
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
                    viewIdx={activeViewIdx()}
                    viewIndex={activeView()}
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
