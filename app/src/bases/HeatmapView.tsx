import { For, Show, createMemo } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { buildChartData, buildHeatmapWeeks } from "../../../core/src/bases/chart";
import styles from "./Charts.module.css";

// Blue shades: low -> high intensity, tuned to work as a heatmap over a dark surface.
// Inline `style` on .statBig (not here) picks up the real accent var.
const SHADES = ["#1e2a38", "#26527a", "#357fcc", "#4a9eff"];
// Empty cells use --surface-1 (the faintest fg-tinted surface in App.css).
const EMPTY_CELL = "var(--surface-1, #1a1a22)";

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
      </Show>
    </div>
  );
}
