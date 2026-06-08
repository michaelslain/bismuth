import { createSignal, createResource, createMemo, onMount, Show, Switch, Match, Index } from "solid-js";
import { api } from "../api";
import { parseBase, parseBaseFile } from "../../../core/src/bases/parse";
import { runView } from "../../../core/src/bases/query";
import { refToPath } from "../../../core/src/bases/sourceSpec";
import type { BaseConfig, Row, ViewResult, SourceSpec, QueryBlock, FileMeta } from "../../../core/src/bases/types";
import { TableView } from "./TableView";
import { CardsView } from "./CardsView";
import { ListView } from "./ListView";
import { KanbanView } from "./KanbanView";
import { MapView } from "./MapView";
import { HeatmapView } from "./HeatmapView";
import { BarView } from "./BarView";
import { LineView } from "./LineView";
import { StatView } from "./StatView";
import { CalendarView } from "./CalendarView";
import { FlashcardsView } from "./FlashcardsView";
import { BaseSettings } from "./BaseSettings";
import { capitalize } from "./renderValue";
import { TextButton } from "../ui/TextButton";
import { IconButton } from "../ui/IconButton";
import { SegmentedToggle } from "../ui/SegmentedToggle";
import { ViewBar, Crumb, ViewBarSpacer, VBtn } from "../ui/ViewBar";
import { Loading } from "../ui/EmptyState";
import styles from "./BaseView.module.css";

function noteLabel(path: string) { return path.split("/").pop()!.replace(/\.(base|md)$/, ""); }

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
  // For an embedded ```query block: reveal the raw fence inline in the editor. When set,
  // the SOURCE icon appears even without a base file and triggers inline editing.
  embeddedSource?: { onReveal: () => void };
}) {
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
      // A base file is a `type: base` md note (no `.base` extension).
      const text = await api.read(props.path);
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
  const [data, { refetch }] = createResource(sig, async () => {
    const loaded = await loadConfig();
    // Single resolution path: an own-rows base already has its rows parsed client-side;
    // everything else (notes / tasks / base-ref) is resolved server-side via /rows, which
    // follows base composition + scoped tasks. No per-kind logic duplicated here anymore.
    const rows = loaded.inlineRows ?? (loaded.spec ? await api.resolveRows(loaded.spec) : []);
    return { ...loaded, rows };
  });

  const [activeView, setActiveView] = createSignal(0);
  const [sourceMode, setSourceMode] = createSignal(false);
  const [settingsMode, setSettingsMode] = createSignal(false);

  const activeType = createMemo(() => {
    const d = data();
    if (!d || d.config.views.length === 0) return "table";
    return d.config.views[Math.min(activeView(), d.config.views.length - 1)].type;
  });
  const fullPane = () => activeType() === "calendar" || activeType() === "flashcards";

  const result = createMemo<ViewResult | null>(() => {
    const d = data();
    if (!d || fullPane()) return null;
    const idx = Math.min(activeView(), d.config.views.length - 1);
    return runView(d.config, d.rows, idx, hostMeta());
  });

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
          {/* SETTINGS opens a modal overlay (same chrome as the calendar's own settings).
              Calendar has its own settings in its toolbar. SOURCE also shows for an
              embedded query (edits the fence body). */}
          <Show when={editPath() && activeType() !== "calendar"}>
            <VBtn
              icon="Settings"
              title="Settings"
              active={settingsMode()}
              onClick={() => { setSettingsMode(true); setSourceMode(false); }}
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
          <Show when={data()} fallback={<Loading />}>
            <Switch
              fallback={
                <div class={styles.base}>
                  <Show when={result()} fallback={<Loading />}>
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
          basePath={data()!.basePath}
          rows={data()!.rows}
          onClose={() => setSettingsMode(false)}
          onSaved={() => { setSettingsMode(false); refetch(); }}
        />
      </Show>
    </div>
  );
}
