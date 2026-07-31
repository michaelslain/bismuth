// app/src/graph/AsciiGraphRenderer.ts
//
// The knowledge graph as a CHARACTER FIELD. Same job as the old CanvasGraphRenderer (project a
// graph, orbit it, hover/click it) but the output is a fixed grid of monospace characters for
// nodes — the degree ramp "." leaf → "o" linked → "@" hub — a sparse deterministic noise texture
// underneath, and plain text labels on the grid. EDGES are the one exception: real anti-aliased
// vector strokes (see strokeEdges()), drawn straight onto the canvas beneath every glyph and every
// label plate — a deliberate divergence from the character-edge vocabulary the design card
// originally specified (design/ascii/design-system/guidelines/ascii-graph.card.html), because the
// user asked for "the lines how they were in the original" (a real Canvas2D stroke), just with
// ASCII nodes/labels. It still draws onto a Canvas2D context — one fillText per colour RUN per row
// for glyphs/labels, a handful of batched `stroke()` calls for edges — so it keeps canvas
// performance while looking like a terminal. Nothing is ever CSS/ctx-scaled.
//
// THE LAW (design/ascii/design-system/guidelines/ascii-zoom.card.html, PORTING.md §4):
//   ZOOM IS RESOLUTION. The cell is a constant size at every zoom level. What zooming changes is
//   the world-units-per-cell ratio — 100% fits the whole graph on the grid (graph-size RELATIVE:
//   the fit scale is derived from the graph's own bounding radius), 0% is a FIXED absolute
//   resolution where every note is individually distinguishable, identical world-per-cell
//   regardless of graph size (see asciiGrid.ts DEEPEST_WORLD_PER_CELL/maxResFor). No transform:
//   scale, no ctx.scale on glyphs; zoom moves in 10% steps (wheel notches / +- keys) that the field
//   glides toward, re-rasterizing at a finer world→cell mapping each frame of the glide.
//
// The 3D mode is the same grid: the camera math is lifted verbatim from CanvasGraphRenderer's
// project()/projectPositions() (worldScale/target subtract → yaw → pitch → perspective divide),
// and the projected points are snapped onto cells and re-rasterized every frame. Depth is encoded
// by shifting the DEGREE RAMP between bands and fading alpha — never by changing the font size —
// and, for edges, by the same depth-banded alpha falloff the old renderer used (see strokeEdges()).
//
// The pure arithmetic (grid sizing, world→cell snapping, the glyph ramp, the cell hit test) lives
// in ./asciiGrid.ts and is unit-tested there. Its Bresenham trace ("- | / \" with "+" junctions) is
// no longer used by this renderer at all: the LOD aggregate connectors were its last caller, and
// they are vector strokes now too (see the GROUP LINES block) — a character is an order of
// magnitude more ink than a hairline, and at the default 2D view they read as a stair-stepped grey
// scribble across the field rather than as structure. EVERY line the field draws is a vector stroke.
//
// THE ZOOM LADDER runs in three bands (backbone.ts `bandsForT`, and its header):
//   far  — territory masses + cluster names, joined by aggregate connectors (lod.ts)
//   mid  — individual glyphs, joined by a hub-to-hub BACKBONE over the active hierarchy level
//   near — individual glyphs, joined by their real member edges
// plus the colour-tinted intra-cluster mesh at every stop the glyphs are on. The two handovers are
// crossfades, not switches, and `lodMix` owns both ends of the first one — see the field docs on
// `glyphAlpha`/`memberEdgeAlpha` for the trap of collapsing them into a single number.

import "./asciiGraph.css";
import type { GraphData, GraphNode } from "../../../core/src/graph";
import { nodeVisualState } from "../../../core/src/daemonViz";
import {
  clusterLabelAlpha, clusterLabelText, clusterLevelAlphas, computeAlwaysOnSet, eyebrowWidthCells,
  FILE_LABEL_FADE_SPAN, fileLabelAlpha, fileLabelBudget, FILE_LABEL_REVEAL_T, levelBoundaries,
} from "./labelSelection";
import {
  buildColorSlots, clusterExtent, clusterLabelLift, inViewport, pathOf, pickHubAnchor, trimDanglingWord,
} from "./clusterVisual";
import { hashKey } from "../themeColors";
import { isUsableBox, finiteVec3, boundingRadius, boundingHalfExtents, fitScaleForBox } from "./graphFit";
import { structuralGraphSig, shouldResetView } from "./graphStability";
import { noiseField, DEFAULT_NOISE_SEED } from "../ui/ascii/noiseField";
import {
  AGG_EDGE_ALPHA_MIN, AGG_EDGE_DOUBLE_W, LOD_ALPHA_EPS, buildLodIndex, lodMix, massCellAlpha,
  massCellCode, massRadii, type LodLevel,
} from "./lod";
import {
  EDGE_WEIGHT_BUCKETS, buildLevelEdges, computeEdgeLevelWeights, edgeWeightBucketRange,
} from "./backbone";
import type { CommunityCentroid, GraphConfig, GraphRenderer, HoverNode, NodeForUI, Vec3 } from "./graphRenderer";
import { buildBloom, pushCloud, type BloomPoint, type DensityField } from "./densityField";
import { dollyForT, zoomT } from "./cameraModel";
import {
  scaleToSpacing, createSpacingCache, cloneVec3Array, type SpacingCache, type Vec3 as RespaceVec3,
} from "./respace";

/** Numeric per-frame snapshot for QA (`window.__asciiGraphStats`, DEV builds only) — lets the
 *  redesign's fit/LOD/label criteria be asserted against directly instead of eyeballed off a
 *  screenshot. See `AsciiGraphRenderer.computeStats()`. */
export interface AsciiGraphStats {
  zoomPct: number;         // 100 = fit .. 0 = deepest (resolutionPercent)
  entitiesDrawn: number;   // aggregate cluster masses actually rasterized this frame
  labelsDrawn: number;     // this.labels.length (file + cluster names combined)
  labelOverlaps: number;   // count of label PAIRS on the same row whose [col, col+widthCells] spans intersect
  maxLabelChars: number;   // longest label's text.length this frame
  notesOnScreen: number;   // leaf (real) nodes rasterized this frame
  edgesClassified: number; // real member edges that survived the budget rank + projection cull AND the
                           // locality gate, and were sorted into a stroke bucket. NOT a count of lines
                           // drawn — in the mid band the member tier is bucketed and then held at zero
                           // alpha, so on the reference vault this reads in the thousands while ~18 lines
                           // are stroked. Use `edgesStroked` for that. Equals
                           // `edgesIntraVisible + edgesCrossVisible` exactly (the three-way split below).
  edgesIntraVisible: number; // ...of which BOTH endpoints sit in the SAME in-view cluster: the structure
                           // of the neighbourhood on screen.
  edgesCrossVisible: number; // ...of which the endpoints sit in two DIFFERENT in-view clusters (or one of
                           // them has no community at all, so no backbone line could stand in for it).
  edgesTransitingDropped: number; // real member edges the locality gate dropped: at least one endpoint's
                           // cluster has nothing on screen, so the line merely transits the viewport on its
                           // way between two places the user cannot see. See `inViewClusters`.
  edgesStroked: number;    // line segments actually issued to the canvas this paint, all three tiers
                           // (group lines + intra-cluster mesh + member edges)
  backbonePairsDropped: number; // connected community pairs the MAX_LEVEL_PAIRS cap threw away, summed over
                           // levels (build-time, not per frame). Silent truncation is ambiguous with "that
                           // many pairs exist" — buildLevelEdges returns it precisely so a QA hook can say so.
  inkCoverage: number;     // bounding-box area of non-empty cells / (cols*rows) — glyph/label ink only;
                           // NO edge of any kind occupies a cell any more, so this is pure glyph/label ink
  bloomPoints: number;     // points handed to buildBloom this frame (masses in the far band, glyphs in the
                           // mid/near band, both across the crossfade — see emitBloom)
  bloomWeight: number;     // their total PRE-NORMALISATION weight. Measured on the INPUT on purpose:
                           // buildBloom normalises its peak to exactly 1, so the emitted field looks
                           // equally bright whether it came from 2000 nodes or from none. ~conserved
                           // across the mass->glyph handover; a dip here is the atmosphere going dark.
  bloomSdx: number;        // weighted per-axis spread of those points, in 0..1 SCREEN FRACTIONS, also
  bloomSdy: number;        // pre-blur. The blur adds a fixed ~5.3-cell variance to whatever it is
                           // handed, which on the emitted FIELD swallows per-axis scale errors up to
                           // ~25% — so "the summary is the right SIZE" is only checkable here, before
                           // that convolution. Separate x and y, never one radius: the two convert
                           // through different denominators (W vs H) and swapping them is exactly the
                           // kind of error a single number hides.
}
import {
  CELL_H, CELL_W, FONT_PX,
  LAYER_NODE, LAYER_NOISE, PAD_X, PAD_Y, ZOOM_STEP_PCT,
  depthAlpha, fitPxPerWorld, gridMetrics, maxResFor, nearestCellNode,
  nodeGlyph, pxToCell, quantizePan, resFromPercent, resFromT, resolutionPercent, resolutionT,
  snapZoomPercent,
  type GridMetrics,
} from "./asciiGrid";

const FOV_DEG = 60;              // same camera as the old renderer, so framing carries over
// The projection's two clip planes, as fractions of the camera's distance to the TARGET (`P - dolly`
// — see projectNodes; with no dolly that distance is `P` and these reduce to the old renderer's
// literal `persp > 0.05 && zc < P * 0.985`, which is where both numbers come from, unchanged).
// NEAR_PLANE_SLACK is what keeps `persp` off the projection's singularity — a node is culled once it
// is within this fraction of the camera plane, capping `persp` at 1/NEAR_PLANE_SLACK ≈ 67×.
const NEAR_PLANE_SLACK = 0.015;
const MIN_PERSP = 0.05;          // far cull: a node 20x the FOCAL length behind the target is gone (see projectNodes)
/** Shared, never-mutated "this frame has no mass band" value for `massLevelAlphas` — 3D, "local"
 *  mode and community-less graphs assign it every frame, so it must not allocate. */
const NO_MASS_LEVELS: readonly number[] = [];
const ORBIT_SPEED = 0.005;       // rad per px of drag (copied)
const DRAG_THRESHOLD = 5;        // px before a press becomes an orbit/pan rather than a click
// TIME-based (not frame-rate dependent) exponential ease-out toward the camera goal (resolution +
// target): factor = 1 - exp(-dt/GLIDE_TAU_MS) applied each tick, so the SAME real-world settle time
// results regardless of the host's refresh rate. 110ms: at dt-accumulated 300ms (a comfortable
// "~250-350ms per stop" feel) the glide is ~95% converged — reads as settled, not a snap. Replaces
// the old per-FRAME constant (`res += (goal-res)*0.18` every tick call, independent of elapsed time)
// which was tuned back when a 10% zoom-ladder notch was a small magnification step; now that a notch
// is ~1.5x (asciiGrid.ts DEEPEST_WORLD_PER_CELL's deeper absolute floor widened the ladder's range),
// the same per-frame catch-up snapped to each stop in only a few frames, reading as a jump cut.
const GLIDE_TAU_MS = 110;
// The node-count-independent resting spacing respace.ts's `scaleToSpacing` rescales every build's
// positions onto (see build()). MUST be 14.0 — that's not a natural-looking grid unit, it's the exact
// calibration input `asciiGrid.ts`'s DEEPEST_WORLD_PER_CELL comment records ("the vault's own local
// spacing ... has a median nearest-neighbour distance of 14.0 world units"). DEEPEST_WORLD_PER_CELL
// derives the deep-zoom ladder's fixed absolute floor FROM that 14.0 figure, which used to be true only
// for the one vault it was measured on — any OTHER vault's own median spacing silently mis-scaled the
// ladder. Rescaling every graph's resting spacing to this same 14.0 makes the ladder correct for any
// vault, not just the reference one. If this ever changes, MIN_ZOOM_SPAN and the RING_SCALE test
// constant in AsciiGraphRenderer.test.ts must move with it (asciiGrid.ts:293 says so explicitly).
const RESPACE_TARGET_SPACING = 14.0;
const FALLBACK_MAX_RES = 16;     // pre-fit() bootstrap value for `maxRes` (real one is graph/box-derived — see fit())
const WHEEL_NOTCH_PX = 120;      // one physical mouse-wheel click (the Windows WHEEL_DELTA convention most
                                  // browsers report a notch as); each notch moves ZOOM_STEP_PCT, trackpad
                                  // deltas simply accumulate toward the next notch instead of firing every event
const RES_EPS = 0.002;           // below this the resolution glide is considered settled
const NOISE_DENSITY = 0.08;      // texture, never the signal (the design card defaults GLYPHS to 0%)
const NOISE_ALPHA = 0.45;        // tokens/ascii.css --field-noise-op
const DEPTH_BANDS = 3;           // "." far / "o" mid / "@" near — the ramp shift, not a font change
export const DIM_ALPHA = 0.28;   // NODE non-focus dimming on hover / cluster highlight — glyphs read fine
                                  // much dimmer than lines do, so this is deliberately NOT shared with
                                  // edges (see EDGE_DIM_ALPHA below — reusing this one for edges was bug).
// Dense-graph edge thinning (stable per-edge rank, like the old renderer). Adopted VERBATIM from
// CanvasGraphRenderer.ts:179-180 — ASCII shipped a single 2600/0.12 pair for both dimensions, less
// than half the budget, so a dense vault (the reference one has 4566 edges) drew a visibly thinner
// graph here than the renderer this one replaces. The 3D FLOOR is deliberately much higher than the
// 2D one: in 3D the depth-band falloff already thins the far half of the cloud optically, so
// dropping the same fraction structurally on top of it reads as holes.
const EDGE_BUDGET_2D = 6000, EDGE_FLOOR_2D = 0.06;
const EDGE_BUDGET_3D = 6000, EDGE_FLOOR_3D = 0.45;
// Colour-tinted INTRA-CLUSTER MESH alpha (CanvasGraphRenderer.ts:131). A cluster's BODY is its
// internal edges — without them a cluster on the glyph bands reads as a dot cloud, not a woven mass.
const INTRA_EDGE_ALPHA = 0.22;
const MESH_W_BASE = 0.3, MESH_W_MIN = 0.12, MESH_W_MAX = 1.1;  // CanvasGraphRenderer.ts:1298
/** Endpoint pull-back for every vector line, in CELL WIDTHS — see strokeEdges()' CLEARANCE comment
 *  for the derivation. One constant so the member tier and the group tiers can't drift apart. */
const CLEARANCE_CELLS = 0.55;
// GROUP LINES — the far band's aggregate connectors and the mid band's hub-to-hub backbone, both
// vector-stroked through the same batched path (see queueGroupLine/strokeGroupLines). Widths ported
// from CanvasGraphRenderer.ts:1259/1265; `GROUP_W_BASE + wb * GROUP_W_STEP` is its per-weight-bucket
// ramp, and the clamp is its own [0.25, 2.4].
const GROUP_W_BASE = 0.35, GROUP_W_STEP = 0.55, GROUP_W_MIN = 0.25, GROUP_W_MAX = 2.4;
/** Lightest weight bucket's share of a group line's alpha (CanvasGraphRenderer.ts:1260's `0.55 +
 *  0.45 * ((wb + 0.5) / WB)`) — heavier group links read heavier, but the lightest still reads. */
const GROUP_EDGE_ALPHA_MIN = 0.55;
/** Group-line batching granularity: alphas are quantized to 1/GROUP_ALPHA_STEPS and batched with the
 *  line width, so a level's lines cost a handful of `stroke()` calls rather than one per line —
 *  the same "one path per alpha tier" discipline strokeEdges() uses for member edges. */
const GROUP_ALPHA_STEPS = 24;
const HIT_RADIUS_CELLS = 2;      // cells searched outward from the cursor for a node
const CLUSTER_LABEL_TRACKING_EM = 0.14; // tokens/typography.css --ls-eyebrow, applied via ctx.letterSpacing

// VECTOR EDGE STROKING (see strokeEdges()) — the pre-redesign CanvasGraphRenderer's edge appearance,
// ported onto this field's camera/culling instead of drawn as grid characters.
// EDGE_DIM_ALPHA is its own constant (NOT the node DIM_ALPHA above, 0.28 — a past bug reused it and
// made a dimmed edge read BRIGHTER than an in-focus depth band in 3D) — CanvasGraphRenderer.ts:847/851
// dims non-focus/non-incident edges to `op * 0.05`; --graph-edge already bakes `op` in (see
// deriveEdgeBaseAlpha()'s derivation below), so the faithful multiplier here is bare 0.05.
export const EDGE_DIM_ALPHA = 0.05;
// `EDGE_BASE_ALPHA_FALLBACK` is the pre-first-restyle() default for the per-theme `edgeBaseAlpha`
// instance field (see deriveEdgeBaseAlpha() + readTokens()) — NOT a fixed "1" for every theme. Measured
// (see AsciiGraphRenderer.test.ts "edge base alpha"): a flat alpha of 1 is correct on ink/cathode (their
// --graph-edge token already composites close to the original CanvasGraphRenderer's neutral-at-opacity
// weight — ink ratio ~0.92, cathode ~1.0, both cheaply within rounding of "no attenuation needed") but
// is badly wrong on paper/riso, where the original's LIGHT-theme dampening (a 45%-toward-background
// colour mix at a lower 0.2 opacity — GraphView.tsx buildConfig()) made the original's line far
// fainter than --graph-edge stroked at full alpha (paper needs ~0.47, riso ~0.34 — see
// deriveEdgeBaseAlpha()'s doc comment for the derivation). So this is NOT "the single knob to nudge if
// lines read heavy/faint" any more — it is a computed-once-per-theme value; nudge deriveEdgeBaseAlpha
// (or its inputs, --graph-edge/--text-muted/--graph-bg) instead.
const EDGE_BASE_ALPHA_FALLBACK = 1;
export const EDGE_W_GAIN = 0.4, EDGE_W_MIN = 0.08, EDGE_W_MAX = 1.6; // CanvasGraphRenderer.ts drawCanvas()
const EDGE_DEPTH_MIN = 0.04, EDGE_DEPTH_CURVE = 2.4;          // CanvasGraphRenderer.ts DEPTH_MIN_OPACITY/DEPTH_CURVE
const EDGE_DEPTH_BANDS = 6;                                   // CanvasGraphRenderer.ts drawCanvas()'s 3D depth banding

// Colour slots. Every colour is a CSS custom property read off the host, so a theme switch is a
// re-read (the old renderer took ints through setConfig; here the tokens ARE the source).
const C_G0 = 0, C_G1 = 1, C_G2 = 2, C_G3 = 3, C_G4 = 4;
const C_FG = 5, C_MUTED = 6, C_FAINT = 7, C_ACCENT = 8, C_EDGE = 9;
const COLOR_VARS = ["--graph-0", "--graph-1", "--graph-2", "--graph-3", "--graph-4", "--fg", "--text-muted", "--faint", "--accent", "--graph-edge"];
const COLOR_FALLBACK = ["#f0509b", "#9b53e8", "#3f6bf0", "#27c7d9", "#43d49a", "#e8e8ee", "#9aa0b4", "#6b7086", "#3f6bf0", "#3C4048"];
const RAMP = [C_G0, C_G1, C_G2, C_G3, C_G4];
// COMMUNITY COLOUR SLOTS (see rebuildCommunityColors()/colorLevelsFor/restyle + rasterize's colour
// block, and clusterVisual.ts's buildColorSlots): every (hierarchy level, community) pair gets its
// OWN resolved colour — ranked by member count, not hashed — via buildColorSlots against ASCII's
// `--graph-0..4` tokens as the palette. That is a MUCH bigger space than the old 5-slot RAMP (a real
// vault's finer levels can carry dozens of communities), so colours live in a flat per-build array
// (`this.commColors`) instead of the fixed `this.colors` table, addressed on `colorBuf` starting at
// `BLEND_BASE`. `COMM_BLEND_BASE` (below) starts a SEPARATE, per-frame-memoized range for the
// LEVEL-DRIVEN COLOR crossfade — blending two community colours together while the camera walks
// between adjacent hierarchy levels — built lazily (only the (a,b) pairs a frame actually asks for,
// not the full cross product) because the community space is no longer small enough to precompute in
// full up front. `colorBuf` is a Uint16Array (not Uint8) precisely to give this range room.
const BLEND_BASE = 16;
// Lazily-memoized LEVEL-DRIVEN COLOR blend slots — see blendColorSlot()/resolveFillColor(). Set well
// above any realistic `commColors` span (BLEND_BASE.. ) so the two ranges never collide; MAX_BLEND_SLOTS
// keeps the memo inside Uint16Array's ceiling regardless of how many distinct (a,b) pairs a frame asks
// for (a pathological graph degrades to a hard colour cut instead of an out-of-range write — see
// blendColorSlot()).
const COMM_BLEND_BASE = 50000;
const MAX_BLEND_SLOTS = 15000;
const BLEND_KEY_MUL = 65536; // exceeds any possible colorBuf slot value — safe as a plain JS Map key, never written to a buffer
// Padding (px) added to the actual canvas box before a screen point counts as "in the viewport" for
// label-candidate purposes — ported from CanvasGraphRenderer.ts's inViewport call sites (40px) via
// clusterVisual.ts's inViewport(). See layoutLabels()/layoutClusterNames().
const VIEWPORT_LABEL_PAD = 40;
/** Shared empty roster — the fail-closed fallback in layoutClusterNames (see `namableByLevel`). */
const EMPTY_COMMUNITY_SET: ReadonlySet<number> = new Set<number>();

/** Parse a CSS colour STRING (the tokens table only ever holds `#rgb`/`#rrggbb` hex — see
 *  theme/tokens.ts — or, defensively, `rgb()`/`rgba()`) into 0..255 channels for the LEVEL-DRIVEN
 *  colour blend's per-tick RGB lerp. Returns null on anything else so the caller can fall back to a
 *  neutral colour instead of propagating a NaN into the paint. */
function parseColorToRGB(css: string): [number, number, number] | null {
  const s = css.trim();
  if (s[0] === "#") {
    const h = s.slice(1);
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16), g = parseInt(h[1] + h[1], 16), b = parseInt(h[2] + h[2], 16);
      return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? [r, g, b] : null;
    }
    if (h.length >= 6) {
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? [r, g, b] : null;
    }
    return null;
  }
  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
}

type RGB = [number, number, number];
const rgbDist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Standard (ungamma-corrected — plenty precise for a light/dark call, not colour-managed output)
 *  sRGB relative luminance, 0..255 scale. Used only to classify a resolved background as light or
 *  dark from its ACTUAL colour, never a theme name — see deriveEdgeBaseAlpha(). */
const srgbLuminance = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * The per-theme scalar `strokeEdges()` multiplies onto its --graph-edge stroke so the composited
 * result MATCHES the pre-redesign CanvasGraphRenderer's edge weight for the theme currently resolved
 * — not a flat "1" (see EDGE_BASE_ALPHA_FALLBACK's comment for why that was wrong on light themes).
 *
 * GraphView.tsx's buildConfig() is the fidelity reference: dark scopes stroke the theme's raw neutral
 * (`--text-muted`) colour at `edgeOpacity` 0.32; light scopes first blend neutral 45% toward the
 * background (a raw grey line reads far heavier on a pale canvas than a dark one) and stroke at a
 * lower 0.2 — see its `ap.isLight` branch. "Light" here is derived from the resolved background's OWN
 * luminance (srgbLuminance), not a theme-name lookup, so this is one formula for any theme, present or
 * future — never a per-theme branch.
 *
 * Canvas src-over compositing is LINEAR in alpha (composite = bg + alpha*(fg-bg)), so the visual
 * "distance from background" a stroke produces is directly proportional to alpha. That makes solving
 * for the equivalent alpha one division: the original's composited distance (at ITS colour+opacity)
 * divided by --graph-edge's distance from the SAME background at alpha 1. Clamped to [0,1] — a theme
 * whose --graph-edge is already fainter than the original's target needs no attenuation (>1 would mean
 * "boost it past full alpha", which a plain stroke can't do and shouldn't need to: 1 is already a very
 * close match on the two themes measured that way — see the test).
 */
export function deriveEdgeBaseAlpha(neutralCss: string, bgCss: string, edgeCss: string): number {
  const neutral = parseColorToRGB(neutralCss), bg = parseColorToRGB(bgCss), edge = parseColorToRGB(edgeCss);
  if (!neutral || !bg || !edge) return EDGE_BASE_ALPHA_FALLBACK;
  const isLight = srgbLuminance(bg) > 127.5;
  const origColor = isLight ? mixRGB(neutral, bg, 0.45) : neutral;
  const origOpacity = isLight ? 0.2 : 0.32;
  const origDist = rgbDist(origColor, bg) * origOpacity;
  const edgeDist = rgbDist(edge, bg);
  if (edgeDist <= 0) return EDGE_BASE_ALPHA_FALLBACK;
  return Math.max(0, Math.min(1, origDist / edgeDist));
}

