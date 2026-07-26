// [########..] — the system's only progress indicator, and its only bar chart.
// Solid port of design/ascii/design-system/components/ascii/AsciiMeter.jsx — the
// pure fill math lives in ./asciiMeterMath.ts so it's unit-testable without a DOM.
import { For } from "solid-js";
import { chartFill, chartLabelPad, chartMax, meterFill } from "./asciiMeterMath";

export interface AsciiMeterProps {
  /** 0–1. Not clamped before scaling — the rendered fill count clamps instead,
   *  so 1.4 still draws a full bar and -0.4 an empty one. */
  value: number;
  width?: number;
  label?: string;
  suffix?: string;
  color?: string;
}

export function AsciiMeter(props: AsciiMeterProps) {
  const width = () => props.width ?? 10;
  const filled = () => meterFill(props.value, width());
  const color = () => props.color ?? "var(--accent)";
  return (
    <span class="asc-meter" style={{ color: "var(--text-muted)" }}>
      {props.label ? props.label + "  " : ""}
      [<span style={{ color: color() }}>{"#".repeat(filled())}</span>
      <span class="empty">{".".repeat(width() - filled())}</span>]
      {props.suffix ? " " + props.suffix : ""}
    </span>
  );
}

export interface AsciiChartSeries {
  label: string;
  value: number;
  color?: string;
}

export interface AsciiChartProps {
  series: AsciiChartSeries[];
  width?: number;
}

/** A row of typed bars — the system's only chart. */
export function AsciiChart(props: AsciiChartProps) {
  const width = () => props.width ?? 16;
  const max = () => chartMax(props.series);
  const pad = () => chartLabelPad(props.series);
  return (
    <div style={{ "font-size": "var(--fs-micro)", "line-height": "12px", color: "var(--text-muted)" }}>
      <For each={props.series}>
        {(s) => {
          const fill = () => chartFill(s.value, max(), width());
          return (
            <div style={{ "white-space": "pre" }}>
              {s.label.padEnd(pad() + 1)}
              <span style={{ color: s.color ?? "var(--accent)" }}>{"#".repeat(fill())}</span>
              {" ".repeat(Math.max(0, width() - fill() + 1))}
              {s.value}
            </div>
          );
        }}
      </For>
    </div>
  );
}
