import { createSignal, createResource, createMemo, createEffect, onMount, on, useTransition, Show, Switch, Match, Index } from "solid-js";
import { api } from "../api";
import { serverVersion, lastChange } from "../serverVersion";
import { changeAffectsView, type ViewDeps } from "./changeRelevance";
import { reconcileViewResult } from "./reconcileRows";
import { RowCache } from "./rowCache";
import { BaseSkeleton } from "./BaseSkeleton";
import { parseBase, parseBaseFile } from "../../../core/src/bases/parse";
import { runView } from "../../../core/src/bases/query";
import { refToPath } from "../../../core/src/bases/sourceSpec";
import { fileBasename as noteLabel } from "../../../core/src/pathUtils";
import type { BaseConfig, Row, ViewResult, SourceSpec, QueryBlock, FileMeta } from "../../../core/src/bases/types";
import { TableView } from "./TableView";
import { CardsView } from "./CardsView";
import { ListView } from "./ListView";
import { BulletsView } from "./BulletsView";
import { KanbanView } from "./KanbanView";
import { MapView } from "./MapView";
import { HeatmapView } from "./HeatmapView";
import { BarView } from "./BarView";
import { LineView } from "./LineView";
import { StatView } from "./StatView";
import { CalendarView } from "./CalendarView";
import { showCalendarSettings } from "../calendar/state";
import { FlashcardsView } from "./FlashcardsView";
import { BaseSettings } from "./BaseSettings";
import { capitalize } from "./renderValue";
import { TextButton } from "../ui/TextButton";
import { IconButton } from "../ui/IconButton";
import { SegmentedToggle } from "../ui/SegmentedToggle";
import { ViewBar, Crumb, ViewBarSpacer, VBtn } from "../ui/ViewBar";
import { Loading } from "../ui/EmptyState";
import styles from "./BaseView.module.css";

/** A minimal FileMeta for the host note, exposed to an embedded base as `this.file`
 *  so filters like `file.hasLink(this.file)` (match notes linking back to the host)
 *  and `this.file.name` resolve. tags/links are left empty — `this.file` is used to
 *  identify the host by name/path, not to read its own tags. */
function hostFileMeta(path: string): FileMeta {
  const name = noteLabel(path);
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const dot = path.lastIndexOf(".");
  const ext = dot > slash ? path.slice(dot + 1) : "";
  return { name, basename: name, path, folder, ext, size: 0, ctime: 0, mtime: 0, tags: [], links: [] };
}

interface Loaded {
  config: BaseConfig;
  spec?: SourceSpec;          // undefined for a view block with no of:/tasks: → empty state
  inlineRows: Row[] | null;
  basePath?: string;
}

/** A fully resolved base: its parsed config plus the rows the view renders. */
type LoadedRows = Loaded & { rows: Row[] };

/** Module-level SWR cache of resolved bases, shared across every BaseView instance
 *  (and across tabs/splits) so reopening a base paints instantly from the last
 *  resolution while it revalidates. Keyed by the view signature (path/source/view),
 *  invalidated by the SSE server version — see `rowCache.ts`. */
const rowCache = new RowCache<LoadedRows>();

/** Raw source editor for a base file — a textarea + Save, used by the per-view Source
 *  toggle. (Embedded ```query blocks edit their fence inline in the editor instead.) */
function SourceEditor(props: { path: string; onClose: () => void }) {
  const [text, setText] = createSignal<string | null>(null);
  let gutter: HTMLDivElement | undefined;
  onMount(async () => setText(await api.read(props.path)));
  // 1-based line numbers for the gutter. A <textarea> can't carry per-line ::before,
  // so we render a parallel gutter column and keep its scroll synced to the textarea.
  const lines = createMemo(() => Array.from({ length: (text() ?? "").split("\n").length }, (_, i) => i + 1));
  const save = async () => {
    if (text() != null) await api.write(props.path, text()!);
    props.onClose();
  };
  return (
    <div class={styles.source}>
      <Show when={text() != null} fallback={<Loading />}>
        <div class={styles.sourceEditor}>
          <div class={styles.sourceGutter} ref={gutter} aria-hidden="true">
            <Index each={lines()}>{(n) => <div>{n()}</div>}</Index>
          </div>
          <textarea
            class={styles.sourceArea}
            value={text()!}
            spellcheck={false}
            onInput={(e) => setText(e.currentTarget.value)}
            onScroll={(e) => { if (gutter) gutter.scrollTop = e.currentTarget.scrollTop; }}
          />
        </div>
      </Show>
      <div class={styles.sourceBar}>
        <TextButton onClick={save}>SAVE</TextButton>
        <TextButton onClick={props.onClose}>CANCEL</TextButton>
      </div>
    </div>
  );
}

