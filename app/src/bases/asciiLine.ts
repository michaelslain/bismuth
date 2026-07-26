// Pure ASCII line-plot layout behind LineView.tsx — ported in spirit from
// design/ascii/design-system/guidelines/bases-line.card.html: a value over time,
// plotted on the character grid (no SVG). Kept as plain functions (no DOM/Solid) so
// it's unit-testable headlessly, matching the AsciiMeter/asciiMeterMath split.

export interface LinePoint {
  label: string;
  value: number;
}

/** One drawn cell: a run of same-style characters within a plot row. */
export interface LineSegment {
  text: string;
  /** Plotted line glyphs (`/ - \\ o`) read accent; blank padding reads plain. */
  accent: boolean;
}

export interface LineRow {
  /** Left y-axis gutter: the row's value tick, or blank. */
  tick: string;
  segments: LineSegment[];
}

export interface LinePlot {
  rows: LineRow[];
  /** The baseline `+---…` axis rule, sized to the plot width. */
  axisRule: string;
  /** x-axis tick labels, one per point, spaced to align under each point's column
   *  (blank-padded between). Omitted (empty string) when there are too many points
   *  to label without collision — mirrors BarView's <=16 gate. */
  axisLabels: string;
}

const TICK_WIDTH = 3; // gutter width for the y-axis value column, e.g. "12 "

/** Row index (0 = top) a value plots at, within `height` rows spanning [0, max]. */
function rowFor(value: number, max: number, height: number): number {
  if (max <= 0) return height - 1;
  const r = height - 1 - Math.round((Math.max(0, value) / max) * (height - 1));
  return Math.max(0, Math.min(height - 1, r));
}

/**
 * Lay `points` onto a character grid: `height` rows tall, one column-slot of
 * `colWidth` characters per point (the point centered in its slot). Consecutive
 * points are connected with `/`, `\`, or `-` per intervening column, an `o` marks
 * each actual data point. Returns blank (empty rows array) for zero points.
 */
export function buildLinePlot(points: LinePoint[], opts?: { height?: number; colWidth?: number }): LinePlot {
  const height = opts?.height ?? 9;
  const colWidth = opts?.colWidth ?? 8;
  const n = points.length;
  if (n === 0) return { rows: [], axisRule: "", axisLabels: "" };

  const max = Math.max(0, ...points.map((p) => p.value), 1);
  const width = n * colWidth;
  const grid: string[] = Array.from({ length: height }, () => " ".repeat(width));
  const setCell = (row: number, col: number, ch: string) => {
    if (row < 0 || row >= height || col < 0 || col >= width) return;
    grid[row] = grid[row].slice(0, col) + ch + grid[row].slice(col + 1);
  };

  const colOf = (i: number) => i * colWidth + Math.floor(colWidth / 2);
  const rowOf = (i: number) => rowFor(points[i].value, max, height);

  for (let i = 0; i < n - 1; i++) {
    const c0 = colOf(i);
    const c1 = colOf(i + 1);
    const r0 = rowOf(i);
    const r1 = rowOf(i + 1);
    let prevRow = r0;
    for (let c = c0 + 1; c < c1; c++) {
      const t = (c - c0) / (c1 - c0);
      const r = Math.round(r0 + (r1 - r0) * t);
      const ch = r < prevRow ? "/" : r > prevRow ? "\\" : "-";
      setCell(r, c, ch);
      prevRow = r;
    }
  }
  // Markers drawn last so they win over any connecting glyph landing on the same cell.
  for (let i = 0; i < n; i++) setCell(rowOf(i), colOf(i), "o");

  // Group each row into accent/blank runs so the caller renders a handful of
  // <span>s per row instead of one per character.
  const rows: LineRow[] = grid.map((line, r) => {
    const segments: LineSegment[] = [];
    let cur = "";
    let curAccent = false;
    for (const ch of line) {
      const accent = ch !== " ";
      if (segments.length === 0 && cur === "") { cur = ch; curAccent = accent; continue; }
      if (accent === curAccent) { cur += ch; continue; }
      segments.push({ text: cur, accent: curAccent });
      cur = ch;
      curAccent = accent;
    }
    if (cur) segments.push({ text: cur, accent: curAccent });
    const tick = r === 0 ? String(max).padStart(TICK_WIDTH - 1) + " " : r === height - 1 ? "0".padStart(TICK_WIDTH - 1) + " " : " ".repeat(TICK_WIDTH);
    return { tick, segments };
  });

  const axisRule = " ".repeat(TICK_WIDTH) + "+" + "-".repeat(width);
  const axisLabels =
    n <= 16
      ? " ".repeat(TICK_WIDTH + 1) +
        points
          .map((p, i) => p.label.padEnd(i === n - 1 ? p.label.length : colWidth))
          .join("")
      : "";

  return { rows, axisRule, axisLabels };
}
