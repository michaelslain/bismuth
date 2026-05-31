// app/src/ClusterLegend.tsx
// Presentational graph overlay: a compact, vertical list of communities (color swatch +
// name + node count). Clicking a row flies to that cluster's nodes. Pure props in / callbacks
// out — it knows nothing about the renderer; GraphView positions it and wires the callbacks.
// Styled to match the GraphView overlay chrome (rgba(20,20,24,0.55), 10–11px, inherit font).
import { For, Show, createMemo } from "solid-js";

export interface ClusterRow {
  community: number;
  label: string;
  count: number;
  color: string;
  ids: string[];
}

// Cap the visible rows so a busy graph doesn't grow an unbounded panel; the remainder
// is summarized as a "+N more" tail.
const MAX_ROWS = 12;

export function ClusterLegend(props: {
  rows: ClusterRow[];
  onFocus: (ids: string[]) => void; // fly to this cluster's nodes
  onHover?: (community: number | null) => void;
}) {
  // Sort by count desc (largest community first); stable tie-break on community id.
  const sorted = createMemo(() =>
    [...props.rows].sort((a, b) => b.count - a.count || a.community - b.community),
  );
  const visible = createMemo(() => sorted().slice(0, MAX_ROWS));
  const overflow = createMemo(() => Math.max(0, sorted().length - MAX_ROWS));

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "1px",
        background: "rgba(20,20,24,0.55)",
        "border-radius": "4px",
        padding: "4px",
        "font-family": "inherit",
        "font-size": "11px",
        "max-width": "200px",
        "pointer-events": "auto",
      }}
    >
      <For each={visible()}>
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
                color: "rgba(232,232,232,0.92)",
              }}
            >
              {row.label}
            </span>
            <span
              style={{
                "margin-left": "auto",
                "padding-left": "8px",
                color: "rgba(200,200,200,0.55)",
                "font-variant-numeric": "tabular-nums",
              }}
            >
              {row.count}
            </span>
          </div>
        )}
      </For>
      <Show when={overflow() > 0}>
        <div
          style={{
            padding: "3px 6px",
            color: "rgba(200,200,200,0.45)",
            "font-size": "10px",
          }}
        >
          +{overflow()} more
        </div>
      </Show>
    </div>
  );
}
