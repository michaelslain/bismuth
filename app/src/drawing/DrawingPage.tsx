// app/src/drawing/DrawingPage.tsx
import { createResource, createSignal, Index, onCleanup, Show } from "solid-js";
import { api } from "../api";
import { debounce } from "../debounce";
import { emptyDoc, parseDoc, type DrawingDoc, type PaperBg } from "../../../core/src/drawing/model";
import { createDrawingStore } from "./store";
import { DrawingCanvas, type ToolState } from "./DrawingCanvas";
import { Toolbar } from "./Toolbar";
import { TextButton } from "../ui/TextButton";
import { Icon } from "../icons/Icon";
import "./Drawing.css";

// size defaults to one of the 5 discrete toolbar levels so a button reads as active;
// smoothMode picks how the finished stroke is relaxed (default "smooth" — relax once on release).
const DEFAULT_TOOLS: ToolState = {
  tool: "pen", color: "fg", size: 5, smoothMode: "smooth", holdToStraighten: true, holdDelayMs: 900,
};

export function DrawingPage(props: { path: string }) {
  const [loaded] = createResource(() => props.path, async (p): Promise<DrawingDoc> => {
    try { return parseDoc(await api.read(p)); } catch { return emptyDoc(); }
  });
  return (
    <Show when={loaded()} keyed fallback={<div class="draw-loading">Loading drawing…</div>}>
      {(initial) => <DrawingEditor path={props.path} initial={initial} />}
    </Show>
  );
}

function DrawingEditor(props: { path: string; initial: DrawingDoc }) {
  const save = debounce((d: DrawingDoc) => { void api.saveDrawing(props.path, d); }, 600);
  const store = createDrawingStore(props.initial, save);
  const [tools, setToolsSig] = createSignal<ToolState>(DEFAULT_TOOLS);
  const setTools = (patch: Partial<ToolState>) => setToolsSig((t) => ({ ...t, ...patch }));

  // Transient zoom (NOT persisted). Applied as a CSS WIDTH multiplier on a wrapper
  // around each page — DrawingCanvas.toLocal divides by getBoundingClientRect().width,
  // so pointer mapping stays correct at any zoom without touching the canvas code.
  const ZOOM_MIN = 0.25, ZOOM_MAX = 4;
  const [zoom, setZoom] = createSignal(1);
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const zoomBy = (factor: number) => setZoom((z) => clampZoom(z * factor));
  // Button presses step by a fixed 5% (wheel/pinch stays smooth/multiplicative).
  const zoomStep = (delta: number) => setZoom((z) => clampZoom(Math.round((z + delta) * 100) / 100));
  // The app is dark-only (appearance.theme selects a Bismuth color palette, not a
  // light/dark mode), so the drawing canvas always renders dark.
  const theme = (): "dark" | "light" => "dark";

  // Cmd/Ctrl + wheel (and trackpad pinch, which the browser reports as a ctrlKey
  // wheel) zooms. Registered non-passive so we can preventDefault the browser's own
  // page zoom; plain scroll falls through untouched.
  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * 0.01));
  };
  const attachStage = (el: HTMLDivElement) => {
    el.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => el.removeEventListener("wheel", onWheel));
  };

  return (
    <div class="draw-app">
      <Toolbar
        tools={tools}
        setTools={setTools}
        bg={() => store.doc().paper.bg}
        setBackground={(bg: PaperBg) => store.setBackground(bg)}
        onUndo={() => store.undo()}
        onRedo={() => store.redo()}
        zoom={zoom}
        onZoomIn={() => zoomStep(0.05)}
        onZoomOut={() => zoomStep(-0.05)}
        onResetZoom={() => setZoom(1)}
      />
      <div class="draw-stage" ref={attachStage}>
        <Index each={store.doc().pages}>
          {(_page, i) => (
            <div class="draw-page-zoom" style={{ width: `${zoom() * 100}%`, "max-width": `${zoom() * 1400}px` }}>
              <DrawingCanvas
                doc={store.doc}
                pageIndex={i}
                tools={tools}
                theme={theme}
                onCommit={(s) => store.commitStroke(i, s)}
                onEraseStroke={(idx) => store.eraseStroke(i, idx)}
              />
            </div>
          )}
        </Index>
        <TextButton onClick={() => store.addPage()}><Icon value="Plus" size={14} />ADD PAGE</TextButton>
      </div>
    </div>
  );
}
