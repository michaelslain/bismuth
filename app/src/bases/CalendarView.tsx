import { createSignal, createMemo, For, Show } from "solid-js";
import { api } from "../api";
import type { BaseConfig, Row } from "../../../core/src/bases/types";
import { occurrencesInRange } from "../../../core/src/bases/calendarRows";
import { toDateStr, addDays } from "../../../core/src/bases/recurrence";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Month-grid calendar over a base's rows. Renders occurrences of dated rows
 * (expanding any recurrence cell), supports prev/next/today navigation, and
 * adds a new event by appending a row on the clicked day. Operates on raw rows
 * in table order so the add targets the right base file.
 *
 * Week/day time-grid + drag-to-reschedule are intentionally left to the existing
 * Calendar tab until this view is visually verified.
 */
export function CalendarView(props: {
  rows: Row[];
  config: BaseConfig;
  basePath?: string;
  onChange: () => void;
  onOpen?: (path: string) => void;
}) {
  const view = () => props.config.views[0] ?? { type: "calendar", name: "" };
  const dateField = () => view().dateField ?? "date";
  const recurrenceField = () => view().recurrenceField ?? "recurrence";
  const titleField = () => view().order?.[0] ?? "title";

  const now = new Date();
  const [cursor, setCursor] = createSignal(new Date(now.getFullYear(), now.getMonth(), 1));

  const gridStart = createMemo(() => addDays(cursor(), -cursor().getDay()));
  const days = createMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart(), i)));

  const byDate = createMemo(() => {
    const start = toDateStr(days()[0]);
    const end = toDateStr(days()[41]);
    const occ = occurrencesInRange(props.rows, { dateField: dateField(), recurrenceField: recurrenceField() }, start, end);
    const map = new Map<string, { index: number; title: string }[]>();
    for (const o of occ) {
      const r = props.rows[o.index];
      const title = String(r.note[titleField()] ?? r.note.front ?? r.note.title ?? "(untitled)");
      (map.get(o.date) ?? map.set(o.date, []).get(o.date)!).push({ index: o.index, title });
    }
    return map;
  });

  const addEvent = async (dateStr: string) => {
    if (!props.basePath) return;
    await api.rowCreate(props.basePath, { [titleField()]: "New event", [dateField()]: dateStr });
    props.onChange();
  };

  const monthLabel = () => `${MONTHS[cursor().getMonth()]} ${cursor().getFullYear()}`;
  const shift = (n: number) => setCursor(new Date(cursor().getFullYear(), cursor().getMonth() + n, 1));
  const today = toDateStr(now);

  const cell = (d: Date) => {
    const ds = toDateStr(d);
    const inMonth = d.getMonth() === cursor().getMonth();
    const events = byDate().get(ds) ?? [];
    return (
      <div
        onClick={() => addEvent(ds)}
        style={{
          "border": "1px solid var(--border, #2a2a2a)",
          "min-height": "84px",
          "padding": "4px",
          "opacity": inMonth ? "1" : "0.4",
          "background": ds === today ? "var(--accent-soft, rgba(120,120,255,0.12))" : "transparent",
          "overflow": "hidden",
          "cursor": "pointer",
        }}
      >
        <div style={{ "font-size": "11px", "opacity": "0.7", "text-align": "right" }}>{d.getDate()}</div>
        <For each={events}>
          {(e) => (
            <div
              style={{
                "background": "var(--accent, #5b7cfa)",
                "color": "#fff",
                "border-radius": "4px",
                "padding": "1px 5px",
                "margin-top": "2px",
                "font-size": "12px",
                "white-space": "nowrap",
                "overflow": "hidden",
                "text-overflow": "ellipsis",
              }}
            >
              {e.title}
            </div>
          )}
        </For>
      </div>
    );
  };

  return (
    <div style={{ padding: "8px", height: "100%", display: "flex", "flex-direction": "column" }}>
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "8px" }}>
        <button onClick={() => shift(-1)}>‹</button>
        <button onClick={() => setCursor(new Date(now.getFullYear(), now.getMonth(), 1))}>Today</button>
        <button onClick={() => shift(1)}>›</button>
        <strong style={{ "margin-left": "8px" }}>{monthLabel()}</strong>
        <Show when={!props.basePath}>
          <span style={{ "margin-left": "auto", opacity: "0.6", "font-size": "12px" }}>read-only (no base file)</span>
        </Show>
      </div>
      <div style={{ display: "grid", "grid-template-columns": "repeat(7, 1fr)" }}>
        <For each={DOW}>{(d) => <div style={{ "text-align": "center", "font-size": "11px", opacity: "0.7", padding: "2px" }}>{d}</div>}</For>
      </div>
      <div style={{ display: "grid", "grid-template-columns": "repeat(7, 1fr)", "grid-auto-rows": "1fr", flex: "1" }}>
        <For each={days()}>{(d) => cell(d)}</For>
      </div>
    </div>
  );
}
