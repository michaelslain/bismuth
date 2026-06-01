import { Show, createMemo } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { buildChartData } from "../../../core/src/bases/chart";
import styles from "./Charts.module.css";

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

  return (
    <div class={styles.chart}>
      <Show when={data().points.length > 0} fallback={<div class={styles.empty}>No data to chart.</div>}>
        <div class={styles.stat}>
          <div class={styles.statBig} style={{ color: "var(--accent, #4a9eff)" }}>
            {Number.isInteger(total()) ? total() : total().toFixed(1)}
          </div>
          <div class={styles.statSub}>total {data().valueLabel} · avg {avg().toFixed(1)}/bucket</div>
          <svg width="200" height="36" viewBox="0 0 200 36">
            <polyline points={spark()} fill="none" stroke="var(--accent, #4a9eff)" stroke-width="2" opacity="0.8" />
          </svg>
        </div>
      </Show>
    </div>
  );
}