/**
 * The two endpoints `strokeEdges()` actually `moveTo`/`lineTo` for one edge segment, each pulled
 * back `clearance` px along the segment from its raw cell-centre point — see strokeEdges()'s doc
 * comment (CanvasGraphRenderer painted an OPAQUE node disc over its endpoints; a thin glyph doesn't,
 * so an untrimmed vector line runs straight through the glyph's interior/counters).
 *
 * Segments no more than `2 * clearance` apart are returned UNTRIMMED rather than pulled back — two
 * clearances that size would meet or cross, inverting the segment's direction and drawing it
 * backwards (near-coincident or overlapping nodes, e.g. two notes at the same LOD cell). Pure +
 * unit-tested (AsciiGraphRenderer.test.ts "segment clearance").
 */
export function trimSegmentForClearance(
  ax: number, ay: number, bx: number, by: number, clearance: number,
): [number, number, number, number] {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len <= clearance * 2) return [ax, ay, bx, by];
  const ux = dx / len, uy = dy / len;
  return [ax + ux * clearance, ay + uy * clearance, bx - ux * clearance, by - uy * clearance];
}

/**
 * Clamp a 3D edge's average depth-fraction (`(a.dr+b.dr)/2`, nominally 0..1) into a valid
 * `edgeBands` index. A non-finite midpoint — one endpoint's `dr` going NaN, which projectNodes()
 * CAN produce from a degenerate camera/projection state (e.g. `minZ`/`maxZ` themselves hitting an
 * infinity, poisoning `(depth-minZ)/span` for every node sharing that frame's span) — must NOT
 * propagate into the index: `Math.floor`/`Math.min`/`Math.max` all return NaN once fed one, and
 * `this.edgeBands[NaN]` is `undefined`, so `.push()` throws inside the rAF tick and the render loop
 * dies (the field freezes). Falls back to band 0 (farthest) instead. Pure + unit-tested
 * (AsciiGraphRenderer.test.ts "safe depth band").
 */
export function safeDepthBand(mid: number, bands: number): number {
  if (!Number.isFinite(mid)) return 0;
  return Math.max(0, Math.min(bands - 1, Math.floor(mid * bands)));
}

const DEFAULT_CONFIG: Partial<GraphConfig> = {
  viewMode: "3d", showGraphLabels: true, graphLabelHubCount: 10, spin: true, spinSpeed: 0.0015,
  backgroundNoise: false,
};

interface NodeView {
  node: GraphNode;
  p3: Vec3;
  p2: Vec3;
  deg: number;
  color: number;   // index into this.colors — the FINEST-level (or fixed-kind) slot; see colorByLevel
  /** RAMP slot (0..4) the node would show at EACH hierarchy level, coarsest → finest — precomputed
   *  once in restyle() (colorLevelsFor), never re-hashed per frame. Length 1 for a node with no
   *  community at all (self/daemon/cron/process, or community-less legacy data): every consumer
   *  treats that as "fixed colour, never blended". See rasterize()'s LEVEL-DRIVEN COLOR block. */
  colorByLevel: number[];
  dim: boolean;    // daemon-disabled → drawn faint
  // per-frame scratch
  sx: number; sy: number; depth: number; dr: number;
  col: number; row: number; onGrid: boolean;
  // Perspective validity (3D): the projected point is in FRONT of the camera / past the near-clip —
  // meaningful independent of whether it lands inside the grid's col/row bounds. `onGrid` above is
  // `projValid && within bounds`; edges (real, vector-stroked — see strokeEdges()) gate on
  // `projValid` alone, exactly like the pre-redesign CanvasGraphRenderer's `onScreen` — the canvas's
  // own paint-time clip handles an edge whose far endpoint is merely off-field, so its on-screen
  // portion still draws instead of the edge being dropped entirely. Always true in 2D (no
  // perspective to fail).
  projValid: boolean;
}
interface EdgeView { a: NodeView; b: NodeView; kr: number }
/** One LOD aggregate entity on the field — a hierarchy-level community rendered as a single ASCII
 *  mass. Built once per graph build (structure) with per-frame screen scratch, mirroring NodeView. */
interface EntityView {
  flat: number;          // index into entityFlat (what cellEntity stores)
  level: number;
  community: number;
  count: number;
  wx: number; wy: number; // members' 2D world centroid (same space as NodeView.p2)
  sdx: number; sdy: number; // members' per-axis world spread about it (lod.ts LodCluster.sdx/sdy) —
                          // how big the summarized thing IS, which the bloom needs and the compact
                          // mass GLYPH's own rowR/colR deliberately are not. See emitBloom().
  color: number;          // ramp slot — the SAME key layoutClusterNames uses, so mass == name colour
  name: string;
  rowR: number; colR: number; // uncapped mass radii in cells (sqrt scaling — lod.ts massRadii)
  memberIds: string[];
  // per-frame scratch
  sx: number; sy: number; col: number; row: number; onGrid: boolean;
  drawnRowR: number; drawnColR: number; // grid-capped radii for this frame
}
interface LabelDraw {
  // A resolved CSS colour string, not a colorBuf slot — labels never blend (only alpha crossfades),
  // and a cluster name's colour comes straight out of `buildColorSlots` (an already-final hex, no
  // slot indirection needed), so callers resolve once at label-creation time via resolveFillColor()
  // (fixed slots) or the raw buildColorSlots hex (community names) rather than at paint time.
  text: string; col: number; row: number; color: string; accent: boolean;
  alpha: number;      // crossfade multiplier — forced file labels and cluster names ignore this differently (see paint())
  eyebrow?: boolean;  // cluster name: uppercase + tracked, drawn at full brightness × alpha
  // Real drawn width in cells (eyebrowWidthCells for a tracked cluster name, plain text.length for a
  // file label) — the SAME span the occupancy reservation used, so debug/QA instrumentation
  // (window.__asciiGraphStats) can check for overlaps without recomputing tracking math.
  widthCells: number;
}

// A node's hierarchy path, coarsest → finest, is `pathOf` (clusterVisual.ts) — imported rather than
// re-derived (see that function's docblock for the two edges it handles: `community: 0` is not
// absent, and a per-level lookup must clamp `path[Math.min(L, path.length - 1)]`, never index past a
// shallower node's own path).

/** The exemplar name per level, mirroring `pathOf`'s fallback. */
function nodePathLabels(n: GraphNode): string[] | undefined {
  if (n.communityPathLabels && n.communityPathLabels.length) return n.communityPathLabels;
  return n.community != null ? [n.communityLabel ?? `cluster ${n.community}`] : undefined;
}

/** Wikilink/tag flavouring so a label reads like the vault does (design's `[[note name]]`). */
function labelText(n: GraphNode): string {
  // vault.ts already builds a tag node's label WITH its "#" (`label: \`#${tag}\``), so prefixing
  // unconditionally printed "##research" on the field.
  if (n.kind === "tag") return n.label.startsWith("#") ? n.label : "#" + n.label;
  if (n.kind === "note" || n.kind === "memory") return "[[" + n.label + "]]";
  return n.label;
}

export class AsciiGraphRenderer implements GraphRenderer {
  private host?: HTMLElement;
  private viewport!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private ro?: ResizeObserver;
  private dpr = 1;

  private cfg: GraphConfig = { ...DEFAULT_CONFIG } as GraphConfig;

  // graph data
  private nodes: NodeView[] = [];
  private byId = new Map<string, NodeView>();
  private edges: EdgeView[] = [];
  private adjacency = new Map<string, Set<string>>();
  private sig = "";
  // Per-structural-signature memo for scaleToSpacing (respace.ts) — a re-visited graph shape (a mode
  // toggle back to one already settled this session) is a Map lookup, not an O(n²) remeasure. Separate
  // caches per dimension: 2D (`position2d`) and 3D (`position`) are independent point clouds with their
  // own median nearest-neighbour distance, so their rescale factors legitimately differ. `clone` is
  // `cloneVec3Array`, never identity — see respace.ts's own header for why an identity clone on a
  // reference type would silently reinstate the exact position-corruption hazard this cache exists to
  // prevent (the 2D<->3D morph lerps p2/p3 in place every frame).
  private p3SpacingCache: SpacingCache<RespaceVec3[]> = createSpacingCache(cloneVec3Array);
  private p2SpacingCache: SpacingCache<RespaceVec3[]> = createSpacingCache(cloneVec3Array);
  private radius3 = 1; private radius2 = 1;
  // 2D-only bounding-BOX half-extents (see graphFit.ts boundingHalfExtents/fitScaleForBox) — the
  // fit-to-100% law for a rectangular field fills each AXIS to FIT_FILL_FRACTION independently,
  // rather than reading a single circumscribing radius (which over-reads a wide/short cloud and
  // only considers the field's shorter axis). 3D keeps radius2/radius3-style fitting (see fit()).
  private half2 = { hx: 1, hy: 1 };

  // grid + buffers (reused across frames — nothing is allocated in the hot loop)
  private m: GridMetrics = gridMetrics(1, 1, CELL_W, CELL_H);
  private W = 1; private H = 1;
  private charBuf = new Uint16Array(1);
  private layerBuf = new Uint8Array(1);
  // Uint16, not Uint8: colorBuf slots now range over the per-build community-colour space
  // (BLEND_BASE..) and the per-frame blend memo (COMM_BLEND_BASE..) — see the COMMUNITY COLOUR
  // SLOTS comment above RAMP/BLEND_BASE.
  private colorBuf = new Uint16Array(1);
  private alphaBuf = new Uint8Array(1);
  private cellNode = new Int32Array(1);
  private noiseBuf = new Uint16Array(1);
  private labelOccupied = new Uint8Array(1);
  private labels: LabelDraw[] = [];
  private labelScratch: NodeView[] = [];
  // layoutClusterNames()'s per-frame candidate scratch: community → its VIEWPORT-VISIBLE members
  // this frame (see clusterExtent()'s call-site contract — deliberately NOT the whole-graph
  // membership `clusterHubByLevel` below uses).
  private clusterAgg = new Map<number, NodeView[]>();
  /** THE LOCALITY GATE's per-frame answer to "which clusters am I actually looking at" — the set of
   *  cluster COLOUR SLOTS (`NodeView.colorByLevel` at the frame's dominant level, which is a globally
   *  unique key per (level, community) — see rebuildCommunityColors()) that have at least ONE member
   *  inside the padded viewport. Rebuilt every frame the leaf pass runs, from exactly the predicate
   *  `layoutClusterNames` already aggregates `clusterAgg` with (`projValid && inViewport(…,
   *  VIEWPORT_LABEL_PAD)`), so "on screen" means one thing in this renderer, not two.
   *
   *  **Why a member count of ONE and not a share.** The user's report was that at deep zoom their own
   *  neighbourhood's structure was buried under long lines transiting from clusters they could not
   *  see. The fix has to drop those without ever hiding a relationship whose two ends are both on
   *  screen — this project's first rule is that the graph may not lie. With "has ≥1 visible member"
   *  that second property is not a special case bolted on, it is a THEOREM: if both endpoints are in
   *  the viewport then each one is itself a visible member of its own cluster, so both clusters are in
   *  this set and the edge is kept. Any share-based bar (`clusterLabelThreshold`'s
   *  `max(6, 1.5% of visible)`, say) breaks that — it would silently drop edges between two visible
   *  glyphs whenever their communities are small, and a 4-note community can never clear an absolute
   *  floor of 6 at all. `clusterLabelThreshold` is the bar for earning a NAME (a scarce, overlapping,
   *  screen-space resource); "am I looking at this cluster" is a different question and takes a
   *  different, weaker answer.
   *
   *  Keyed on the COLOUR slot rather than a raw community id so the gate and the intra-cluster mesh
   *  read the one key: the mesh's `ca === cb` test at the same dominant level is the same "same
   *  cluster right now" question, and computing it twice from two different derivations is how the
   *  two silently drift apart. Slots below `BLEND_BASE` are the no-community fallbacks (self, daemon,
   *  cron/process, community-less data) and never enter this set — see the gate itself for why such
   *  an edge is exempt rather than dropped. */
  private inViewClusters = new Set<number>();
  // Per-level community → its display name, resolved once per build() (communityPathLabels is
  // static graph data, not a per-frame thing) so layoutClusterNames() never has to search for a
  // representative member. Index = hierarchy level (0 = coarsest); length = levelCount.
  private communityNamesByLevel: Map<number, string>[] = [];
  // Per-level community → its resolved display COLOUR (buildColorSlots' hex output — see
  // rebuildCommunityColors()), and → its colorBuf SLOT (BLEND_BASE + a flat index into
  // `commColors`/`commColorsRGB`). Rebuilt every restyle() (not just build()) because the palette —
  // unlike community structure — changes on a theme switch.
  private communityColorsByLevel: Map<number, string>[] = [];
  private communitySlotByLevel: Map<number, number>[] = [];
  private commColors: string[] = [];
  private commColorsRGB: [number, number, number][] = [];
  // Lazily-memoized LEVEL-DRIVEN COLOR blend results THIS FRAME (see blendColorSlot()) — cleared at
  // the top of EVERY frame rasterize()'s `colorW1` gate finds a crossfade actually in progress, not
  // just once when the crossfade begins: `w1` (the blend weight) changes every one of those frames,
  // so a memo entry from a previous frame's `w1` is stale and must not survive into this one — caching
  // across the whole crossfade instead of per-frame would freeze the animation partway through.
  private blendColors: string[] = [];
  private blendIndex = new Map<number, number>();
  // Whole-graph, PRECOMPUTED per-level community → hub member id (pickHubAnchor) — built once per
  // structural rebuild (build()), never per frame and never filtered to what's on screen. See
  // clusterVisual.ts pickHubAnchor's call-site contract: this is what layoutClusterNames() anchors
  // cluster names to, so a name and the mass it labels never disagree about where "the cluster" is,
  // and the anchor doesn't jump as members pan in and out of frame.
  private clusterHubByLevel: Map<number, string>[] = [];
  /** Per hierarchy level, WHICH communities are allowed to put a name on the field — the roster
   *  `buildLodIndex` admits as aggregate entities (`LOD_MIN_CLUSTER` members and up). Built once per
   *  structural build(), from `lodLevels`, so the two name passes read the SAME roster:
   *  `layoutEntityNames` iterates the entities themselves, `layoutClusterNames` filters against this.
   *
   *  **This is the fix for the 3D "text soup".** The zoom LADDER — which level owns the field, at
   *  what alpha, and when file names take over — was already shared: both passes are driven from
   *  `clusterLevelAlphas`/`clusterLabelAlpha` off the one `resolutionT`. What was NOT shared was the
   *  ROSTER, and that is what the picture showed. The reference vault's coarsest level holds 171
   *  communities of which only 15 clear `LOD_MIN_CLUSTER`; 2D named the 15 (it can only name what
   *  `buildLodIndex` built), 3D named every community it found on screen, and the other 156 are
   *  one-, two- and three-note communities whose exemplar name IS a note's own title. So at fit 3D
   *  drew 56 "cluster" names — "LAGGY EYE FOLLOWING", "ON TRANSNISTRIA", "MIDTERM 2 PRACTICE" — over
   *  the glyph field, which reads as file-name soup and was reported as one. (It peaked at 109
   *  around the 80%/60% stops, not at fit.) A community under this threshold is not one the LAYOUT
   *  placed either (core/src/layout.ts uses the same 4 to decide which cluster earns a grid cell —
   *  see LOD_MIN_CLUSTER's doc), so naming it was never naming a cluster.
   *
   *  Deliberately fail-CLOSED: a level with no entry names nothing. The alternative (skip the filter
   *  when the roster is missing) fails back into exactly the soup this exists to prevent, silently. */
  private namableByLevel: Set<number>[] = [];
  // Deepest hierarchy depth any node carries (1..4 typically; see core/src/graph.ts communityPath).
  // 0 means no node carries a community at all (no cluster names to draw).
  private levelCount = 0;
  private boxReady = false;

  // LOD (2D only — see lod.ts): the per-level aggregate structure, built once per build().
  private lodLevels: LodLevel[] = [];
  private entityLevels: EntityView[][] = [];
  private entityFlat: EntityView[] = [];
  private cellEntity = new Int32Array(1);  // cell → entityFlat index (-1 none), rebuilt per raster
  // Per-frame LOD state (written at the top of rasterize, read by the label + hit-test paths).
  private lodOn = false;
  // THE THREE-BAND LADDER (backbone.ts `bandsForT`, via lod.ts `lodMix`) — deliberately TWO fields,
  // not the one `leafAlpha` this used to be. In the mid band they take different values (glyphs on,
  // real member edges off, the backbone standing in for them), so a single shared number cannot
  // serve both: keyed off the glyph gate, `strokeEdges()` draws the full member hairball across the
  // whole mid band; keyed off the member alpha, the leaf raster pass never runs and there are no
  // glyphs at all. See backbone.ts's wiring recipe.
  /** The leaf/glyph RASTER gate (`1 - massAlpha`): whether individual note glyphs rasterize at all
   *  this frame, and at what alpha. Consumed by rasterize()'s leaf pass and layoutLabels()'s
   *  file-name gate. NOT an edge alpha. */
  private glyphAlpha = 1;
  /** The REAL MEMBER EDGE alpha (`bandsForT`'s near band). Consumed by strokeEdges()'s member
   *  passes only. NOT the glyph gate. */
  private memberEdgeAlpha = 1;
  /** Per-hierarchy-level MASS alpha this frame — `lodMix()`'s `levelAlphas` (`clusterLevelAlphas ×
   *  massAlpha`) — or `NO_MASS_LEVELS` on any frame with no mass band in play (3D, "local" mode, a
   *  community-less graph). `emitBloom()` is its ONLY consumer, and it needs its own field rather
   *  than reading `glyphAlpha`: the bloom's two inputs (masses, glyphs) are nonzero in DIFFERENT
   *  bands, so one number cannot tell it which pass has ink on the field this frame. An entry above
   *  `LOD_ALPHA_EPS` also certifies that `projectEntities(L)` ran this frame (rasterize()'s far-band
   *  loop skips a level only when its mass alpha is at-or-below that same epsilon AND its names are
   *  gone), so the screen positions the bloom reads off that level are never stale. */
  private massLevelAlphas: readonly number[] = NO_MASS_LEVELS;
  private hoverEntityIdx = -1;

  // Per-frame QA/debug counters (see computeStats/window.__asciiGraphStats) — reset + incremented in
  // rasterize()'s existing passes, never a separate loop.
  private entitiesDrawnFrame = 0;
  private notesOnScreenFrame = 0;
  /** Real member edges that SURVIVED rasterize()'s classification loop (budget rank + projValid + the
   *  LOCALITY GATE) and were sorted into a stroke bucket. NOT how many lines the frame drew: in the
   *  mid band every one of these is bucketed and then the whole member tier is held at zero alpha by
   *  `memberEdgeAlpha`, so this reads in the thousands on the reference vault while ~18 lines are
   *  actually stroked. See `edgesStrokedFrame` for that number — the two are far apart by design, and
   *  conflating them is how a QA metric ends up overclaiming. */
  private edgesClassifiedFrame = 0;
  /** The three-way split of what the LOCALITY GATE (see `inViewClusters`) did to the member edges
   *  this frame: kept because both endpoints are in ONE in-view cluster, kept because they are in TWO
   *  in-view clusters (or an endpoint has no community, which no backbone line could represent), and
   *  DROPPED as merely transiting. `intra + cross === edgesClassifiedFrame` by construction — the
   *  split is a partition of what was bucketed, not a second tally that could drift from it. */
  private edgesIntraVisibleFrame = 0;
  private edgesCrossVisibleFrame = 0;
  private edgesTransitingDroppedFrame = 0;
  /** Line segments actually issued to the canvas this paint, across all three tiers (group lines,
   *  intra-cluster mesh, member edges). Counted where the `moveTo`/`lineTo` pair is emitted, so a
   *  tier that early-returns on alpha contributes nothing. Reset by strokeEdges(), not rasterize():
   *  it counts paint work, and paint() runs after rasterize(). */
  private edgesStrokedFrame = 0;
  /** Points handed to `buildBloom` this frame, and their total PRE-NORMALISATION weight (see
   *  emitBloom). Both are deliberately measured on the INPUT, not the emitted field: `buildBloom`
   *  normalises its peak cell to exactly 1, so an emitted field is equally "bright" whether it was
   *  built from two thousand nodes or from one — a check on the output cannot tell a healthy
   *  atmosphere from a nearly-empty one, which is exactly the failure mode this pair exists to make
   *  visible. `bloomWeight` is the continuity number: it is ~conserved across the mass→glyph
   *  handover by construction (a mass carries its members' weight), so a dip in it IS the dark
   *  window. Written by emitBloom(), which runs after rasterize() in tick(). */
  private bloomPointsFrame = 0;
  private bloomWeightFrame = 0;
  /** ...and their weighted per-axis spread, in screen fractions — see `AsciiGraphStats.bloomSdx`
   *  for why the size of what the bloom emits is only measurable BEFORE `buildBloom`'s blur. */
  private bloomSdxFrame = 0;
  private bloomSdyFrame = 0;

  // Per-frame edge STROKE BUCKETS — rasterize() sorts surviving edges into these (by the alpha
  // they'll be stroked at), and paint()'s strokeEdges() issues one batched `stroke()` call per
  // bucket. Reused across frames (`.length = 0`, never reassigned), so the vector-edge pass
  // allocates nothing, same discipline as the old `putEdge` closure it replaces.
  private edgeAccent: EdgeView[] = [];                                   // hovered-incident, full alpha
  private edgeDim: EdgeView[] = [];                                      // dimmed by an active focus/highlight set
  private edgeMain: EdgeView[] = [];                                     // 2D, no depth fade
  private edgeBands: EdgeView[][] = Array.from({ length: EDGE_DEPTH_BANDS }, () => []); // 3D, far→near
  // The colour-tinted INTRA-CLUSTER MESH (CanvasGraphRenderer.ts:1271-1306): community colour SLOT →
  // this frame's intra-community edges, so the pass is one batched stroke per colour rather than one
  // per edge. The Map is kept across frames (the slot set is stable per build) and its arrays are
  // emptied, not reallocated — the same reuse discipline as the buckets above.
  private intraBuckets = new Map<number, EdgeView[]>();
  private intraOn = false;
  // GROUP LINES for this frame (far-band aggregate connectors + mid-band hub-to-hub backbone),
  // batched by (quantized alpha, width) — see queueGroupLine()/strokeGroupLines(). `pts` is a flat
  // [x0,y0,x1,y1,…] segment list; the Map persists across frames and the arrays are emptied.
  private groupBatches = new Map<string, { alpha: number; width: number; pts: number[] }>();
  // Per-level hub-to-hub backbone pairs (backbone.ts buildLevelEdges), resolved to NodeViews ONCE
  // per structural build — hubs are highest-degree members and communities don't move, so this is
  // build-time work, not per-frame. `levelPairsDropped[L]` is how many connected pairs level L's
  // `MAX_LEVEL_PAIRS` cap threw away (surfaced through computeStats, per buildLevelEdges' contract).
  private levelPairs: { a: NodeView; b: NodeView; count: number }[][] = [];
  private levelPairsDropped: number[] = [];

