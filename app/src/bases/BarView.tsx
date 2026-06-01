import { For, Show, createMemo } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { buildChartData } from "../../../core/src/bases/chart";
import styles from "./Charts.module.css";

const W = 800, H = 300, PAD = 28;

export function BarView(props: { result: ViewResult; config: BaseConfig }) {
  const rows = createMemo<Row[]>(() => props.result.groups.flatMap((g) => g.rows));
  const data = createMemo(() => buildChartData(rows(), props.result.view));

  return (
    <div class={styles.chart}>
      <Show when={data().points.length > 0} fallback={<div class={styles.empty}>No data to chart.</div>}>
        {(() => {
          const d = data();
          const max = d.max <= 0 ? 1 : d.max;
          const n = d.points.length;
          const bw = (W - PAD * 2) / n;
          return (
            <div class={styles.svgWrap}>
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
                <For each={d.points}>
                  {(p, i) => {
                    const h = Math.max(0, (p.value / max) * (H - PAD * 2));
                    return (
                      <>
                        <rect x={PAD + i() * bw + 2} y={H - PAD - h} width={Math.max(1, bw - 4)} height={h} rx={3} fill="var(--accent, #4a9eff)">
                          <title>{`${p.label}: ${p.value}`}</title>
                        </rect>
                        <Show when={n <= 16}>
                          <text x={PAD + i() * bw + bw / 2} y={H - PAD + 14} font-size="10" text-anchor="middle" fill="currentColor" opacity="0.5">{p.label}</text>
                        </Show>
                      </>
                    );
                  }}
                </For>
              </svg>
            </div>
          );
        })()}
      </Show>
    </div>
  );
}
