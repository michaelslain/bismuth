import { For, Show, createMemo } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { buildChartData, buildHeatmapWeeks } from "../../../core/src/bases/chart";
import { todayISO, addDaysISO } from "../../../core/src/dates";
import styles from "./Charts.module.css";

// Five teal intensity levels from the design (low → high), built from the --teal
// category token so they re-tint when the theme changes.
const SHADES = [
  "color-mix(in srgb, var(--teal) 28%, transparent)",
  "color-mix(in srgb, var(--teal) 50%, transparent)",
  "color-mix(in srgb, var(--teal) 75%, transparent)",
  "var(--teal)",
];
// Empty cells use --surface-2 (matches the .cell base in Charts.module.css).
const EMPTY_CELL = "var(--surface-2, #1a1a22)";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function HeatmapView(props: { result: ViewResult; config: BaseConfig }) {
  const rows = createMemo<Row[]>(() => props.result.groups.flatMap((g) => g.rows));
  // The heatmap is always day-binned (a calendar grid), regardless of the view's bin setting.
  const data = createMemo(() => buildChartData(rows(), { ...props.result.view, bin: "day" }));
  const grid = createMemo(() => buildHeatmapWeeks(data().points));

  const color = (v: number | null): string => {
    if (v === null) return EMPTY_CELL;
    const { min, max } = data();
    const t = max === min ? 1 : (v - min) / (max - min);
    return SHADES[Math.min(SHADES.length - 1, Math.floor(t * SHADES.length))];
  };

  // One label per week column: the month name when this column is the first to
  // fall in a new month, blank otherwise (GitHub-style sparse month row).
  const monthLabels = createMemo<string[]>(() => {
    let prev = -1;
    return grid().weeks.map((week) => {
      const iso = week[0]?.date;
      if (!iso) return "";
      const m = Number(iso.slice(5, 7)) - 1;
      if (m === prev) return "";
      prev = m;
      return MONTH_NAMES[m] ?? "";
    });
  });

  // Streak stat cards (entries / current streak / longest streak) over the
  // day-binned points. A day "counts" when it has a value > 0.
  const streaks = createMemo(() => {
    const days = data().points.filter((p) => p.date && p.value > 0);
    const entries = days.length;
    const dates = days.map((p) => p.date as string).sort();
    let longest = 0;
    let current = 0;
    let prev: string | null = null;
    const nextDay = (iso: string) => {
      const d = new Date(iso + "T00:00:00");
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    for (const d of dates) {
      current = prev !== null && nextDay(prev) === d ? current + 1 : 1;
      if (current > longest) longest = current;
      prev = d;
    }
    // `current` is the run ending at the most recent entry — that's only a live
    // streak if the last entry is today (or yesterday, with today still open). If
    // the chain already lapsed, the current streak is 0.
    const today = todayISO();
    if (prev !== null && prev !== today && prev !== addDaysISO(today, -1)) current = 0;
    return { entries, current, longest };
  });

  const streakCards = createMemo(() => {
    const s = streaks();
    return [
      { label: "Entries", value: String(s.entries) },
      { label: "Current streak", value: `${s.current} ${s.current === 1 ? "day" : "days"}` },
      { label: "Longest streak", value: `${s.longest} ${s.longest === 1 ? "day" : "days"}` },
    ];
  });

  return (
    <div class={styles.chart}>
      <Show
        when={grid().weeks.length > 0}
        fallback={
          <div class={styles.empty}>
            No dated rows to chart. Set an x date column in view settings.
          </div>
        }
      >
        <div class={styles.months}>
          <For each={monthLabels()}>
            {(label) => <span class={styles.monthLabel}>{label}</span>}
          </For>
        </div>
        <div class={styles.heatmap}>
          <For each={grid().weeks}>
            {(week) => (
              <div class={styles.week}>
                <For each={week}>
                  {(cell) => (
                    <div
                      class={styles.cell}
                      style={{ background: color(cell.value) }}
                      title={`${cell.date}: ${cell.value ?? 0}`}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
        <div class={styles.legend}>
          Less
          <div class={styles.cell} style={{ background: EMPTY_CELL }} />
          <For each={SHADES}>{(c) => <div class={styles.cell} style={{ background: c }} />}</For>
          More
        </div>
        <div class={`${styles.statgrid} ${styles.streakStats}`}>
          <For each={streakCards()}>
            {(card) => (
              <div class={styles.statCard}>
                <div class={styles.statLabel}>{card.label}</div>
                <div class={styles.statValue}>{card.value}</div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