  // camera — rx/ry orbit (3D), res = THE zoom (resolution), pan in px (2D)
  private rx = -0.5; private ry = 0;
  private res = 1; private goalRes = 1;
  private target: Vec3 = [0, 0, 0]; private goalTarget: Vec3 = [0, 0, 0];
  private panX = 0; private panY = 0;
  // WORLD-anchored raster grid (the pan-jitter fix — see asciiGrid.ts quantizePan): `panX`/`panY`
  // above stay the continuous drag accumulator, but the world→cell PROJECTION uses the quantized
  // whole-cell `panXQ`/`panYQ` so the world→cell rounding phase never shifts mid-drag — the same
  // world-space line always rasterizes to the same discrete cells regardless of how far the field
  // has been panned. `panXFrac`/`panYFrac` are the leftover sub-cell remainder, applied only as a
  // paint-time canvas translate so the ON-SCREEN motion still tracks the cursor smoothly. Recomputed
  // once per rasterize() (panX/panY only change on a drag, not every frame).
  private panXQ = 0; private panYQ = 0;
  private panXFrac = 0; private panYFrac = 0;
  private pxPerWorld = 1; private P = 1;
  // The zoom LADDER, recomputed every fit() from the graph's own bounding radius (see
  // asciiGrid.ts maxResFor) — a bigger graph needs a bigger multiplier to reach the same fixed
  // absolute (0%) detail. `zoomPct` is the durable HUD-facing state (100=fit .. 0=deepest, snapped
  // to ZOOM_STEP_PCT); `goalRes`/`res` are always DERIVED from it via resFromPercent so a resize or
  // rebuild that changes `maxRes` keeps the user's chosen PERCENT stable rather than the raw
  // multiplier. Camera commands that aren't zoom "steps" (frameSubset/resetView) set goalRes
  // directly and then resync zoomPct to match.
  private maxRes = FALLBACK_MAX_RES;
  private zoomPct = 100;
  private wheelAccum = 0;
  private userTook = false;
  // INTRO FRAMING (ported from CanvasGraphRenderer.ts:418/522/524 — its only two off-seam camera
  // knobs, used by the first-run Vault Intro and nothing else). `fitMargin` divides the 100% fit
  // scale, so >1 is extra zoom-OUT; `frameOffsetY` slides the graph's screen ORIGIN down by that
  // fraction of the host height, leaving the canvas itself full-bleed. Both are static per mount —
  // they are framing, not camera state — so neither is touched by fit(resetCamera)/resetView().
  private fitMargin = 1;
  private frameOffsetY = 0;

  // interaction
  private pressed = false; private dragging = false; private movedFar = false;
  private lastX = 0; private lastY = 0; private downX = 0; private downY = 0;

  // selection
  private activeFile: string | null = null;
  private hoveredId: string | null = null;
  private searchMatches = new Set<string>();
  private highlightSet: Set<string> | null = null;
  private alwaysOn = new Set<string>();

  // theme tokens
  private colors: string[] = [...COLOR_FALLBACK];
  private groundColor = "#0b0c11";
  // Per-theme edge-stroke alpha (see deriveEdgeBaseAlpha()) — recomputed in readTokens() whenever the
  // theme's colour tokens are (re-)read, from THIS renderer's own resolved --text-muted/--graph-bg/
  // --graph-edge, never a per-theme-name branch.
  private edgeBaseAlpha = EDGE_BASE_ALPHA_FALLBACK;
  private fontStack = '"Monaspace Xenon", ui-monospace, monospace';
  private cellW = CELL_W; private cellH = CELL_H; private fontPx = FONT_PX;
  // The pinned per-cell letterSpacing applyFont() computed (so glyphs land exactly on the grid) —
  // cluster (eyebrow) labels borrow the same ctx property for real tracking, then paint() restores
  // this value so the next row of field glyphs isn't shorn off its cells.
  private pinnedLetterSpacing = "0px";
  private letterSpacingSupported = false;

  // callbacks
  private onNodeClick: (id: string) => void = () => {};
  private onHover: (n: HoverNode | null) => void = () => {};
  private onFps?: (fps: number) => void;
  private onPaint?: (nodeCount: number) => void;
  private onZoom?: (pct: number) => void;
  private onBloom?: (field: DensityField) => void;
  onHighlightCleared?: () => void;

  // loop
  private raf = 0; private running = false; private visible = true; private dirty = true;
  private lastFrameT = 0; private fpsAccum = 0; private fpsFrames = 0;
  private lastZoomPct = -1;
  private statsHookInstalled = false;

  // ---- lifecycle -----------------------------------------------------------

  mount(el: HTMLElement, onNodeClick: (id: string) => void, onHover?: (n: HoverNode | null) => void) {
    this.host = el;
    this.onNodeClick = onNodeClick;
    if (onHover) this.onHover = onHover;

    this.viewport = document.createElement("div");
    this.viewport.className = "asc-graph-viewport asc-field";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "asc-graph-canvas";
    this.ctx = this.canvas.getContext("2d");
    this.viewport.append(this.canvas);
    el.appendChild(this.viewport);
    this.applyGround();

    this.readTokens();
    this.measure();
    this.ro = new ResizeObserver(() => { this.measure(); this.fit(); });
    this.ro.observe(el);

    this.viewport.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    this.viewport.addEventListener("wheel", this.onWheel, { passive: false });
    this.viewport.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("keydown", this.onKeyDown);

    // DEV-only QA hook (see AsciiGraphStats/computeStats) — the LAST mounted instance wins if more
    // than one field is on the page (main + sidebar mini-graph); harmless, since QA always targets
    // the one visible field. Guarded so a non-Vite runtime (Bun's test runner has no `import.meta.env`)
    // never throws — `?.` short-circuits straight to `undefined`, which is falsy.
    if (typeof window !== "undefined" && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
      (window as unknown as { __asciiGraphStats?: () => AsciiGraphStats }).__asciiGraphStats = () => this.computeStats();
      this.statsHookInstalled = true;
    }

    this.start();
  }

  destroy() {
    this.stop();
    this.setSelectionSuppressed(false);
    this.ro?.disconnect();
    this.viewport?.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.viewport?.removeEventListener("wheel", this.onWheel);
    this.viewport?.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("keydown", this.onKeyDown);
    if (this.statsHookInstalled && typeof window !== "undefined") {
      delete (window as unknown as { __asciiGraphStats?: unknown }).__asciiGraphStats;
      this.statsHookInstalled = false;
    }
    this.host?.replaceChildren();
    this.nodes = []; this.edges = []; this.byId.clear();
    this.onBloom = undefined; // detach — a torn-down renderer must not hold a stale bloom sink
  }

  setFpsCallback(cb: (fps: number) => void) { this.onFps = cb; }
  setPaintCallback(cb: (nodeCount: number) => void) { this.onPaint = cb; }
  setZoomCallback(cb: (pct: number) => void) { this.onZoom = cb; }
  setBloomCallback(cb: ((field: DensityField) => void) | undefined) { this.onBloom = cb; }
  setVisible(visible: boolean) { this.visible = visible; if (visible) { this.dirty = true; this.start(); } else this.stop(); }

  /** Extra fit zoom-OUT (see the `fitMargin` field). Refits immediately; the floor mirrors
   *  CanvasGraphRenderer's own `Math.max(0.2, m)` so a 0 can never divide the fit scale away. */
  setFitMargin(m: number) {
    this.fitMargin = Number.isFinite(m) ? Math.max(0.2, m) : 1;
    this.fit();
  }

  /** Slide the graph's screen origin down by `frac` of the host height (see the `frameOffsetY`
   *  field). No refit — the fit SCALE is unchanged, only where the origin lands. */
  setFrameOffsetY(frac: number) {
    this.frameOffsetY = Number.isFinite(frac) ? frac : 0;
    this.dirty = true;
  }

  /** The screen px the world origin projects to, before perspective: grid centre + pan + the
   *  intro's vertical frame offset. A helper rather than three inlined copies so the node
   *  projection, the entity projection and the cursor-anchored zoom can never disagree about where
   *  the graph's centre is — they all have to invert each other exactly. */
  private originX(panPx: number) { return this.m.padX + (this.m.cols / 2) * this.m.cellW + panPx; }
  private originY(panPx: number) { return this.m.padY + (this.m.rows / 2) * this.m.cellH + panPx + this.frameOffsetY * this.H; }

  // ---- data ----------------------------------------------------------------

  render(g: GraphData) {
    if (!this.host) return;
    // Same stability guarantee as the old renderer: key on STRUCTURE only, so a benign re-fetch
    // (identical nodes/edges, nudged coordinates) never re-shapes the field or snaps the camera.
    const struct = structuralGraphSig(g);
    if (struct === this.sig && this.nodes.length) { this.dirty = true; return; }
    const resetCamera = shouldResetView(new Set(this.byId.keys()), g.nodes);
    this.sig = struct;
    this.build(g, resetCamera);
  }

  private build(g: GraphData, resetCamera: boolean) {
    this.measure();
    this.adjacency.clear();
    const deg = new Map<string, number>();
    for (const e of g.edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
      this.link(e.from, e.to); this.link(e.to, e.from);
    }

    // Node-count-independent resting spacing (respace.ts `scaleToSpacing`, replaces the old client
    // force-settle Canvas used to run on every mode switch). scaleToSpacing centers the cloud on its
    // OWN centroid as part of the same rescale, so this REPLACES the old separate "centre on the
    // content centroid" step above rather than stacking with it — running both would double-apply the
    // translation (harmless numerically once the cloud is already centered, but two transforms doing
    // one job is one too many to reason about, and the second would silently mask a bug in the first).
    // No "self" filter: the old centroid excluded the injected "you" hub so it wouldn't bias the mean,
    // but that hub no longer exists (a6687c0 removed the agents graph mode, and with it agentLayout.ts,
    // the self node's only injector), and
    // respace.ts is deliberately kind-agnostic (it never sees `node.kind` at all — see its header).
    // Raw (unflipped, uncentered) positions, index-aligned with g.nodes/this.nodes so the respaced
    // arrays below can be indexed straight back onto each node with no id bookkeeping.
    const raw3: RespaceVec3[] = [];
    const raw2: RespaceVec3[] = [];
    for (const node of g.nodes) {
      const p = finiteVec3(node.position);
      raw3.push(p);
      raw2.push(finiteVec3(node.position2d, [p[0], p[1], 0]));
    }
    // respace.ts's own header names a SECOND caller-side contract besides the self-pin (that one's
    // moot — see above): "don't call scaleToSpacing at all for a graph that arrived pre-laid-out"
    // (agents/daemon/cron/process — CanvasGraphRenderer.ts's hasIntentionalLayoutKind, `:667-668`).
    // Honoured here by feeding a non-positive targetSpacing for those graphs instead of skipping the
    // call outright: scaleToSpacing's own degenerate-target fallback ("falls back to scale=1 (recenter
    // only)") already does exactly what Canvas's build() does unconditionally for EVERY graph, kind or
    // not — center on the cloud's own centroid, no rescale — so this reuses one call site + one cache
    // instead of forking a second code path. A rescale would still be LAW-safe (a uniform scale can't
    // reorder anything — see respace.ts's header), but these graphs' absolute spacing is deliberately
    // chosen by their own layout (a hub-and-spoke cron/process tree, sized to read at a specific
    // zoom), not the backend's PivotMDS packing scaleToSpacing's target was calibrated against.
    const intentionalLayout = g.nodes.some((n) =>
      n.kind === "agent" || n.kind === "daemon" || n.kind === "cron" || n.kind === "process");
    const targetSpacing = intentionalLayout ? 0 : RESPACE_TARGET_SPACING;
    // Memoized per structural signature (`this.sig`, set by render() just before calling build()) —
    // O(n²) measure runs at most once per distinct graph shape, not once per mode toggle.
    const spaced3 = this.p3SpacingCache.getOrCompute(this.sig, () => scaleToSpacing(raw3, targetSpacing));
    const spaced2 = this.p2SpacingCache.getOrCompute(this.sig, () => scaleToSpacing(raw2, targetSpacing));

    this.hoveredId = null; this.highlightSet = null;
    this.nodes = g.nodes.map((node, i) => {
      const p3 = spaced3[i], p2 = spaced2[i];
      return {
        node,
        // Y negated for both — the backend layout is Y-down, this renderer's world/screen space is
        // Y-up. Negation commutes with respace's centre-then-scale (both act per-axis with the same
        // scalar for +y and -y), so it doesn't matter that it now runs AFTER the rescale rather than
        // folded into the same expression the old centroid subtraction used.
        p3: [p3[0], -p3[1], p3[2]] as Vec3,
        p2: [p2[0], -p2[1], 0] as Vec3,
        deg: deg.get(node.id) ?? 0,
        color: C_FG, colorByLevel: [C_FG], dim: false,
        sx: 0, sy: 0, depth: 0, dr: 1, col: -1, row: -1, onGrid: false, projValid: false,
      } satisfies NodeView;
    });
    this.byId = new Map(this.nodes.map((nv) => [nv.node.id, nv]));

    // Hierarchy depth + per-level exemplar names, resolved once here (not per-frame): `pathOf`
    // falls back to the single-element `[community]` for pre-hierarchy/legacy nodes, so a graph with
    // no communityPath at all still gets exactly the original one-tier cluster-name behaviour.
    this.levelCount = 0;
    for (const nv of this.nodes) {
      const path = pathOf(nv.node);
      if (path && path.length > this.levelCount) this.levelCount = path.length;
    }
    // Loops `L < this.levelCount` (the GRAPH's deepest level), not `L < path.length` (this NODE's
    // own depth) — with the same `Math.min(L, path.length - 1)` clamp `rebuildCommunityColors()` and
    // `clusterHubByLevel` use, so all three per-level tables agree on which community a shallow
    // node belongs to at a level it doesn't itself reach. Without the clamp here specifically, a
    // mixed-depth graph could tally/anchor a deeper level's community correctly (via the other two
    // tables) while this one never learns that community's exemplar name, painting the literal
    // `cluster ${id}` placeholder instead.
    this.communityNamesByLevel = Array.from({ length: this.levelCount }, () => new Map<number, string>());
    for (const nv of this.nodes) {
      const path = pathOf(nv.node);
      if (!path) continue;
      const labels = nodePathLabels(nv.node);
      for (let L = 0; L < this.levelCount; L++) {
        const li = Math.min(L, path.length - 1);
        const id = path[li];
        const map = this.communityNamesByLevel[L];
        if (id == null || !map || map.has(id)) continue;
        map.set(id, labels?.[li] ?? `cluster ${id}`);
      }
    }

    // Whole-graph, PRECOMPUTED per-level community → hub member id (pickHubAnchor — see the
    // `clusterHubByLevel` field doc). Structural: depends only on communityPath + whole-graph degree,
    // neither of which a theme switch touches, so this lives in build(), not restyle(). The clamp
    // (`path[Math.min(L, path.length - 1)]`) is the same one buildColorSlots' community-size tally
    // uses below (rebuildCommunityColors) — a node whose own path is shallower than L still counts
    // toward L's hub race, under its own deepest known community.
    //
    // pickHubAnchor is generic over the id type; fed the real string `node.id` (not a synthetic
    // numeric surrogate), its tie-break (lowest id) matches the ported source's own
    // `nv.node.id < cur.node.id` comparison exactly, not just "some stable order".
    this.clusterHubByLevel = Array.from({ length: this.levelCount }, () => new Map<number, string>());
    if (this.levelCount > 0) {
      const membersByLevel: Map<number, { id: string; degree: number }[]>[] =
        Array.from({ length: this.levelCount }, () => new Map());
      for (const nv of this.nodes) {
        const path = pathOf(nv.node);
        if (!path) continue;
        for (let L = 0; L < this.levelCount; L++) {
          const c = path[Math.min(L, path.length - 1)];
          const map = membersByLevel[L];
          let arr = map.get(c);
          if (!arr) { arr = []; map.set(c, arr); }
          arr.push({ id: nv.node.id, degree: nv.deg });
        }
      }
      for (let L = 0; L < this.levelCount; L++) {
        for (const [c, members] of membersByLevel[L]) {
          const hubId = pickHubAnchor(members);
          if (hubId != null) this.clusterHubByLevel[L].set(c, hubId);
        }
      }
    }

    this.edges = [];
    for (const e of g.edges) {
      const a = this.byId.get(e.from), b = this.byId.get(e.to);
      if (a && b) this.edges.push({ a, b, kr: (hashKey(e.from + "\0" + e.to) % 1000) / 1000 });
    }

    // The mid band's HUB-TO-HUB BACKBONE (backbone.ts buildLevelEdges): per hierarchy level, one
    // line per CONNECTED PAIR of that level's communities, drawn hub to hub with the number of real
    // edges behind it as its weight. Static (hubs are highest-degree members; communities don't
    // move), so it is resolved to NodeViews here, once per structural build, and the per-frame path
    // only picks weights and strokes.
    //
    // NOT a filtered subset of the member edges: drawing the real node-to-node edges that happen to
    // cross a community boundary still fans hundreds of lines into the middle of every blob, so it
    // reads as "some edges are missing" rather than as a graph OF the clusters. See buildLevelEdges'
    // own doc comment — that was the first attempt, and it is why the intended behaviour looked
    // absent.
    this.levelPairs = [];
    this.levelPairsDropped = [];
    if (this.levelCount > 0) {
      const built = buildLevelEdges(
        this.nodes.map((nv) => ({ id: nv.node.id, path: pathOf(nv.node), deg: nv.deg })),
        g.edges.map((e) => ({ a: e.from, b: e.to })),
        this.levelCount,
      );
      this.levelPairsDropped = built.truncated;
      this.levelPairs = built.levelPairs.map((pairs) => {
        const out: { a: NodeView; b: NodeView; count: number }[] = [];
        for (const p of pairs) {
          const a = this.byId.get(p.a.id), b = this.byId.get(p.b.id);
          if (a && b) out.push({ a, b, count: p.count });
        }
        return out;
      });
    }

    // Recentre 2D on the bounding-BOX centre (not the centroid computed above) so a lopsided cloud
    // doesn't leave a dead margin on one side at 100% fit: `c2` above only zeroes the MEAN position,
    // which a skewed cloud still leaves asymmetric against a rectangular field — 92% of the box
    // isn't really 92% if the cloud itself sits off-centre inside its own bounding box. Done BEFORE
    // buildLodIndex/boundingHalfExtents below consume `nv.p2`, so the LOD centroids and the fit
    // radius both already see the recentred coordinates. 3D (`p3`) is untouched — the orbit camera
    // has no "box" to speak of, only a target point.
    if (this.nodes.length) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const nv of this.nodes) {
        const x = nv.p2[0], y = nv.p2[1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
      if (Number.isFinite(midX) && Number.isFinite(midY)) {
        for (const nv of this.nodes) { nv.p2[0] -= midX; nv.p2[1] -= midY; }
      }
    }

    // LOD structure (2D aggregate entities + aggregate edges), precomputed HERE — per graph build,
    // never per frame. Cluster world centroids use the same centred/flipped p2 space the projector
    // consumes, so per-frame entity projection is the same two multiplies a node costs.
    this.lodLevels = buildLodIndex(
      this.nodes.map((nv) => ({ id: nv.node.id, path: pathOf(nv.node) ?? undefined, x: nv.p2[0], y: nv.p2[1] })),
      g.edges.map((e) => ({ from: e.from, to: e.to })),
    );
    this.entityFlat = [];
    this.entityLevels = this.lodLevels.map((lv, L) => lv.clusters.map((c) => {
      const { rowR, colR } = massRadii(c.count, this.cellW, this.cellH);
      const ev: EntityView = {
        flat: this.entityFlat.length, level: L, community: c.community, count: c.count,
        wx: c.wx, wy: c.wy, sdx: c.sdx, sdy: c.sdy,
        color: C_FAINT, // placeholder — restyle() (called at the end of build()) assigns the real
                         // per-level community colour via rebuildEntityColors() before any paint runs
        name: this.communityNamesByLevel[L]?.get(c.community) ?? `cluster ${c.community}`,
        rowR, colR, memberIds: c.memberIds,
        sx: 0, sy: 0, col: -1, row: -1, onGrid: false, drawnRowR: rowR, drawnColR: colR,
      };
      this.entityFlat.push(ev);
      return ev;
    }));
    this.hoverEntityIdx = -1;

    // The shared NAME ROSTER (see `namableByLevel`) — derived from the structure just built, not a
    // second, parallel tally, so the two name passes cannot drift apart. Length is `levelCount`
    // rather than `lodLevels.length` so every level `layoutLabels` can ask for has an entry:
    // buildLodIndex derives its own depth from the same `pathOf` paths, so the two agree, and a
    // level the index somehow skipped names nothing instead of falling open.
    this.namableByLevel = Array.from(
      { length: this.levelCount },
      (_, L) => new Set((this.lodLevels[L]?.clusters ?? []).map((c) => c.community)),
    );

    this.radius3 = boundingRadius(this.nodes.map((nv) => nv.p3));
    this.radius2 = boundingRadius(this.nodes.map((nv) => nv.p2));
    this.half2 = boundingHalfExtents(this.nodes.map((nv) => nv.p2));
    this.alwaysOn = computeAlwaysOnSet(
      g.nodes, g.edges.map((e) => ({ source: e.from, target: e.to })), this.activeFile, this.cfg.graphLabelHubCount ?? 10,
    );
    this.restyle();
    this.fit(resetCamera);
  }

  private link(a: string, b: string) {
    let s = this.adjacency.get(a);
    if (!s) { s = new Set(); this.adjacency.set(a, s); }
    s.add(b);
  }

  // ---- styling -------------------------------------------------------------

  setConfig(cfg: GraphConfig) {
    const prevMode = this.cfg.viewMode;
    this.cfg = cfg;
    this.applyGround();
    // A theme switch reaches us through setConfig (the palette/background change), so that is where
    // the CSS tokens are re-read — the same trigger point the old renderer used for applyHostVars().
    // Note the colour fields on GraphConfig (palette/edgeColor/backgroundColor/…) are IGNORED here:
    // the ASCII field paints from the CSS custom properties directly, which is the single source of
    // truth for the redesign's four theme scopes.
    this.readTokens();
    // readTokens() may have picked up a changed --cell-h (the shared --row-h unit) — re-measure so
    // the grid's row count follows it before fit() recomputes the fit resolution against it.
    this.measure();
    // 2D and 3D fit different layouts (radius2 vs radius3), so a dimension flip re-fits — and
    // returns the field to 0% so the flipped view opens on the whole graph, not a stale crop.
    if (cfg.viewMode !== prevMode) {
      this.rx = -0.5; this.ry = 0;
      this.panX = 0; this.panY = 0;
      this.zoomPct = 100;
      this.res = 1; this.goalRes = 1;
      this.target = [0, 0, 0]; this.goalTarget = [0, 0, 0];
      this.userTook = false;
    }
    this.restyle();
    this.fit();
    this.dirty = true;
  }

  /**
   * The field's GROUND, per `GraphConfig.transparent`.
   *
   * `.asc-field` (ui.css) paints an opaque `--graph-bg` behind the canvas — right for a graph pane,
   * wrong for the first-run Vault Intro, which cross-fades TWO full-bleed graph layers (opacity
   * 0↔1) over the page's own `--bg`. An opaque ground there fades the entire page background
   * between `--bg` and `--graph-bg` on every slide change, and those two tokens differ in three of
   * the four themes (riso's pair is the widest gap). The canvas itself is already
   * transparent — paint() clears it rather than filling — so suppressing this one background is the
   * whole of it.
   *
   * An inline style, not a modifier class: the rule then lives in the same file as the config field
   * that drives it, and it is directly observable from a headless test (happy-dom applies no
   * stylesheets, so a class would assert nothing).
   */
  private applyGround() {
    if (!this.viewport) return;
    this.viewport.style.background = this.cfg.transparent ? "transparent" : "";
  }

  private readTokens() {
    const h = this.host;
    if (!h || typeof getComputedStyle !== "function") return;
    const cs = getComputedStyle(h);
    const read = (name: string, fallback: string) => {
      const v = cs.getPropertyValue(name).trim();
      return v || fallback;
    };
    this.colors = COLOR_VARS.map((v, i) => read(v, COLOR_FALLBACK[i]));
    // The label's cleared ground. --graph-bg may still be a gradient on a non-ASCII theme, and a
    // gradient string is not a valid fillStyle — fall back to the flat page background there.
    const gb = read("--graph-bg", "");
    this.groundColor = gb && !gb.includes("gradient") ? gb : read("--bg", "#0b0c11");
    // Recompute the per-theme edge-stroke alpha from the SAME resolved tokens above (neutral/ground/
    // edge) — see deriveEdgeBaseAlpha()'s doc comment. A gradient ground (falls through to `groundColor`
    // above) still parses fine here: `read("--bg", ...)` already resolved to a flat colour in that case.
    this.edgeBaseAlpha = deriveEdgeBaseAlpha(this.colors[C_MUTED], this.groundColor, this.colors[C_EDGE]);
    this.fontStack = read("--ui-font-stack", this.fontStack);
    // The grid row unit — asciiGraph.css's --cell-h resolves to the app-wide --row-h token (ui.css),
    // so the field's line box (both the main pane AND the sidebar mini-graph — there is no denser
    // cell any more) always matches the sidebar tree / tabs / tables rhythm. GRID LAW: line-height
    // == cell height, so this is the ONLY thing that ever changes the row pitch — never the font size.
    const rowH = parseFloat(read("--cell-h", `${CELL_H}px`));
    if (Number.isFinite(rowH) && rowH > 0) this.cellH = rowH;
    this.applyFont();
  }

