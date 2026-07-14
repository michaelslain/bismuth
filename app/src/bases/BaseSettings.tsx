import { createSignal, createMemo, For, Show } from "solid-js";
import { api } from "../api";
import type { BaseConfig, BasePropertyKind, NumberFormat, Row, ViewType } from "../../../core/src/bases/types";
import { BASE_PROPERTY_KINDS, NUMBER_FORMATS } from "../../../core/src/bases/types";
import { fileBasename as noteLabel } from "../../../core/src/pathUtils";
import { capitalize } from "./renderValue";
import { columnLabel } from "./columnLabel";
import { declaredPropertyKeys } from "../../../core/src/bases/properties";
import {
  blankPropertyRow,
  buildPropertiesYaml,
  moveRow,
  seedPropertyRows,
  type PropertyFormRow,
} from "./basePropertiesForm";
import { Modal } from "../ui/Modal";
import { Icon } from "../icons/Icon";
import { Select } from "../ui/Select";
import { TextInput } from "../ui/TextInput";
import { TextButton } from "../ui/TextButton";
import { IconTextButton } from "../ui/IconTextButton";
// Shares the calendar settings modal chrome (.evm-modal / .set-*).
import "../calendar/Calendar.css";

interface FieldDef {
  key: string;
  /** Short role label shown next to the column dropdown. */
  role: string;
  icon: string;
  def: string;
  /** Optional fields offer a "Not set" choice. */
  optional?: boolean;
  span?: boolean;
  hint: string;
}

// Chart views (heatmap/bar/line/stat) all bind the same axis columns.
const CHART_FIELDS: FieldDef[] = [
  { key: "x", role: "X axis", icon: "calendar", def: "date", hint: "Column plotted along the X axis — a date or a category." },
  { key: "y", role: "Value", icon: "hash", def: "", optional: true, hint: "Numeric column to aggregate. Leave unset to count rows." },
];

// Field-binding settings for non-tabular view types (which column means what).
const FIELDS_BY_TYPE: Partial<Record<ViewType, FieldDef[]>> = {
  flashcards: [
    { key: "frontField", role: "Front", icon: "circle-question-mark", def: "front", hint: "Column shown as the card front (the prompt)." },
    { key: "backField", role: "Back", icon: "circle-check", def: "back", hint: "Column revealed as the answer." },
    { key: "dueField", role: "Due", icon: "calendar-clock", def: "due", span: true, hint: "Column holding each card's next-review date." },
  ],
  heatmap: CHART_FIELDS,
  bar: CHART_FIELDS,
  line: CHART_FIELDS,
  stat: CHART_FIELDS,
};

// Record view types get column-visibility + sort + group-by config.
const RECORD_TYPES: ViewType[] = ["table", "cards", "list", "bullets", "kanban", "map"];

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

const AGG_OPTS = [
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "count", label: "Count" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
];
const BIN_OPTS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const DIR_OPTS = [
  { value: "ASC", label: "Ascending" },
  { value: "DESC", label: "Descending" },
];

// Properties section (#104): kind + number-format pickers.
const KIND_OPTS = BASE_PROPERTY_KINDS.map((k) => ({ value: k, label: capitalize(k) }));
const NUMBER_FORMAT_OPTS = NUMBER_FORMATS.map((f) => ({ value: f, label: capitalize(f) }));

/**
 * Per-view settings as a modal overlay — same chrome as the calendar's
 * CalendarSettings (`.evm-modal`), so every base type shares one polished design:
 * header / sectioned body with `Select` dropdowns / footer with RESET + CANCEL + SAVE.
 * Floats over the live view instead of replacing it.
 */
