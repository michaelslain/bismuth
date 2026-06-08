// core/src/daemonViz.ts
// The pure visual-state knob for DAEMON-mode nodes (crons/processes). Maps a node's daemon
// state (ONLY `enabled` + `running` — recency/lastResult are intentionally NOT used) to a clean
// "border ring" model (NO glow):
//   - a node FILL token,
//   - a BORDER token (a crisp palette-colored ring, or none), and
//   - the node's render opacity.
// Isolated and pure so it's fully unit-testable AND so the value-curve here is the one dial we
// tune later without touching the renderer.
//
// Tokens are abstract, NOT hex — the renderer resolves them against the live theme / node id:
//   fill "base"    — the node's muted default daemon fill (resolved from daemonNeutral)
//   fill "bg"      — the canvas background (--bg); the node reads as a hollow, palette-outlined dot
//   fill "palette" — a stable per-node palette color (running node, solid)
//   border "palette" — a crisp ring in that same stable per-node palette color
//   border "none"    — no border ring
//
// Three states, by (enabled, running):
//   disabled (enabled=false)        → dim base node, NO border
//   enabled, not running            → bg-filled node + a crisp palette border ring (hollow dot)
//   running  (running=true)         → the whole node is its palette color (solid), no border
import type { DaemonVizState } from "./graph";

// "base" = muted disabled fill · "bg" = enabled-idle hollow fill (the canvas background, so only the
// palette border ring reads) · "palette" = running solid fill (a stable per-node color, by id hash).
export type DaemonFill = "base" | "bg" | "palette";
// "palette" = a crisp ring in the node's stable per-node palette color · "none" = no border ring.
export type DaemonBorder = "palette" | "none";

export interface DaemonVisual {
  /** The node's own point fill token. */
  fill: DaemonFill;
  /** The border-ring token: "palette" draws a crisp per-node-colored ring, "none" draws nothing. */
  border: DaemonBorder;
  /** Render opacity 0..1 for the node's own point (baked toward the background by the renderer). */
  opacity: number;
}

/**
 * Visual state for one daemon/cron/process node, from ONLY `enabled` + `running`
 * (`now` is unused now — kept in the signature for call-site stability / future use).
 * Precedence (first match wins):
 *   disabled → dim base node, no border ring
 *   running  → solid palette fill, no border (overrides plain-enabled)
 *   enabled  → bg fill + a crisp palette border ring (a hollow, palette-outlined dot)
 */
export function nodeVisualState(state: DaemonVizState, _now?: number): DaemonVisual {
  // Disabled wins over everything — a disabled cron can't be meaningfully "running".
  if (!state.enabled) {
    return { fill: "base", border: "none", opacity: 0.15 };
  }
  if (state.running) {
    // Running: the entire node is its stable per-node palette color (solid). No separate border.
    return { fill: "palette", border: "none", opacity: 1 };
  }
  // Enabled, not running: a hollow dot filled with the canvas background (--bg) so only the
  // crisp palette border ring reads — the circle itself takes on the background.
  return { fill: "bg", border: "palette", opacity: 1 };
}