  /**
   * Pin the character advance to the design's cell width. Canvas letter-spacing (a) makes a run of
   * text land on exactly the cell grid regardless of the font's natural advance, and (b) disables
   * the font's optional ligatures — Monaspace would otherwise fuse "//" or "|-" and shear the
   * drawing off its cells. Where letterSpacing isn't supported we adopt the font's MEASURED advance
   * as the cell width instead: the grid then matches the font, which is the same guarantee.
   */
  private applyFont() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.font = `${this.fontPx}px ${this.fontStack}`;
    const ls = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    const want = CELL_W;
    const supported = typeof ls.letterSpacing === "string";
    if (supported) ls.letterSpacing = "0px";
    const natural = ctx.measureText("0".repeat(64)).width / 64;
    if (supported && natural > 0) {
      ls.letterSpacing = `${(want - natural).toFixed(4)}px`;
      this.cellW = want;
      this.pinnedLetterSpacing = ls.letterSpacing;
      this.letterSpacingSupported = true;
    } else {
      this.cellW = natural > 0 ? natural : want;
      this.letterSpacingSupported = false;
    }
  }

  private restyle() {
    // Community colours first (rank-based, not hashed — buildColorSlots) — colorLevelsFor's
    // community branch below reads `communitySlotByLevel`, so it must exist before that loop runs.
    this.rebuildCommunityColors();
    for (const nv of this.nodes) {
      const levels = this.colorLevelsFor(nv.node);
      nv.colorByLevel = levels;
      nv.color = levels[levels.length - 1]; // finest/fixed slot — unchanged meaning for existing consumers
      nv.dim = this.isDimmed(nv.node);
    }
    // LOD entity masses share the SAME per-level community colour a node would show at that level
    // (see colorLevelsFor's doc) — recomputed here too since the palette (not just structure) may
    // have changed.
    this.rebuildEntityColors();
    this.dirty = true;
  }

  /**
   * Rank every hierarchy level's communities by member count (buildColorSlots — clusterVisual.ts)
   * against ASCII's own `--graph-0..4` CSS tokens as the palette, replacing the old
   * `RAMP[hashKey(key) % 5]` scheme: hashing collided constantly once a real vault's coarsest level
   * carried more than 5 substantial groups (see clusterVisual.ts's module doc for the measured
   * failure). Flattens the per-level `Map<community, hex>` buildColorSlots returns into ONE dense
   * array (`commColors`/`commColorsRGB`), addressed on `colorBuf` starting at `BLEND_BASE` — a
   * community's SLOT (not just its colour) is what `colorByLevel`/`EntityView.color` store, since
   * those still have to travel through the grid's per-cell integer buffers.
   *
   * Community SIZES are tallied with the same level clamp `pathOf`'s docblock requires
   * (`path[Math.min(L, path.length - 1)]`, never a bare `path[L]`) — otherwise a node whose own
   * hierarchy is shallower than level L silently drops out of L's tally instead of counting toward
   * its own deepest known community.
   *
   * Runs every restyle() (build() AND setConfig()), not just build(): community STRUCTURE only
   * changes on a rebuild, but the PALETTE (and therefore buildColorSlots' actual hex output) changes
   * on every theme switch too.
   */
  private rebuildCommunityColors() {
    const palette = [this.colors[C_G0], this.colors[C_G1], this.colors[C_G2], this.colors[C_G3], this.colors[C_G4]];
    const sizesByLevel: Map<number, number>[] = Array.from({ length: this.levelCount }, () => new Map());
    for (const nv of this.nodes) {
      const path = pathOf(nv.node);
      if (!path) continue;
      for (let L = 0; L < this.levelCount; L++) {
        const c = path[Math.min(L, path.length - 1)];
        const sizes = sizesByLevel[L];
        sizes.set(c, (sizes.get(c) ?? 0) + 1);
      }
    }
    this.commColors = [];
    this.commColorsRGB = [];
    this.communityColorsByLevel = [];
    this.communitySlotByLevel = [];
    for (let L = 0; L < this.levelCount; L++) {
      const hexByCommunity = buildColorSlots(sizesByLevel[L], palette);
      this.communityColorsByLevel[L] = hexByCommunity;
      const slotByCommunity = new Map<number, number>();
      for (const [community, hex] of hexByCommunity) {
        slotByCommunity.set(community, BLEND_BASE + this.commColors.length);
        this.commColors.push(hex);
        this.commColorsRGB.push(parseColorToRGB(hex) ?? [255, 255, 255]);
      }
      this.communitySlotByLevel[L] = slotByCommunity;
    }
    // The blend memo indexes INTO commColors by slot — any stale (a,b) pair from before this rebuild
    // is meaningless once the slot space has been rebuilt from scratch.
    this.blendColors.length = 0;
    this.blendIndex.clear();
  }

  /** LOD entity masses' colours, kept in sync with `communitySlotByLevel` — see restyle()'s doc. */
  private rebuildEntityColors() {
    for (let L = 0; L < this.entityLevels.length; L++) {
      const slotMap = this.communitySlotByLevel[L];
      for (const ev of this.entityLevels[L]) ev.color = slotMap?.get(ev.community) ?? C_FAINT;
    }
  }

  /** Level-by-level colour for one node — resolved ONCE here (build()/restyle(), never per frame;
   *  see rasterize()'s LEVEL-DRIVEN COLOR block for the per-frame lookup+blend that consumes it).
   *  `levels[L]` is the colorBuf SLOT the node would show if hierarchy level `L` (coarsest → finest)
   *  were the ACTIVE one — a fixed RAMP int (0..4) for the non-community fallback cases below, or a
   *  `communitySlotByLevel[L]` entry (rank-based, via buildColorSlots) for an actual community. Each
   *  level's map is already level-scoped by construction (see rebuildCommunityColors — one `Map` per
   *  level), so — unlike the old hash scheme — no separate "is this the node's own finest level" key
   *  variant is needed to keep two different levels' same-numbered communities from colliding.
   *
   *  A node with no community at all (self/daemon/cron/process, or community-less legacy data) gets
   *  a length-1 `levels` array: every consumer treats that as "fixed colour, never blended" —
   *  degenerating to exactly the pre-hierarchy single-colour-per-node behaviour. */
  private colorLevelsFor(n: GraphNode): number[] {
    switch (n.kind) {
      case "self": return [C_FG];
      case "daemon": return [C_ACCENT];
      case "cron":
      case "process": {
        const vs = nodeVisualState(n.daemon ?? { enabled: true, running: false, lastResult: null, lastFiredMs: null });
        return [vs.fill === "palette" || vs.border === "palette" ? RAMP[hashKey(n.id) % RAMP.length] : C_FAINT];
      }
      default: {
        const path = pathOf(n);
        if (path && path.length) {
          return path.map((c, L) => this.communitySlotByLevel[L]?.get(c) ?? C_FAINT);
        }
        // No community at all (a community-less fixture, or a graph mode that never stamps one) —
        // the pre-hierarchy fixed colour: tags by their own label (so the same tag always reads the
        // same colour across views), everything else by folder/kind.
        if (n.kind === "tag") return [RAMP[hashKey("tag:" + n.label) % RAMP.length]];
        const key = n.kind === "note" ? "folder:" + (n.folder ?? "(root)") : n.kind + ":" + n.label;
        return [RAMP[hashKey(key) % RAMP.length]];
      }
    }
  }

  private isDimmed(n: GraphNode): boolean {
    if (n.kind !== "cron" && n.kind !== "process") return false;
    return !(n.daemon?.enabled ?? true);
  }

  // ---- geometry ------------------------------------------------------------

  private measure() {
    if (!this.host || !this.ctx) return;
    const r = this.host.getBoundingClientRect();
    if (!isUsableBox(r.width, r.height)) { if (!this.boxReady) this.dirty = true; return; }
    this.boxReady = true;
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    // Only touch the backing store when it actually changes: assigning canvas.width/height CLEARS
    // the canvas (and resets the 2D context state) even when the value is identical. measure() is
    // called unconditionally from setConfig(), which GraphView fires on every theme/settings change
    // — so an unguarded reassign blanks the field, and if the rAF loop happens to be paused at that
    // moment (backgrounded tab, hidden mini-graph) nothing repaints it until the loop resumes.
    const bw = Math.round(this.W * this.dpr), bh = Math.round(this.H * this.dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) { this.canvas.width = bw; this.canvas.height = bh; }
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.applyFont();

    const m = gridMetrics(this.W, this.H, this.cellW, this.cellH, PAD_X, PAD_Y);
    const cells = m.cols * m.rows;
    if (m.cols !== this.m.cols || m.rows !== this.m.rows || this.charBuf.length !== cells) {
      this.charBuf = new Uint16Array(cells);
      this.layerBuf = new Uint8Array(cells);
      this.colorBuf = new Uint16Array(cells);
      this.alphaBuf = new Uint8Array(cells);
      this.cellNode = new Int32Array(cells);
      this.cellEntity = new Int32Array(cells);
      this.labelOccupied = new Uint8Array(cells);
      this.noiseBuf = buildNoise(m.cols, m.rows);
    }
    this.m = m;
    // Perspective focal length — the old renderer's (H/2)/tan(FOV/2), against the grid's own box.
    this.P = ((m.rows * m.cellH) / 2) / Math.tan((FOV_DEG * Math.PI) / 360);
    this.dirty = true;
  }

  /**
   * Reconcile the grid with the host's CURRENT box, once per frame.
   *
   * measure() is also driven by mount()/render()/the ResizeObserver, but every one of those is a
   * one-shot: the knowledge graph is a SINGLE floating element that App re-places and re-sizes
   * across slots (`.graph-floater`, sized inline from a rAF), so mount() and the first render()
   * both routinely run while the host is still 0×0 — and then the field is pinned to its 1×1
   * bootstrap grid until a ResizeObserver notification happens to arrive. Any frame that skips
   * that delivery (a coalesced resize, an observation delivered while the box was still degenerate,
   * a throttled/occluded window) left the renderer permanently unmeasured: every node off-grid,
   * every cell empty — a blank canvas under a perfectly populated HUD and cluster legend, which is
   * exactly the bug this guards. The rAF loop is the one thing that keeps running, so the size is
   * reconciled here instead of being trusted to arrive.
   *
   * Cheap: one getBoundingClientRect of an element whose geometry nothing in the frame has
   * invalidated (the loop only writes to the canvas), and measure()/fit() only run when the box
   * actually differs from the grid we last built.
   */
  private syncSize() {
    if (!this.host) return;
    const r = this.host.getBoundingClientRect();
    if (!isUsableBox(r.width, r.height)) return;
    if (this.boxReady && Math.abs(r.width - this.W) < 0.5 && Math.abs(r.height - this.H) < 0.5) return;
    this.measure();
    this.fit();
  }

  /** Recompute the world→px fit ("res = 1 fits the whole graph on the grid", i.e. 100%) and the
   *  deepest-zoom ceiling (`maxRes`, i.e. 0% — see asciiGrid.ts maxResFor). The ceiling is
   *  graph/box-derived, so it can shift on every resize or rebuild; `zoomPct` (not `goalRes`) is the
   *  durable state, so a shifted ceiling re-derives `goalRes` to land back on the SAME percent
   *  instead of silently changing what "the user's current zoom" means.
   *
   *  FIT LAW: 2D fills each screen AXIS to FIT_FILL_FRACTION of the graph's own bounding-box
   *  half-extents (`fitScaleForBox`/`half2`) — the binding axis lands at exactly that fraction, so a
   *  16:9 field no longer wastes its long axis, and a rectangular node cloud is no longer over-read
   *  by a circumscribing radius (which reads up to sqrt(2) too large against its own bounding box).
   *  3D keeps the original radius-based `fitPxPerWorld` (a fraction of the shorter screen axis) —
   *  the orbiting camera has no fixed box to fill, only a distance to keep the whole cloud in frame
   *  regardless of yaw/pitch. */
  private fit(resetCamera = false) {
    if (!this.boxReady) return;
    const is2d = this.cfg.viewMode === "2d";
    if (is2d) {
      this.pxPerWorld = fitScaleForBox(
        this.m.cols * this.m.cellW, this.m.rows * this.m.cellH, this.half2.hx, this.half2.hy,
      );
    } else {
      const radius = Math.max(1e-6, this.radius3);
      this.pxPerWorld = fitPxPerWorld(this.m.cols, this.m.rows, this.m, radius);
    }
    // Intro framing (CanvasGraphRenderer.ts:1128's `/ this.fitMargin`): applied to the FIT scale, so
    // 100% means "the whole graph, zoomed out by this much" and every derived quantity follows —
    // including `maxRes` below, whose ladder therefore still bottoms out at the same fixed absolute
    // world-per-cell (asciiGrid.ts DEEPEST_WORLD_PER_CELL) rather than at a margin-dependent one.
    this.pxPerWorld /= this.fitMargin;
    this.maxRes = maxResFor(this.pxPerWorld, this.cellW);
    if (resetCamera) {
      this.zoomPct = 100;
      this.res = 1; this.goalRes = 1;
      this.target = [0, 0, 0]; this.goalTarget = [0, 0, 0];
      this.panX = 0; this.panY = 0; this.userTook = false;
      this.rx = -0.5; this.ry = 0;
    } else {
      this.goalRes = resFromPercent(this.zoomPct, this.maxRes);
    }
    this.dirty = true;
  }

  // ---- render loop ---------------------------------------------------------

  private start() { if (this.running || !this.visible || !this.host) return; this.running = true; this.raf = requestAnimationFrame(this.tick); }
  private stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  private tick = (t: number) => {
    if (!this.running) return;
    this.syncSize();
    // Real elapsed ms since the last tick — clamped to [1, 100]: never zero/negative (defensive
    // against a non-monotonic or repeated rAF timestamp, which would otherwise divide-by-zero-ish or
    // run the ease backwards) and capped so one slow/late frame can't snap the glide most of the way
    // to its goal in a single jump (a genuinely backgrounded tab is handled by setVisible()/stop(),
    // not this clamp).
    const dt = this.lastFrameT ? Math.max(1, Math.min(100, t - this.lastFrameT)) : 16.67;
    if (this.lastFrameT) {
      this.fpsAccum += t - this.lastFrameT; this.fpsFrames++;
      if (this.fpsAccum >= 500) { this.onFps?.(Math.round((this.fpsFrames * 1000) / this.fpsAccum)); this.fpsAccum = 0; this.fpsFrames = 0; }
    }
    this.lastFrameT = t;

    const is2d = this.cfg.viewMode === "2d";
    if (!is2d && this.cfg.spin && this.nodes.length <= 350 && !this.userTook && !this.dragging) {
      this.ry += this.cfg.spinSpeed ?? 0.0015; this.dirty = true;
    }
    // Smooth-glide the world-per-cell ratio (the old renderer's goalZoom glide, in resolution space),
    // then SNAP the last sub-epsilon sliver. An asymptotic ease never actually arrives, and `res` is
    // what the HUD percent is derived from — leaving it permanently `RES_EPS` short of the step the
    // user selected reads out as 91% for a 90% stop (worse the shorter the ladder, since RES_EPS is
    // absolute while a step's size shrinks with `maxRes`). Landing exactly makes the readout the
    // step, without giving up the animated approach. `glide` is TIME-based (GLIDE_TAU_MS), so
    // re-rasterization during the glide happens every frame at the CURRENT eased resolution — the
    // field never jumps straight from one endpoint to the other — and the real-world settle time is
    // the same regardless of the host's refresh rate.
    const glide = 1 - Math.exp(-dt / GLIDE_TAU_MS);
    if (Math.abs(this.goalRes - this.res) > RES_EPS) { this.res += (this.goalRes - this.res) * glide; this.dirty = true; }
    else if (this.res !== this.goalRes) { this.res = this.goalRes; this.dirty = true; }
    if (Math.hypot(this.goalTarget[0] - this.target[0], this.goalTarget[1] - this.target[1], this.goalTarget[2] - this.target[2]) > 0.3) {
      for (let i = 0; i < 3; i++) this.target[i] += (this.goalTarget[i] - this.target[i]) * glide;
      this.dirty = true;
    }

    if (this.dirty) {
      this.rasterize(is2d);
      this.paint();
      this.emitZoom();
      this.emitBloom();
      this.dirty = false;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private emitZoom() {
    const pct = resolutionPercent(this.res, this.maxRes);
    if (pct !== this.lastZoomPct) { this.lastZoomPct = pct; this.onZoom?.(pct); }
  }

  /**
   * Emit the per-frame node-density field for the phosphor bloom (densityField.ts). This field had
   * no atmosphere at all before — the flat --graph-bg ground drew alone.
   *
   * IT EMITS FROM WHICHEVER PASS ACTUALLY RAN. That is not a refinement, it is the whole point:
   * the bloom is *node density* light, and which primitive carries the density on screen changes
   * with the band (backbone.ts `bandsForT`). Reading only `this.nodes`, as this did originally, is
   * a silent black screen across the entire far band — `rasterize()` gates `projectNodes()` on
   * `glyphAlpha > LOD_ALPHA_EPS` (a real optimisation: it skips an O(n) projection over thousands
   * of nodes in a band where none of them draw), so at fit every `nv.projValid` is false, the point
   * list comes out empty, and the atmosphere goes dark in the app's DEFAULT 2D view. Neither the
   * suite nor three reviews caught that, because the bloom is a different subsystem from the band
   * ladder that broke it; a screenshot did. Do not re-key this off `this.nodes` alone, and do not
   * "fix" a future version of that bug by hoisting the projection out of its gate.
   *
   *   far band  — the MASSES own the field: each aggregate entity emits a CLOUD (densityField.ts's
   *               `pushCloud`) centred on its projected centroid, carrying MEMBER COUNT × that
   *               level's own mass alpha (its depth in the hierarchy ladder) and spread over the
   *               members' own projected extent (`sdx`/`sdy` × the same world→screen scale
   *               `projectEntities` uses). Both halves of that are load-bearing. The COUNT weight
   *               is what makes the handover continuous rather than merely non-empty: a mass
   *               standing in for `count` notes contributes exactly the light those `count` glyphs
   *               contribute once they rasterize, and `blur()` is mass-conserving, so the total
   *               does not jump when the bands swap. The SPREAD is what stops it doing so as a
   *               spike — see `pushCloud`'s comment for the measurement, and note the spread is the
   *               MEMBERS' extent, not the compact mass glyph's `drawnRowR`/`drawnColR`: the bloom
   *               summarizes the same notes the mass does, at the size those notes actually occupy.
   *               `massLevelAlphas[L] > LOD_ALPHA_EPS` also certifies `projectEntities(L)` ran this
   *               frame — see that field's doc comment.
   *   mid/near  — the GLYPHS own it: the screen positions `projectNodes()` already wrote this frame
   *               (nv.sx/nv.sy), never a re-projection (there is only ever one projection pass per
   *               frame), dropping any node not in front of the camera (`nv.projValid`, the same
   *               test drawn nodes/edges gate on). Weighted by depth — the same `depthAlpha` curve
   *               the nodes themselves fade by, rather than a second invented one.
   *   crossfade — BOTH contribute, each scaled by its own band weight (`massAlpha` distributed over
   *               `levelAlphas`, and `glyphAlpha`), which sum to 1. No pop, no dark window.
   *
   * With no mass band in play (3D, "local" mode, community-less graphs) `massLevelAlphas` is empty
   * and `glyphAlpha` is 1, so this reduces EXACTLY to the original glyph-only pass.
   *
   * `buildBloom` itself drops anything that lands outside the 0..1 field once converted to a screen
   * fraction, so neither loop needs its own viewport clip.
   */
  private emitBloom() {
    if (!this.onBloom) return;
    const pts: BloomPoint[] = [];
    let weight = 0;
    // The world→screen scale projectEntities() used this frame, so the emitted cloud lands exactly
    // where the members would have. (2D only, which is the only place a mass band exists.)
    const s = this.pxPerWorld * this.res;
    for (let L = 0; L < this.entityLevels.length; L++) {
      const a = this.massLevelAlphas[L] ?? 0;
      if (a <= LOD_ALPHA_EPS) continue;
      for (const ev of this.entityLevels[L]) {
        const x = ev.sx / this.W, y = ev.sy / this.H;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const w = ev.count * a;
        pushCloud(pts, x, y, (ev.sdx * s) / this.W, (ev.sdy * s) / this.H, w);
        weight += w;
      }
    }
    if (this.glyphAlpha > LOD_ALPHA_EPS) {
      for (const nv of this.nodes) {
        if (!nv.projValid) continue;
        const x = nv.sx / this.W, y = nv.sy / this.H;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const w = depthAlpha(nv.dr) * this.glyphAlpha;
        pts.push({ x, y, weight: w });
        weight += w;
      }
    }
    this.bloomPointsFrame = pts.length;
    this.bloomWeightFrame = weight;
    // Second moment of what we are about to emit. One extra pass over the list we just built (a
    // handful of flops per point, against buildBloom's own ~128k-tap blur on the next line), and it
    // is the ONLY place the emitted size is observable: `blur` adds a fixed variance that swamps
    // per-axis scale errors of up to ~25% by the time the field reaches a consumer.
    let mx = 0, my = 0, mxx = 0, myy = 0;
    for (const p of pts) {
      const pw = p.weight ?? 1;
      mx += pw * p.x; my += pw * p.y;
      mxx += pw * p.x * p.x; myy += pw * p.y * p.y;
    }
    if (weight > 0) {
      const ex = mx / weight, ey = my / weight;
      this.bloomSdxFrame = Math.sqrt(Math.max(0, mxx / weight - ex * ex));
      this.bloomSdyFrame = Math.sqrt(Math.max(0, myy / weight - ey * ey));
    } else {
      this.bloomSdxFrame = 0; this.bloomSdyFrame = 0;
    }
    this.onBloom(buildBloom(pts));
  }

  // ---- cursor-anchored zoom (2D) -------------------------------------------

  /**
   * Take one zoom-ladder step ANCHORED at viewport px (ax, ay): move the percent state as
   * `setZoomPercent` does, then re-aim `goalTarget` so the world point sitting at that px keeps
   * exactly that px through the step. Everything is computed in GOAL space (goalRes/goalTarget,
   * not the mid-glide res/target), so consecutive wheel notches COMPOSE exactly — the settled
   * post-step camera puts the anchored world point back under the cursor to the pixel, whatever
   * the glide did in between. Pan is untouched (it stays the drag's). 3D falls back to the plain
   * step: the orbit camera has no meaningful cursor point to pin.
   */
  private zoomStepAnchored(pct: number, ax: number, ay: number) {
    const before = this.goalRes;
    this.setZoomPercent(pct);
    const after = this.goalRes;
    if (this.cfg.viewMode !== "2d" || after === before) return;
    const sB = this.pxPerWorld * before, sA = this.pxPerWorld * after;
    if (!(sB > 0) || !(sA > 0)) return;
    const ox = this.originX(this.panX);
    const oy = this.originY(this.panY);
    // World point under the anchor px at the goal-before camera … stays put at the goal-after one.
    const wx = this.goalTarget[0] + (ax - ox) / sB;
    const wy = this.goalTarget[1] + (ay - oy) / sB;
    this.goalTarget = [wx - (ax - ox) / sA, wy - (ay - oy) / sA, this.goalTarget[2]];
  }

  /** Keyboard zoom (and any cursorless step) anchors the CENTRE of the grid. */
  private zoomStepCentered(pct: number) {
    const m = this.m;
    this.zoomStepAnchored(pct, m.padX + (m.cols * m.cellW) / 2, m.padY + (m.rows * m.cellH) / 2);
  }

  // ---- rasterization -------------------------------------------------------

  // NO EDGE EVER OCCUPIES A GRID CELL any more. Real member edges have been vector strokes since the
  // redesign; the LOD aggregate connectors were the last grid-traced primitive (a `putEdge` sink fed
  // by `traceEdge`'s Bresenham walk, writing one of `-|/\+` per cell) and this task strokes them as
  // vectors too — see the GROUP LINES block below for why. `layerBuf`'s `LAYER_EDGE` tier is
  // therefore no longer written by anything; the cell layers are noise < node < label.

  /** Project every ACTIVE primitive onto the grid, then draw the layers into the cell buffers.
   *
   *  LEVEL OF DETAIL (2D + a community hierarchy) — LIVE by default via GraphConfig.showLodMasses
   *  (GraphView.tsx sets it whenever the ascii renderer is active outside "local" mode — see the
   *  `lodOn` gate below). When enabled, the zoom ladder maps onto the hierarchy: coarse stops
   *  rasterize the active level's AGGREGATE ENTITIES + AGGREGATE EDGES only (a frame costs
   *  O(clusters + inter-cluster connectors)); the leaf passes below — per-node
   *  projection, the real edge loop, the real node loop — simply do not run until `lodMix`'s leaf
   *  alpha comes up near the deep stops. Crossfades between adjacent levels (and between the finest
   *  level and the leaves) reuse the exact alphas of the cluster-name/file-name label crossfade, so
   *  geometry and naming always move together. 3D keeps the original full-detail path untouched.
   *  With the flag off (e.g. local mode), every node rasterizes as a glyph at every zoom stop instead. */
  private rasterize(is2d: boolean) {
    const m = this.m;
    const cells = m.cols * m.rows;
    const noiseA = Math.round(NOISE_ALPHA * 255);
    // QA/debug instrumentation counters (see computeStats/window.__asciiGraphStats) — reset once per
    // rasterize() and incremented in the SAME passes below that already walk these collections, so
    // the hot loop pays for nothing extra beyond a few integer increments.
    this.entitiesDrawnFrame = 0;
    this.notesOnScreenFrame = 0;
    this.edgesClassifiedFrame = 0;
    this.edgesIntraVisibleFrame = 0;
    this.edgesCrossVisibleFrame = 0;
    this.edgesTransitingDroppedFrame = 0;
    this.edgesStrokedFrame = 0;
    // THE LOCALITY GATE's roster (see `inViewClusters`) — cleared UNCONDITIONALLY, like the stroke
    // buckets below, so a frame that returns early out of the leaf pass can never leave a previous
    // frame's answer to "which clusters am I looking at" standing.
    this.inViewClusters.clear();
    // Clear the vector-edge stroke buckets (see the field decls + strokeEdges()) UNCONDITIONALLY —
    // not just inside the glyph gate below — so a frame where an opt-in coarse LOD stop's masses own
    // the field instead doesn't leave last frame's edges stroked over it. Same for the intra-cluster
    // mesh and the group-line batches, which are populated under their own independent gates.
    this.edgeAccent.length = 0; this.edgeDim.length = 0; this.edgeMain.length = 0;
    for (const band of this.edgeBands) band.length = 0;
    for (const list of this.intraBuckets.values()) list.length = 0;
    this.intraOn = false;
    for (const b of this.groupBatches.values()) b.pts.length = 0;
    // WORLD-anchored pan (the jitter fix): split into a whole-cell part (fed into the projection
    // below, so the world→cell rounding phase never shifts) and a sub-cell residual (applied as a
    // paint-time canvas translate — see paint()). Recomputed once per rasterize(), not per node.
    const qx = quantizePan(this.panX, m.cellW);
    const qy = quantizePan(this.panY, m.cellH);
    this.panXQ = qx.whole; this.panYQ = qy.whole;
    this.panXFrac = qx.frac; this.panYFrac = qy.frac;
    // Layer 1 — the noise field (graph.backgroundNoise, off by default — settingsSchema.ts). Static
    // per grid size + seed, laid down first so edges and nodes can CLEAR it (writing a higher layer
    // over the same cell). When the setting is off the buffers are just reset to empty — cellNode
    // still needs clearing every frame regardless, since the hit test reads it.
    const showNoise = this.cfg.backgroundNoise === true;
    for (let i = 0; i < cells; i++) {
      if (showNoise) {
        const ch = this.noiseBuf[i];
        this.charBuf[i] = ch;
        this.layerBuf[i] = ch ? LAYER_NOISE : 0;
        this.colorBuf[i] = C_FAINT;
        this.alphaBuf[i] = noiseA;
      } else {
        this.charBuf[i] = 0;
        this.layerBuf[i] = 0;
      }
      this.cellNode[i] = -1;
      this.cellEntity[i] = -1;
    }

    const t = resolutionT(this.res, this.maxRes);

    // GraphConfig.showLodMasses opts IN to the LOD aggregate-entity/edge passes below — LIVE by
    // default (GraphView.tsx sets it whenever the ascii renderer is active outside "local" mode).
    // With the flag off (e.g. local mode) every individual node rasterizes as a glyph at every zoom
    // stop instead; the hierarchy then reads only through node COLOR (see the LEVEL-DRIVEN COLOR
    // block below) + the cluster-name labels, never an aggregate mass.
    const lodOn = this.cfg.showLodMasses === true && is2d && this.levelCount > 0 && this.entityLevels.length > 0;
    this.lodOn = lodOn;
    // THE THREE-BAND LADDER (backbone.ts §5.4, via lodMix): far = territory masses + aggregate
    // connectors; mid = individual glyphs + the hub-to-hub backbone; near = individual glyphs + real
    // member edges. With LOD off (3D, "local" mode, community-less graphs) there is no mass band to
    // hand over FROM and no communities to connect hub-to-hub, so glyphs and real edges own every
    // stop — exactly the pre-band behaviour, and exactly what `bandsForT(t, 0)` returns.
    const mix = lodOn ? lodMix(t, this.levelCount) : null;
    const glyphA = mix ? mix.glyphAlpha : 1;
    this.glyphAlpha = glyphA;
    this.memberEdgeAlpha = mix ? mix.memberAlpha : 1;
    // The bloom's far-band input (see emitBloom). Assigned HERE, above the leaf gate, so it is
    // always the CURRENT frame's mix — a frame that returns early out of any pass below still
    // leaves the atmosphere reading this frame's bands, never the last one's.
    this.massLevelAlphas = mix ? mix.levelAlphas : NO_MASS_LEVELS;

    // ---- LEVEL-DRIVEN COLOR: which (at most two, adjacent) hierarchy levels are "active" this ----
    // ---- frame, and the crossfade weight between them — off the SAME clusterLevelAlphas the -------
    // ---- cluster-name labels use, so a node's colour and the label naming its region always -------
    // ---- agree on which level owns the field. Zoomed out every node reads by its TOP-level -------
    // ---- cluster; zooming in re-colours it by sub-cluster, then sub-sub-cluster, crossfading at ---
    // ---- the same boundaries the labels already cross at (labelSelection.ts levelBoundaries). -----
    // A 0/1-level graph has nothing to blend regardless (every colorByLevel is length 1).
    const clusterColorsOn = this.levelCount > 0;
    let colorL0 = 0, colorL1 = 0, colorW1 = 0;
    if (clusterColorsOn && this.levelCount > 1) {
      const picked = this.activeColorLevels(clusterLevelAlphas(t, this.levelCount));
      colorL0 = picked.L0; colorL1 = picked.L1; colorW1 = picked.w1;
      // Reset the lazy blend memo only while an actual crossfade is in progress — most frames sit
      // settled at one level (w1 ≈ 0) and skip this entirely; nodeColorSlotForFrame falls back to the
      // plain per-level slot (an exact community hex, not a blended rgb() string) then. See
      // blendColorSlot() — entries are computed on demand per (a,b) pair actually requested this
      // frame, not a full precomputed cross product (the community space is too big for that now).
      if (colorW1 > LOD_ALPHA_EPS) { this.blendColors.length = 0; this.blendIndex.clear(); }
    }

    // ---- LEAF passes (individual note GLYPHS + real member edges) — DEFAULT: always on. ----------
    // Gated on `glyphAlpha` (= 1 - massAlpha), NOT on the member-edge alpha: glyphs rasterize across
    // BOTH the mid and the near band. In the mid band this pass runs at full strength while the real
    // member edges it classifies below are held at ~0 by `memberEdgeAlpha` in strokeEdges() — the
    // backbone tells the between-group story there instead.
    if (glyphA > LOD_ALPHA_EPS) {
      this.projectNodes(is2d);

      // ---- THE LOCALITY GATE, part 1: which clusters am I actually looking at? ------------------
      // Scoped to `lodOn`, i.e. to the band ladder itself, and that scope is the whole justification
      // for dropping anything: with masses and a real hierarchy in play a between-cluster connection
      // the gate removes is the story the hub-to-hub BACKBONE tells instead. 3D, "local" mode and
      // community-less graphs have no backbone to hand the story to, so they keep every edge —
      // exactly the pre-gate behaviour, and the same scope `intraOn` below already uses.
      //
      // Deliberately NOT additionally gated on the near band. It does not need to be: the gate only
      // ever removes REAL MEMBER EDGES, and `memberEdgeAlpha` holds those at ~0 across the whole mid
      // band anyway, so the gate is invisible until the near band opens and is already fully applied
      // on the first frame a member edge is visible. A band condition would buy nothing but a second
      // threshold to keep in sync — and a pop at whatever `t` it fired.
      if (lodOn) {
        for (const nv of this.nodes) {
          if (!nv.projValid || !inViewport(nv.sx, nv.sy, this.W, this.H, VIEWPORT_LABEL_PAD)) continue;
          const slot = nv.colorByLevel[Math.min(colorL0, nv.colorByLevel.length - 1)];
          if (slot >= BLEND_BASE) this.inViewClusters.add(slot);
        }
      }

      const focus = this.focusSet();
      // INTRA-CLUSTER MESH gate (CanvasGraphRenderer.ts:1271-1306): a cluster's BODY is its internal
      // edges, stroked in the cluster's own colour so density reads as mass rather than grey noise.
      // Drawn at every zoom the GLYPHS are on (mid + near) — in the far band the cluster is a solid
      // mass, not a dot cloud, so a mesh under it would be exactly the field-crossing noise this
      // whole pass exists to avoid. Suppressed while a hover or a highlight set owns the colouring,
      // as in the source: the mesh's tint would fight the dim/accent story.
      //
      // Scoped to `lodOn` — i.e. to the band ladder itself (2D, a real hierarchy, masses enabled),
      // which is the app's default 2D view. 3D keeps its untouched full-detail path (its edges carry
      // depth-band alpha the flat mesh alpha would fight), and "local" mode stays the deliberately
      // flat, uncoloured neighbourhood view it already is.
      this.intraOn = lodOn && this.hoveredId == null && !focus;
      // Adopted from CanvasGraphRenderer.ts:1225 — per-dimension budget/floor (see the constants).
      const budget = is2d ? EDGE_BUDGET_2D : EDGE_BUDGET_3D;
      const floor = is2d ? EDGE_FLOOR_2D : EDGE_FLOOR_3D;
      // Layer 2 — edges. No longer grid characters: each surviving edge is bucketed by the alpha
      // it will be STROKED at (paint()'s strokeEdges() issues the actual `beginPath/moveTo/lineTo/
      // stroke` calls, one batched `stroke()` per bucket, real anti-aliased vector lines beneath the
      // glyph/label passes below). This loop only classifies — see the field decls for the four
      // reused bucket arrays.
      const keepFrac = this.edges.length > budget ? Math.max(floor, budget / this.edges.length) : 1;
      for (const e of this.edges) {
        if (e.kr >= keepFrac) continue;
        const { a, b } = e;
        // `projValid` gates whether a node's projection means anything AT ALL (3D: in front of the
        // camera, past the near-clip) — independent of grid-bounds visibility. A vector line needs no
        // grid clip (the canvas clips at paint time, exactly like the pre-redesign renderer's
        // `onScreen`), so an edge whose far endpoint sits off the field still strokes its on-screen
        // portion instead of being dropped whole — the "edges vanish at deep zoom" fix, ported.
        if (!a.projValid || !b.projValid) continue;
        // The cluster key at THE DOMINANT COLOUR LEVEL, computed once and read by both the mesh and
        // the locality gate below — one derivation, so the two cannot drift apart on what "the same
        // cluster right now" means.
        const ca = a.colorByLevel[Math.min(colorL0, a.colorByLevel.length - 1)];
        const cb = b.colorByLevel[Math.min(colorL0, b.colorByLevel.length - 1)];
        // The mesh's own bucketing, done in this same walk rather than a second pass over `edges`:
        // an edge whose endpoints share a community AT THE DOMINANT COLOUR LEVEL is the cluster's
        // own wiring. One that crosses groups is not — the group lines above tell that story.
        // (CanvasGraphRenderer.ts:1285-1294.) An intra edge is bucketed here AND still classified
        // below: in the near band it draws twice, tinted texture under the neutral member stroke,
        // exactly as in the source. Bucketed BEFORE the gate on purpose: the mesh is a mid-AND-near
        // band tier riding `glyphAlpha`, and the mid band is settled design this task must not touch.
        if (this.intraOn && ca === cb) {
          let arr = this.intraBuckets.get(ca);
          if (!arr) { arr = []; this.intraBuckets.set(ca, arr); }
          arr.push(e);
        }
        const hov = this.hoveredId;
        // hover = ONE degree: only edges directly incident to the hovered node light up — strict
        // INCIDENCE, not `focus` (focusSet() also carries the hovered node's NEIGHBOURS, needed
        // below for the node dimming/ring pass — using that broader set here spared every edge
        // between two of the hovered node's neighbours from dimming, a past bug).
        // CanvasGraphRenderer.ts:847-848.
        const incident = hov != null && (a.node.id === hov || b.node.id === hov);
        const focused = focus != null && (focus.has(a.node.id) || focus.has(b.node.id));

        // ---- THE LOCALITY GATE, part 2: does this edge belong to what is on screen? --------------
        // The user, at maximum zoom: "the amount of edges from other clusters crossing over is just
        // too much". Every real edge that survived the budget used to be stroked, so a neighbourhood's
        // own structure sat under long lines merely PASSING THROUGH from communities off both sides of
        // the frame. Those lines say nothing a viewer can act on — neither of their ends is visible —
        // and at this band the hierarchy is fully resolved, so the connection they stand for is the
        // backbone's story, not theirs.
        //
        // An edge draws when BOTH its endpoints' clusters are in view (`inViewClusters`). For an
        // intra-cluster edge that is one test applied twice, i.e. exactly "its cluster is in view";
        // for a cross-cluster edge it is the stronger "both of them are". Note what this does NOT
        // need: a special case for "both endpoints are visible, so never hide it". A visible endpoint
        // IS a visible member of its own cluster, so that case is already inside the set — see
        // `inViewClusters` for why that theorem is the reason the predicate is a member COUNT of one
        // rather than a share.
        //
        // Three exemptions, each because nothing else would represent the edge:
        //  - an endpoint with NO community (`slot < BLEND_BASE`: self, daemon, cron/process). The
        //    backbone is built from community pairs (buildLevelEdges skips a null path outright), so a
        //    dropped edge here vanishes with no stand-in anywhere on the field.
        //  - a hovered-incident edge: hover is the user asking this exact node what it connects to.
        //  - a focus-set edge (search matches / daemon-list highlight): the same question, held open.
        if (lodOn && ca >= BLEND_BASE && cb >= BLEND_BASE && !incident && !focused
          && !(this.inViewClusters.has(ca) && this.inViewClusters.has(cb))) {
          this.edgesTransitingDroppedFrame++;
          continue;
        }
        this.edgesClassifiedFrame++;
        if (ca === cb) this.edgesIntraVisibleFrame++; else this.edgesCrossVisibleFrame++;

        if (incident) { this.edgeAccent.push(e); continue; }
        if (hov != null) { this.edgeDim.push(e); continue; }
        if (focus) {
          // persistent cluster highlight (search matches / daemon-list focus, no hover in play): dim
          // only when NEITHER endpoint is in the highlighted set. CanvasGraphRenderer.ts:851.
          if (!focused) { this.edgeDim.push(e); continue; }
        }
        if (is2d) { this.edgeMain.push(e); continue; }
        this.edgeBands[safeDepthBand((a.dr + b.dr) / 2, EDGE_DEPTH_BANDS)].push(e);
      }

      // Layer 3 — nodes. Weight is the glyph (degree ramp, shifted by depth band in 3D), colour is
      // the cluster; the hovered / active node takes the accent.
      for (let i = 0; i < this.nodes.length; i++) {
        const nv = this.nodes[i];
        if (!nv.onGrid) continue;
        this.notesOnScreenFrame++;
        const idx = nv.row * m.cols + nv.col;
        const id = nv.node.id;
        const hot = id === this.hoveredId || id === this.activeFile || this.searchMatches.has(id);
        let alpha = is2d ? 1 : depthAlpha(nv.dr);
        if (focus && !focus.has(id)) alpha *= DIM_ALPHA;
        if (nv.dim) alpha *= 0.45;
        if (hot) alpha = 1;
        alpha *= glyphA;
        const glyph = nv.node.kind === "self" ? "@" : nodeGlyph(nv.deg, nv.dr, !is2d, DEPTH_BANDS);
        this.charBuf[idx] = glyph.charCodeAt(0);
        this.layerBuf[idx] = LAYER_NODE;
        this.colorBuf[idx] = hot ? C_ACCENT : this.nodeColorSlotForFrame(nv, clusterColorsOn, colorL0, colorL1, colorW1);
        this.alphaBuf[idx] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
        this.cellNode[idx] = i;
      }
    }

    // ---- FAR band: aggregate entities + their connectors, active levels only. -------------------
    if (mix) {
      // The cluster-NAME ladder is not the mass ladder: names ride `clusterLevelAlphas ×
      // clusterLabelAlpha` (layoutLabels) and keep going through the mid band, long after the masses
      // themselves have handed over. `layoutEntityNames` anchors on the entity's PROJECTED position,
      // so a level whose name is still being drawn must still be projected even when its mass alpha
      // is 0 — otherwise the name is placed from a stale screen position several frames old. The
      // projection is O(clusters) for at most two active levels, so this costs nothing; only
      // `drawAggregateEdges`/`drawEntityMasses` are gated on the mass weight.
      const nameLevels = clusterLevelAlphas(t, this.levelCount);
      for (let L = 0; L < this.entityLevels.length; L++) {
        const a = mix.levelAlphas[L] ?? 0;
        // The name gate is layoutLabels' own `levelAlphas[L] * clusterLabelAlpha(t) > 0.01`, and
        // `clusterLabelAlpha <= 1`, so testing the raw level alpha against the same 0.01 is a strict
        // superset of it — no name can be laid out from an unprojected level.
        if (a <= LOD_ALPHA_EPS && (nameLevels[L] ?? 0) <= 0.01) continue;
        this.projectEntities(L);
        if (a <= LOD_ALPHA_EPS) continue;
        this.drawAggregateEdges(L, a);
        this.drawEntityMasses(L, a);
      }
    }

    // ---- MID band: the hub-to-hub BACKBONE. ----------------------------------------------------
    // Gated on the same `glyphA` the leaf pass is, not on `backboneAlpha` alone: the backbone is
    // anchored on real node views, so it can only be stroked on a frame where projectNodes() ran.
    // (`backboneAlpha <= glyphAlpha` always — they are two terms of one partition — so this only
    // ever excludes the sub-epsilon tail, never a visible backbone.)
    if (mix && glyphA > LOD_ALPHA_EPS && mix.backboneAlpha > LOD_ALPHA_EPS && this.levelPairs.length) {
      // FILE_LABEL_REVEAL_T, not computeEdgeLevelWeights' own ported default (0.62, Canvas's
      // constant): ASCII keys node colour, cluster names and the level ladder off 0.75. Left at the
      // default, the backbone would rewire to the finer grouping about one wheel notch BEFORE
      // colours and names do — see that function's doc comment.
      const w = computeEdgeLevelWeights(t, this.levelCount, FILE_LABEL_REVEAL_T);
      for (let L = 0; L < this.levelPairs.length; L++) {
        const lw = (w[L] ?? 0) * mix.backboneAlpha;
        if (lw <= 0.01) continue;
        this.queueBackbone(L, lw);
      }
    }

    this.layoutLabels(is2d);
  }

  // ---- LEVEL-DRIVEN COLOR (see rasterize()'s block + colorLevelsFor/restyle) -----------------------

  /** Which (at most two) hierarchy levels are "active" this frame per `levelAlphas` (the SAME
   *  partition-of-unity `clusterLevelAlphas` computes for the cluster-name crossfade), and the
   *  crossfade weight between them. L0 is the dominant level; `w1` is L1's share, renormalized over
   *  just the two so it stays exactly the blend weight even on a boundary frame where a third level
   *  carries a sub-epsilon residual. Degenerates to `w1 = 0` (pure L0, no blend) whenever only one
   *  level is actually active — which is exactly what `clusterLevelAlphas` returns at/after the
   *  file-label reveal point ([0,...,0,1]), so "keep the finest-level colour" falls out for free. */
  private activeColorLevels(levelAlphas: number[]): { L0: number; L1: number; w1: number } {
    let L0 = 0, a0 = -1;
    for (let i = 0; i < levelAlphas.length; i++) if (levelAlphas[i] > a0) { a0 = levelAlphas[i]; L0 = i; }
    let L1 = L0, a1 = 0;
    for (let i = 0; i < levelAlphas.length; i++) {
      if (i === L0) continue;
      if (levelAlphas[i] > a1) { a1 = levelAlphas[i]; L1 = i; }
    }
    const total = a0 + a1;
    return { L0, L1, w1: total > 1e-6 ? a1 / total : 0 };
  }

  /** The colorBuf value for one on-grid node this frame: a node with no hierarchy
   *  (`colorByLevel.length <= 1`) keeps its one fixed slot; settled (non-crossfading, `w1 ≈ 0`)
   *  frames resolve the plain L0 slot too (an exact community hex — see BLEND_BASE's comment for why
   *  that matters); only an in-progress crossfade actually asks blendColorSlot() for a blend. `a`/`b`
   *  here are always `commColors`-range slots (`>= BLEND_BASE`) — `colorByLevel.length > 1` only
   *  ever comes from the community branch of colorLevelsFor(). */
  private nodeColorSlotForFrame(nv: NodeView, clusterColorsOn: boolean, L0: number, L1: number, w1: number): number {
    const cbl = nv.colorByLevel;
    if (!clusterColorsOn || cbl.length <= 1) return nv.color;
    const a = cbl[Math.min(L0, cbl.length - 1)];
    if (w1 <= LOD_ALPHA_EPS) return a;
    const b = cbl[Math.min(L1, cbl.length - 1)];
    if (a === b) return a; // same community both sides — nothing to blend
    return this.blendColorSlot(a, b, w1);
  }

  /** Lazily-memoized LEVEL-DRIVEN COLOR blend: the RGB lerp between two community colours (`a`, `b`
   *  — both `commColors`-range colorBuf slots) at crossfade weight `w1`, cached per (a,b) pair for
   *  THIS FRAME ONLY — rasterize()'s `colorW1` gate clears `blendColors`/`blendIndex` at the top of
   *  every frame a crossfade is in progress (`w1` itself changes every one of those frames, so a
   *  memo entry computed against a stale `w1` would freeze the animation partway through if it
   *  survived past one frame). Replaces the old RAMP.length²=25-entry full precompute: the community
   *  colour space is no longer a small fixed 5, so this only ever materializes the (a,b) pairs a
   *  frame actually asks for — bounded by distinct on-grid community transitions this frame, not the
   *  full cross product. `MAX_BLEND_SLOTS` is a hard ceiling so a pathological community count can't
   *  overrun `colorBuf`'s Uint16 range; past it, callers get a hard cut (`a`, no blend) instead of an
   *  out-of-range slot. */
  private blendColorSlot(a: number, b: number, w1: number): number {
    const key = a * BLEND_KEY_MUL + b;
    const cached = this.blendIndex.get(key);
    if (cached !== undefined) return COMM_BLEND_BASE + cached;
    if (this.blendColors.length >= MAX_BLEND_SLOTS) return a;
    const ca = this.commColorsRGB[a - BLEND_BASE] ?? [255, 255, 255];
    const cb = this.commColorsRGB[b - BLEND_BASE] ?? [255, 255, 255];
    const r = Math.round(ca[0] + (cb[0] - ca[0]) * w1);
    const g = Math.round(ca[1] + (cb[1] - ca[1]) * w1);
    const bl = Math.round(ca[2] + (cb[2] - ca[2]) * w1);
    const idx = this.blendColors.length;
    this.blendColors.push(`rgb(${r},${g},${bl})`);
    this.blendIndex.set(key, idx);
    return COMM_BLEND_BASE + idx;
  }

  /** Project one level's entities (2D only — the flat pipeline with rx = ry = 0, i.e. two
   *  multiplies per entity). O(clusters), allocation-free: scratch lives on the prebuilt views. */
  private projectEntities(level: number) {
    const m = this.m;
    const s = this.pxPerWorld * this.res;
    const tx = this.target[0], ty = this.target[1];
    // The QUANTIZED pan (see rasterize()/asciiGrid.ts quantizePan) — same world→cell phase the node
    // projection below uses, so entity masses never wiggle relative to the notes they summarize.
    const ox = this.originX(this.panXQ);
    const oy = this.originY(this.panYQ);
    const capRow = Math.max(1, (m.rows / 7) | 0);
    const capCol = Math.max(2, (m.cols / 7) | 0);
    for (const ev of this.entityLevels[level]) {
      ev.sx = ox + (ev.wx - tx) * s;
      ev.sy = oy + (ev.wy - ty) * s;
      ev.col = Math.round((ev.sx - m.padX) / m.cellW);
      ev.row = Math.round((ev.sy - m.padY) / m.cellH);
      ev.drawnRowR = Math.min(ev.rowR, capRow);
      ev.drawnColR = Math.min(ev.colR, capCol);
      // A mass whose CENTRE is off-grid can still overlap the field by up to its radius.
      ev.onGrid = ev.col >= -ev.drawnColR && ev.col < m.cols + ev.drawnColR
        && ev.row >= -ev.drawnRowR && ev.row < m.rows + ev.drawnRowR;
    }
  }

  // ---- GROUP LINES: the far band's aggregate connectors + the mid band's hub-to-hub backbone ----
  // Both are "the lines between the groups at this zoom", so both go through one batched VECTOR
  // path. They were characters until this task: `traceEdge`'s Bresenham walk wrote one of `-|/\+`
  // into every cell along the line, and a character is an order of magnitude more ink than a
  // hairline — at the default 2D view the ~25 connectors between the reference vault's 15 masses
  // read as a stair-stepped grey scribble crossing the entire field rather than as structure. Same
  // connectors, same weights, same anchors; anti-aliased 1px strokes beneath the glyph layer, the
  // same treatment the real member edges already get (see strokeEdges()).

  /** Fetch (or start) the group-line batch for a given alpha/width, so lines sharing a tier cost one
   *  `stroke()` between them. Alpha is quantized to `GROUP_ALPHA_STEPS`; the key packs both. */
  private groupBatch(alpha: number, width: number): { alpha: number; width: number; pts: number[] } {
    // ALPHA is quantized (a continuous per-connector ramp would otherwise be one stroke per line);
    // WIDTH is not. Width already comes from a tiny discrete set — three backbone weight buckets and
    // the aggregate connectors' light/heavy pair — so rounding it buys no batching at all and only
    // costs fidelity: at the mid plateau the buckets' 0.854 / 2.196 / 2.4 were landing on 0.875 /
    // 2.25 / 2.375, i.e. the ported ramp arriving visibly wrong at every stop.
    const aq = Math.max(1, Math.min(GROUP_ALPHA_STEPS, Math.round(alpha * GROUP_ALPHA_STEPS)));
    const key = `${aq}|${width}`;
    let b = this.groupBatches.get(key);
    if (!b) { b = { alpha: aq / GROUP_ALPHA_STEPS, width, pts: [] }; this.groupBatches.set(key, b); }
    return b;
  }

  /** Cell-centre screen x/y of a grid column/row — group lines terminate on the CELL LATTICE (where
   *  a mass's or a glyph's ink actually sits), the same rule strokeEdges() uses for member edges. */
  private cellCX(col: number) { return this.m.padX + col * this.m.cellW + this.m.cellW / 2; }
  private cellCY(row: number) { return this.m.padY + row * this.m.cellH + this.m.cellH / 2; }

  /** Queue one group-line segment between two CELLS, pulled back from both cell centres by the same
   *  clearance `strokeEdges()` applies to member edges. Group lines end on ink exactly like member
   *  edges do — a hub's `@` glyph, a mass's `@` core — and a thin fillText glyph covers almost none
   *  of its cell, so an untrimmed line runs straight through the endpoint's interior and muddies it.
   *  That the group tiers were skipping this was an oversight, not a decision. */
  private pushGroupSeg(batch: { pts: number[] }, aCol: number, aRow: number, bCol: number, bRow: number) {
    const [ax, ay, bx, by] = trimSegmentForClearance(
      this.cellCX(aCol), this.cellCY(aRow), this.cellCX(bCol), this.cellCY(bRow), CLEARANCE_CELLS * this.m.cellW,
    );
    batch.pts.push(ax, ay, bx, by);
  }

  /** `zoomScale` for LINE WIDTHS — 1 at fit, rising to `EDGE_W_MAX / EDGE_W_GAIN` (4) at the deepest
   *  stop. `CanvasGraphRenderer` scaled every line width by its camera's magnification; this field
   *  has no such scalar (zoom is RESOLUTION — THE LAW: a mark's on-screen size never changes with
   *  zoom, and vector lines are its one stated exception), so the equivalent is the member-edge width
   *  ramp `strokeEdges()` already uses, normalized by its own value at fit. Every ported width
   *  constant (`0.4` member, `0.3` mesh, `0.35 + 0.55·wb` group) then multiplies this and keeps the
   *  source's exact relative weights at both ends of the ladder. */
  private lineWidthScale(): number {
    const t = resolutionT(this.res, this.maxRes);
    return (EDGE_W_GAIN + (EDGE_W_MAX - EDGE_W_GAIN) * t) / EDGE_W_GAIN;
  }

  /** Aggregate connectors for one level (FAR band): ONE line per community pair summarizing every
   *  real link between the two member sets, anchored on the two masses. Visual weight = link count →
   *  alpha ramp (`aggEdgeWeight`'s log scale, precomputed at build), and the heaviest connectors
   *  stroke at DOUBLE width — the vector analogue of the parallel Bresenham trace this replaced,
   *  same intent (density reads as thickness), no longer a second row of characters.
   *
   *  No grid clipping: a vector line needs none (the canvas clips at paint time), which is also why
   *  a connector between two masses whose centres are both off-frame still draws the part crossing
   *  the field. `clipSegmentToGrid` existed only because `traceEdge`'s guard cap could truncate a
   *  long Bresenham walk before it reached the visible cells. */
  private drawAggregateEdges(level: number, levelAlpha: number) {
    const lv = this.lodLevels[level];
    const evs = this.entityLevels[level];
    if (!lv) return;
    const base = this.edgeBaseAlpha * levelAlpha;
    const wScale = this.lineWidthScale();
    for (const e of lv.edges) {
      const a = evs[e.a], b = evs[e.b];
      if (!a || !b) continue;
      // BOTH masses must have ink on the field — the same rule the backbone uses (see queueBackbone,
      // and `CanvasGraphRenderer.ts:1266` for the group-line convention it comes from) and the same
      // rule `drawEntityMasses`/`layoutEntityNames` already apply to the mass and its name. A
      // connector to a mass that isn't drawn is a line to nowhere: it can only read as a stray
      // diagonal leaving the frame. At fit — the app's default view — every mass is on the grid and
      // this changes nothing; it matters once the field is panned or stepped in.
      if (!a.onGrid || !b.onGrid) continue;
      const alpha = base * (AGG_EDGE_ALPHA_MIN + (1 - AGG_EDGE_ALPHA_MIN) * e.w);
      if (alpha <= 0.004) continue;
      const width = (e.w >= AGG_EDGE_DOUBLE_W ? GROUP_W_BASE * 2 : GROUP_W_BASE) * wScale;
      this.pushGroupSeg(this.groupBatch(alpha, width), a.col, a.row, b.col, b.row);
    }
  }

  /** The MID band's hub-to-hub backbone for one hierarchy level: one line per connected pair of that
   *  level's communities, drawn between the two communities' HUBS (highest-degree members — the same
   *  anchor rule the cluster names use), with the number of real edges behind it as its weight.
   *  Pairs come presorted heaviest-first from `buildLevelEdges`, so `pairs[0].count` is the level's
   *  maximum and `edgeWeightBucketRange` slices the rest against it — heavier group links read
   *  heavier, bucketed so a level stays a handful of batched strokes rather than one per pair. */
  private queueBackbone(level: number, weight: number) {
    const pairs = this.levelPairs[level];
    if (!pairs || !pairs.length) return;
    const maxCount = pairs[0].count;
    const base = this.edgeBaseAlpha * weight;
    const wScale = this.lineWidthScale();
    for (let wb = 0; wb < EDGE_WEIGHT_BUCKETS; wb++) {
      const alpha = base * (GROUP_EDGE_ALPHA_MIN
        + (1 - GROUP_EDGE_ALPHA_MIN) * ((wb + 0.5) / EDGE_WEIGHT_BUCKETS));
      if (alpha <= 0.004) continue;
      const width = Math.max(GROUP_W_MIN, Math.min(GROUP_W_MAX, (GROUP_W_BASE + wb * GROUP_W_STEP) * wScale));
      const { lo, hi } = edgeWeightBucketRange(wb, maxCount);
      const batch = this.groupBatch(alpha, width);
      for (const p of pairs) {
        if (p.count < lo || p.count >= hi) continue;
        // BOTH hubs must be ON THE GRID — `CanvasGraphRenderer.ts:1266`'s `if (!p.a.onScreen ||
        // !p.b.onScreen) continue`, and a DELIBERATE difference from the real member edges a few
        // lines down, which gate on `projValid` alone so an edge with one endpoint off-frame still
        // strokes its visible part (the "edges vanish at deep zoom" fix). A member edge with one end
        // off-screen is a real relationship you can still read; a GROUP line with one end off-screen
        // is a line to nowhere, and the finest levels have hundreds of them — measured on the
        // reference vault at 50%, dropping this rule drew ~620 lines fanning off every edge of the
        // field, which is the field-crossing noise this whole band exists to remove.
        if (!p.a.onGrid || !p.b.onGrid) continue;
        this.pushGroupSeg(batch, p.a.col, p.a.row, p.b.col, p.b.row);
      }
    }
  }

  /** One level's entity masses: an elliptical "@ o ." ramp blob per community, sized by member
   *  count (sqrt scaling, grid-capped), in the community's own ramp colour. During the leaf
   *  crossfade a real node glyph already on a cell WINS — members "emerge through" the dissolving
   *  parent instead of being stamped over. Every mass cell registers in cellEntity for the hit
   *  test, whichever glyph won the cell. */
  private drawEntityMasses(level: number, levelAlpha: number) {
    const m = this.m;
    for (const ev of this.entityLevels[level]) {
      if (!ev.onGrid) continue;
      this.entitiesDrawnFrame++;
      const hot = ev.flat === this.hoverEntityIdx;
      const rowR = ev.drawnRowR, colR = ev.drawnColR;
      const invR2 = 1 / (rowR * rowR), invC2 = 1 / (colR * colR);
      for (let dy = -rowR; dy <= rowR; dy++) {
        const row = ev.row + dy;
        if (row < 0 || row >= m.rows) continue;
        const base = row * m.cols;
        for (let dx = -colR; dx <= colR; dx++) {
          const col = ev.col + dx;
          if (col < 0 || col >= m.cols) continue;
          const d2 = dx * dx * invC2 + dy * dy * invR2;
          if (d2 > 1) continue;
          const i = base + col;
          this.cellEntity[i] = ev.flat;
          if (this.layerBuf[i] === LAYER_NODE && this.cellNode[i] >= 0) continue; // a real note owns the cell
          let alpha = massCellAlpha(d2) * levelAlpha;
          if (hot) alpha = Math.min(1, alpha + 0.25);
          this.charBuf[i] = massCellCode(d2);
          this.layerBuf[i] = LAYER_NODE;
          this.colorBuf[i] = ev.color;
          this.alphaBuf[i] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
        }
      }
    }
  }

  /**
   * The 3D camera dolly for the CURRENT resolution stop, in the same px units as `this.P`
   * (`cameraModel.ts` `dollyForT`, and its header). 0 in 2D — a flat view has nothing to approach.
   *
   * ── THE THING THAT IS NOT OBVIOUS, AND THAT EVERYTHING ELSE HERE FOLLOWS FROM ────────────────
   *
   * Scaling the world by `k` ABOUT THE TARGET, with the camera held at focal distance `P`, is not
   * merely "like" a dolly — it IS one, exactly, for every point:
   *
   *     k·X · P/(P − k·Z)  ≡  X · P/(P − Z − D)   for all X, Z   ⟺   D = P·(1 − 1/k)
   *
   * (cross-multiply: k(P − Z − D) = P − kZ ⟹ kP − kD = P). So `s = pxPerWorld · res` with `zc = z2`
   * — the code that was here — has ALWAYS been a camera dolly of `P·(1 − 1/res)`, producing exactly
   * the parallax, near/far separation and cloud-opening a pinned camera cannot produce.
   * §6's "ASCII pins the camera distance, so it produces almost no parallax" is a reading of the
   * source, not of the algebra, and it is wrong. Verified against this renderer's own projection:
   * screen positions agree to the last bit at res 1, 2, 8 and 68.
   *
   * Two consequences, and they are the whole design:
   *
   *   1. `zc = z2 + dollyForT(t, P)` written NAIVELY on top of the existing world scale does not ADD
   *      an approach — it applies the approach TWICE, `res × maxZs^t`. At t = 1 that is a ~17×
   *      overshoot: `z2`'s extent (±3.4·P on the 800×600 fixture) is already many times the 0.985·P
   *      of near-plane headroom, so the doubled camera pushes essentially everything in front of the
   *      target through the near plane and the field goes blank. That is the hazard, and its cause
   *      is double-counting, not an unbudgeted constant.
   *   2. What ASCII actually lacks is not the dolly but its CEILING. `res` runs to `maxRes`, which is
   *      graph- and box-derived and routinely exceeds `1/(1 − MAX_ZOOM_FRAC) ≈ 16.7` on a real vault
   *      — at `res = 68` the implicit dolly is `0.985·P`, i.e. sitting ON the near plane Canvas's
   *      `onWheel` clamp existed to stay off. That is the regime where the 3D field thins to a
   *      handful of violently-magnified glyphs. `dollyForT` IS that clamp, carried over.
   *
   * ── SO: the dolly is made EXPLICIT and CAPPED ────────────────────────────────────────────────
   *
   * `projectNodes` drops `res` from the 3D world scale (`s = pxPerWorld`) and puts the camera back
   * where the camera belongs: `zc = z2 + dolly`. The magnification the ladder gets is then
   *
   *     mag(t) = P/(P − dolly) = min( res , maxZsFor(P)^t )
   *
   * — `res` wherever the resolution ladder asks for less than the camera ceiling (in which case this
   * is the SAME projection as before, term for term, by the identity above), and Canvas's
   * `MAX_ZOOM_FRAC`-clamped ceiling wherever it asks for more. `P·(1 − 1/res)` below is literally
   * "the dolly `res` alone would imply": budgeting `zc` against `res` is taking the smaller of the
   * two, which is why a deep ladder now stops at ~16.7× instead of running onto the singularity.
   *
   * THE LAW is untouched — a dolly moves POSITIONS, never a glyph's size — and so is the semantic:
   * LOD level, label ladder and colour level all key off `resolutionT(res, maxRes)`, which nothing
   * here touches. The one accepted cost is that on a graph whose ladder is deeper than the camera
   * ceiling, 3D's 0% stop no longer reaches `DEEPEST_WORLD_PER_CELL` (2D still does): a perspective
   * camera cannot magnify 68× without standing on its own near plane, and a readable field that
   * always renders beats an unreadable one that sometimes does not.
   */
  private cameraDolly(is2d: boolean): number {
    if (is2d) return 0;
    const P = this.P;
    const ceiling = dollyForT(resolutionT(this.res, this.maxRes), P);
    const wanted = P * (1 - 1 / Math.max(1, this.res));
    return Math.max(0, Math.min(ceiling, wanted));
  }

  /** The copied camera math (CanvasGraphRenderer.project/projectPositions), evaluated inline with
   *  the per-frame constants hoisted. 2D is the same pipeline with rx = ry = 0 over the flat
   *  layout, so perspective resolves to 1. No allocation. */
  private projectNodes(is2d: boolean) {
    const m = this.m;
    const P = this.P;
    // The camera. In 3D the magnification lives in the DOLLY, so the world sits at its fit scale and
    // `res` does not multiply into `z2` a second time (cameraDolly() has the derivation). In 2D there
    // is no camera to move, so `res` scales the world exactly as it always has.
    const dolly = this.cameraDolly(is2d);
    const s = is2d ? this.pxPerWorld * this.res : this.pxPerWorld;
    // Distance from the camera to the TARGET plane. The NEAR plane below is a fixed fraction of
    // THIS, not of the focal length `P`: `persp` is uniformly `P/camDist`× larger once the camera has
    // dollied in, so a threshold pinned to `P` would tighten by that same factor and start culling
    // nodes whose screen positions are perfectly finite — silently thinning the field as you
    // approach, which is the same blank-at-high-zoom failure by a slower route. Rebased this way the
    // plane sits at the same WORLD distance in front of the target at every dolly, and reduces to the
    // original `zc < P * 0.985` exactly when `dolly` is 0 (all of 2D, and 3D at fit).
    //
    // MIN_PERSP — the FAR cull — is deliberately NOT rebased. Against the code AS IT NOW STANDS it is
    // a guard rather than a behaviour: it fires only for a node more than 20× the camera distance
    // BEHIND the target, and a fitted graph's own depth extent is at most `0.42 * boxPx / 0.866 ≈
    // 0.49 * P` from the centre (fitPxPerWorld's fraction over the FOV's own half-angle), i.e. under
    // 1·P even with the target moved onto the rim by frameSubset. Un-rebased it needs 20·P and
    // rebased it needs 20·camDist ≥ 1.2·P — both out of reach now, so rebasing it would be an
    // untestable change to unreachable code. Left literal.
    //
    // BUT it is NOT a no-op against the code as it stood BEFORE the camera change, and the honest
    // statement is that this is an accepted, unasserted behavioural delta rather than nothing at all.
    // The old form scaled world Z by `res`, so the cull fired at `Z ≤ −19·P/res` — which is INSIDE a
    // fitted cloud's ±0.49·P extent once `res > 39`, and this file cites `res = 68` as a realistic
    // vault value. So on a deep ladder the new form KEEPS far-behind nodes the old form culled. The
    // direction is more content rather than less, which is why it is accepted; the equivalence test
    // is scoped to a shallow ladder and structurally cannot show it.
    const camDist = Math.max(1, P - dolly);
    const nearPlane = P - camDist * NEAR_PLANE_SLACK;
    const tx = this.target[0], ty = this.target[1], tz = this.target[2];
    const rx = is2d ? 0 : this.rx, ry = is2d ? 0 : this.ry;
    const cyr = Math.cos(ry), syr = Math.sin(ry), cxr = Math.cos(rx), sxr = Math.sin(rx);
    // The QUANTIZED pan (see rasterize()/asciiGrid.ts quantizePan) — the pan-jitter fix: `panXQ`/
    // `panYQ` are always a whole multiple of the cell size, so the world→cell rounding PHASE below
    // never shifts mid-drag. The leftover sub-cell remainder (`panXFrac`/`panYFrac`) is applied only
    // as a canvas translate at paint time, never here. `originY` also folds in the intro's static
    // vertical frame offset (see setFrameOffsetY) — a constant px shift, so unlike the drag pan it
    // cannot re-phase the world→cell rounding mid-interaction and needs no quantization.
    const ox = this.originX(this.panXQ);
    const oy = this.originY(this.panYQ);
    let minZ = Infinity, maxZ = -Infinity;
    for (const nv of this.nodes) {
      const p = is2d ? nv.p2 : nv.p3;
      const x = (p[0] - tx) * s, y = (p[1] - ty) * s, z = (p[2] - tz) * s;
      const x1 = x * cyr + z * syr, z1 = -x * syr + z * cyr;
      const y2 = y * cxr - z1 * sxr, z2 = y * sxr + z1 * cxr;
      const zc = z2 + dolly;                           // the derived camera approach — see cameraDolly()
      const persp = P / Math.max(1, P - zc);
      nv.sx = ox + x1 * persp;
      nv.sy = oy + y2 * persp;
      nv.depth = zc;
      // snapToCell()'s arithmetic, inlined: the pure helper returns an object, and this loop runs
      // once per node per frame. (asciiGrid.test.ts pins the two to the same result.)
      const col = Math.round((nv.sx - m.padX) / m.cellW);
      const row = Math.round((nv.sy - m.padY) / m.cellH);
      nv.col = col; nv.row = row;
      // `projValid`: the projection is meaningful at all (in front of the camera / past the near
      // clip) — independent of grid bounds, so edges can gate on it alone and then CLIP to the grid
      // (see rasterize()'s edge loop) instead of requiring both endpoints already on-screen. Both
      // near plane is dolly-relative (see `camDist` above), so it means the same WORLD distance in
      // front of the target at every stop rather than tightening as the camera comes in.
      const projValid = persp > MIN_PERSP && zc < nearPlane;
      nv.projValid = projValid;
      nv.onGrid = projValid && col >= 0 && col < m.cols && row >= 0 && row < m.rows;
      if (zc < minZ) minZ = zc;
      if (zc > maxZ) maxZ = zc;
    }
    const span = maxZ - minZ;
    const flat = !(span > 1);
    for (const nv of this.nodes) nv.dr = flat ? 1 : (nv.depth - minZ) / span;
  }

  /**
   * Which labels to draw, and where — an N+1-tier zoom-driven system (labelSelection.ts owns the
   * pure curve math):
   *
   *   1. CLUSTER NAMES, per hierarchy LEVEL. Below `FILE_LABEL_REVEAL_T` the field names
   *      communities, not files — walking `communityPath` coarsest → finest as the camera zooms in,
   *      one crossfade per level boundary (`clusterLevelAlphas`), landing on the finest level right
   *      at the reveal point. Each active level's community centroids get their
   *      `communityPathLabels[level]` exemplar in eyebrow register (uppercase + tracked), placed by
   *      the same greedy grid-occupancy the file-label pass below uses, so cluster names — at any
   *      level, even two adjacent levels mid-crossfade — never overlap each other.
   *   2. FILE NAMES. Labels sit to the node's right on the SAME grid; a label that would run off
   *      the field flips to the node's left, and one whose cells are already taken (by a cluster
   *      name or a higher-ranked file label) is dropped unless it's forced (active/hovered/search —
   *      those always draw, at any zoom). The non-forced budget is intentionally conservative right
   *      after the reveal point (only the highest-ranked, i.e. hub, candidates clear it) and only
   *      opens up toward `FILE_LABEL_FULL_T` — "full naming" is a near-max-resolution thing.
   *
   * Every tier crossfades (not switches) across its own span, via `alpha` on each LabelDraw.
   */
  private layoutLabels(is2d: boolean) {
    this.labels.length = 0;
    if (this.cfg.showGraphLabels === false) return;
    const m = this.m;
    this.labelOccupied.fill(0);
    const t = resolutionT(this.res, this.maxRes);
    const cAlpha = clusterLabelAlpha(t);
    const fAlpha = fileLabelAlpha(t);

    if (cAlpha > 0.01 && this.levelCount > 0) {
      const levelAlphas = clusterLevelAlphas(t, this.levelCount);
      for (let L = 0; L < levelAlphas.length; L++) {
        const a = levelAlphas[L] * cAlpha;
        // LOD (2D): a level's name anchors to its ENTITY (already projected — O(clusters)); the
        // 3D / no-hierarchy path keeps the per-node on-grid aggregation.
        if (a > 0.01) { if (this.lodOn) this.layoutEntityNames(L, a); else this.layoutClusterNames(L, a); }
      }
    }

    // In the FAR band the leaf raster pass did not run — there are no note glyphs on the field for a
    // file label (forced or not) to point at, so the file-label pass is skipped entirely (which is
    // also what keeps a far-band frame O(clusters), not O(nodes log nodes)). The gate is the GLYPH
    // alpha, the same one rasterize()'s leaf pass uses — not the member-edge alpha, which is still 0
    // through the whole mid band where glyphs (and therefore label anchors) very much exist.
    if (this.lodOn && this.glyphAlpha <= LOD_ALPHA_EPS) return;

    // Reused scratch array — layoutLabels runs every frame, so it must not allocate one per frame.
    // Candidate gate is `inViewport` (the actual box + 40px), not merely `onGrid`'s exact cell
    // bounds — the label budget must be spent on what the user can actually see this frame, not
    // ranked by a global (possibly off-frame) criterion first (see clusterVisual.ts inViewport's
    // doc: "otherwise ... zooming in used to surface no new names"). `projValid` is ASCII's
    // equivalent of the source's own on-screen/depth-cull flag, ANDed in per that function's contract.
    const ordered = this.labelScratch;
    ordered.length = 0;
    for (const nv of this.nodes) {
      if (nv.projValid && inViewport(nv.sx, nv.sy, this.W, this.H, VIEWPORT_LABEL_PAD)) ordered.push(nv);
    }
    // ALL-LABELS MODE (GraphConfig.labelEveryNode — see the seam's doc for why the old
    // `graphLabelHubCount: 9999` sentinel never could work). Both zoom-driven gates come off: the
    // BUDGET opens to every candidate, and the crossfade ALPHA is pinned to 1. Both are load-bearing
    // and neither implies the other — `fileLabelBudget` and `fileLabelAlpha` are separate curves
    // that are BOTH zero at/below FILE_LABEL_REVEAL_T (0.75), i.e. across the whole range a diagram
    // opened at fit actually sits in, so dropping only one of them still shows nothing.
    const everyNode = this.cfg.labelEveryNode === true;
    const budget = everyNode ? ordered.length : fileLabelBudget(t, ordered.length);

    const forced = (nv: NodeView) => {
      const id = nv.node.id;
      return id === this.hoveredId || id === this.activeFile || nv.node.kind === "self" ||
        this.searchMatches.has(id) || (this.highlightSet?.has(id) ?? false) ||
        (this.hoveredId != null && (this.adjacency.get(this.hoveredId)?.has(id) ?? false));
    };
    const rank = (nv: NodeView) => (forced(nv) ? 1e9 : this.alwaysOn.has(nv.node.id) ? 1e6 + nv.deg : nv.deg + nv.dr);
    ordered.sort((a, b) => rank(b) - rank(a));

    /** Is any cell of the [col-1, col+len] span on `row` already claimed by an earlier label? */
    const taken = (col: number, len: number, row: number) => {
      for (let c = col - 1; c <= col + len; c++) {
        if (c < 0 || c >= m.cols) continue;
        if (this.labelOccupied[row * m.cols + c]) return true;
      }
      return false;
    };

    let drawn = 0;
    for (const nv of ordered) {
      const force = forced(nv);
      if (!force && drawn >= budget) break; // forced labels sort to the front, so this can break
      const text = labelText(nv.node);
      const len = text.length;
      let col = nv.col + 2;
      if (col + len > m.cols) col = nv.col - 2 - len;
      if (col < 0) continue;
      const row = nv.row;
      if (row < 0 || row >= m.rows) continue;
      let free = !taken(col, len, row);
      // ALL-LABELS mode retries the OTHER side of the node before giving a label up — a diagram's
      // names are its content, so "blocked on the right" should not silently unname a box while the
      // space to its left is empty. The knowledge graph deliberately does NOT do this: there a
      // dropped label is the budget doing its job, and a second placement attempt per candidate
      // would spend the budget on whichever labels happen to be contested.
      if (!free && everyNode) {
        const alt = col === nv.col + 2 ? nv.col - 2 - len : nv.col + 2;
        if (alt >= 0 && alt + len <= m.cols && !taken(alt, len, row)) { col = alt; free = true; }
      }
      if (!free && !force && !everyNode) continue;
      for (let c = col - 1; c <= col + len; c++) {
        if (c >= 0 && c < m.cols) this.labelOccupied[row * m.cols + c] = 1;
      }
      const accent = nv.node.id === this.activeFile || nv.node.id === this.hoveredId || this.searchMatches.has(nv.node.id);
      const colorSlot = accent ? C_ACCENT : is2d ? C_MUTED : nv.dr > 0.55 ? C_MUTED : C_FAINT;
      this.labels.push({
        text, col, row, color: this.resolveFillColor(colorSlot),
        accent, alpha: force || everyNode ? 1 : fAlpha, widthCells: len,
      });
      drawn++;
    }
  }

  /** Cluster-name pass for ONE hierarchy `level` (0 = coarsest): one label per that level's
   *  community, ANCHORED ON ITS HUB (pickHubAnchor — clusterVisual.ts), never on a member centroid —
   *  a vault's communities are hub-and-spoke and sprawling, so a centroid routinely lands in empty
   *  space (the failure this replaces; see clusterVisual.ts's module doc). The hub comes from
   *  `clusterHubByLevel`, precomputed ONCE per structural rebuild over the WHOLE community (not
   *  filtered to what's on screen) — so the anchor never jumps as members pan in and out of frame.
   *  There is exactly ONE anchor rule here, unconditionally: no second, screen-derived anchor to
   *  switch to, because switching is the thing that cannot be made smooth (see below).
   *
   *  **The edge clamp is CONDITIONAL — this is the load-bearing subtlety.** The col clamp below
   *  (`col < 0` / `col + wCells > m.cols`) exists for exactly one job: stop an ON-SCREEN label from
   *  running off the grid. Applied unconditionally it also does something illegitimate — fed an
   *  anchor that is itself off the grid, it PARKS the label at the edge column, a stationary name the
   *  field visibly slides out from under while the user keeps panning, captioning whatever happens to
   *  drift under it. So the clamp only fires while the ANCHOR's own column is on the grid; past that
   *  the label is placed at its raw hub column and, once its cells are entirely outside the grid,
   *  simply isn't drawn. That is what Canvas does (`drawClusterNames` draws at the hub's raw x with
   *  no clamp, letting the canvas clip), and it matches how `row` is ALREADY handled six lines down —
   *  an off-grid row `continue`s rather than clamping. Columns now behave the same way rows always
   *  did.
   *
   *  **Accepted cost, stated plainly:** a community whose hub has panned off-frame loses its name
   *  until the hub comes back, even while its members are still on screen. That is a real regression
   *  against the pre-hub-anchor centroid behaviour. It is deliberate. The alternative — falling back
   *  to the visible members' centroid while the hub is away — was measured and is worse: the hub and
   *  the centroid are BY CONSTRUCTION far apart (that is the entire premise of hub-anchoring, and
   *  AsciiGraphRenderer.test.ts's hub-anchor test asserts `|label − centroid| > 10` on purpose), so
   *  the switch between them teleports the label ~99 columns of a 124-column field in one frame; and
   *  while the hub is away the centroid itself jitters backwards against the pan as members cross the
   *  viewport pad, which is precisely the per-frame instability hub-anchoring exists to eliminate. A
   *  quiet, honest omission beats a teleport and beats a frozen label captioning the wrong region.
   *  (The app's DEFAULT 2D view is unaffected either way — it uses `layoutEntityNames`, the LOD path
   *  below, not this one. This path is 3D, "local" mode, and community-less graphs.)
   *
   *  Reserved first so file labels — and any OTHER level's names drawn the same frame during a
   *  level-to-level crossfade — never draw over each other. Larger communities (more VISIBLE members
   *  this frame) claim contested cells first — same greedy-by-worth idea as the file-label loop.
   *
   *  **Only communities on the level's NAME ROSTER are candidates at all** (`namableByLevel` — read
   *  that field's doc; it is the whole of Task 15). Without it this pass named every community it
   *  found on screen while the 2D pass could only name the ones `buildLodIndex` had built, so the
   *  same graph at the same stop showed 15 cluster names in 2D and 56 in 3D — the extra 41 being
   *  one- and two-note communities named after a single note, i.e. the "text soup". The gate is
   *  applied during aggregation, before `clusterExtent`/hub lookup, so a filtered community costs
   *  nothing per frame.
   *
   *  The name lifts above the hub's cell by `clusterLabelLift(clusterExtent(...))` — a constant
   *  minimum plus the community's own on-screen reach, so a big mass's name clears the whole mass.
   *  `clusterExtent` — UNLIKE the hub — takes only this frame's VIEWPORT-VISIBLE members: it measures
   *  how far the label has to reach across what the user can actually see right now, which is a
   *  different member set from the whole-graph one the hub uses on purpose (see clusterHubByLevel's
   *  field doc and clusterVisual.ts pickHubAnchor's call-site contract — the two must NOT share one
   *  materialized member array, or the anchor starts recomputing per frame and visibly drifts). */
  private layoutClusterNames(level: number, alpha: number) {
    const m = this.m;
    const names = this.communityNamesByLevel[level];
    const hubs = this.clusterHubByLevel[level];
    if (!names || !hubs) return;
    // The level's NAME ROSTER — see this method's doc and `namableByLevel`. Fail-closed: a level
    // with no roster names nothing, rather than falling back to naming everything.
    const namable = this.namableByLevel[level] ?? EMPTY_COMMUNITY_SET;
    const agg = this.clusterAgg;
    agg.clear();
    for (const nv of this.nodes) {
      if (!nv.projValid || !inViewport(nv.sx, nv.sy, this.W, this.H, VIEWPORT_LABEL_PAD)) continue;
      const path = pathOf(nv.node);
      if (!path) continue;
      const c = path[Math.min(level, path.length - 1)];
      if (!namable.has(c)) continue;
      let arr = agg.get(c);
      if (!arr) { arr = []; agg.set(c, arr); }
      arr.push(nv);
    }
    if (agg.size === 0) return;

    const items = [...agg.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
    for (const [community, members] of items) {
      const hubId = hubs.get(community);
      const hub = hubId != null ? this.byId.get(hubId) : undefined;
      if (!hub || !hub.projValid) continue; // no valid whole-graph anchor this frame
      const col0 = Math.round((hub.sx - m.padX) / m.cellW);
      const row0 = Math.round((hub.sy - m.padY) / m.cellH);
      const extent = clusterExtent({ sx: hub.sx, sy: hub.sy }, members);
      const liftRows = Math.round(clusterLabelLift(extent) / m.cellH);
      const row = row0 - liftRows; // "up" = decreasing row, off the TOP of the hub's cell
      if (row < 0 || row >= m.rows) continue;
      const text = trimDanglingWord(clusterLabelText(names.get(community) ?? `cluster ${community}`));
      const len = text.length;
      // The tracked (ctx.letterSpacing) draw is wider on screen than `len` cells — reserve the REAL
      // drawn width (eyebrowWidthCells), not `len`, so a neighbouring label can never be painted
      // over by the extra sub-cell tracking gap (the "soup" bug). Reservation range and the
      // free-space check below share the exact same [col-1, col+wCells] bounds — that identity is
      // what makes overlap impossible, not just unlikely.
      const wCells = eyebrowWidthCells(len, CLUSTER_LABEL_TRACKING_EM, this.fontPx, this.cellW);
      let col = col0 - Math.floor(wCells / 2); // centre by DRAWN width, not raw char count
      // Keep an ON-SCREEN name inside the grid — but ONLY while the anchor's own column is on the
      // grid. `col0` is the test, deliberately, NOT a pixel-space `inViewport(hub.sx, …)`: the clamp
      // it guards is column-space arithmetic, and gating column-space arithmetic on a pixel-space
      // predicate leaves a band (a padded viewport is WIDER than the grid) where the guard reads
      // "on screen" while the clamp is already parking the label — the residual freeze that made the
      // previous attempt at this fix fail review. One space, one test. Past the edge the label keeps
      // its raw hub column and clips, exactly like Canvas. See this method's doc for the cost.
      if (col0 >= 0 && col0 < m.cols) {
        if (col < 0) col = 0;
        if (col + wCells > m.cols) col = Math.max(0, m.cols - wCells);
      }
      // Entirely outside the grid — don't draw it at all (and don't run the occupancy loops over a
      // range with no on-grid cells in it). A partially-overlapping label still draws, clipped, so
      // the name slides off the edge continuously instead of vanishing the instant it touches it.
      if (col + wCells <= 0 || col >= m.cols) continue;
      let free = true;
      for (let c = col - 1; c <= col + wCells && free; c++) {
        if (c < 0 || c >= m.cols) continue;
        if (this.labelOccupied[row * m.cols + c]) free = false;
      }
      if (!free) continue;
      for (let c = col - 1; c <= col + wCells; c++) {
        if (c >= 0 && c < m.cols) this.labelOccupied[row * m.cols + c] = 1;
      }
      const color = this.communityColorsByLevel[level]?.get(community) ?? "#888";
      this.labels.push({ text, col, row, color, accent: false, alpha, eyebrow: true, widthCells: wCells });
    }
  }

  /** LOD variant of the cluster-name pass: one eyebrow label per ON-GRID entity of `level`,
   *  centred under its mass (falling back to above it at the bottom edge). Entities come presorted
   *  largest-first from buildLodIndex, so contested cells go to the biggest community — the same
   *  greedy-by-worth rule as everywhere else. O(clusters), not O(nodes).
   *
   *  **The edge clamp is CONDITIONAL here for exactly the reason it is in `layoutClusterNames` —
   *  and this is the path that matters most, because it is the one the app's DEFAULT 2D view uses.**
   *  `ev.onGrid` (projectEntities) admits a mass whose CENTRE is up to `drawnColR` columns OFF the
   *  grid, since a big mass can still overlap the field from out there. Clamped unconditionally, a
   *  name anchored in that band parks at the edge column and sits there while the user keeps panning
   *  — a stationary caption over whatever drifts under it, the same defect the hub-anchored path was
   *  fixed for, just bounded by `drawnColR` instead of unbounded. So the clamp fires only while the
   *  ANCHOR's own column is on the grid; past that the name keeps its raw centred column and clips,
   *  and once its cells are entirely outside the grid it simply isn't drawn — which is how `row` a
   *  few lines up has always behaved. */
  private layoutEntityNames(level: number, alpha: number) {
    const m = this.m;
    const evs = this.entityLevels[level];
    if (!evs) return;
    for (const ev of evs) {
      if (!ev.onGrid) continue;
      // Same treatment as the non-LOD cluster-name pass above. Canvas applies trimDanglingWord at
      // its ONE name site; ASCII has TWO (that pass and this one), so applying it at only one of
      // them would leave the LOD mass names — the ones the app's DEFAULT 2D view actually shows —
      // keeping a trailing "and"/"of"/"the".
      const text = trimDanglingWord(clusterLabelText(ev.name));
      const len = text.length;
      let row = ev.row + ev.drawnRowR + 1;
      if (row >= m.rows) row = ev.row - ev.drawnRowR - 1;
      if (row < 0 || row >= m.rows) continue;
      // Reserve the REAL drawn width (tracking included), not the raw char count — see
      // layoutClusterNames' comment. Reservation and the free-space check share identical bounds.
      const wCells = eyebrowWidthCells(len, CLUSTER_LABEL_TRACKING_EM, this.fontPx, this.cellW);
      let col = ev.col - Math.floor(wCells / 2); // centre by DRAWN width, not raw char count
      // ON-GRID anchors only — see this method's doc. `ev.col` is the test, in column space, for the
      // same reason `layoutClusterNames` tests `col0` rather than a pixel-space predicate: gating
      // column-space arithmetic on anything else leaves a band where the guard reads "on screen"
      // while the clamp is already parking the label.
      if (ev.col >= 0 && ev.col < m.cols) {
        if (col < 0) col = 0;
        if (col + wCells > m.cols) col = Math.max(0, m.cols - wCells);
      }
      // Entirely outside the grid — don't draw it, and don't run the occupancy loops over a range
      // with no on-grid cells. A partially-overlapping name still draws, clipped, so it slides off
      // the edge continuously instead of vanishing the instant it touches it.
      if (col + wCells <= 0 || col >= m.cols) continue;
      let free = true;
      for (let c = col - 1; c <= col + wCells && free; c++) {
        if (c < 0 || c >= m.cols) continue;
        if (this.labelOccupied[row * m.cols + c]) free = false;
      }
      if (!free) continue;
      for (let c = col - 1; c <= col + wCells; c++) {
        if (c >= 0 && c < m.cols) this.labelOccupied[row * m.cols + c] = 1;
      }
      this.labels.push({
        text, col, row, color: this.resolveFillColor(ev.color), accent: false, alpha, eyebrow: true, widthCells: wCells,
      });
    }
  }

  // ---- painting ------------------------------------------------------------

  /** `colorBuf`'s sentinel scheme: a plain slot (0..9) resolves through `this.colors`/
   *  COLOR_FALLBACK as always; `BLEND_BASE..<COMM_BLEND_BASE` indexes a resolved per-(level,
   *  community) colour (`commColors`, buildColorSlots); `COMM_BLEND_BASE` and above indexes the
   *  per-frame, lazily-memoized LEVEL-DRIVEN COLOR blend cache (blendColorSlot) instead. */
  private resolveFillColor(slot: number): string {
    if (slot >= COMM_BLEND_BASE) return this.blendColors[slot - COMM_BLEND_BASE] ?? "#888";
    if (slot >= BLEND_BASE) return this.commColors[slot - BLEND_BASE] ?? "#888";
    return this.colors[slot] ?? COLOR_FALLBACK[slot] ?? "#888";
  }

  /** Vector-stroke every LINE the field draws, BENEATH the glyph/label passes, in three tiers —
   *  group lines (far-band aggregate connectors + mid-band backbone), then the colour-tinted
   *  intra-cluster mesh, then the real member edges. Real anti-aliased 1px lines, the pre-redesign
   *  CanvasGraphRenderer's edge appearance (width/alpha falloff, colour source, batching) ported onto
   *  this field's own camera/culling instead of rasterized as grid characters. rasterize() already
   *  sorted survivors into the bucket arrays below (by the alpha they'll be stroked at); this only
   *  issues the batched `stroke()` calls — each one `beginPath()` + its bucket's `moveTo`/`lineTo`
   *  pairs + one `stroke()` — the same "one path per alpha tier" batching the old renderer used to
   *  keep thousands of edges cheap.
   *
   *  Each tier is independently gated, and the three gates are DIFFERENT numbers: group lines ride
   *  their own per-level weights × `backboneAlpha`, the mesh rides the glyph gate, and the member
   *  passes ride `memberEdgeAlpha`. See backbone.ts's wiring recipe for why they cannot be one.
   *
   *  Endpoints snap to the node's CELL CENTRE, not the raw sub-pixel projection (`nv.sx`/`nv.sy`):
   *  glyphs are drawn at the cell lattice (see the row loop below), so the cell centre is exactly
   *  where a node's ink sits — a line to the true projected point would miss the glyph by up to half
   *  a cell. Called from paint() AFTER the pan-residual `setTransform`, so these endpoints ride the
   *  same panXFrac/panYFrac translate the glyphs do — lines and glyphs never drift apart mid-drag. */
  private strokeEdges() {
    const ctx = this.ctx;
    if (!ctx) return;
    const m = this.m;
    const cx = (nv: NodeView) => m.padX + nv.col * m.cellW + m.cellW / 2;
    const cy = (nv: NodeView) => m.padY + nv.row * m.cellH + m.cellH / 2;
    const edgeHexBase = this.colors[C_EDGE] ?? COLOR_FALLBACK[C_EDGE];
    // 1. GROUP LINES — the far band's aggregate connectors and the mid band's hub-to-hub backbone,
    //    already batched by (alpha, width) in rasterize(). Beneath everything else: they are the
    //    coarse story, and a member edge or a glyph on top of one should win.
    ctx.strokeStyle = edgeHexBase;
    for (const b of this.groupBatches.values()) {
      if (!b.pts.length) continue;
      ctx.globalAlpha = Math.min(1, b.alpha);
      ctx.lineWidth = b.width;
      ctx.beginPath();
      for (let i = 0; i + 3 < b.pts.length; i += 4) {
        ctx.moveTo(b.pts[i], b.pts[i + 1]);
        ctx.lineTo(b.pts[i + 2], b.pts[i + 3]);
        this.edgesStrokedFrame++;
      }
      ctx.stroke();
    }
    // 2. INTRA-CLUSTER MESH — every intra-community edge in the CLUSTER'S OWN colour, one batched
    //    stroke per colour. This is the cluster's body: without it a group of glyphs is a dot cloud,
    //    with it the weave itself reads as mass. It draws wherever glyphs do — across BOTH the mid
    //    and near bands, unlike the member edges below — and it FADES IN WITH THEM.
    //
    //    That `× glyphAlpha` is load-bearing, not polish. `intraOn` only asks whether the leaf pass
    //    ran at all, and its threshold (LOD_ALPHA_EPS) is crossed at t ≈ 0.330, where massAlpha is
    //    still 0.985. Stroked at a flat INTRA_EDGE_ALPHA from that instant, the mesh is a
    //    full-strength colour-tinted web laid over near-solid territory masses with no visible
    //    glyphs anywhere — a cobweb across the field, which is precisely the noise the far band
    //    exists NOT to have, and it persists the whole way across [0.33, 0.46].
    const meshA = INTRA_EDGE_ALPHA * this.edgeBaseAlpha * this.glyphAlpha;
    if (this.intraOn && meshA > 0.004) {
      // CanvasGraphRenderer.ts:1298 — `max(0.12, min(1.1, 0.3 * zoomScale))`: deliberately THINNER
      // than a member edge (0.4) with a lower ceiling, so the weave reads as texture under the graph
      // rather than competing with it.
      const meshW = Math.max(MESH_W_MIN, Math.min(MESH_W_MAX, MESH_W_BASE * this.lineWidthScale()));
      for (const [slot, list] of this.intraBuckets) {
        if (!list.length) continue;
        ctx.strokeStyle = this.resolveFillColor(slot);
        ctx.globalAlpha = meshA;
        ctx.lineWidth = meshW;
        ctx.beginPath();
        for (const e of list) {
          const [ax, ay, bx, by] = trimSegmentForClearance(cx(e.a), cy(e.a), cx(e.b), cy(e.b), CLEARANCE_CELLS * m.cellW);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          this.edgesStrokedFrame++;
        }
        ctx.stroke();
      }
    }
    // 3. REAL MEMBER EDGES — `memberEdgeAlpha` (the NEAR band), never the glyph gate: across the mid
    //    band glyphs are fully on while these are fully off, the backbone standing in for them.
    const base = this.edgeBaseAlpha * this.memberEdgeAlpha;
    if (base <= 0.004) { ctx.globalAlpha = 1; return; }
    // Width follows the RESOLUTION stop (0=fit .. 1=deepest), not `this.res` raw — `res` ranges
    // 1..maxRes and real vaults run maxRes into the teens/twenties, so gating on it directly saturated
    // the 1.6 ceiling almost immediately (a past bug: `EDGE_W_GAIN * this.res` clamped to 1.6 at
    // res>=4). This still grows lines on the dolly-in the way CanvasGraphRenderer's own zoomScale grew
    // both its lines AND its node dots together — glyphs stay a constant cell size either way (THE LAW,
    // top of file), so only the vector edges (their one stated exception) get thicker — but the ceiling
    // is now reached only at the actual deepest zoom stop. Sane at both ends: EDGE_W_GAIN (0.4) at fit
    // (t=0), EDGE_W_MAX (1.6) at the deepest stop (t=1) — see AsciiGraphRenderer.test.ts "edge width".
    const t = resolutionT(this.res, this.maxRes);
    ctx.lineWidth = Math.max(EDGE_W_MIN, Math.min(EDGE_W_MAX, EDGE_W_GAIN + (EDGE_W_MAX - EDGE_W_GAIN) * t));
    const edgeHex = edgeHexBase;
    // Hovered-incident edges stroke in --accent, not the original's neutral-at-2.2x-alpha
    // (CanvasGraphRenderer.ts:848) — an INTENTIONAL, user-chosen deviation (the user was asked and
    // chose to keep the accent tint for hover). Do not "restore fidelity" here.
    const accentHex = this.colors[C_ACCENT] ?? COLOR_FALLBACK[C_ACCENT];
    // A stroked line runs straight through its endpoint glyph's cell centre; CanvasGraphRenderer got
    // away with centre-to-centre because its node pass painted an OPAQUE filled disc over the endpoint
    // (CanvasGraphRenderer.ts:898-904) — a thin fillText glyph covers almost none of its cell, so an
    // untrimmed line would muddy the glyph's interior/counters. Pull each endpoint back along the
    // segment instead. Segments shorter than twice the clearance are drawn UNTRIMMED rather than
    // inverted — trimming a near-coincident pair would flip the direction and draw backwards.
    const CLEARANCE = CLEARANCE_CELLS * m.cellW;
    const pass = (list: EdgeView[], alpha: number, color: string) => {
      if (!list.length || alpha <= 0.004) return;
      ctx.strokeStyle = color;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.beginPath();
      for (const e of list) {
        const [ax, ay, bx, by] = trimSegmentForClearance(cx(e.a), cy(e.a), cx(e.b), cy(e.b), CLEARANCE);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        this.edgesStrokedFrame++;
      }
      ctx.stroke();
    };
    // Dim (non-focus) and flat-2D edges first, then 3D depth bands far→near (so alpha compositing
    // order matches the old renderer's back-to-front pass), then the hovered-incident accent on top.
    pass(this.edgeDim, base * EDGE_DIM_ALPHA, edgeHex);
    pass(this.edgeMain, base, edgeHex);
    for (let bi = 0; bi < EDGE_DEPTH_BANDS; bi++) {
      const fade = EDGE_DEPTH_MIN + (1 - EDGE_DEPTH_MIN) * Math.pow((bi + 0.5) / EDGE_DEPTH_BANDS, EDGE_DEPTH_CURVE);
      pass(this.edgeBands[bi], base * fade, edgeHex);
    }
    // `base`, not the bare `memberEdgeAlpha` — see EDGE_BASE_ALPHA_FALLBACK's comment: base already
    // folds in the per-theme edgeBaseAlpha, so every pass (including this one) stays on the one knob.
    pass(this.edgeAccent, base, accentHex);
    ctx.globalAlpha = 1; // leave clean for the row loop + label pass right after
  }

  /** One fillText per colour+alpha RUN per row. Runs keep the character count per call high (a
   *  13k-cell field costs a few hundred calls, not 13k) while staying exactly on the cell grid,
   *  because the advance is pinned by letterSpacing in applyFont(). */
  private paint() {
    const ctx = this.ctx;
    if (!ctx) return;
    // Clear at the IDENTITY transform (no pan residual) first — clearing under a translated
    // transform would leave an uncleared sliver at whichever edge the translate shifted content
    // AWAY from. The residual pan translate is applied AFTER, for every draw below.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (!this.boxReady) return;
    // The pan-jitter fix's other half: `panXFrac`/`panYFrac` (computed once per rasterize(), see
    // asciiGrid.ts quantizePan) are the sub-cell remainder the world→cell projection deliberately
    // ignores (it uses the whole-cell `panXQ`/`panYQ` instead, so the raster never re-phases). A
    // plain canvas translate re-applies that remainder to every subsequent draw — field glyphs AND
    // labels move together — so the on-screen motion still tracks the cursor smoothly between
    // whole-cell raster updates, instead of stepping in visible whole-cell jumps.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, this.panXFrac * this.dpr, this.panYFrac * this.dpr);
    // Vector edge lines, stroked BEFORE any glyph/label draw so they sit beneath every node and
    // every label plate — the same paint order the pre-redesign renderer used (edges, then opaque
    // node dots on top). See strokeEdges()'s doc comment for the bucket/batching design.
    this.strokeEdges();
    ctx.font = `${this.fontPx}px ${this.fontStack}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const m = this.m;
    let drawnNodes = 0;
    for (let r = 0; r < m.rows; r++) {
      const y = m.padY + r * m.cellH + m.cellH / 2;
      const base = r * m.cols;
      let run = "";
      let runCol = 0;
      let runColor = -1;
      let runAlpha = -1;
      const flush = () => {
        if (!run) return;
        const trimmed = run.replace(/ +$/, "");
        if (trimmed) {
          ctx.fillStyle = this.resolveFillColor(runColor);
          ctx.globalAlpha = runAlpha / 255;
          ctx.fillText(trimmed, m.padX + runCol * m.cellW, y);
        }
        run = "";
      };
      for (let c = 0; c < m.cols; c++) {
        const i = base + c;
        const code = this.charBuf[i];
        if (!code) { if (run) run += " "; continue; }
        if (this.layerBuf[i] === LAYER_NODE) drawnNodes++;
        // Quantize alpha so near-identical cells share a run (16 buckets is invisible, and it keeps
        // a depth-faded field from degenerating into one fillText per character).
        const a = this.alphaBuf[i] & 0xf0;
        const col = this.colorBuf[i];
        if (run && (col !== runColor || a !== runAlpha)) flush();
        if (!run) { runCol = c; runColor = col; runAlpha = a; }
        run += String.fromCharCode(code);
      }
      flush();
    }

    // Labels last, each on cleared ground (the design's opaque label plate) so a name is never
    // read through the field behind it. Cluster (eyebrow) names borrow the pinned cell letterSpacing
    // for real `--ls-eyebrow` tracking, then hand it back so the next frame's field glyphs (drawn at
    // the top of THIS function, before labels) still land exactly on their cells.
    ctx.globalAlpha = 1;
    const ctxLS = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    const eyebrowLS = `${(this.fontPx * CLUSTER_LABEL_TRACKING_EM).toFixed(2)}px`;
    for (const l of this.labels) {
      if (l.alpha <= 0.01) continue; // fully crossfaded out — skip so its ground-clear box doesn't blank the field
      const x = m.padX + l.col * m.cellW;
      const y = m.padY + l.row * m.cellH;
      ctx.fillStyle = this.groundColor;
      ctx.fillRect(x - m.cellW * 0.5, y, (l.text.length + 1) * m.cellW, m.cellH);
      ctx.fillStyle = l.color; // already a resolved CSS colour string — see LabelDraw's doc
      ctx.globalAlpha = (l.eyebrow ? 1 : l.accent ? 1 : 0.9) * l.alpha;
      if (this.letterSpacingSupported) ctxLS.letterSpacing = l.eyebrow ? eyebrowLS : this.pinnedLetterSpacing;
      ctx.fillText(l.text, x, y + m.cellH / 2);
      ctx.globalAlpha = 1;
    }
    if (this.letterSpacingSupported) ctxLS.letterSpacing = this.pinnedLetterSpacing;
    this.onPaint?.(drawnNodes);
  }

  // ---- interaction ---------------------------------------------------------

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.pressed = true; this.movedFar = false;
    this.downX = this.lastX = e.clientX; this.downY = this.lastY = e.clientY;
    this.setSelectionSuppressed(true);
  };

  private prevUserSelect: string | null = null;
  private setSelectionSuppressed(on: boolean): void {
    const body = typeof document !== "undefined" ? document.body : null;
    if (!body) return;
    if (on) {
      if (this.prevUserSelect === null) this.prevUserSelect = body.style.userSelect;
      body.style.userSelect = "none";
    } else {
      body.style.userSelect = this.prevUserSelect ?? "";
      this.prevUserSelect = null;
    }
  }

  private onPointerLeave = () => { if (this.hoveredId || this.hoverEntityIdx >= 0) this.applyHover(null, -1); this.dirty = true; };

  /** Cell under the cursor → the node that owns it (or a node within a couple of cells). Subtracts
   *  the pan-jitter fix's sub-cell canvas translate (`panXFrac`/`panYFrac` — see paint()) so the hit
   *  test lines back up with what's actually drawn on screen, not the untranslated raster. */
  private pick(clientX: number, clientY: number): NodeView | null {
    if (!this.viewport) return null;
    const r = this.viewport.getBoundingClientRect();
    const { col, row } = pxToCell(clientX - r.left - this.panXFrac, clientY - r.top - this.panYFrac, this.m);
    const idx = nearestCellNode(col, row, this.m, this.cellNode, HIT_RADIUS_CELLS);
    return idx >= 0 ? this.nodes[idx] ?? null : null;
  }

  /** Cell under the cursor → the LOD entity whose mass covers it (entityFlat index, -1 none).
   *  Radius 0 extra rings: a mass is many cells wide — nothing to be fuzzy about. */
  private pickEntityIdx(clientX: number, clientY: number): number {
    if (!this.viewport || !this.lodOn) return -1;
    const r = this.viewport.getBoundingClientRect();
    const { col, row } = pxToCell(clientX - r.left - this.panXFrac, clientY - r.top - this.panYFrac, this.m);
    return nearestCellNode(col, row, this.m, this.cellEntity, 1);
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) {
      const nv = this.pick(e.clientX, e.clientY);
      this.applyHover(nv, nv ? -1 : this.pickEntityIdx(e.clientX, e.clientY));
    }
    if (!this.pressed) return;
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
    if (!this.movedFar && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > DRAG_THRESHOLD) {
      this.movedFar = true; this.dragging = true; this.userTook = true;
      this.viewport.classList.add("is-dragging");
      if (this.hoveredId || this.hoverEntityIdx >= 0) this.applyHover(null, -1);
      if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
    }
    if (!this.dragging) return;
    if (this.cfg.viewMode === "2d") { this.panX += dx; this.panY += dy; }
    else {
      this.ry += dx * ORBIT_SPEED;
      this.rx += dy * ORBIT_SPEED;
      this.rx = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.rx));
    }
    this.dirty = true;
  };

  private onPointerUp = (e: PointerEvent) => {
    const wasDrag = this.dragging || this.movedFar;
    this.pressed = false; this.dragging = false;
    this.viewport?.classList.remove("is-dragging");
    this.setSelectionSuppressed(false);
    this.dirty = true;
    if (wasDrag) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (hit) this.onNodeClick(hit.node.id);
    else {
      // Clicking an AGGREGATE ENTITY (an island) recentres on it and expands it one hierarchy level
      // (see clickEntity) — never onNodeClick, a cluster id is not a note.
      const evIdx = this.pickEntityIdx(e.clientX, e.clientY);
      if (evIdx >= 0) { this.applyHover(null, -1); this.clickEntity(evIdx); }
      else if (this.highlightSet) { this.clearHighlight(); this.onHighlightCleared?.(); }
    }
  };

  /** THE LAW: the wheel changes RESOLUTION, never the glyph size — and it does so in
   *  `ZOOM_STEP_PCT` STEPS, not continuously. `wheelAccum` turns however finely a trackpad/mouse
   *  slices its deltaY into discrete notches (`WHEEL_NOTCH_PX`, one per `ZOOM_STEP_PCT`): a real
   *  mouse wheel click is already ~one notch, a trackpad's finer deltas simply accumulate toward
   *  one. The field itself still reads as smooth motion — `setZoomPercent` only moves the STEP
   *  target; `tick()`'s existing per-frame glide eases `res` toward it. */
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.userTook = true;
    // CURSOR-ANCHORED (2D): each notch steps the ladder about the world point under the cursor —
    // zoomStepAnchored re-aims goalTarget so that point keeps its px through the step. An event
    // without usable coordinates (synthetic dispatch) anchors the grid centre, like keyboard zoom.
    const r = this.viewport.getBoundingClientRect();
    let ax = e.clientX - r.left, ay = e.clientY - r.top;
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
      ax = this.m.padX + (this.m.cols * this.m.cellW) / 2;
      ay = this.m.padY + (this.m.rows * this.m.cellH) / 2;
    }
    this.wheelAccum += e.deltaY;
    while (Math.abs(this.wheelAccum) >= WHEEL_NOTCH_PX) {
      // deltaY < 0 (scroll up / pinch in) is the conventional "zoom in" gesture — MORE resolution,
      // i.e. a LOWER percent under the 100%=fit/0%=deepest convention.
      const dir = this.wheelAccum < 0 ? -1 : 1;
      this.wheelAccum -= dir * WHEEL_NOTCH_PX;
      this.zoomStepAnchored(this.zoomPct + dir * ZOOM_STEP_PCT, ax, ay);
    }
  };

  /** Move the zoom ladder to the step nearest `pct` (100=fit .. 0=deepest), and re-derive `goalRes`
   *  from it against the current `maxRes` ceiling. The single place that ever assigns `zoomPct`
   *  outside of a reset, so wheel/keys/frameSubset/resetView all stay in one durable state. */
  private setZoomPercent(pct: number) {
    this.zoomPct = snapZoomPercent(pct);
    this.goalRes = resFromPercent(this.zoomPct, this.maxRes);
    this.dirty = true;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (!this.host || this.host.offsetParent === null) return;
    if (e.key === "Escape") this.resetView();
    else if (e.key === "z" || e.key === "Z") { if (this.hoveredId) this.focusNode(this.hoveredId); else this.resetView(); }
    else if (e.key === "+" || e.key === "=") { this.userTook = true; this.zoomStepCentered(this.zoomPct - ZOOM_STEP_PCT); }
    else if (e.key === "-" || e.key === "_") { this.userTook = true; this.zoomStepCentered(this.zoomPct + ZOOM_STEP_PCT); }
  };

  /** The one place hover state changes: a real node wins over an entity; either surfaces through
   *  `onHover` (an entity as a synthetic "cluster"-kind HoverNode naming the community + size). */
  private applyHover(nv: NodeView | null, evIdx: number) {
    const id = nv?.node.id ?? null;
    if (id === this.hoveredId && evIdx === this.hoverEntityIdx) return;
    this.hoveredId = id;
    this.hoverEntityIdx = evIdx;
    if (nv) this.onHover({ id: nv.node.id, label: nv.node.label, kind: nv.node.kind, folder: nv.node.folder });
    else if (evIdx >= 0) {
      const ev = this.entityFlat[evIdx];
      this.onHover({ id: `cluster:L${ev.level}:${ev.community}`, label: `${ev.name} · ${ev.count} notes`, kind: "cluster" });
    } else this.onHover(null);
    this.dirty = true;
  }

  // ---- highlight / selection ----------------------------------------------

  setActiveFile(id: string | null) {
    this.activeFile = id;
    this.alwaysOn = computeAlwaysOnSet(
      this.nodes.map((n) => n.node),
      this.edges.map((e) => ({ source: e.a.node.id, target: e.b.node.id })),
      this.activeFile, this.cfg.graphLabelHubCount ?? 10,
    );
    this.dirty = true;
  }

  setSearchMatches(ids: Set<string>) { this.searchMatches = ids; this.dirty = true; }
  highlightNodes(ids: string[]) { this.highlightSet = ids.length ? new Set(ids) : null; this.dirty = true; }
  clearHighlight() { this.highlightSet = null; this.dirty = true; }

  private focusSet(): Set<string> | null {
    if (this.hoveredId) {
      const s = new Set<string>([this.hoveredId]);
      for (const nb of this.adjacency.get(this.hoveredId) ?? []) s.add(nb);
      return s;
    }
    return this.highlightSet;
  }

  // ---- camera commands -----------------------------------------------------

  focusNode(id: string) {
    if (!this.byId.has(id)) return;
    this.frameSubset([id, ...(this.adjacency.get(id) ?? [])]);
  }

  /**
   * Frame a subset by RAISING THE RESOLUTION until it fills the grid (and re-centring on it) — the
   * ASCII equivalent of a dolly-in; no glyph is scaled.
   *
   * `frameSubset` asks for a MAGNIFICATION ("make this subset fill ~55% of the field"), and the two
   * view modes reach a magnification by different roads: 2D scales the world by `res`, 3D dollies
   * the camera (see cameraDolly()). Both are still expressed as ONE durable state — the resolution
   * stop — so this converts the wanted magnification into the stop that DELIVERS it, per mode, and
   * every camera command (`focusNode` → here, `clickEntity`, `resetView`, the wheel) writes only
   * `zoomPct`/`goalRes`. There is no second zoom axis to fall out of sync, which is exactly what the
   * pre-merge pair had (Canvas's `goalZoom` in px vs ASCII's `goalRes`).
   *
   * The 3D conversion is `cameraModel.zoomT` — `dollyForT`'s exact inverse — taken against the dolly
   * that WOULD produce the wanted magnification. Because the 3D camera's magnification is
   * `min(res, maxZsFor(P)^t)`, reaching a magnification needs BOTH factors to be there, so the two
   * progressions are combined with `max` rather than either one alone: use only the resolution
   * ladder and a deep-ladder graph under-frames (the camera ceiling caps it short of the request);
   * use only `zoomT` and a shallow-ladder graph under-frames instead (`res` runs out first).
   */
  frameSubset(ids: string[]) {
    const views = ids.map((i) => this.byId.get(i)).filter(Boolean) as NodeView[];
    if (!views.length) return;
    const is2d = this.cfg.viewMode === "2d";
    const pts = views.map((v) => (is2d ? v.p2 : v.p3));
    const c = centroid3(pts);
    let r = 1e-6;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
    const whole = Math.max(1e-6, is2d ? this.radius2 : this.radius3);
    const wantMag = (whole / r) * 0.55;
    // resFromT(resolutionT(m, maxRes), maxRes) is m clamped to [1, maxRes] — the 2D road, unchanged.
    let t = resolutionT(wantMag, this.maxRes);
    if (!is2d) t = Math.max(t, zoomT(this.P * (1 - 1 / Math.max(1, wantMag)), this.P));
    this.goalTarget = c;
    this.goalRes = resFromT(t, this.maxRes);
    // Framing isn't a zoom STEP — it's a continuous camera command — but resync the durable percent
    // state to wherever it landed, so the next wheel notch / +- press steps from there.
    this.zoomPct = resolutionPercent(this.goalRes, this.maxRes);
    this.userTook = true;
    this.dirty = true;
  }

  /**
   * Clicking an AGGREGATE ENTITY (an island): centre the camera on its members' 2D world centroid
   * and step the zoom ladder IN just far enough to reveal its CHILD hierarchy level —
   * labelSelection.ts `levelBoundaries`, the SAME boundaries the cluster-name crossfade uses, so
   * geometry and naming always agree on where a level "owns" the field.
   *
   * Landing EXACTLY at `levelBoundaries()[childLevel]` (rather than somewhere deeper inside the
   * child's segment) is deliberate, and it is now doing TWO jobs at once:
   *
   *   1. It is the MINIMUM resolution increase that reveals the child grouping. Per
   *      `clusterLevelAlphas`, the child level's own alpha is already FULLY IN right at that
   *      boundary (its crossfade completes there, it doesn't start there). Going deeper only shrinks
   *      the visible world window further, which can push the child's own members back OFF the grid
   *      on a widely-spread hierarchy without buying anything for the crossfade.
   *   2. It is also the stop within the child's whole window `[bounds[c], bounds[c+1])` where the
   *      child's MASSES are strongest, because `bandsForT`'s `massAlpha` is non-increasing in `t`.
   *      So if the children can be drawn as territory masses at all, this is where.
   *
   * **WHAT THE USER ACTUALLY SEES THERE DEPENDS ON DEPTH, and on a real vault it is often not
   * masses.** The mass band ends at `BACKBONE_START_T + BACKBONE_FADE_SPAN` (0.46) while the level
   * ladder runs to `FILE_LABEL_REVEAL_T` (0.75), so a level whose window STARTS past 0.46 has no
   * stop anywhere at which it renders as masses. On the reference vault's 5-level hierarchy
   * (`levelBoundaries(5) = [0, .15, .30, .45, .60, .75]`):
   *
   * | clicked level | target t | child mass alpha | what the click produces                       |
   * |---|---|---|---|
   * | 0 | 0.150 | 1.000  | child masses, named                                             |
   * | 1 | 0.300 | 1.000  | child masses, named                                             |
   * | 2 | 0.450 | 0.0146 | effectively glyphs (the masses are there but invisible)          |
   * | 3 | 0.600 | 0.0000 | glyphs + the child level's backbone and names; no masses at all  |
   *
   * That is not a bug and it is not worked around here: clicking a deep mass DISSOLVES it into its
   * members, and the child grouping is still revealed — through node colour, the cluster-name ladder
   * and the hub-to-hub backbone, all of which switch to the child level at exactly this `t`. What
   * this comment must not do is keep claiming the click "reveals its child hierarchy level" as
   * masses unconditionally, because for levels 2+ it does not. Re-stretching the bands to make it
   * true was considered and rejected — see `backbone.ts`'s header and its constants.
   *
   * The LEAF pseudo-level is a separate exception: the file-label alpha — and the leaf raster pass,
   * gated the same way — is exactly 0 AT `FILE_LABEL_REVEAL_T` and only rises past it, so landing
   * there wouldn't reveal anything; nudge half the fade span in instead.
   *
   * Only sets the GOAL state (`goalTarget`/`zoomPct`/`goalRes`); the normal per-frame glide in
   * tick() carries the camera there. Never steps OUT: the target percent is clamped so a click
   * always zooms IN (or holds), even in a degenerate ladder with very few stops.
   */
  private clickEntity(evIdx: number) {
    const ev = this.entityFlat[evIdx];
    this.goalTarget = [ev.wx, ev.wy, 0];
    const bounds = levelBoundaries(this.levelCount); // length levelCount+1, coarsest→finest, ends at FILE_LABEL_REVEAL_T
    const childLevel = Math.min(ev.level + 1, this.levelCount);
    const isLeaf = childLevel >= this.levelCount;
    // `bounds[childLevel]` is both the minimum resolution that reveals the child grouping AND the
    // strongest its masses ever get (massAlpha is non-increasing) — see this method's doc for what
    // that means when the child's window starts past the end of the mass band.
    const targetT = isLeaf ? FILE_LABEL_REVEAL_T + FILE_LABEL_FADE_SPAN * 0.5 : bounds[childLevel];
    const targetPct = snapZoomPercent(resolutionPercent(resFromT(targetT, this.maxRes), this.maxRes));
    this.zoomPct = Math.min(this.zoomPct, targetPct);
    this.goalRes = resFromPercent(this.zoomPct, this.maxRes);
    this.userTook = true;
    this.dirty = true;
  }

  /** Back to the whole-graph overview. Nothing here mentions the camera dolly because there is
   *  nothing to reset: `goalRes = 1` is `t = 0`, and `cameraDolly()` is 0 there by construction
   *  (`dollyForT(0, P) === 0`), so the 3D camera returns to the fit distance on the same glide as the
   *  resolution — one state, one command. */
  resetView() {
    this.clearHighlight();
    this.zoomPct = 100;
    this.goalRes = 1;
    this.goalTarget = [0, 0, 0];
    this.panX = 0; this.panY = 0;
    this.userTook = false;
    this.dirty = true;
  }

  // ---- UI data accessors ---------------------------------------------------

  getNodesForUI(): NodeForUI[] {
    return this.nodes.filter((n) => n.node.kind !== "self").map((n) => ({
      id: n.node.id, label: n.node.label, folder: n.node.folder,
      community: n.node.community, communityLabel: n.node.communityLabel,
    }));
  }

  getCommunityCentroids(): Map<number, CommunityCentroid> {
    const groups = new Map<number, NodeView[]>();
    for (const nv of this.nodes) {
      const c = nv.node.community;
      if (c == null) continue;
      let arr = groups.get(c);
      if (!arr) { arr = []; groups.set(c, arr); }
      arr.push(nv);
    }
    const out = new Map<number, CommunityCentroid>();
    for (const [c, members] of groups) {
      if (members.length < 2) continue;
      out.set(c, {
        label: members[0].node.communityLabel ?? `Cluster ${c}`,
        ids: members.map((mm) => mm.node.id),
        color: this.resolveFillColor(members[0].color),
        centroid: centroid3(members.map((mm) => mm.p3)),
        count: members.length,
      });
    }
    return out;
  }

  // ---- QA / debug instrumentation ------------------------------------------

  /**
   * A numeric snapshot of the CURRENT frame, for QA to assert against directly instead of
   * eyeballing a screenshot (see `AsciiGraphStats`). The per-frame counts (`entitiesDrawnFrame` etc.)
   * are already tracked for free inside rasterize()'s existing passes; only `inkCoverage` (a
   * bounding-box sweep over `charBuf`) and `labelOverlaps`/`maxLabelChars` (an O(labels²) pass over
   * the — at most a few dozen — labels drawn this frame) do any extra work, and both are deferred to
   * HERE (called on demand, e.g. from `window.__asciiGraphStats()`) rather than every rasterize().
   */
  computeStats(): AsciiGraphStats {
    const cols = this.m.cols, rows = this.m.rows;
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      for (let c = 0; c < cols; c++) {
        if (this.charBuf[base + c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    const inkCoverage = Number.isFinite(minR)
      ? ((maxR - minR + 1) * (maxC - minC + 1)) / Math.max(1, cols * rows)
      : 0;

    let maxLabelChars = 0;
    const byRow = new Map<number, { col: number; w: number }[]>();
    for (const l of this.labels) {
      if (l.text.length > maxLabelChars) maxLabelChars = l.text.length;
      let arr = byRow.get(l.row);
      if (!arr) { arr = []; byRow.set(l.row, arr); }
      arr.push({ col: l.col, w: l.widthCells });
    }
    let labelOverlaps = 0;
    for (const arr of byRow.values()) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          if (a.col <= b.col + b.w && b.col <= a.col + a.w) labelOverlaps++;
        }
      }
    }

    return {
      zoomPct: this.lastZoomPct,
      entitiesDrawn: this.entitiesDrawnFrame,
      labelsDrawn: this.labels.length,
      labelOverlaps,
      maxLabelChars,
      notesOnScreen: this.notesOnScreenFrame,
      edgesClassified: this.edgesClassifiedFrame,
      edgesIntraVisible: this.edgesIntraVisibleFrame,
      edgesCrossVisible: this.edgesCrossVisibleFrame,
      edgesTransitingDropped: this.edgesTransitingDroppedFrame,
      edgesStroked: this.edgesStrokedFrame,
      backbonePairsDropped: this.levelPairsDropped.reduce((a, b) => a + b, 0),
      inkCoverage,
      bloomPoints: this.bloomPointsFrame,
      bloomWeight: this.bloomWeightFrame,
      bloomSdx: this.bloomSdxFrame,
      bloomSdy: this.bloomSdyFrame,
    };
  }
}

function centroid3(ps: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of ps) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  const n = Math.max(1, ps.length);
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** Char codes for the static noise texture. Deterministic per grid size, so it never shimmers. */
function buildNoise(cols: number, rows: number): Uint16Array {
  const text = noiseField(cols, rows, NOISE_DENSITY, DEFAULT_NOISE_SEED);
  const out = new Uint16Array(cols * rows);
  const lines = text.split("\n");
  for (let r = 0; r < rows; r++) {
    const line = lines[r] ?? "";
    for (let c = 0; c < cols; c++) {
      const ch = line.charCodeAt(c);
      out[r * cols + c] = Number.isNaN(ch) || ch === 32 ? 0 : ch;
    }
  }
  return out;
}
