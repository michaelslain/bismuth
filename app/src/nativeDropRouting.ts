// app/src/nativeDropRouting.ts
// Pure helpers for a forwarded native (Tauri) file drop — the raw→CSS coordinate scale the
// bridge (nativeDrop.ts) applies, and the single-claim guard every consumer uses.
//
// ── The raw→CSS scale ─────────────────────────────────────────────────────────────────
// Tauri types every drag position as a PhysicalPosition, but the UNITS depend on the engine
// (read from wry 0.55's source, `src/*/drag_drop.rs`):
//
//   • WKWebView (macOS/iOS): NSDraggingInfo.draggingLocation — window POINTS (logical px).
//   • WebKitGTK (Linux): the GTK widget's coordinates — logical px.
//   • WebView2 (Windows): ScreenToClient — PHYSICAL px.
//
// The bridge used to divide every position by devicePixelRatio. On a Retina Mac that HALVED
// already-logical coordinates, so a drop resolved to the point at half the cursor's x and y:
// a drop on the left half of a chat landed in the sidebar file tree (which uploaded the file
// into the vault), and only the far bottom-right of a pane accepted a drop at all.
//
// So the scale is MEASURED end to end instead of assumed: the window's content width in the
// position's own units, against the CSS viewport width:
//
//     scale = cssInnerWidth / rawInnerWidth
//     rawInnerWidth = physicalInnerWidth                  (physical units)
//                   = physicalInnerWidth / scaleFactor    (logical units)
//
// Page zoom (zoom.ts → WKWebView.pageZoom / WebView2 ZoomFactor) shows up in cssInnerWidth on
// every engine, so the same formula covers it with no engine sniffing about zoom:
//
//   • macOS, no zoom:        css = points            → scale 1
//   • macOS, zoom z:         css = points / z        → scale 1/z
//   • Windows, DPR d:        css = physical / d      → scale 1/d (zoom folded in likewise)

/** The units a native drag position arrives in. Windows (WebView2) is the only physical one. */
export type NativeDragUnits = 'logical' | 'physical'

export function nativeDragUnits(isWindows: boolean): NativeDragUnits {
    return isWindows ? 'physical' : 'logical'
}

/** Multiplier from a raw Tauri drag coordinate to page CSS px. `cssInnerWidth` =
 *  window.innerWidth; `physicalInnerWidth` / `scaleFactor` = the window's Tauri innerSize()
 *  width and scaleFactor(). Snaps to the no-zoom value within 2% so rounding noise never drifts
 *  coordinates; on degenerate inputs falls back to that no-zoom value (logical → 1, physical →
 *  1/dpr) — a wrong correction is worse than none. */
export function nativeDragScale(m: {
    units: NativeDragUnits
    cssInnerWidth: number
    physicalInnerWidth: number
    scaleFactor: number
    dpr: number
}): number {
    const ok = (n: number) => Number.isFinite(n) && n > 0
    const dpr = ok(m.dpr) ? m.dpr : 1
    if (!ok(m.cssInnerWidth) || !ok(m.physicalInnerWidth) || !ok(m.scaleFactor))
        return m.units === 'logical' ? 1 : 1 / dpr
    const nominal = m.units === 'logical' ? 1 : 1 / m.scaleFactor
    const rawInnerWidth =
        m.units === 'logical'
            ? m.physicalInnerWidth / m.scaleFactor
            : m.physicalInnerWidth
    const scale = m.cssInnerWidth / rawInnerWidth
    // Real zooms are ≥10% steps (zoom.ts STEPS); within 2% of nominal is measurement noise.
    return Math.abs(scale / nominal - 1) < 0.02 ? nominal : scale
}

// ── The single-claim guard (#30 "double insert") ────────────────────────────────────
// A native drop is ONE window event fan-out to every subscribed surface. If two live
// handlers ever process the same drop — a duplicated subscription across an editor
// rebuild, two stacked editors of the same note, an HMR remnant — each inserts once and
// the cell gets the embed twice. The event's `detail` object is SHARED by every listener
// of one dispatch, so it is the natural dedupe key: the first handler that DECIDES to
// process the drop claims it here; any other handler sees the claim and skips. A WeakSet
// holds no references alive and resets per dispatched detail.
const claimedDrops = new WeakSet<object>()

/** Claim a forwarded native-drop event for processing. Returns true exactly once per
 *  detail object — the caller that gets `true` handles the drop; `false` means another
 *  (possibly duplicated) handler already owns it. */
export function claimNativeDrop(detail: object): boolean {
    if (claimedDrops.has(detail)) return false
    claimedDrops.add(detail)
    return true
}
