// app/src/ClusterLegend.tsx
// Presentational graph overlay: a compact, vertical list of communities (color swatch +
// name + node count). Clicking a row flies to that cluster's nodes. Pure props in / callbacks
// out — it knows nothing about the renderer; GraphView positions it and wires the callbacks.
// Styled to match the GraphView overlay chrome via theme tokens (--surface-2 / --fg /
// --text-muted), so it tracks light and dark themes instead of baking in dark greys.
import { For, createMemo } from "solid-js";
import "./ClusterLegend.css";
// ASCII register: the swatch is a coloured hub glyph, the rows sit on --fs-ui.
import "./graph/asciiGraph.css";

export interface ClusterRow {
  community: number;
  label: string;
  count: number;
  color: string;
  ids: string[];
}

export function ClusterLegend(props: {
  rows: ClusterRow[];
  onFocus: (ids: string[], community: number) => void; // fly to / toggle this cluster's nodes
  onHover?: (community: number | null) => void;
  /** The persistently-highlighted cluster, if any — its row reads as selected, and clicking it
   *  again deselects (GraphView owns the state; empty-canvas clicks clear it too). */
  selected?: number | null;
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
            classList={{ selected: props.selected === row.community }}
            // Stop mousedown from bubbling to the enclosing pane-leaf, whose focus handler
            // (PaneTree's onMouseDown) re-renders the pane and recreates these rows mid-click —
            // detaching the mousedown target before mouseup, so the browser never fires the click
            // and onFocus never runs. Matches EmptyPane's interactive-control pattern.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => props.onFocus(row.ids, row.community)}
            onMouseEnter={() => props.onHover?.(row.community)}
            onMouseLeave={() => props.onHover?.(null)}
            title={row.label}
          >
            {/* The cluster's swatch is the degree ramp's hub glyph in the cluster's own colour —
                the same "@" the field draws its hubs with (tokens/ascii.css --node-hub), not a
                rounded colour chip. */}
            <span class="cluster-glyph" style={{ color: row.color }} aria-hidden="true">@</span>
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
