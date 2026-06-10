// app/src/ClusterLegend.tsx
// Presentational graph overlay: a compact, vertical list of communities (color swatch +
// name + node count). Clicking a row flies to that cluster's nodes. Pure props in / callbacks
// out — it knows nothing about the renderer; GraphView positions it and wires the callbacks.
// Styled to match the GraphView overlay chrome via theme tokens (--surface-2 / --fg /
// --text-muted), so it tracks light and dark themes instead of baking in dark greys.
import { For, createMemo } from "solid-js";
import "./ClusterLegend.css";

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
    <div class="cluster-legend">
      <For each={sorted()}>
        {(row) => (
          <div
            class="cluster-row"
            // Stop mousedown from bubbling to the enclosing pane-leaf, whose focus handler
            // (PaneTree's onMouseDown) re-renders the pane and recreates these rows mid-click —
            // detaching the mousedown target before mouseup, so the browser never fires the click
            // and onFocus never runs. Matches EmptyPane's interactive-control pattern.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => props.onFocus(row.ids)}
            onMouseEnter={() => props.onHover?.(row.community)}
            onMouseLeave={() => props.onHover?.(null)}
            title={row.label}
          >
            <span class="cluster-swatch" style={{ background: row.color }} />
            <span class="cluster-label">
              {row.label}
            </span>
            <span class="cluster-count">
              {row.count}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}
