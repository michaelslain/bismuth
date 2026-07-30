/** Typed progress meter and bar chart. The system draws no SVG charts. */
export interface AsciiMeterProps {
  /** 0–1. */
  value: number;
  width?: number;
  label?: string;
  suffix?: string;
  color?: string;
}
export declare function AsciiMeter(props: AsciiMeterProps): JSX.Element;
export interface AsciiChartSeries { label: string; value: number; color?: string; }
export interface AsciiChartProps { series: AsciiChartSeries[]; width?: number; }
export declare function AsciiChart(props: AsciiChartProps): JSX.Element;
