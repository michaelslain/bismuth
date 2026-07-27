// app/src/graph/rendererKind.ts
//
// TESTING ONLY — pure kind -> renderer-instance mapping for GraphView.tsx's renderer A/B harness
// (an undiscoverable dev-only toggle: no settingsSchema entry, just a throwaway localStorage key —
// see GraphView.tsx for the signal + toolbar wiring). Factored out into its own module, like
// graphFit.ts/labelSelection.ts/lod.ts, so the mapping is unit-testable without pulling
// GraphView.tsx's Solid/JSX component tree into a test. Delete this whole file + GraphView.tsx's
// renderer-toggle block + the R1-R4 toolbar buttons once the ASCII redesign is validated.
//
//   R1 "canvas"        — CanvasGraphRenderer, unmodified. The pre-ASCII renderer.
//   R2 "ascii"         — AsciiGraphRenderer, unmodified. The shipped default: the ORGANIC layout,
//                        every node rendered as a glyph (LOD masses OFF), hierarchy read through
//                        zoom-driven node COLOR (communityPath[activeLevel]) + the cluster-name
//                        labels — see AsciiGraphRenderer.ts's LEVEL-DRIVEN COLOR block.
//   R3 "canvas-ascii"  — CanvasGraphRenderer + labels forced onto the ASCII mono stack
//                        (GraphConfig.labelFontFamily, set by GraphView's buildConfig).
//   R4 "ascii-canvas"  — AsciiGraphRenderer with the level-driven CLUSTER COLOR turned off
//                        (GraphConfig.clusterColorsOff, set by GraphView's buildConfig) — otherwise
//                        identical to R2 (organic layout, masses off), but nodes fall back to a
//                        plain DEGREE ramp instead of their community's colour.
import { AsciiGraphRenderer } from "./AsciiGraphRenderer";
import { CanvasGraphRenderer } from "./CanvasGraphRenderer";
import type { GraphRenderer } from "./graphRenderer";

export type RendererKind = "canvas" | "ascii" | "canvas-ascii" | "ascii-canvas";

const RENDERER_KINDS: readonly RendererKind[] = ["canvas", "ascii", "canvas-ascii", "ascii-canvas"];

export function isRendererKind(v: unknown): v is RendererKind {
  return typeof v === "string" && (RENDERER_KINDS as readonly string[]).includes(v);
}

/** kind -> a fresh renderer instance. Both classes satisfy GraphRenderer (see graphRenderer.ts's
 *  compile-time proof), so this factory is the only kind-aware branch point. Always constructs a
 *  NEW instance (GraphView destroys the previous one and mounts this one fresh on every swap). */
export function makeRenderer(kind: RendererKind): GraphRenderer {
  return kind === "canvas" || kind === "canvas-ascii" ? new CanvasGraphRenderer() : new AsciiGraphRenderer();
}

/** R1/R3 mount the legacy CanvasGraphRenderer, which still takes a DOM labels-overlay element in
 *  its `mount()` signature (see graphRenderer.ts) even though it (like AsciiGraphRenderer) now draws
 *  labels itself, on-canvas — the overlay is vestigial. GraphView re-provides one anyway for
 *  fidelity with that historical contract. */
export function isCanvasKind(kind: RendererKind): boolean {
  return kind === "canvas" || kind === "canvas-ascii";
}

/** Toolbar segment options for the R1-R4 micro-register (GraphView's top toolbar, full pane only).
 *  Text-only labels + a descriptive title tooltip per segment, matching the neighboring 2D/3D
 *  SegmentedToggle. */
export const RENDERER_KIND_OPTIONS: { id: RendererKind; title: string; label: string }[] = [
  { id: "canvas", title: "R1 — CanvasGraphRenderer, unmodified (pre-ASCII)", label: "R1" },
  { id: "ascii", title: "R2 — AsciiGraphRenderer, unmodified (shipped default: organic + zoom-colored regions)", label: "R2" },
  { id: "canvas-ascii", title: "R3 — CanvasGraphRenderer with ASCII mono-stack labels", label: "R3" },
  { id: "ascii-canvas", title: "R4 — AsciiGraphRenderer with cluster colors off (plain degree ramp)", label: "R4" },
];