export function BaseSettings(props: {
  type: ViewType;
  config: BaseConfig;
  /** Index of the view these settings edit — the active view, not always the first. */
  viewIdx: number;
  basePath?: string;
  rows: Row[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const view = () => props.config.views[props.viewIdx];
  const isRecord = () => RECORD_TYPES.includes(props.type);
  const isChart = () => CHART_TYPES.includes(props.type);
  const fields = () => FIELDS_BY_TYPE[props.type] ?? [];

  // Row-derived columns unioned with the base's own declared properties (list-form
  // `properties:`), so a declared-but-not-yet-populated field is still offerable.
  const allCols = createMemo(() => [...new Set([...columnsOf(props.rows), ...declaredPropertyKeys(props.config)])]);

  // Options for a column-binding dropdown: the available columns, always unioned
  // with the field's current value + default so an off-screen binding still shows.
  const colOptions = (f: FieldDef, current: string) => {
    const seen = new Set(allCols());
    const extra = [current, f.def].filter((c) => c && !seen.has(c));
    return [
      ...(f.optional ? [{ value: "", label: "Count rows" }] : []),
      ...allCols().map((c) => ({ value: c, label: c })),
      ...extra.map((c) => ({ value: c, label: c })),
    ];
  };

  // --- field-binding form (flashcards / chart axes) ---
  const seedFields = (): Record<string, string> => {
    const v = (view() ?? {}) as unknown as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const f of fields()) out[f.key] = (v[f.key] as string) ?? f.def;
    return out;
  };
  const [form, setForm] = createSignal<Record<string, string>>(seedFields());
  // Flashcards: review every card both ways (front→back AND back→front), each direction
  // scheduled independently in `*Back` companion columns.
  const [bidi, setBidi] = createSignal<boolean>(!!view()?.bidirectional);

  // --- record form (columns / sort / group) ---
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

  // None + every column, for sort/group dropdowns.
  const propOptions = createMemo(() => [
    { value: "", label: "None" },
    ...allCols().map((c) => ({ value: c, label: columnLabel(c, props.config) })),
  ]);

  // --- properties form (#104: define the base's OWN declared property set) ---
  // Base-level, not per-view — shown regardless of `props.type`. Seeded ONLY from an
  // existing list-form declaration (`declaredProperties`); a base using classic map-form
  // metadata (or no `properties:` at all) starts from an empty list so the panel never
  // surfaces entries it can't losslessly round-trip as a list. `hadDeclared` is captured
  // once (not reactive) so save() only rewrites `properties:` when there's something to
  // write — either the base already declared a list, or the user added one here — instead
  // of clobbering an untouched map-form base with an empty list on every unrelated save.
  const hadDeclared = props.config.declaredProperties !== undefined;
  const [propRows, setPropRows] = createSignal<PropertyFormRow[]>(seedPropertyRows(props.config));
  const updateRow = (i: number, patch: Partial<PropertyFormRow>) =>
    setPropRows(propRows().map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addPropRow = () => setPropRows([...propRows(), blankPropertyRow(propRows().map((r) => r.name))]);
  const removePropRow = (i: number) => setPropRows(propRows().filter((_, idx) => idx !== i));

  const reset = () => {
    setForm(Object.fromEntries(fields().map((f) => [f.key, f.def])));
    setCols(allCols().map((c) => ({ col: c, visible: true })));
    setSortProp("");
    setSortDir("ASC");
    setGroupProp("");
    setGroupDir("ASC");
    setAggregate(view()?.y ? "sum" : "count");
    setBin("day");
    setPropRows(seedPropertyRows(props.config));
  };

  const save = async () => {
    if (props.basePath) {
      if (isRecord()) {
        await api.setProperty(props.basePath, "order", cols().filter((c) => c.visible).map((c) => c.col));
        await api.setProperty(props.basePath, "sort", sortProp() ? [{ property: sortProp(), direction: sortDir() }] : []);
        await api.setProperty(props.basePath, "groupBy", groupProp() ? { property: groupProp(), direction: groupDir() } : null);
      } else {
        for (const f of fields()) await api.setProperty(props.basePath, f.key, form()[f.key]);
        if (props.type === "flashcards") await api.setProperty(props.basePath, "bidirectional", bidi());
        if (isChart()) {
          await api.setProperty(props.basePath, "aggregate", aggregate());
          if (props.type !== "heatmap") await api.setProperty(props.basePath, "bin", bin());
        }
      }
      if (hadDeclared || propRows().length > 0) {
        await api.setProperty(props.basePath, "properties", buildPropertiesYaml(propRows()));
      }
    }
    props.onSaved();
  };

  return (
    <Modal onClose={props.onClose} class="base-settings evm-modal">
      <div class="evm-head">
        <div class="evm-mark"><Icon value="sliders-horizontal" size={18} /></div>
        <div class="evm-htext">
          <div class="evm-title">{capitalize(props.type)} settings</div>
          <Show when={props.basePath}>{(p) => <div class="evm-sub">{noteLabel(p())}</div>}</Show>
        </div>
        <div class="evm-x" role="button" aria-label="Close" onClick={props.onClose}><Icon value="x" size={16} /></div>
      </div>

      <div class="evm-body">
        {/* Field-binding types: flashcards / chart axes */}
        <Show when={fields().length > 0}>
          <div class="set-sect">Column mapping</div>
          <div class="set-grid">
            <For each={fields()}>{(f) => (
              <div class={"set-field" + (f.span ? " span" : "")}>
                <div class="set-lab">
                  <Icon value={f.icon} size={14} strokeWidth={2} />{f.role} column
                  {f.optional ? <span class="opt">optional</span> : <span class="req">required</span>}
                </div>
                <Select
                  value={form()[f.key] ?? ""}
                  options={colOptions(f, form()[f.key] ?? "")}
                  placeholder={f.optional ? "Count rows" : "Not set"}
                  onChange={(c) => setForm({ ...form(), [f.key]: c })}
                />
                <div class="set-hint">{f.hint}</div>
              </div>
            )}</For>
          </div>
          <Show when={props.type === "flashcards"}>
            <div class="set-col" onClick={() => setBidi(!bidi())} style={{ "margin-top": "8px" }}>
              <span class="set-col-name">Bidirectional — review each card both ways (front ↔ back)</span>
              <span class={"evm-toggle" + (bidi() ? " on" : "")}><i /></span>
            </div>
            <div class="set-hint">
              Scheduling uses the standard SM-2 algorithm (fixed, not configurable). Use <strong>Cram</strong> in the deck to review everything without affecting scheduling.
              <Show when={bidi()}> Each direction is scheduled independently (reverse state lives in <code>dueBack</code> / <code>easeBack</code> / <code>intervalBack</code>).</Show>
            </div>
          </Show>
        </Show>

        {/* Chart types: aggregate + (non-heatmap) date bucket */}
        <Show when={isChart()}>
          <div class="set-sect">Aggregation</div>
          <div class="set-grid">
            <div class="set-field">
              <div class="set-lab"><Icon value="sigma" size={14} strokeWidth={2} />Aggregate</div>
              <Select value={aggregate()} options={AGG_OPTS} onChange={(v) => setAggregate(v as "sum" | "avg" | "count" | "min" | "max")} />
              <div class="set-hint">How values are combined per X-axis bucket.</div>
            </div>
            <Show when={props.type !== "heatmap"}>
              <div class="set-field">
                <div class="set-lab"><Icon value="calendar-days" size={14} strokeWidth={2} />Date bucket</div>
                <Select value={bin()} options={BIN_OPTS} onChange={(v) => setBin(v as "day" | "week" | "month")} />
                <div class="set-hint">Group date values by day, week, or month.</div>
              </div>
            </Show>
          </div>
        </Show>

        {/* Record types: columns + sort + group */}
        <Show when={isRecord()}>
          <div class="set-sect">Columns</div>
          <div class="set-hint">Toggle to show or hide. Drag the column headers in the table to reorder.</div>
          <div class="set-cols">
            <For each={cols()}>{(item, i) => {
              const locked = () => item.visible && visibleCount() <= 1;
              return (
                <div
                  class="set-col"
                  classList={{ off: !item.visible, locked: locked() }}
                  title={locked() ? "At least one column must stay visible" : undefined}
                  onClick={() => toggle(i())}
                >
                  <span class="set-col-name">{columnLabel(item.col, props.config)}</span>
                  <span class={"evm-toggle" + (item.visible ? " on" : "")}><i /></span>
                </div>
              );
            }}</For>
          </div>

          <div class="set-sect">Sort &amp; group</div>
          <div class="set-grid">
            <div class="set-field">
              <div class="set-lab"><Icon value="arrow-down-up" size={14} strokeWidth={2} />Sort by</div>
              <Select value={sortProp()} options={propOptions()} placeholder="None" onChange={setSortProp} />
            </div>
            <Show when={sortProp()}>
              <div class="set-field">
                <div class="set-lab"><Icon value="arrow-down" size={14} strokeWidth={2} />Sort direction</div>
                <Select value={sortDir()} options={DIR_OPTS} onChange={(v) => setSortDir(v as "ASC" | "DESC")} />
              </div>
            </Show>
            <div class="set-field">
              <div class="set-lab"><Icon value="group" size={14} strokeWidth={2} />Group by</div>
              <Select value={groupProp()} options={propOptions()} placeholder="None" onChange={setGroupProp} />
            </div>
            <Show when={groupProp()}>
              <div class="set-field">
                <div class="set-lab"><Icon value="arrow-down" size={14} strokeWidth={2} />Group direction</div>
                <Select value={groupDir()} options={DIR_OPTS} onChange={(v) => setGroupDir(v as "ASC" | "DESC")} />
              </div>
            </Show>
          </div>
        </Show>

        {/* Properties: the base's OWN declared property set — base-level, shown for every
            view type (#104). Each row: name, type, visibility, reorder, delete, plus an
            optional second line of type-specific fields. */}
        <div class="set-sect">Properties</div>
        <div class="set-hint">
          Declare this base's own fields — name, type, and whether it shows on cards/table. Order here drives card/table field order.
        </div>
        <Show when={propRows().length > 0}>
          <div class="propset-group">
            <For each={propRows()}>{(row, i) => (
              <div class="propset-row">
                <div class="propset-main">
                  <TextInput class="propset-name" value={row.name} placeholder="Property name" onInput={(v) => updateRow(i(), { name: v })} />
                  <Select class="propset-type" value={row.kind} options={KIND_OPTS} onChange={(v) => updateRow(i(), { kind: v as BasePropertyKind })} />
                  <div
                    class="propset-vis"
                    title={row.hidden ? "Hidden from cards/table — click to show" : "Visible on cards/table — click to hide"}
                    onClick={() => updateRow(i(), { hidden: !row.hidden })}
                  >
                    <span class="propset-vis-lab">{row.hidden ? "Hidden" : "Visible"}</span>
                    <span class={"evm-toggle" + (row.hidden ? "" : " on")}><i /></span>
                  </div>
                  <button type="button" class="propset-btn" disabled={i() === 0} aria-label="Move up" onClick={() => setPropRows(moveRow(propRows(), i(), -1))}>
                    <Icon value="ArrowUp" size={13} />
                  </button>
                  <button type="button" class="propset-btn" disabled={i() === propRows().length - 1} aria-label="Move down" onClick={() => setPropRows(moveRow(propRows(), i(), 1))}>
                    <Icon value="ArrowDown" size={13} />
                  </button>
                  <button type="button" class="propset-btn del" aria-label={`Remove ${row.name || "property"}`} onClick={() => removePropRow(i())}>
                    <Icon value="Trash2" size={13} />
                  </button>
                </div>

                <Show when={row.kind === "select" || row.kind === "multiselect"}>
                  <TextInput
                    class="propset-extra propset-options"
                    multiline
                    value={row.optionsText}
                    placeholder="Options — one per line or comma-separated (e.g. todo, doing, done)"
                    onInput={(v) => updateRow(i(), { optionsText: v })}
                  />
                </Show>

                <Show when={row.kind === "number"}>
                  <div class="propset-extra propset-numrow">
                    <Select value={row.number} options={NUMBER_FORMAT_OPTS} onChange={(v) => updateRow(i(), { number: v as NumberFormat })} />
                    <Show when={row.number === "unit" || row.number === "currency"}>
                      <TextInput
                        value={row.unit}
                        placeholder={row.number === "currency" ? "Currency code (e.g. USD)" : "Unit label (e.g. kg)"}
                        onInput={(v) => updateRow(i(), { unit: v })}
                      />
                    </Show>
                  </div>
                </Show>

                <Show when={row.kind === "formula"}>
                  <TextInput class="propset-extra" value={row.expr} placeholder="Expression, e.g. note.qty * note.price" onInput={(v) => updateRow(i(), { expr: v })} />
                </Show>

                <Show when={row.kind !== "formula"}>
                  <TextInput class="propset-extra" value={row.defaultText} placeholder="Default value (optional)" onInput={(v) => updateRow(i(), { defaultText: v })} />
                </Show>
              </div>
            )}</For>
          </div>
        </Show>
        <div class="propset-add">
          <IconTextButton icon="Plus" size="sm" onClick={addPropRow}>ADD PROPERTY</IconTextButton>
        </div>
      </div>

      <div class="evm-foot">
        <span class="hintkey"><b>esc</b> to close</span>
        <IconTextButton icon="RotateCcw" size="sm" iconSize={13} onClick={reset} style={{ "margin-left": "14px" }}>RESET</IconTextButton>
        <div class="sp" />
        <TextButton size="sm" onClick={props.onClose}>CANCEL</TextButton>
        <IconTextButton icon="Check" size="sm" variant="selected" onClick={save}>SAVE</IconTextButton>
      </div>
    </Modal>
  );
}
