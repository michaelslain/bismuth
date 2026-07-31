// app/src/graph/EmbeddedGraph.tsx
//
// The rendered face of a ```graph note block (app/src/editor/graphBlock.ts): parses the
// block's DSL body (core/src/graphBlock.ts), lays the graph out with the SAME pure layout
// the knowledge graph uses (core/src/layout.ts), and renders it with the SAME renderer the
// knowledge graph uses (AsciiGraphRenderer, through the GraphRenderer seam) — no second renderer.
//
// The renderer is held as a `GraphRenderer`, not as the concrete class: this block only ever
// needs the seam, and typing it that way is what let CanvasGraphRenderer be deleted.
//
// Two renderer contracts this block deliberately diverges from, both because a hand-authored
// diagram is not a knowledge graph:
//   • labelEveryNode — the file-label ladder (labelSelection.ts) is zoom-driven and shows NOTHING
//     at fit, which is where a block opens. A diagram's labels are its content, so it opts out of
//     the ladder entirely. (The old `graphLabelHubCount: 9999` was an attempt at this that could
//     never have worked — see GraphConfig.labelEveryNode's doc.)
//   • showLodMasses is left off. A ` ```graph ` block carries no communities (layoutGraphData
//     below explains why), so there is nothing to aggregate and every node draws as itself at
//     every zoom stop.
//
// The round-trip: every edit tool below mutates the parsed spec through the pure helpers
// and hands the CANONICAL serialized markdown to props.onChange, which the widget writes
// back into the fence as an ordinary editor transaction. The doc change re-renders the
// block from that markdown — so what you see is always exactly what the markdown says.
//
// Edit affordances (v1 — a coherent, honest subset):
//   SELECT   click a node → rename its id / set its label / delete it
//   CONNECT  click two nodes → add an edge between them (or remove the existing one);
//            the →/— toggle picks directed vs undirected for new edges
//   ERASE    click a node → delete it and its edges
//   + NODE   append a fresh node
//   SOURCE   reveal the raw fence for hand-editing (collapses when the caret leaves)
// Node drag-repositioning is intentionally NOT in: layout is computed (deterministically)
// from the structure, so positions aren't part of the markdown model.

