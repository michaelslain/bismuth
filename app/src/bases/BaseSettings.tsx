import { createSignal, createMemo, For, Show } from "solid-js";
import { api } from "../api";
import type { BaseConfig, Row, ViewType } from "../../../core/src/bases/types";
import { capitalize, columnLabel } from "./renderValue";
import { TextButton } from "../ui/TextButton";
import { Field } from "../ui/Field";

interface FieldDef {
  key: string;
  label: string;
  def: string;
}

// Chart views (heatmap/bar/line/stat) all bind the same axis columns.
const CHART_FIELDS: FieldDef[] = [
  { key: "x", label: "X axis column (date or category)", def: "date" },
  { key: "y", label: "Value column (blank = count rows)", def: "" },
];

// Field-binding settings for non-tabular view types (which column means what).
const FIELDS_BY_TYPE: Partial<Record<ViewType, FieldDef[]>> = {
  flashcards: [
    { key: "frontField", label: "Front column", def: "front" },
    { key: "backField", label: "Back column", def: "back" },
    { key: "dueField", label: "Due column", def: "due" },
  ],
  calendar: [
    { key: "dateField", label: "Date column", def: "date" },
    { key: "startTimeField", label: "Start-time column", def: "startTime" },
    { key: "endTimeField", label: "End-time column", def: "endTime" },
    { key: "recurrenceField", label: "Recurrence column", def: "recurrence" },
    { key: "categoryField", label: "Category column", def: "category" },
  ],
  heatmap: CHART_FIELDS,
  bar: CHART_FIELDS,
  line: CHART_FIELDS,
  stat: CHART_FIELDS,
};

// Record view types get column-visibility + sort + group-by config.
const RECORD_TYPES: ViewType[] = ["table", "cards", "list", "kanban", "map"];

// Chart view types get aggregate + date-bucket config.
const CHART_TYPES: ViewType[] = ["heatmap", "bar", "line", "stat"];

function columnsOf(rows: Row[]): string[] {
  const set = new Set<string>();
  let hasName = false;
  for (const r of rows) {
    Object.keys(r.note).forEach((k) => set.add(k));
    if (r.file?.name) hasName = true;
  }
  const cols = [...set];
  return hasName ? ["file.name", ...cols] : cols;
}

