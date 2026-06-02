import { For, Show, createMemo } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { buildChartData } from "../../../core/src/bases/chart";
import styles from "./Charts.module.css";

interface StatCard {
  label: string;
  value: string;
  delta?: string;
}

export function StatView(props: { result: ViewResult; config: BaseConfig }) {
  const rows = createMemo<Row[]>(() => props.result.groups.flatMap((g) => g.rows));
  const data = createMemo(() => buildChartData(rows(), props.result.view));

  const total = createMemo(() => data().points.reduce((a, p) => a + p.value, 0));
  const avg = createMemo(() => (data().points.length ? total() / data().points.length : 0));
  const spark = createMemo(() => {
    const d = data();
    const n = d.points.length;
    if (n === 0) return "";
    const max = d.max <= 0 ? 1 : d.max;
    const step = n === 1 ? 0 : 200 / (n - 1);
    return d.points.map((p, i) => `${i * step},${34 - Math.max(0, (p.value / max) * 30)}`).join(" ");
  });

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // When several buckets/series exist, surface the summary as a grid of up-to-4
  // stat cards (label + serif value + a green up-delta). A single bucket keeps
  // the big serif fallback.
  const cards = createMemo<StatCard[]>(() => {
    const d = data();
    if (d.points.length <= 1) return [];
    const last = d.points[d.points.length - 1]?.value ?? 0;
    const prev = d.points.length >= 2 ? d.points[d.points.length - 2]?.value ?? 0 : 0;
    const change = last - prev;
    return [
      {
        label: `total ${d.valueLabel}`,
        value: fmt(total()),
        delta: change > 0 ? `+${fmt(change)} ↑ latest` : undefined,
      },
      { label: "average / bucket", value: avg().toFixed(1) },
      { label: "buckets", value: String(d.points.length) },
      { label: `peak ${d.valueLabel}`, value: fmt(d.max) },
    ];
  });

  return (
    <div class={styles.chart}>
      <Show when={data().points.length > 0} fallback={<div class={styles.empty}>No data to chart.</div>}>
        <Show
          when={cards().length > 0}
          fallback={
            <div class={styles.stat}>
              <div class={styles.statBig}>{fmt(total())}</div>
              <div class={styles.statSub}>total {data().valueLabel} · avg {avg().toFixed(1)}/bucket</div>
              <svg width="200" height="36" viewBox="0 0 200 36">
                <polyline points={spark()} fill="none" stroke="var(--blue)" stroke-width="2" opacity="0.85" />
              </svg>
            </div>
          }
        >
          <div class={styles.statgrid}>
            <For each={cards()}>
              {(card) => (
                <div class={styles.statCard}>
                  <div class={styles.statLabel}>{card.label}</div>
                  <div class={styles.statValue}>{card.value}</div>
                  <Show when={card.delta}>
                    <div class={styles.statDelta}>{card.delta}</div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