import { createEffect, createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { AsciiGraphRenderer } from "./AsciiGraphRenderer";
import type { GraphConfig, GraphRenderer } from "./graphRenderer";
import { computeLayout } from "../../../core/src/layout";
import {
  parseGraphBlock,
  serializeGraphBlock,
  graphBlockToGraphData,
  addNode,
  removeNode,
  renameNode,
  setNodeLabel,
  hasEdgeBetween,
  addEdge,
  removeEdgesBetween,
  type GraphBlockSpec,
} from "../../../core/src/graphBlock";
import { settings, DEFAULT_ACCENT_PALETTE, type Settings } from "../settings";
import { resolveAppearance, type ColorTokens } from "../themes";
import { paletteToInts, hexToInt } from "../themeColors";
import { SegmentedToggle } from "../ui/SegmentedToggle";
import { IconButton } from "../ui/IconButton";
import { IconTextButton } from "../ui/IconTextButton";
import { Icon } from "../icons/Icon";
import "./embeddedGraph.css";

type Tool = "select" | "connect" | "erase";

// Tool/arrow/dimension choices are module-level so they survive the widget remount that
// every write-back causes (the fence's source changes → a fresh widget renders the new
// markdown). Shared across blocks, like the graph view's 2D/3D toggle.
const [tool, setTool] = createSignal<Tool>("select");
const [directed, setDirected] = createSignal(true);
const [dim, setDim] = createSignal<"2d" | "3d">("2d");

/** Lerp two 0xRRGGBB colors per-channel (t=0 → a, t=1 → b). Mirrors GraphView's mixHex. */
function mixHex(a: number, b: number, t: number): number {
  const ch = (shift: number) => {
    const av = (a >> shift) & 0xff;
    const bv = (b >> shift) & 0xff;
    return Math.round(av + (bv - av) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Attach deterministic layout coords (position/position2d) computed client-side — an
 *  embedded diagram is small, so the sync settle is instant; determinism means the same
 *  markdown always reproduces the same picture.
 *
 *  KNOWN LIMITATION (Task 5, fix round 2 — left as-is, by design, not an oversight): `input.nodes`
 *  below carries no `community`/`communityPath` — a hand-authored ` ```graph ` block has no Louvain
 *  detection run over it, so there's genuinely no community data to attach (unlike GraphView.tsx's
 *  LOCAL mode, which DOES have it available from the full engine graph and now passes it through —
 *  see localLayoutInput.ts). The user's call: keep embedded diagrams simple rather than run detection
 *  inline for what's usually a handful of nodes, where any visual overlap costs little.
 *
 *  Concretely, this means the "two densely-linked clusters joined by one bridge visibly separate"
 *  property the deleted core/test/layout.test.ts assertion used to guard does NOT hold here under the
 *  shipped LinLog + degreeRepulsion default (measured — same two-6/10/20/40-clique-plus-bridge fixture,
 *  centroid distance ÷ intra-cluster spread, single 120-tick settle, >1 = clusters read as distinct):
 *      cluster size     6       10      20      40
 *      pre-Task-5      2.006   1.742   1.970   2.141   (always > 1: clusters separate)
 *      shipped         0.813   1.344   0.237   2.388   (0.813 / 0.237 are BELOW 1: clusters visibly
 *                                                        interpenetrate — the centroids sit closer
 *                                                        together than the clusters' own radii)
 *  Not a monotonic regression (40 is fine, 6 and 20 aren't) — it's noise from the combination lacking
 *  any community signal to lock onto, not a consistent shrink. If this ever becomes a real complaint
 *  (as opposed to a documented, accepted trade-off), the fix is almost certainly NOT re-tuning physics
 *  constants here — see COMMUNITY_SEP_MULT's hazard comment in core/src/layout.ts for why that trap is
 *  easy to fall into — but giving embedded blocks SOME grouping signal to feed `computeLayout`, e.g. an
 *  author-specified `group:` field per node, synthesized into `community`. */
export function layoutGraphData(spec: GraphBlockSpec) {
  const data = graphBlockToGraphData(spec);
  if (data.nodes.length === 0) return data;
  const input = {
    nodes: data.nodes.map((n) => ({ id: n.id })),
    edges: data.edges.map((e) => ({ from: e.from, to: e.to })),
  };
  const pos3 = computeLayout(input, { dimensions: 3, refineTicks: 120 });
  const pos2 = computeLayout(input, { dimensions: 2, refineTicks: 80, initialPositions: pos3 });
  for (const n of data.nodes) {
    n.position = pos3[n.id];
    const p2 = pos2[n.id];
    if (p2) n.position2d = [p2[0], p2[1]];
  }
  return data;
}

/** The block's live GraphConfig, mirroring GraphView's derivation with the embedded-diagram
 *  overrides (no idle spin, every node labelled). Extracted from the createEffect below so the
 *  headless smoke test can drive a real renderer with the EXACT object the block ships — the
 *  component itself can't be mounted under `bun test` (bun resolves solid-js/web to its SERVER
 *  build, so `render()` throws "Client-only API called on the server side"; that is why there is
 *  not one .test.tsx in this repo). */
export function embeddedGraphConfig(
  gs: Settings["graph"], ap: ColorTokens, dim: "2d" | "3d",
): GraphConfig {
  const palette = ap.accentPalette?.length ? ap.accentPalette : DEFAULT_ACCENT_PALETTE;
  return {
    spin: false,
    spinSpeed: gs.spinSpeed,
    palette: paletteToInts(palette),
    repulsion: gs.repulsion,
    linkDistance: gs.linkDistance,
    centering: gs.centering,
    nodeSize: gs.nodeSize,
    viewMode: dim,
    showGraphLabels: true,
    labelEveryNode: true, // a diagram's labels ARE its content — see the file header
    graphLabelHubCount: 0, // moot under labelEveryNode: nothing needs ranking when nothing is cut
    nodeSizeMinMult: gs.nodeSizeMinMult,
    nodeSizeDegreeGain: gs.nodeSizeDegreeGain,
    nodeSizeMaxMult: gs.nodeSizeMaxMult,
    edgeColor: ap.isLight
      ? mixHex(hexToInt(ap.neutral, 0xaeb4c2), hexToInt(ap.background, 0xffffff), 0.45)
      : hexToInt(ap.neutral, 0xaeb4c2),
    edgeOpacity: ap.isLight ? 0.3 : 0.45,
    backgroundColor: hexToInt(ap.background, 0x14151b),
    labelTextColor: ap.isLight ? ap.foreground : "rgba(232,232,238,0.95)",
    labelBgColor: ap.isLight ? "rgba(255,255,255,0.82)" : "rgba(14,14,17,0.6)",
    selfColor: hexToInt(ap.foreground, 0xffffff),
  };
}

export function EmbeddedGraph(props: {
  source: string;
  onReveal: () => void;
  onChange: (body: string) => void;
}) {
  // The widget remounts whenever the source changes (its eq() compares source), so the
  // body is static for this component instance — parse + lay out once.
  const { spec, errors } = parseGraphBlock(props.source);
  const hasErrors = errors.length > 0;
  const data = layoutGraphData(spec);

  const [pending, setPending] = createSignal<string | null>(null); // connect-mode first endpoint
  const [selected, setSelected] = createSignal<string | null>(null);
  const [editId, setEditId] = createSignal("");
  const [editLabel, setEditLabel] = createSignal("");

  const renderer: GraphRenderer = new AsciiGraphRenderer();
  let host!: HTMLDivElement;

  // Serialize a mutated spec back into the fence. The widget no-ops identical bodies, so
  // an ineffective edit (e.g. an invalid rename) simply leaves the document untouched.
  const commit = (next: GraphBlockSpec) => {
    if (hasErrors) return; // serializing a partial parse would DROP the bad lines
    props.onChange(serializeGraphBlock(next));
  };

  const selectNode = (id: string | null) => {
    setSelected(id);
    const n = id ? spec.nodes.find((n) => n.id === id) : undefined;
    setEditId(n?.id ?? "");
    setEditLabel(n?.label ?? "");
    if (id) renderer.highlightNodes([id]);
    else renderer.clearHighlight();
  };

  const onNodeClick = (id: string) => {
    if (hasErrors) return;
    const t = tool();
    if (t === "erase") {
      commit(removeNode(spec, id));
      return;
    }
    if (t === "connect") {
      const p = pending();
      if (!p) { setPending(id); renderer.highlightNodes([id]); return; }
      if (p === id) { setPending(null); renderer.clearHighlight(); return; }
      commit(hasEdgeBetween(spec, p, id) ? removeEdgesBetween(spec, p, id) : addEdge(spec, p, id, directed()));
      return;
    }
    selectNode(selected() === id ? null : id);
  };

  const applyEdit = () => {
    const id = selected();
    if (!id) return;
    commit(renameNode(setNodeLabel(spec, id, editLabel()), id, editId()));
  };

  onMount(() => {
    renderer.mount(host, onNodeClick);
    renderer.onHighlightCleared = () => { setSelected(null); setPending(null); };
    renderer.render(data);
    // The renderer preventDefaults wheel (zoom). Fine for a full-pane graph, but an
    // INLINE block must not hijack note scrolling — so plain scroll passes through
    // (stopPropagation in the capture phase keeps it from the renderer's viewport
    // listener) and only Mod+scroll (or a trackpad pinch, which sets ctrlKey) zooms.
    const wheelGate = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) e.stopPropagation();
    };
    host.addEventListener("wheel", wheelGate, { capture: true });
    onCleanup(() => host.removeEventListener("wheel", wheelGate, { capture: true }));
  });
  onCleanup(() => renderer.destroy());

  // Live theme + graph settings (see embeddedGraphConfig above for the derivation + the two
  // deliberate divergences from the knowledge graph's contract).
  createEffect(() => {
    renderer.setConfig(embeddedGraphConfig(settings.graph, resolveAppearance(settings.appearance), dim()));
  });

  const hint = () => {
    if (hasErrors) return "Fix the source to enable graph editing.";
    if (spec.nodes.length === 0) return "Empty graph — press + NODE to start.";
    switch (tool()) {
      case "connect":
        return pending()
          ? `Click another node to ${directed() ? "link" : "join"} it with "${pending()}" (linked pair → unlink).`
          : "Click two nodes to add an edge — clicking an already-linked pair removes it.";
      case "erase":
        return "Click a node to delete it and its edges.";
      default:
        return "Click a node to rename / relabel / delete it. Drag orbits, Mod+scroll zooms.";
    }
  };

  return (
    <div class="graph-block-root">
      <div class="graph-block-toolbar">
        <Show when={!hasErrors}>
          <SegmentedToggle<Tool>
            value={tool()}
            onChange={(t) => { setTool(t); setPending(null); selectNode(null); }}
            size="sm"
            options={[
              { id: "select", title: "Select — click a node to edit it", label: <><Icon value="Pencil" size={13} /><span class="btn-label">SELECT</span></> },
              { id: "connect", title: "Connect — click two nodes to link / unlink", label: <><Icon value="Link" size={13} /><span class="btn-label">CONNECT</span></> },
              { id: "erase", title: "Erase — click a node to delete it", label: <><Icon value="Eraser" size={13} /><span class="btn-label">ERASE</span></> },
            ]}
          />
          <Show when={tool() === "connect"}>
            <SegmentedToggle<"dir" | "undir">
              value={directed() ? "dir" : "undir"}
              onChange={(v) => setDirected(v === "dir")}
              size="sm"
              options={[
                { id: "dir", title: "New edges are directed (->)", label: <Icon value="ArrowRight" size={13} /> },
                { id: "undir", title: "New edges are undirected (--)", label: <Icon value="Minus" size={13} /> },
              ]}
            />
          </Show>
          <IconTextButton icon="Plus" size="sm" onClick={() => commit(addNode(spec).spec)}>NODE</IconTextButton>
        </Show>
        <span class="graph-block-spacer" />
        <SegmentedToggle<"2d" | "3d">
          value={dim()}
          onChange={setDim}
          size="sm"
          options={[
            { id: "2d", title: "Flat layout", label: <Icon value="Square" size={13} /> },
            { id: "3d", title: "Orbit layout", label: <Icon value="Box" size={13} /> },
          ]}
        />
        <IconButton icon="Code" label="Edit graph source" size="sm" onClick={props.onReveal} />
      </div>
      <Show when={hasErrors}>
        <div class="graph-block-errors">
          <For each={errors}>{(e) => <div>line {e.line}: {e.message}</div>}</For>
        </div>
      </Show>
      <div class="graph-block-canvas" ref={host} />
      <Show when={!hasErrors && tool() === "select" && selected()}>
        <div class="graph-block-edit">
          <label class="graph-block-edit-label">id</label>
          <input
            class="ui-input graph-block-input"
            value={editId()}
            onInput={(e) => setEditId(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyEdit(); }}
          />
          <label class="graph-block-edit-label">label</label>
          <input
            class="ui-input graph-block-input"
            value={editLabel()}
            placeholder={selected() ?? ""}
            onInput={(e) => setEditLabel(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyEdit(); }}
          />
          <IconTextButton icon="Check" size="sm" onClick={applyEdit}>APPLY</IconTextButton>
          <IconTextButton icon="Trash2" size="sm" danger onClick={() => commit(removeNode(spec, selected()!))}>DELETE</IconTextButton>
        </div>
      </Show>
      <div class="graph-block-footer">
        <span>{hint()}</span>
        <span class="graph-block-spacer" />
        <span>{spec.nodes.length} nodes · {spec.edges.length} edges</span>
      </div>
    </div>
  );
}
