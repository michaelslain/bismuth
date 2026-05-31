import { createSignal, createResource, createMemo, For, Show, Switch, Match } from "solid-js";
import { api } from "../api";
import { parseBase, parseBaseFile } from "../../../core/src/bases/parse";
import { runView } from "../../../core/src/bases/query";
import type { BaseConfig, Row, ViewResult, SourceSpec, ViewBlock } from "../../../core/src/bases/types";
import { TableView } from "./TableView";
import { CardsView } from "./CardsView";
import { ListView } from "./ListView";
import { KanbanView } from "./KanbanView";
import { MapView } from "./MapView";
import { CalendarView } from "./CalendarView";
import { FlashcardsView } from "./FlashcardsView";
import { BaseSettings } from "./BaseSettings";
import { Icon } from "../icons/Icon";
import styles from "./BaseView.module.css";

interface Loaded {
  config: BaseConfig;
  spec?: SourceSpec;          // undefined for a view block with no of:/tasks: → empty state
  inlineRows: Row[] | null;
  basePath?: string;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function refToPath(ref?: string): string {
  const bare = (ref ?? "").replace(/^\[\[/, "").replace(/\]\]$/, "");
  if (!bare) return "";
  return bare.endsWith(".md") || bare.endsWith(".base") ? bare : `${bare}.md`;
}

/** Raw source editor for a base file — a textarea + Save, used by the per-view Source toggle. */
function SourceEditor(props: { path: string; onClose: () => void }) {
  const [text, setText] = createSignal<string | null>(null);
  createResource(
    () => props.path,
    async (p) => {
      setText(await api.read(p));
      return true;
    },
  );
  const save = async () => {
    if (text() != null) await api.write(props.path, text()!);
    props.onClose();
  };
  return (
    <div class={styles.source}>
      <Show when={text() != null} fallback={<div class={styles.loading}>Loading…</div>}>
        <textarea
          class={styles.sourceArea}
          value={text()!}
          spellcheck={false}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </Show>
      <div class={styles.sourceBar}>
        <button onClick={save}>Save</button>
        <button onClick={props.onClose}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Unified view host. Renders any source (base / notes / tasks) as any view type.
 * Inputs (priority order): `view` (a ```view block spec), `path` (a type:base / .base file),
 * or `source` (inline ```base YAML).
 */
export function BaseView(props: {
  path?: string;
  source?: string;
  view?: ViewBlock;
  hostPath?: string;
  onOpen?: (path: string) => void;
}) {
  const [hostMeta] = createResource(
    () => props.hostPath,
    async (p) => (p ? ((await api.meta(p)) as Record<string, unknown>) : undefined),
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
      const text = await api.read(props.path);
      if (props.path.endsWith(".base")) {
        const config = parseBase(text);
        return { config, spec: config.source ?? { kind: "notes" }, inlineRows: null, basePath: props.path };
      }
      const name = props.path.split("/").pop()!.replace(/\.md$/, "");
      const { config, rows } = parseBaseFile(text, { name, path: props.path });
      const spec: SourceSpec = config.source ?? { kind: "base" };
      return { config, spec, inlineRows: spec.kind === "base" ? rows : null, basePath: props.path };
    }
    const config = parseBase(props.source ?? "");
    return { config, spec: config.source ?? { kind: "notes" }, inlineRows: null };
  }

  // Single resolution path: an own-rows base already has its rows parsed client-side;
  // everything else (notes / tasks / base-ref) is resolved server-side via /rows, which
  // follows base composition + scoped tasks. No per-kind logic duplicated here anymore.
  async function resolveRows(spec: SourceSpec | undefined, inlineRows: Row[] | null): Promise<Row[]> {
    if (inlineRows) return inlineRows;
    if (!spec) return [];
    return api.resolveRows(spec);
  }

  const sig = createMemo(() => JSON.stringify({ p: props.path, s: props.source, v: props.view }));
  const [data, { refetch }] = createResource(sig, async () => {
    const loaded = await loadConfig();
    const rows = await resolveRows(loaded.spec, loaded.inlineRows);
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

  return (
    <div class={styles.host}>
      <Show when={(data()?.config.views.length ?? 0) > 1 || editPath()}>
        <div class={styles.bar}>
          <Show when={(data()?.config.views.length ?? 0) > 1}>
            <div class={styles.tabs}>
              <For each={data()!.config.views}>
                {(v, i) => (
                  <button
                    class={`${styles.tab} ${i() === activeView() ? styles.active : ""}`}
                    onClick={() => setActiveView(i())}
                  >
                    {v.name}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={editPath()}>
            <div class={styles.barRight}>
              <button class={styles.srcBtn} onClick={() => { setSettingsMode(!settingsMode()); setSourceMode(false); }}>
                {settingsMode() ? <><Icon value="X" size={14} /> Close</> : <><Icon value="Settings" size={14} /> Settings</>}
              </button>
              <button class={styles.srcBtn} onClick={() => { setSourceMode(!sourceMode()); setSettingsMode(false); }}>
                {sourceMode() ? <><Icon value="X" size={14} /> Close source</> : <><Icon value="Code" size={14} /> Source</>}
              </button>
            </div>
          </Show>
        </div>
      </Show>

      <div class={styles.body}>
        <Switch
          fallback={
            <Show when={data()} fallback={<div class={styles.loading}>Loading…</div>}>
              <Switch
                fallback={
                  <div class={styles.base}>
                    <Show when={result()} fallback={<div class={styles.loading}>Loading…</div>}>
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
                            <ListView result={res()} config={data()!.config} />
                          </Match>
                          <Match when={res().view.type === "map"}>
                            <MapView result={res()} config={data()!.config} onOpen={props.onOpen} />
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
          }
        >
          <Match when={sourceMode()}>
            <SourceEditor path={editPath()!} onClose={() => { setSourceMode(false); refetch(); }} />
          </Match>
          <Match when={settingsMode() && !!data()}>
            <div class={styles.base}>
              <BaseSettings
                type={activeType()}
                config={data()!.config}
                basePath={data()!.basePath}
                rows={data()!.rows}
                onSaved={() => { setSettingsMode(false); refetch(); }}
              />
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
