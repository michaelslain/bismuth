import { createSignal, createResource, createMemo, For, Show, Switch, Match } from "solid-js";
import { api } from "../api";
import { parseBase, parseBaseFile } from "../../../core/src/bases/parse";
import { runView } from "../../../core/src/bases/query";
import { passesFilter } from "../../../core/src/bases/filters";
import { taskToRow, filterTaskRows } from "../../../core/src/bases/taskRow";
import type { BaseConfig, Row, ViewResult, SourceSpec, ViewBlock } from "../../../core/src/bases/types";
import { TableView } from "./TableView";
import { CardsView } from "./CardsView";
import { ListView } from "./ListView";
import { KanbanView } from "./KanbanView";
import { MapView } from "./MapView";
import styles from "./BaseView.module.css";

interface Loaded {
  config: BaseConfig;
  spec: SourceSpec;
  inlineRows: Row[] | null; // own table rows for a base source; null otherwise
  basePath?: string; // the base file to write row mutations back to
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function refToPath(ref?: string): string {
  const bare = (ref ?? "").replace(/^\[\[/, "").replace(/\]\]$/, "");
  if (!bare) return "";
  return bare.endsWith(".md") || bare.endsWith(".base") ? bare : `${bare}.md`;
}

/**
 * Unified view host. Renders any source (base / notes / tasks) as any view type.
 * Inputs (mutually exclusive, in priority order):
 *   - `view`:   a parsed ```view block spec
 *   - `path`:   a `type: base` .md file (own table rows) or a legacy .base file (notes query)
 *   - `source`: inline ```base YAML (legacy; queries notes)
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
      return { config, spec: v.source, inlineRows: null, basePath: v.source.kind === "base" ? refToPath(v.source.ref) : undefined };
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

  async function resolveRows(spec: SourceSpec, inlineRows: Row[] | null): Promise<Row[]> {
    const today = new Date().toISOString().slice(0, 10);
    if (spec.kind === "tasks") {
      const rows = (await api.tasks()).map(taskToRow);
      return spec.where ? filterTaskRows(rows, spec.where, today) : rows;
    }
    if (spec.kind === "notes") {
      const rows = await api.vaultData();
      if (!spec.where) return rows;
      return rows.filter((r) => passesFilter(spec.where!, { file: r.file, note: r.note, formula: r.formula }));
    }
    // base
    if (inlineRows) return inlineRows;
    const path = refToPath(spec.ref);
    if (!path) return [];
    return (await api.base(path)).rows;
  }

  const sig = createMemo(() => JSON.stringify({ p: props.path, s: props.source, v: props.view }));
  const [data, { refetch }] = createResource(sig, async () => {
    const loaded = await loadConfig();
    const rows = await resolveRows(loaded.spec, loaded.inlineRows);
    return { ...loaded, rows };
  });

  const [activeView, setActiveView] = createSignal(0);

  const result = createMemo<ViewResult | null>(() => {
    const d = data();
    if (!d) return null;
    const idx = Math.min(activeView(), d.config.views.length - 1);
    return runView(d.config, d.rows, idx, hostMeta());
  });

  return (
    <div class={styles.base}>
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
      <Show when={result()} fallback={<div class={styles.loading}>Loading…</div>}>
        {(res) => (
          <Switch fallback={<TableView result={res()} config={data()!.config} />}>
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
  );
}