export function BaseSettings(props: {
  type: ViewType;
  config: BaseConfig;
  basePath?: string;
  rows: Row[];
  onSaved: () => void;
}) {
  const view = () => props.config.views[0];
  const isRecord = () => RECORD_TYPES.includes(props.type);
  const isChart = () => CHART_TYPES.includes(props.type);
  const fields = () => FIELDS_BY_TYPE[props.type] ?? [];

  // --- field-binding form (flashcards / calendar) ---
  const seedFields = (): Record<string, string> => {
    const v = (view() ?? {}) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const f of fields()) out[f.key] = (v[f.key] as string) ?? f.def;
    return out;
  };
  const [form, setForm] = createSignal<Record<string, string>>(seedFields());

  // --- record form (columns / sort / group) ---
  const allCols = createMemo(() => columnsOf(props.rows));
  const seedCols = (): { col: string; visible: boolean }[] => {
    const ord = view()?.order;
    const all = allCols();
    if (ord && ord.length) {
      const inOrder = ord.filter((c) => all.includes(c)).map((c) => ({ col: c, visible: true }));
      const rest = all.filter((c) => !ord.includes(c)).map((c) => ({ col: c, visible: false }));
      return [...inOrder, ...rest];
    }
    return all.map((c) => ({ col: c, visible: true }));
  };
  const [cols, setCols] = createSignal(seedCols());
  const [sortProp, setSortProp] = createSignal(view()?.sort?.[0]?.property ?? "");
  const [sortDir, setSortDir] = createSignal(view()?.sort?.[0]?.direction ?? "ASC");
  const [groupProp, setGroupProp] = createSignal(view()?.groupBy?.property ?? "");
  const [groupDir, setGroupDir] = createSignal(view()?.groupBy?.direction ?? "ASC");
  const [aggregate, setAggregate] = createSignal<"sum" | "avg" | "count" | "min" | "max">(view()?.aggregate ?? (view()?.y ? "sum" : "count"));
  const [bin, setBin] = createSignal<"day" | "week" | "month">(view()?.bin ?? "day");

  const visibleCount = () => cols().filter((c) => c.visible).length;

  const toggle = (i: number) => {
    const arr = [...cols()];
    // Never allow hiding the LAST visible column. A zero-column table is useless, and
    // because an empty `order` means "no preference → show all" (query.ts), hiding the
    // last column would paradoxically show every column instead of none.
    if (arr[i].visible && visibleCount() <= 1) return;
    arr[i] = { ...arr[i], visible: !arr[i].visible };
    setCols(arr);
  };

  const save = async () => {
    if (props.basePath) {
      if (isRecord()) {
        await api.setProperty(props.basePath, "order", cols().filter((c) => c.visible).map((c) => c.col));
        await api.setProperty(props.basePath, "sort", sortProp() ? [{ property: sortProp(), direction: sortDir() }] : []);
        await api.setProperty(props.basePath, "groupBy", groupProp() ? { property: groupProp(), direction: groupDir() } : null);
      } else {
        for (const f of fields()) await api.setProperty(props.basePath, f.key, form()[f.key]);
        if (isChart()) {
          await api.setProperty(props.basePath, "aggregate", aggregate());
          if (props.type !== "heatmap") await api.setProperty(props.basePath, "bin", bin());
        }
      }
    }
    props.onSaved();
  };

  return (
    <div class="srs-panel">
      <h3>{`${capitalize(props.type)} settings`}</h3>

      {/* Field-binding types: flashcards / calendar */}
      <Show when={fields().length > 0}>
        <div class="srs-grid">
          <For each={fields()}>
            {(f) => (
              <Field class="srs-field" label={f.label}>
                <input type="text" value={form()[f.key]} placeholder={f.def} onInput={(e) => setForm({ ...form(), [f.key]: e.currentTarget.value })} />
              </Field>
            )}
          </For>
        </div>
        <Show when={props.type === "flashcards"}>
          <p class="ui-empty" style={{ "font-size": "12px" }}>
            Scheduling uses the standard SM-2 algorithm (fixed, not configurable). Use <strong>Cram</strong> in the deck to review everything without affecting scheduling.
          </p>
        </Show>
      </Show>

      {/* Chart types: aggregate + (non-heatmap) date bucket */}
      <Show when={isChart()}>
        <div class="srs-grid">
          <Field class="srs-field" label="Aggregate">
            <select value={aggregate()} onChange={(e) => setAggregate(e.currentTarget.value as "sum" | "avg" | "count" | "min" | "max")}>
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
              <option value="count">Count</option>
              <option value="min">Min</option>
              <option value="max">Max</option>
            </select>
          </Field>
          <Show when={props.type !== "heatmap"}>
            <Field class="srs-field" label="Date bucket">
              <select value={bin()} onChange={(e) => setBin(e.currentTarget.value as "day" | "week" | "month")}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </Field>
          </Show>
        </div>
      </Show>

      {/* Record types: columns + sort + group */}
      <Show when={isRecord()}>
        <div class="vs-section">
          <h4>Columns</h4>
          <p class="ui-empty" style={{ "font-size": "12px" }}>Check to show or hide. Drag the column headers in the table to reorder.</p>
          <For each={cols()}>
            {(item, i) => (
              <label class="vs-check">
                <input
                  type="checkbox"
                  checked={item.visible}
                  disabled={item.visible && visibleCount() <= 1}
                  title={item.visible && visibleCount() <= 1 ? "At least one column must stay visible" : undefined}
                  onChange={() => toggle(i())}
                />
                {columnLabel(item.col, props.config)}
              </label>
            )}
          </For>
        </div>

        <div class="srs-grid">
          <Field class="srs-field" label="Sort by">
            <select value={sortProp()} onChange={(e) => setSortProp(e.currentTarget.value)}>
              <option value="">None</option>
              <For each={allCols()}>{(c) => <option value={c}>{columnLabel(c, props.config)}</option>}</For>
            </select>
          </Field>
          <Field class="srs-field" label="Sort direction">
            <select value={sortDir()} onChange={(e) => setSortDir(e.currentTarget.value as "ASC" | "DESC")}>
              <option value="ASC">Ascending</option>
              <option value="DESC">Descending</option>
            </select>
          </Field>
          <Field class="srs-field" label="Group by">
            <select value={groupProp()} onChange={(e) => setGroupProp(e.currentTarget.value)}>
              <option value="">None</option>
              <For each={allCols()}>{(c) => <option value={c}>{columnLabel(c, props.config)}</option>}</For>
            </select>
          </Field>
          <Show when={groupProp()}>
            <Field class="srs-field" label="Group direction">
              <select value={groupDir()} onChange={(e) => setGroupDir(e.currentTarget.value as "ASC" | "DESC")}>
                <option value="ASC">Ascending</option>
                <option value="DESC">Descending</option>
              </select>
            </Field>
          </Show>
        </div>
      </Show>

      <Show when={!isRecord() && !isChart() && fields().length === 0}>
        <p class="ui-empty">No extra settings for this view type yet.</p>
      </Show>

      <div class="grade-row">
        <TextButton onClick={save}>SAVE</TextButton>
        <TextButton onClick={props.onSaved}>CLOSE</TextButton>
      </div>
    </div>
  );
}
