import { For, Show, createMemo } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { buildChartData } from "../../../core/src/bases/chart";
import { buildLinePlot } from "./asciiLine";
import styles from "./Charts.module.css";

/** A value over time, plotted on the character grid — no SVG (bases-line.card.html). */
export function LineView(props: { result: ViewResult; config: BaseConfig }) {
  const rows = createMemo<Row[]>(() => props.result.groups.flatMap((g) => g.rows));
  const data = createMemo(() => buildChartData(rows(), props.result.view));
  const plot = createMemo(() => buildLinePlot(data().points));

  return (
    <div class={styles.chart}>
      <Show when={plot().rows.length > 0} fallback={<div class={styles.empty}>No data to chart.</div>}>
        <pre class={styles.linePlot}>
          <For each={plot().rows}>
            {(row) => (
              <>
                {row.tick}
                <For each={row.segments}>
                  {(seg) => (seg.accent ? <span class={styles.glyph}>{seg.text}</span> : seg.text)}
                </For>
                {"\n"}
              </>
            )}
          </For>
          {plot().axisRule}
          {"\n"}
          {plot().axisLabels}
        </pre>
      </Show>
    </div>
  );
}
