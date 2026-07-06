// app/src/editor/ink/InkOverlay.tsx
// Draw-anywhere note ink: a transparent stroke layer over the CodeMirror editor. Rendered by
// Editor.tsx inside its `wrapper` (position:relative), covering the editor viewport with two
// canvases (committed base + live draft — the DrawingCanvas dual-canvas model). Strokes live in
// a LOGICAL content space: the editor's 680px reading column (INK_LOGICAL_W) with a uniform
// display scale s = contentDOM.width / 680, so pane-width changes rescale ink + stroke width
// proportionally (the same fixed-logical-space trick the page drawing uses). Scrolling never
// moves the canvases — each repaint reads contentDOM's live rect, so the paint offset tracks
// the scroll for free (rAF-coalesced).
//
// v1 anchoring is deliberately boring: y is logical content space, unanchored to any CM line —
// editing text ABOVE existing ink shifts the text but not the ink (paper-like annotation).
// Mid-draw reflow can't happen (the doc is non-editable in draw mode).
//
// Persistence: a hidden `.ink/<note>.ink` sidecar (core/src/drawing/ink.ts), lazily created on
// the first stroke, debounce-saved, carried on rename/delete by files.ts, and classified by the
// server as dirty-to-nothing so an autosave costs no rebuilds anywhere.
import { createSignal, createEffect, onCleanup, Show, untrack } from "solid-js";
import type { EditorView } from "@codemirror/view";
import { api } from "../../api";
import { lastChange } from "../../serverVersion";
import { emptyInkDoc, parseInkDoc, serializeInkDoc, inkPathFor, INK_LOGICAL_W, type InkDoc } from "../../../../core/src/drawing/ink";
import type { DrawingDoc, Stroke } from "../../../../core/src/drawing/model";
import { drawStroke, type Ctx2D } from "../../../../core/src/drawing/render2d";
import { themeColors } from "../../../../core/src/drawing/theme";
import { smoothStrokePoints } from "../../../../core/src/drawing/smooth";
import { widthFor, isRealPressure } from "../../drawing/input";
import { createDrawingStore } from "../../drawing/store";
import { Toolbar } from "../../drawing/Toolbar";
import type { ToolState } from "../../drawing/DrawingCanvas";
import "../../drawing/Drawing.css";
import "./InkOverlay.css";

// Tool state is module-level so the pen/color/size choice follows the user across notes for
// the session (same defaults as DrawingPage's DEFAULT_TOOLS).
const [tools, setToolsSig] = createSignal<ToolState>({
  tool: "pen", color: "fg", size: 5, smoothMode: "smooth", holdToStraighten: true, holdDelayMs: 900,
});
const setTools = (patch: Partial<ToolState>) => setToolsSig((t) => ({ ...t, ...patch }));

/** Wrap an InkDoc's strokes as a single-page DrawingDoc so createDrawingStore (undo/redo/
 *  commit/erase) is reused verbatim; convert back only at the save boundary. */
const wrapInk = (strokes: Stroke[]): DrawingDoc => ({ v: 1, kind: "drawing", paper: { bg: "blank" }, pages: [{ strokes }] });

