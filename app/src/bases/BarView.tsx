import { For, Show, createMemo } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { buildChartData } from "../../../core/src/bases/chart";
import styles from "./Charts.module.css";

const W = 800, H = 300, PAD = 28;

// Per-bar palette cycles through the graph color ramp (--graph-0..--graph-4),
// sourced from the theme tokens so bars re-tint when the user switches themes.
const BAR_PALETTE = [
  "var(--graph-0, var(--teal))",
  "var(--graph-1, var(--blue))",
  "var(--graph-2, var(--violet))",
  "var(--graph-3, var(--green))",
  "var(--graph-4, var(--gold))",
];

export function BarView(props: { result: ViewResult; config: BaseConfig }) {
  const rows = createMemo<Row[]>(() => props.result.groups.flatMap((g) => g.rows));
  const data = createMemo(() => buildChartData(rows(), props.result.view));
  const max = () => (data().max <= 0 ? 1 : data().max);
  const bw = () => (W - PAD * 2) / Math.max(1, data().points.length);

  return (
    <div class={styles.chart}>
      <Show when={data().points.length > 0} fallback={<div class={styles.empty}>No data to chart.</div>}>
        <div class={styles.svgWrap}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
            <For each={data().points}>
              {(p, i) => {
                const h = () => Math.max(0, (p.value / max()) * (H - PAD * 2));
                return (
                  <>
                    <rect x={PAD + i() * bw() + 2} y={H - PAD - h()} width={Math.max(1, bw() - 4)} height={h()} rx={4} fill={BAR_PALETTE[i() % BAR_PALETTE.length]} opacity="0.88">
                      <title>{`${p.label}: ${p.value}`}</title>
                    </rect>
                    <Show when={data().points.length <= 16}>
                      <text x={PAD + i() * bw() + bw() / 2} y={H - PAD + 14} font-size="10" text-anchor="middle" fill="currentColor" opacity="0.5" font-family='"Monaspace Xenon", ui-monospace, monospace'>{p.label}</text>
                    </Show>
                  </>
                );
              }}
            </For>
          </svg>
        </div>
      </Show>
    </div>
  );
}