/**
 * Unified view host. Renders any source (base / notes / tasks) as any view type.
 * Inputs (priority order): `view` (a flat ```query block spec), `path` (a `type: base` md file),
 * or `source` (inline ```query YAML).
 */
export function BaseView(props: {
  path?: string;
  source?: string;
  view?: QueryBlock;
  hostPath?: string;
  onOpen?: (path: string) => void;
  // The `path` file body, already read by FileView to branch base-vs-editor. Seeds the
  // first load so we don't re-read /file; a later refetch (e.g. after a source-edit save)
  // re-reads from disk to pick up changes.
  body?: string;
  // For an embedded ```query block: reveal the raw fence inline in the editor. When set,
  // the SOURCE icon appears even without a base file and triggers inline editing.
  embeddedSource?: { onReveal: () => void };
}) {
  // Consume the prefetched body exactly once: the initial render reuses it, any refetch
  // reads fresh from disk.
  let pendingBody = props.body;
  const [hostMeta] = createResource(
    () => props.hostPath,
    async (p) => {
      if (!p) return undefined;
      const fm = (await api.meta(p)) as Record<string, unknown>;
      // Attach the host note's file identity so an embedded base can reference it as
      // `this.file` (e.g. `file.hasLink(this.file)` for back-link filters).
      return { ...fm, file: hostFileMeta(p) };
    },
  );

  async function loadConfig(): Promise<Loaded> {
    if (props.view) {
      const v = props.view;
      const config: BaseConfig = {
        views: [
          {
            type: v.as,
            name: capitalize(v.as),
            filters: v.where,
            sort: v.sort,
            groupBy: v.group ? { property: v.group } : undefined,
            limit: v.limit,
          },
        ],
      };
      return { config, spec: v.source, inlineRows: null, basePath: v.source?.kind === "base" ? refToPath(v.source.ref) : undefined };
    }
    if (props.path) {
      // A base file is a `type: base` md note (no `.base` extension). Reuse the body
      // FileView already read on the first load; re-read on any subsequent refetch.
      const text = pendingBody ?? (await api.read(props.path));
      pendingBody = undefined;
      const name = noteLabel(props.path);
      const { config, rows } = parseBaseFile(text, { name, path: props.path });
      // No explicit source: a md base WITH an inline table renders its own rows; without
      // one (a query base — filters/views over the vault) it defaults to notes, so a query
      // base "just works" instead of rendering empty.
      const spec: SourceSpec = config.source ?? (rows.length ? { kind: "base" } : { kind: "notes" });
      return { config, spec, inlineRows: spec.kind === "base" ? rows : null, basePath: props.path };
    }
    const config = parseBase(props.source ?? "");
    return { config, spec: config.source ?? { kind: "notes" }, inlineRows: null };
  }

  const sig = createMemo(() => JSON.stringify({ p: props.path, s: props.source, v: props.view }));

  // Mark cached rows stale whenever the backend version advances (a vault change) so
  // the next resolve revalidates. The cached values stay around for an instant paint.
  createEffect(() => rowCache.invalidate(serverVersion()));

  // The resource source is the *identity* key only (path/source/view) — NOT the server
  // version. A key change is a genuinely different base, so it's fine to suspend (show a
  // skeleton). A version bump is a background revalidation of the SAME base: we drive it
  // through a transition (below) so the current tree keeps rendering while the new rows
  // load, instead of suspending to the <Suspense> fallback. That fallback swap would
  // unmount + remount full-pane views like the calendar on their own writes — resetting
  // scroll, flickering, and re-running their onMount (which re-reads the file from disk
  // and could race a not-yet-landed write). The cache + in-flight dedup keep resolves cheap.
  const [, startRevalidate] = useTransition();
  const [fetched, { refetch }] = createResource(sig, async (key) => {
    const version = serverVersion();
    // Fresh cache hit (same version, not invalidated): skip the /rows round-trip.
    if (rowCache.isFresh(key, version)) return rowCache.peek(key)!;
    const loaded = await loadConfig();
    // Single resolution path: an own-rows base already has its rows parsed client-side;
    // everything else (notes / tasks / base-ref) is resolved server-side via /rows, which
    // follows base composition + scoped tasks. No per-kind logic duplicated here anymore.
    const rows = loaded.inlineRows ?? (loaded.spec ? await api.resolveRows(loaded.spec) : []);
    const result: LoadedRows = { ...loaded, rows };
    rowCache.set(key, result, version);
    return result;
  });

  // Revalidate on a server version bump, but ONLY when the change can actually affect this
  // view's rows. Otherwise a busy vault re-resolves + re-renders every open base continuously
  // and pegs CPU — e.g. the daemon rewrites DAEMON.md every ~2s, which bumps the
  // version with { paths:[DAEMON.md], dirty:{graph:false,tree:false} } even though no base
  // cares about it. Safe-by-default: anything we can't rule out triggers a refetch. Accepted
  // revalidations run in a transition (stale-while-revalidate: prior rows stay painted, no
  // Suspense flash / full-pane remount) until the fresh resolve lands.
  //   - no dirty (poll catch-up, unknown extent) → refetch
  //   - dirty.tree (new/renamed/removed/icon note may newly match the filter) → refetch
  //   - paths empty + !tree → memory-only (3rd brain); never affects vault rows → skip
  //   - dirty.graph (a vault tag/link edit may change filter membership) → refetch
  //   - else content-only vault edit → refetch only if it touched our own rows / base / host note
  createEffect(on(serverVersion, () => {
    const d = data();
    const deps: ViewDeps | null = d
      ? {
          baseFilters: d.config.filters,
          viewFilters: d.config.views.map((v) => v.filters),
          spec: d.spec,
          relevantPaths: new Set(
            [...d.rows.map((r) => r.file.path), d.basePath, props.path, props.hostPath].filter(Boolean) as string[],
          ),
        }
      : null;
    if (changeAffectsView(lastChange(), deps)) void startRevalidate(() => refetch());
  }, { defer: true }));

  // Effective data: the freshly fetched result when available, else the last cached
  // resolution for this view (stale-while-revalidate) so a reopen/split paints instantly
  // from cache instead of blanking to a spinner while /rows runs.
  const data = createMemo<LoadedRows | undefined>(() => fetched() ?? rowCache.peek(sig()));

  const [activeView, setActiveView] = createSignal(0);
  const [sourceMode, setSourceMode] = createSignal(false);
  const [settingsMode, setSettingsMode] = createSignal(false);

  const activeType = createMemo(() => {
    const d = data();
    if (!d || d.config.views.length === 0) return "table";
    return d.config.views[Math.min(activeView(), d.config.views.length - 1)].type;
  });
  const fullPane = () => activeType() === "calendar" || activeType() === "flashcards";

  // Reconcile each freshly-computed result against the PREVIOUS one (createMemo hands us its
  // prior return value) so groups/rows that didn't change keep their object identity. Solid's
  // `<For>` keys by identity, so this is what stops a revalidation (e.g. the SSE bump after a
  // task status toggle) from unmounting+remounting every card and flickering the whole grid —
  // only the row that actually changed repaints. See reconcileRows.ts.
  const result = createMemo<ViewResult | null>((prev) => {
    const d = data();
    if (!d || fullPane()) return null;
    const idx = Math.min(activeView(), d.config.views.length - 1);
    const next = runView(d.config, d.rows, idx, hostMeta());
    return reconcileViewResult(prev ?? undefined, next);
  }, null);

  const editPath = () => data()?.basePath;
  const baseName = createMemo(() => {
    const p = editPath();
    return p ? noteLabel(p) : undefined;
  });

  return (
    <div class={styles.host}>
      <Show when={(data()?.config.views.length ?? 0) > 1 || editPath() || props.embeddedSource}>
        <ViewBar class={props.embeddedSource ? styles.embeddedBar : ""}>
          <Show when={baseName()}>{(n) => <Crumb icon="Table">{n()}</Crumb>}</Show>
          <Show when={props.embeddedSource}><span class={styles.queryLabel}>query</span></Show>
          <Show when={(data()?.config.views.length ?? 0) > 1}>
            <SegmentedToggle
              class={styles.tabs}
              value={activeView()}
              onChange={setActiveView}
              options={data()!.config.views.map((v, i) => ({ id: i, label: v.name }))}
            />
          </Show>
          <ViewBarSpacer />
          {/* SETTINGS gear sits next to SOURCE for every base type, including the
              calendar — which routes to its own settings modal (showCalendarSettings)
              instead of the generic BaseSettings overlay. SOURCE also shows for an
              embedded query (edits the fence body). */}
          <Show when={editPath()}>
            <VBtn
              icon="Settings"
              title="Settings"
              active={activeType() === "calendar" ? showCalendarSettings.value : settingsMode()}
              onClick={() => {
                if (activeType() === "calendar") showCalendarSettings.value = !showCalendarSettings.value;
                else { setSettingsMode(true); setSourceMode(false); }
              }}
            />
          </Show>
          <Show when={editPath() || props.embeddedSource}>
            <IconButton
              icon={editPath() && sourceMode() ? "X" : "Code"}
              label="Source"
              variant={editPath() && sourceMode() ? "selected" : "normal"}
              onClick={() => {
                // Embedded query: reveal the fence inline in the editor. Base file: toggle
                // the textarea source panel.
                if (props.embeddedSource) props.embeddedSource.onReveal();
                else { setSourceMode(!sourceMode()); setSettingsMode(false); }
              }}
            />
          </Show>
        </ViewBar>
      </Show>

      <div class={styles.body}>
        <Show when={sourceMode() && editPath()}>
          <SourceEditor path={editPath()!} onClose={() => { setSourceMode(false); refetch(); }} />
        </Show>
        <Show when={!sourceMode()}>
          {/* No cached/fetched data yet: show a shaped skeleton (default table outline —
              the view kind isn't known until the config parses) so the pane shows
              structure immediately instead of a bare spinner. */}
          <Show when={data()} fallback={<BaseSkeleton type="table" />}>
            <Switch
              fallback={
                <div class={styles.base}>
                  <Show when={result()} fallback={<BaseSkeleton type={activeType()} />}>
                    {(res) => (
                      <Switch
                        fallback={
                          <TableView
                            result={res()}
                            config={data()!.config}
                            onReorder={data()!.basePath ? (c) => { void api.setProperty(data()!.basePath!, "order", c).then(refetch); } : undefined}
                            widths={res().view.columnWidths}
                            onWidthsChange={data()!.basePath ? (cw) => { void api.setProperty(data()!.basePath!, "columnWidths", cw); } : undefined}
                          />
                        }
                      >
                        <Match when={res().view.type === "kanban"}>
                          <KanbanView result={res()} config={data()!.config} onChange={refetch} />
                        </Match>
                        <Match when={res().view.type === "cards"}>
                          <CardsView result={res()} config={data()!.config} />
                        </Match>
                        <Match when={res().view.type === "list"}>
                          <ListView result={res()} config={data()!.config} onChange={refetch} />
                        </Match>
                        <Match when={res().view.type === "bullets"}>
                          <BulletsView result={res()} config={data()!.config} />
                        </Match>
                        <Match when={res().view.type === "map"}>
                          <MapView result={res()} config={data()!.config} onOpen={props.onOpen} />
                        </Match>
                        <Match when={res().view.type === "heatmap"}>
                          <HeatmapView result={res()} config={data()!.config} />
                        </Match>
                        <Match when={res().view.type === "bar"}>
                          <BarView result={res()} config={data()!.config} />
                        </Match>
                        <Match when={res().view.type === "line"}>
                          <LineView result={res()} config={data()!.config} />
                        </Match>
                        <Match when={res().view.type === "stat"}>
                          <StatView result={res()} config={data()!.config} />
                        </Match>
                      </Switch>
                    )}
                  </Show>
                </div>
              }
            >
              <Match when={activeType() === "flashcards"}>
                <FlashcardsView rows={data()!.rows} config={data()!.config} basePath={data()!.basePath} onReviewed={refetch} />
              </Match>
              <Match when={activeType() === "calendar"}>
                <CalendarView basePath={data()!.basePath} onChange={refetch} />
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
          viewIdx={Math.min(activeView(), Math.max(0, data()!.config.views.length - 1))}
          basePath={data()!.basePath}
          rows={data()!.rows}
          onClose={() => setSettingsMode(false)}
          onSaved={() => { setSettingsMode(false); refetch(); }}
        />
      </Show>
    </div>
  );
}
