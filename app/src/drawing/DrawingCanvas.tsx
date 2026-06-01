// app/src/drawing/DrawingCanvas.tsx
import { onMount, onCleanup, createEffect } from "solid-js";
import { PAGE_W, PAGE_H, type DrawingDoc, type Stroke, type Tool } from "../../../core/src/drawing/model";
import { renderPage, drawStroke, type Ctx2D } from "../../../core/src/drawing/render2d";
import { themeColors } from "../../../core/src/drawing/theme";
import { streamlinePoint, widthFor, isRealPressure } from "./input";

export interface ToolState { tool: Tool | "eraser"; color: string; size: number; smoothing: number;
  holdToStraighten: boolean; holdDelayMs: number; }

export function DrawingCanvas(props: {
  doc: () => DrawingDoc; pageIndex: number; tools: () => ToolState; theme: () => "dark" | "light";
  onCommit: (s: Stroke) => void; onEraseStroke: (strokeIndex: number) => void;
}) {
  let base!: HTMLCanvasElement; let live!: HTMLCanvasElement;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const theme = () => themeColors(props.theme());
  function ctxOf(c: HTMLCanvasElement): Ctx2D & CanvasRenderingContext2D {
    const x = c.getContext("2d")!; x.setTransform(DPR, 0, 0, DPR, 0, 0); return x as any;
  }
  function repaintBase() {
    const x = ctxOf(base);
    renderPage(x, props.doc().pages[props.pageIndex], props.doc().paper, theme(), PAGE_W, PAGE_H);
  }
  function clearLive() { live.getContext("2d")!.clearRect(0, 0, live.width, live.height); }

  let drawing = false, hasReal = false, holdTimer: ReturnType<typeof setTimeout> | undefined;
  let filt = { x: 0, y: 0 }, lastRaw = { x: 0, y: 0, t: 0 }, current: Stroke | null = null;

  const toLocal = (e: PointerEvent) => {
    const r = live.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (PAGE_W / r.width), y: (e.clientY - r.top) * (PAGE_H / r.height) };
  };
  function paintLive() {
    clearLive();
    if (current) drawStroke(ctxOf(live), current, theme());
  }
  function armHold() {
    clearTimeout(holdTimer);
    const ts = props.tools();
    if (!ts.holdToStraighten || ts.tool !== "pen") return;
    holdTimer = setTimeout(() => {
      if (current && current.pts.length > 9) {
        current.straight = true;
        const x0 = current.pts[0], y0 = current.pts[1];
        current.pts = [x0, y0, 255, lastRaw.x, lastRaw.y, 255];
        paintLive();
      }
    }, ts.holdDelayMs);
  }

  function onDown(e: PointerEvent) {
    const ts = props.tools(); drawing = true; live.setPointerCapture(e.pointerId);
    if (isRealPressure(e.pressure)) hasReal = true;
    const p = toLocal(e); filt = { ...p }; lastRaw = { x: p.x, y: p.y, t: e.timeStamp };
    if (ts.tool === "eraser") { eraseAt(p); current = null; return; }
    current = { t: ts.tool, c: ts.color, w: ts.size, pts: [p.x, p.y, Math.round((e.pressure || 1) * 255)] };
    armHold();
  }
  function onMove(e: PointerEvent) {
    if (!drawing) return;
    const ts = props.tools();
    if (ts.tool === "eraser") { eraseAt(toLocal(e)); return; }
    for (const ev of (e.getCoalescedEvents?.() ?? [e])) {
      const raw = toLocal(ev);
      const dt = Math.max(ev.timeStamp - lastRaw.t, 1);
      const dist = Math.hypot(raw.x - lastRaw.x, raw.y - lastRaw.y);
      const speed = (dist / dt) * 16;
      filt = streamlinePoint(filt, raw, ts.smoothing);
      if (isRealPressure(ev.pressure)) hasReal = true;
      if (current && !current.straight) {
        const w = widthFor({ base: ts.size, pressure: ev.pressure, speed, hasRealPressure: hasReal });
        void w;
        current.pts.push(filt.x, filt.y, Math.round((ev.pressure || 1) * 255));
        if (dist > 3) armHold();
      }
      lastRaw = { x: raw.x, y: raw.y, t: ev.timeStamp };
    }
    if (current?.straight) { const raw = toLocal(e); current.pts[3] = raw.x; current.pts[4] = raw.y; }
    paintLive();
  }
  function onUp() {
    if (!drawing) return; drawing = false; clearTimeout(holdTimer);
    if (current && current.pts.length >= 3) props.onCommit(current);
    current = null; clearLive();
  }
  function eraseAt(p: { x: number; y: number }) {
    const strokes = props.doc().pages[props.pageIndex].strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const pts = strokes[i].pts;
      for (let j = 0; j + 1 < pts.length; j += 3) {
        if (Math.hypot(pts[j] - p.x, pts[j + 1] - p.y) < props.tools().size + 8) { props.onEraseStroke(i); return; }
      }
    }
  }

  onMount(() => {
    for (const c of [base, live]) { c.width = PAGE_W * DPR; c.height = PAGE_H * DPR; c.style.width = PAGE_W + "px"; c.style.height = PAGE_H + "px"; }
    repaintBase();
    live.addEventListener("pointerdown", onDown);
    live.addEventListener("pointermove", onMove);
    live.addEventListener("pointerup", onUp);
    live.addEventListener("pointercancel", onUp);
  });
  onCleanup(() => clearTimeout(holdTimer));

  // Repaint the committed layer whenever the document or theme changes.
  createEffect(() => { props.doc(); props.theme(); if (base) repaintBase(); });

  return (
    <div class="draw-page-shadow">
      <div style={{ position: "relative", width: PAGE_W + "px", height: PAGE_H + "px" }}>
        <canvas ref={base} class="draw-canvas" style={{ position: "absolute", inset: "0" }} />
        <canvas ref={live} class="draw-canvas draw-live" style={{ position: "absolute", inset: "0" }} />
      </div>
    </div>
  );
}
