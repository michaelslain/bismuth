// app/src/zoom.ts
// Whole-app UI zoom (Cmd+=/Cmd+-/Cmd+0 + the command palette). Mirrors the
// GraphView.tsx viewMode pattern: a module-level value shared by every consumer,
// seeded from localStorage, applied via a native mechanism rather than a CSS var —
// see the design note below and the plan this implements.
//
// Mechanism: native webview page-zoom (tauri::WebviewWindow::set_zoom, a thin
// wrapper over WKWebView.pageZoom / WebView2 ZoomFactor / WebKitGTK zoom_level —
// the SAME mechanism real browsers use for Cmd+=/Cmd+-). This is a genuine
// engine-level reflow/rescale: text stays crisp (no manual font-size math), the
// graph canvas (CanvasGraphRenderer) already re-provisions its backing store from
// getBoundingClientRect() x devicePixelRatio via a ResizeObserver, and every
// existing measurement pattern in the app (getBoundingClientRect, window.innerWidth,
// position: fixed) keeps meaning exactly what it already means — nothing to
// special-case. A CSS transform/zoom-property scheme would NOT reflow (or would
// only affect its own subtree), breaking fixed-position overlays and viewport math.
//
// Known caveat (not introduced by this feature, not fixed here): app/src/drawing/
// DrawingCanvas.tsx captures `devicePixelRatio` once at mount and sizes its backing
// buffer to a fixed logical page size, not reactively to container resize — an
// already-open drawing pane won't re-sharpen until it remounts (same as real Safari
// zoom would do to it today).
//
// Why localStorage, not `.settings`: zoom is a machine/display preference (a 13"
// laptop and a 32" monitor shouldn't share one zoom level via a synced vault), and
// it changes far more often than a typical setting (repeated Cmd+= presses) — the
// same class of transient per-window UI choice as the graph's 2D/3D toggle.
import { readCache, writeCache } from "./viewCache";
import { isTauri } from "./nativeMenu";

const ZOOM_KEY = "bismuth:ui:zoom"; // percent, e.g. 100
const STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
const DEFAULT_PCT = 100;

function readStoredPct(): number {
  const v = readCache<number>(ZOOM_KEY);
  return typeof v === "number" && STEPS.includes(v) ? v : DEFAULT_PCT;
}

let currentPct = readStoredPct();

function applyNative(pct: number): void {
  if (isTauri()) {
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("set_ui_zoom", { factor: pct / 100 }).catch(() => {}),
    );
  } else if (typeof document !== "undefined" && "zoom" in document.documentElement.style) {
    // Dev/browser-tab fallback only (no Tauri IPC bridge) — best-effort, not the
    // shipped mechanism. Chrome/Safari support the non-standard `zoom` CSS
    // property always; Firefox 126+.
    (document.documentElement.style as unknown as Record<string, string>).zoom = String(pct / 100);
  }
}

function setPct(pct: number): void {
  currentPct = pct;
  writeCache(ZOOM_KEY, pct);
  applyNative(pct);
}

/** Call once per window on mount to restore the last zoom level. */
export function initZoom(): void {
  applyNative(currentPct);
}

export function zoomIn(): void {
  const next = STEPS.find((s) => s > currentPct);
  if (next) setPct(next);
}

export function zoomOut(): void {
  const prev = [...STEPS].reverse().find((s) => s < currentPct);
  if (prev) setPct(prev);
}

export function zoomReset(): void {
  setPct(DEFAULT_PCT);
}

export function currentZoomPercent(): number {
  return currentPct;
}
