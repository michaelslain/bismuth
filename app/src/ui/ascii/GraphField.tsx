// app/src/ui/ascii/GraphField.tsx
// The knowledge graph as a character field: a deterministic noise texture
// (off by default), Bresenham-rasterized edges on top of it, and absolutely
// positioned node labels on top of that. Node/hub glyphs are not this
// component's job — callers layer them in via `children` (see
// design/ascii/design-system/guidelines/ascii-graph.card.html).
//
// THE LAW (PORTING.md §4): zoom is RESOLUTION. The cell size never changes —
// `cols`/`rows` grow instead, re-rasterizing at a finer grid. Never
// `transform: scale` on the field; that breaks the character grid (and, in an
// embedded context, zooms the host page with it).
//
// Ported from design/ascii/design-system/components/ascii/GraphField.jsx.
import { For, Show, type JSX } from "solid-js";
import { Glyph } from "./Glyph";
import { noiseField } from "./noiseField";
import { clearNoiseUnderEdges, rasterEdges, type GraphEdge, type GraphNode } from "./rasterEdges";

export type { GraphNode, GraphEdge };

export interface GraphLabel {
  text: string;
  left: string;
  top: string;
  color?: string;
  active?: boolean;
}

export interface GraphFieldProps {
  cols?: number;
  rows?: number;
  nodes?: GraphNode[];
  /** Index pairs into `nodes`. */
  edges?: GraphEdge[];
  labels?: GraphLabel[];
  density?: number;
  /** The glyph noise field. Off by default — texture, never the signal. */
  showNoise?: boolean;
  showEdges?: boolean;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}

/** Matches the reference field's inset — clear of the field's own border. */
const FIELD_PADDING = "10px 0 0 8px";

export function GraphField(props: GraphFieldProps): JSX.Element {
  const cols = () => props.cols ?? 110;
  const rows = () => props.rows ?? 60;
  const nodes = () => props.nodes ?? [];
  const edges = () => props.edges ?? [];
  const labels = () => props.labels ?? [];
  const density = () => props.density ?? 0.34;
  const showNoise = () => props.showNoise ?? false;
  const showEdges = () => props.showEdges ?? true;

  const edgesText = () => rasterEdges(cols(), rows(), nodes(), edges());

  // The noise layer is texture UNDER the edges, and is cleared beneath every
  // edge cell — otherwise a random noise glyph competes with the line glyph
  // at the same cell and the field reads as mush (GraphField.prompt.md).
  // Label clearing is handled by CSS: .asc-node-label paints an opaque
  // `--bg` behind its own text, so it needs no grid-level treatment here.
  const noiseText = () => {
    const raw = noiseField(cols(), rows(), density());
    return showEdges() ? clearNoiseUnderEdges(raw, edgesText()) : raw;
  };

  return (
    <div class="asc-field" style={{ flex: 1, ...props.style }}>
      <Show when={showNoise()}>
        <Glyph class="noise" text={noiseText()} style={{ padding: FIELD_PADDING }} color="var(--faint)" opacity={0.45} />
      </Show>
      <Show when={showEdges()}>
        <Glyph class="edges" text={edgesText()} glow style={{ padding: FIELD_PADDING }} color="var(--accent)" />
      </Show>
      <For each={labels()}>
        {(l) => (
          <span
            class={l.active ? "asc-node-label active" : "asc-node-label"}
            style={{ left: l.left, top: l.top, color: l.color }}
          >
            {l.text}
          </span>
        )}
      </For>
      {props.children}
    </div>
  );
}
