import { For, Show, createMemo } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { buildChartData } from "../../../core/src/bases/chart";
import styles from "./Charts.module.css";

const W = 800, H = 300, PAD = 28;

export function LineView(props: { result: ViewResult; config: BaseConfig }) {
  const rows = createMemo<Row[]>(() => props.result.groups.flatMap((g) => g.rows));
  const data = createMemo(() => buildChartData(rows(), props.result.view));

  const geom = createMemo(() => {
    const d = data();
    const n = d.points.length;
    if (n === 0) return null;
    const max = d.max <= 0 ? 1 : d.max;
    const step = n === 1 ? 0 : (W - PAD * 2) / (n - 1);
    const coords = d.points.map((p, i) => {
      const x = PAD + i * step;
      const y = H - PAD - Math.max(0, (p.value / max) * (H - PAD * 2));
      return { x, y };
    });
    const pts = coords.map((c) => `${c.x},${c.y}`);
    return {
      line: pts.join(" "),
      area: `${pts.join(" ")} ${PAD + (n - 1) * step},${H - PAD} ${PAD},${H - PAD}`,
      dots: coords,
    };
  });

  return (
    <div class={styles.chart}>
      <Show when={geom()} fallback={<div class={styles.empty}>No data to chart.</div>}>
        {(g) => (
          <div class={styles.svgWrap}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="oa-line-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--blue)" stop-opacity="0.35" />
                  <stop offset="100%" stop-color="var(--blue)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <polygon points={g().area} fill="url(#oa-line-fill)" />
              <polyline points={g().line} fill="none" stroke="var(--blue)" stroke-width="2" />
              <For each={g().dots}>{(c) => <circle cx={c.x} cy={c.y} r="2.4" fill="var(--teal)" />}</For>
            </svg>
          </div>
        )}
      </Show>
    </div>
  );
}
