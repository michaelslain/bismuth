// app/src/ClusterLegend.tsx
// Presentational graph overlay: a compact, vertical list of communities (color swatch +
// name + node count). Clicking a row flies to that cluster's nodes. Pure props in / callbacks
// out — it knows nothing about the renderer; GraphView positions it and wires the callbacks.
// Styled to match the GraphView overlay chrome via theme tokens (--surface-2 / --fg /
// --text-muted), so it tracks light and dark themes instead of baking in dark greys.
import { For, createMemo } from "solid-js";

export interface ClusterRow {
  community: number;
  label: string;
  count: number;
  color: string;
  ids: string[];
}

export function ClusterLegend(props: {
  rows: ClusterRow[];
  onFocus: (ids: string[]) => void; // fly to this cluster's nodes
  onHover?: (community: number | null) => void;
}) {
  // Sort by count desc (largest community first); stable tie-break on community id.
  const sorted = createMemo(() =>
    [...props.rows].sort((a, b) => b.count - a.count || a.community - b.community),
  );

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "1px",
        background: "var(--surface-2)",
        "border-radius": "4px",
        padding: "4px",
        "font-family": "inherit",
        "font-size": "11px",
        width: "100%",
        height: "100%",
        "overflow-y": "auto",
        "pointer-events": "auto",
      }}
    >
      <For each={sorted()}>
        {(row) => (
          <div
            onClick={() => props.onFocus(row.ids)}
            onMouseEnter={() => props.onHover?.(row.community)}
            onMouseLeave={() => props.onHover?.(null)}
            style={{
              display: "flex",
              "align-items": "center",
              gap: "7px",
              padding: "3px 6px",
              "border-radius": "3px",
              cursor: "pointer",
              "white-space": "nowrap",
            }}
            title={row.label}
          >
            <span
              style={{
                width: "9px",
                height: "9px",
                "border-radius": "2px",
                background: row.color,
                "flex-shrink": 0,
              }}
            />
            <span
              style={{
                flex: 1,
                "min-width": 0,
                overflow: "hidden",
                "text-overflow": "ellipsis",
                color: "var(--fg)",
              }}
            >
              {row.label}
            </span>
            <span
              style={{
                "margin-left": "auto",
                "padding-left": "8px",
                color: "var(--text-muted)",
                "font-variant-numeric": "tabular-nums",
              }}
            >
              {row.count}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}
