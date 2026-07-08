// app/src/nativeDropRouting.ts
// Pure helpers for CONSUMING a forwarded native (Tauri) file drop — the coordinate
// correction and the single-claim guard. Kept separate from nativeDrop.ts (the event
// bridge, owned elsewhere) so consumers can be fixed/tested without touching the bridge.
//
// ── The physical→CSS correction (#30 "wrong cell") ──────────────────────────────────
// nativeDrop.ts converts Tauri's PhysicalPosition to CSS px by dividing by
// `window.devicePixelRatio`. That is correct ONLY when the DPR really is the full
// physical→CSS ratio. Bismuth applies a persisted WHOLE-APP ZOOM via the native
// webview page-zoom (zoom.ts → WKWebView.pageZoom / WebView2 ZoomFactor), and the two
// engines disagree about what that does to devicePixelRatio:
//
//   • Chromium (WebView2 / dev-in-Chrome): page zoom IS folded into devicePixelRatio
//     (dpr = deviceScale × zoom) — dividing by dpr yields true CSS px. Correct.
//   • WebKit (the packaged Tauri WKWebView = Safari): page zoom is NOT folded in —
//     devicePixelRatio stays the backing scale. Dividing by dpr yields WINDOW POINTS,
//     which differ from page CSS px by the zoom factor.
//
// So in the packaged app at (say) 125% zoom, every forwarded coordinate is 25% too
// large. A pane-sized rect hit-test (chat) tolerates that; a ~30px table cell does
// not — the drop resolves to a cell BELOW/RIGHT of the one under the cursor (the
// "puts it in the wrong cell" bounce). Rather than sniff engines, we MEASURE the true
// ratio end-to-end: the window's inner width in physical px (from Tauri) over the CSS
// viewport width gives the real physical→CSS scale; comparing it with dpr yields the
// residual factor the forwarded coordinates must be multiplied by:
//
//     factor = dpr × cssInnerWidth / physicalInnerWidth
//
//   • no zoom, any DPR:            dpr = phys/css            → factor 1 (no-op)
//   • Chromium-style zoom-in-DPR:  dpr = base×z, css = W/z   → factor 1 (no-op)
//   • WebKit zoom-not-in-DPR:      dpr = base,   css = W/z   → factor 1/z (corrects)
//
// The measurement (Tauri innerSize + window.innerWidth) happens in the consumer; this
// function is the pinned, unit-tested transform.

/** Multiplier to apply to a forwarded native-drop coordinate (already divided by DPR by the
 *  bridge) to get true page CSS px. `cssInnerWidth` = window.innerWidth; `physicalInnerWidth`
 *  = the window's inner width in physical pixels (Tauri PhysicalSize). Snaps to exactly 1
 *  within a small epsilon so scrollbar/rounding noise never drifts coordinates; returns 1 on
 *  degenerate inputs (a wrong correction is worse than none). */
export function nativeDropScale(dpr: number, cssInnerWidth: number, physicalInnerWidth: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  if (!Number.isFinite(cssInnerWidth) || cssInnerWidth <= 0) return 1;
  if (!Number.isFinite(physicalInnerWidth) || physicalInnerWidth <= 0) return 1;
  const factor = (dpr * cssInnerWidth) / physicalInnerWidth;
  // Real zooms are ≥10% steps (zoom.ts STEPS); anything within 2% of 1 is measurement noise
  // (overlay scrollbars, fractional device scale), not a zoom mismatch.
  return Math.abs(factor - 1) < 0.02 ? 1 : factor;
}

// ── The single-claim guard (#30 "double insert") ────────────────────────────────────
// A native drop is ONE window event fan-out to every subscribed surface. If two live
// handlers ever process the same drop — a duplicated subscription across an editor
// rebuild, two stacked editors of the same note, an HMR remnant — each inserts once and
// the cell gets the embed twice. The event's `detail` object is SHARED by every listener
// of one dispatch, so it is the natural dedupe key: the first handler that DECIDES to
// process the drop claims it here; any other handler sees the claim and skips. A WeakSet
// holds no references alive and resets per dispatched detail.
const claimedDrops = new WeakSet<object>();

/** Claim a forwarded native-drop event for processing. Returns true exactly once per
 *  detail object — the caller that gets `true` handles the drop; `false` means another
 *  (possibly duplicated) handler already owns it. */
export function claimNativeDrop(detail: object): boolean {
  if (claimedDrops.has(detail)) return false;
  claimedDrops.add(detail);
  return true;
}
