// app/src/graph/embeddedGraphRender.ts
//
// The two pure, renderer-facing units EmbeddedGraph.tsx needs to feed a GraphRenderer:
// layoutGraphData (lays out a parsed ```graph block with the SAME pure layout the knowledge
// graph uses) and embeddedGraphConfig (derives the block's GraphConfig from live settings/theme).
//
// WHY THIS IS ITS OWN .ts FILE (Task 26). These two functions contain no JSX — the split isn't
// about that. The problem is that `bun test` transpiles a `.tsx` file as a WHOLE: even a JSX-free
// export dies at import if anything ELSE in the same file uses JSX, because Bun still has to pick
// a JSX transform for the file and Solid doesn't support Bun's default one. Concretely: this repo's
// tsconfig sets `jsx: "preserve"` + `jsxImportSource: "solid-js"` so Vite's own transform (via
// vite-plugin-solid/babel-preset-solid, which compiles JSX to direct DOM-creation calls, not calls
// into a runtime module) can do the real work; `"preserve"` isn't one of Bun's own executable JSX
// modes, so under `bun test` it falls back to ITS default — the classic React automatic runtime —
// and tries to import `react/jsx-dev-runtime`, which isn't installed. Retargeting Bun at
// `solid-js/jsx-dev-runtime` instead doesn't fix it either: that path exists only for TypeScript's
// type-checker (`types/jsx.d.ts`) and at runtime re-exports `dist/solid.js`, which has no
// `jsx`/`jsxs`/`jsxDEV` functions for an automatic runtime to call — Solid was never meant to be
// consumed that way. So there is no tsconfig/bunfig knob that makes a Solid `.tsx` importable under
// Bun; EmbeddedGraph.test.ts (added in 6890c3e) imported straight from EmbeddedGraph.tsx and had
// therefore never actually run even once (see the test file's own header + the Task 26 report for
// the provenance check). Moving the two functions here — a plain .ts module with zero JSX anywhere
// in the file — removes the need for any JSX transform when this module loads, so both `bun test`
// and Vite can import it. EmbeddedGraph.tsx re-imports both names from here unchanged.
import { computeLayout } from "../../../core/src/layout";
import { graphBlockToGraphData, type GraphBlockSpec } from "../../../core/src/graphBlock";
import type { GraphConfig } from "./graphRenderer";
import { DEFAULT_ACCENT_PALETTE, type Settings } from "../settings";
import type { ColorTokens } from "../themes";
import { paletteToInts, hexToInt } from "../themeColors";

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
 *  overrides (no idle spin, every node labelled). Lives here (not inline in the component's
 *  createEffect) so the headless smoke test can drive a real renderer with the EXACT object the
 *  block ships — the component itself can't be mounted under `bun test` (bun resolves solid-js/web
 *  to its SERVER build, so `render()` throws "Client-only API called on the server side"; that is
 *  why there is not one .test.tsx in this repo) — see the file header for why this also had to move
 *  out of the .tsx file entirely, not just out of the effect. */
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
    labelEveryNode: true, // a diagram's labels ARE its content — see EmbeddedGraph.tsx's file header
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