export function InkOverlay(props: {
  view: () => EditorView | undefined;
  path: () => string | null;
  active: () => boolean;
  onExit: () => void;
}) {
  let base!: HTMLCanvasElement;
  let live!: HTMLCanvasElement;
  let host!: HTMLDivElement;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const theme = () => themeColors("dark"); // the app is dark-only (mirrors DrawingPage)

  // The per-note store. Recreated on every path switch (ink loads async; empty until then).
  const [store, setStore] = createSignal<ReturnType<typeof createDrawingStore> | null>(null);
  const strokes = (): Stroke[] => store()?.doc().pages[0].strokes ?? [];
  const hasInk = () => strokes().length > 0;
  // The overlay renders its canvases only when there's something to show or the user is
  // drawing — an ink-free note in normal mode pays nothing beyond the one async load probe.
  const mounted = () => props.active() || hasInk();

  // ── Persistence ─────────────────────────────────────────────────────────────────────────
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSavedInk: string | undefined; // recognize our own SSE echo
  let savePath: string | null = null; // the path saves are bound to (frozen per buffer)
  const flushSave = (doc?: DrawingDoc) => {
    clearTimeout(saveTimer);
    const p = savePath;
    const d = doc ?? untrack(() => store()?.doc());
    if (!p || !d) return;
    const ink: InkDoc = { v: 1, kind: "ink", strokes: d.pages[0].strokes };
    const text = serializeInkDoc(ink);
    if (text === lastSavedInk) return; // nothing new (also skips the initial load state)
    lastSavedInk = text;
    void api.saveNoteInk(p, ink);
  };
  const requestSave = (doc: DrawingDoc) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flushSave(doc), 600);
  };

  // Load (or reset) the ink whenever the buffer switches. The GET is async and off the open
  // path — the note renders immediately; ink pops in when the read lands (usually instantly).
  createEffect(() => {
    const p = props.path();
    // Flush the PREVIOUS buffer's pending save before rebinding (mirrors Editor's flushSave).
    onCleanup(() => flushSave());
    savePath = p;
    lastSavedInk = undefined;
    setStore(null);
    if (!p) return;
    void (async () => {
      let doc = emptyInkDoc();
      try {
        const text = await api.read(inkPathFor(p));
        if (text.trim()) {
          doc = parseInkDoc(text);
          lastSavedInk = serializeInkDoc(doc);
        }
      } catch {
        /* unreadable/corrupt sidecar — start empty; the first stroke rewrites it */
      }
      if (props.path() !== p) return; // buffer switched while loading
      setStore(createDrawingStore(wrapInk(doc.strokes), requestSave));
    })();
  });

  // Cross-pane sync: a split sibling saved this note's ink → refetch unless it's our own echo.
  createEffect(() => {
    const change = lastChange();
    const p = props.path();
    if (!p || !change.paths.includes(inkPathFor(p))) return;
    void (async () => {
      try {
        const text = await api.read(inkPathFor(p));
        if (props.path() !== p || text === lastSavedInk || !text.trim()) return;
        const doc = parseInkDoc(text);
        lastSavedInk = text;
        setStore(createDrawingStore(wrapInk(doc.strokes), requestSave));
      } catch {
        /* ignore — next change retries */
      }
    })();
  });

  // ── Geometry + painting ─────────────────────────────────────────────────────────────────
  // Logical→viewport mapping, read fresh per paint: scale s = content width / 680, offsets =
  // contentDOM's rect relative to the overlay host (which fills the wrapper). Reading the live
  // rect per repaint makes scrolling correct with zero bookkeeping.
  const geom = () => {
    const v = props.view();
    if (!v) return null;
    const cr = v.contentDOM.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    if (cr.width <= 0) return null;
    return { s: cr.width / INK_LOGICAL_W, offX: cr.left - hr.left, offY: cr.top - hr.top };
  };
  const ctxOf = (c: HTMLCanvasElement): Ctx2D & CanvasRenderingContext2D =>
    c.getContext("2d")! as Ctx2D & CanvasRenderingContext2D;

  let rafPending = false;
  const repaint = () => {
    if (rafPending || !base) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!base) return;
      const g = geom();
      const bx = ctxOf(base);
      bx.setTransform(1, 0, 0, 1, 0, 0);
      bx.clearRect(0, 0, base.width, base.height);
      if (!g) return;
      bx.setTransform(DPR * g.s, 0, 0, DPR * g.s, DPR * g.offX, DPR * g.offY);
      const t = theme();
      for (const s of strokes()) drawStroke(bx, s, t);
      paintLive();
    });
  };
  const paintLive = () => {
    if (!live) return;
    const lx = ctxOf(live);
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.clearRect(0, 0, live.width, live.height);
    const g = geom();
    if (!g || !current) return;
    lx.setTransform(DPR * g.s, 0, 0, DPR * g.s, DPR * g.offX, DPR * g.offY);
    drawStroke(lx, current, theme());
  };

  const resize = () => {
    if (!base || !host) return;
    const w = host.clientWidth, h = host.clientHeight;
    for (const c of [base, live]) {
      if (c.width !== w * DPR || c.height !== h * DPR) { c.width = w * DPR; c.height = h * DPR; }
    }
    repaint();
  };

  // While mounted: observe the host + the editor scroller so scroll/resize/reflow repaint.
  createEffect(() => {
    if (!mounted()) return;
    const v = props.view();
    queueMicrotask(resize);
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const scroller = v?.scrollDOM;
    const onScroll = () => repaint();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => {
      ro.disconnect();
      scroller?.removeEventListener("scroll", onScroll);
    });
  });
  // Repaint when the committed strokes change (store mutation / undo / reload).
  createEffect(() => {
    strokes();
    repaint();
  });

  // ── Stroke capture (mirrors DrawingCanvas's proven state machine, in logical coords) ────
  let drawing = false, hasReal = false, holdTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRaw = { x: 0, y: 0, t: 0 };
  let current: Stroke | null = null;

  const toLogical = (e: PointerEvent) => {
    const v = props.view()!;
    const cr = v.contentDOM.getBoundingClientRect();
    const s = cr.width > 0 ? cr.width / INK_LOGICAL_W : 1;
    return { x: (e.clientX - cr.left) / s, y: (e.clientY - cr.top) / s };
  };
  const pressureByte = (pressure: number, speed: number): number => {
    const b = tools().size;
    const w = widthFor({ base: b, pressure, speed, hasRealPressure: hasReal });
    return Math.round(Math.max(0, Math.min(1, w / (b * 1.75))) * 255);
  };
  const armHold = () => {
    clearTimeout(holdTimer);
    const ts = tools();
    if (!ts.holdToStraighten || ts.tool !== "pen") return;
    holdTimer = setTimeout(() => {
      if (current && current.pts.length > 9) {
        current.straight = true;
        const x0 = current.pts[0], y0 = current.pts[1];
        current.pts = [x0, y0, 255, lastRaw.x, lastRaw.y, 255];
        paintLive();
      }
    }, ts.holdDelayMs);
  };
  const eraseAt = (p: { x: number; y: number }) => {
    const st = store();
    if (!st) return;
    const list = strokes();
    const tol = tools().size + 8;
    for (let i = list.length - 1; i >= 0; i--) {
      const pts = list[i].pts;
      for (let j = 0; j + 1 < pts.length; j += 3) {
        if (Math.hypot(pts[j] - p.x, pts[j + 1] - p.y) < tol) { st.eraseStroke(0, i); return; }
      }
    }
  };
  const onDown = (e: PointerEvent) => {
    if (!props.view() || !store()) return;
    const ts = tools();
    drawing = true;
    live.setPointerCapture(e.pointerId);
    hasReal = isRealPressure(e.pressure);
    const p = toLogical(e);
    lastRaw = { x: p.x, y: p.y, t: e.timeStamp };
    if (ts.tool === "eraser") { eraseAt(p); current = null; return; }
    current = { t: ts.tool, c: ts.color, w: ts.size, pts: [p.x, p.y, pressureByte(e.pressure, 0)] };
    armHold();
  };
  const onMove = (e: PointerEvent) => {
    if (!drawing) return;
    const ts = tools();
    if (ts.tool === "eraser") { eraseAt(toLogical(e)); return; }
    for (const ev of (e.getCoalescedEvents?.() ?? [e])) {
      const raw = toLogical(ev);
      const dt = Math.max(ev.timeStamp - lastRaw.t, 1);
      const dist = Math.hypot(raw.x - lastRaw.x, raw.y - lastRaw.y);
      const speed = (dist / dt) * 16;
      if (isRealPressure(ev.pressure)) hasReal = true;
      if (current && !current.straight) {
        current.pts.push(raw.x, raw.y, pressureByte(ev.pressure, speed));
        if (dist > 3) armHold();
      }
      lastRaw = { x: raw.x, y: raw.y, t: ev.timeStamp };
    }
    if (current?.straight) { const raw = toLogical(e); current.pts[3] = raw.x; current.pts[4] = raw.y; }
    paintLive();
  };
  const onUp = () => {
    if (!drawing) return;
    drawing = false;
    clearTimeout(holdTimer);
    if (current && current.pts.length >= 3) {
      if (!current.straight && tools().smoothMode === "smooth") {
        current.pts = smoothStrokePoints(current.pts);
      }
      store()?.commitStroke(0, current);
    }
    current = null;
    paintLive();
  };
  // The canvas sits over the scroller, so wheel events would otherwise dead-end in draw mode —
  // forward them so the note still scrolls under the pen.
  const onWheel = (e: WheelEvent) => {
    const scroller = props.view()?.scrollDOM;
    if (!scroller) return;
    scroller.scrollTop += e.deltaY;
    scroller.scrollLeft += e.deltaX;
    e.preventDefault();
  };

  // Draw-mode key handling (capture, registered on window while active so it wins regardless
  // of focus): Escape exits; Mod+Z / Mod+Shift+Z drive the INK undo stack, never CM's.
  createEffect(() => {
    if (!props.active()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onExit();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) store()?.redo();
        else store()?.undo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });

  onCleanup(() => {
    clearTimeout(holdTimer);
    clearTimeout(saveTimer);
  });

  // On unload-ish flushes we rely on the 600ms debounce being short; a keepalive variant like
  // the note autosave's is unnecessary for ink (losing <600ms of strokes on force-quit is fine).

  return (
    <Show when={mounted()}>
      <div ref={host} class="ink-host" classList={{ active: props.active() }}>
        <canvas ref={base} class="ink-canvas" />
        <canvas
          ref={live}
          class="ink-canvas ink-live"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onWheel={onWheel}
        />
        <Show when={props.active()}>
          <Toolbar
            tools={tools}
            setTools={setTools}
            onUndo={() => store()?.undo()}
            onRedo={() => store()?.redo()}
          />
        </Show>
      </div>
    </Show>
  );
}
