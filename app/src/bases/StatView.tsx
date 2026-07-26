import { For, Show, createMemo } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { buildChartData } from "../../../core/src/bases/chart";
import styles from "./Charts.module.css";

interface StatTile {
  label: string;
  value: string;
  delta?: string;
  /** Value color: plain fg by default; the standout metric reads accent, a
   *  near-empty one reads faint — per bases-stat.card.html's four tiles. */
  tone?: "accent" | "faint";
}

/** A single aggregate per tile — plain numbers, no chart (bases-stat.card.html:
 *  the largest type in the system, and the one view with no ASCII chart at all). */
export function StatView(props: { result: ViewResult; config: BaseConfig }) {
  const rows = createMemo<Row[]>(() => props.result.groups.flatMap((g) => g.rows));
  const data = createMemo(() => buildChartData(rows(), props.result.view));

  const total = createMemo(() => data().points.reduce((a, p) => a + p.value, 0));
  const avg = createMemo(() => (data().points.length ? total() / data().points.length : 0));

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // When several buckets/series exist, surface the summary as a grid of up-to-4
  // stat tiles (label + big value + a faint delta). A single bucket keeps one tile.
  const tiles = createMemo<StatTile[]>(() => {
    const d = data();
    if (d.points.length === 0) return [];
    if (d.points.length === 1) {
      return [{ label: d.valueLabel, value: fmt(total()) }];
    }
    const last = d.points[d.points.length - 1]?.value ?? 0;
    const prev = d.points.length >= 2 ? d.points[d.points.length - 2]?.value ?? 0 : 0;
    const change = last - prev;
    return [
      {
        label: `total ${d.valueLabel}`,
        value: fmt(total()),
        delta: change !== 0 ? `${change > 0 ? "+" : ""}${fmt(change)} latest` : undefined,
        tone: "accent",
      },
      { label: "average / bucket", value: avg().toFixed(1) },
      { label: "buckets", value: String(d.points.length) },
      { label: `peak ${d.valueLabel}`, value: fmt(d.max), tone: d.max === 0 ? "faint" : undefined },
    ];
  });

  return (
    <div class={styles.chart}>
      <Show when={tiles().length > 0} fallback={<div class={styles.empty}>No data to chart.</div>}>
        <div class={styles.statgrid}>
          <For each={tiles()}>
            {(tile) => (
              <div class={styles.statTile}>
                <div class={`${styles.statValue} ${tile.tone ? styles[tile.tone] : ""}`}>{tile.value}</div>
                <div class={styles.statLabel}>{tile.label}</div>
                <Show when={tile.delta}>
                  <div class={styles.statDelta}>{tile.delta}</div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
