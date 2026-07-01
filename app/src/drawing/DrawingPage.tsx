// app/src/drawing/DrawingPage.tsx
import { createResource, createSignal, Index, onCleanup, Show } from "solid-js";
import { api, apiBase } from "../api";
import { debounce } from "../debounce";
import { emptyDoc, parseDoc, PAGE_W, PAGE_H, type DrawingDoc, type ImageEl, type Page, type PaperBg } from "../../../core/src/drawing/model";
import { createDrawingStore } from "./store";
import { DrawingCanvas, type ToolState } from "./DrawingCanvas";
import { Toolbar } from "./Toolbar";
import { IconTextButton } from "../ui/IconTextButton";
import { Loading } from "../ui/EmptyState";
import { pushToast } from "../Toast";
import "./Drawing.css";

// --- Image intake (import button / paste / drag-drop / markup background) ------------
// A placed image is stored as a self-contained `data:` URL inside the `.draw` so the file
// stays portable + headless-exportable. These helpers turn a File/blob/asset into a centered,
// page-fit ImageEl in 816×1056 logical space.
const IMAGE_NAME_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const isImageFile = (f: File): boolean => f.type.startsWith("image/") || IMAGE_NAME_RE.test(f.name);

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error("read failed"));
    fr.readAsDataURL(blob);
  });
}
function decodeSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || PAGE_W, h: img.naturalHeight || PAGE_H });
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}
/** Center a natural-size image on the page, preserving aspect ratio. `maxScale` caps upscale:
 *  an IMPORT never blows a small image up past 1×; a markup BACKGROUND (maxScale=∞) fills the page. */
function fitImage(natW: number, natH: number, maxScale = Infinity): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(PAGE_W / natW, PAGE_H / natH, maxScale);
  const w = natW * scale, h = natH * scale;
  return { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, w, h };
}
async function imageElFromSrc(src: string, maxScale = Infinity): Promise<ImageEl> {
  const { w, h } = await decodeSize(src);
  return { src, ...fitImage(w, h, maxScale) };
}

// size defaults to one of the 5 discrete toolbar levels so a button reads as active;
// smoothMode picks how the finished stroke is relaxed (default "smooth" — relax once on release).
const DEFAULT_TOOLS: ToolState = {
  tool: "pen", color: "fg", size: 5, smoothMode: "smooth", holdToStraighten: true, holdDelayMs: 900,
};

// Transient zoom bounds (NOT persisted). Shared with the Toolbar so its disabled
// guards can't drift from the clamp here.
export const ZOOM_MIN = 0.25, ZOOM_MAX = 4;

export function DrawingPage(props: { path: string }) {
  const [loaded] = createResource(() => props.path, async (p): Promise<DrawingDoc> => {
    try { return parseDoc(await api.read(p)); } catch { return emptyDoc(); }
  });
  return (
    <Show when={loaded()} keyed fallback={<Loading>Loading drawing…</Loading>}>
      {(initial) => <DrawingEditor path={props.path} initial={initial} />}
    </Show>
  );
}

function DrawingEditor(props: { path: string; initial: DrawingDoc }) {
  const save = debounce((d: DrawingDoc) => { void api.saveDrawing(props.path, d); }, 600);
  const store = createDrawingStore(props.initial, save);
  const [tools, setToolsSig] = createSignal<ToolState>(DEFAULT_TOOLS);
  const setTools = (patch: Partial<ToolState>) => setToolsSig((t) => ({ ...t, ...patch }));

  // --- Image import: toolbar button (hidden file input), plus paste + drag-drop onto the
  // stage (mirrors Editor.tsx's attachment intake, filtered to images). Each image is placed
  // page-fit + centered, capped at natural size (no upscaling an import). Whole-doc undo covers
  // an insert (selection/move/delete of a placed image is a tracked followup — see store.removeImage).
  let fileInput!: HTMLInputElement;
  async function importOne(file: File, pageIndex: number) {
    try {
      store.addImage(pageIndex, await imageElFromSrc(await blobToDataUrl(file), 1));
    } catch (e) {
      pushToast(`Couldn't import image: ${(e as Error).message}`);
    }
  }
  const importFiles = (files: File[], pageIndex: number) => {
    for (const f of files) if (isImageFile(f)) void importOne(f, pageIndex);
  };
  const onPickFile = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    importFiles(input.files ? [...input.files] : [], 0);
    input.value = ""; // let the same file be re-imported later
  };
  // Which page an event landed on (drop), else page 0 (paste / toolbar button).
  const pageIndexFromTarget = (target: EventTarget | null): number => {
    const host = (target as HTMLElement | null)?.closest?.("[data-page-index]") as HTMLElement | null;
    const n = host ? Number(host.dataset.pageIndex) : 0;
    return Number.isFinite(n) ? n : 0;
  };
  const onDragOver = (e: DragEvent) => {
    const dt = e.dataTransfer;
    if (dt?.types?.includes("Files") || dt?.items?.length) e.preventDefault();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); // never let the browser navigate to a dropped file
    const files = e.dataTransfer ? [...e.dataTransfer.files].filter(isImageFile) : [];
    if (files.length) importFiles(files, pageIndexFromTarget(e.target));
  };
  const onPaste = (e: ClipboardEvent) => {
    const files: File[] = [];
    for (const it of e.clipboardData?.items ?? []) {
      if (it.kind === "file" && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) files.push(f); }
    }
    if (files.length) { e.preventDefault(); importFiles(files, 0); }
  };

  // Transient zoom (NOT persisted). Applied as a CSS WIDTH multiplier on a wrapper
  // around each page — DrawingCanvas.toLocal divides by getBoundingClientRect().width,
  // so pointer mapping stays correct at any zoom without touching the canvas code.
  // ZOOM_MIN/ZOOM_MAX are module-level (shared with the Toolbar's disabled guards).
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
  // Focus the (tabindex=0) stage on interaction so a subsequent Cmd/Ctrl+V paste targets it
  // (a plain <div> only receives `paste` while focused). Harmless to drawing — the live canvas
  // still gets the pointerdown + capture.
  const focusStage = (el: HTMLDivElement) => () => el.focus({ preventScroll: true });
  const attachStage = (el: HTMLDivElement) => {
    const onFocus = focusStage(el);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onFocus);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);
    el.addEventListener("paste", onPaste);
    onCleanup(() => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onFocus);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
      el.removeEventListener("paste", onPaste);
    });
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
        onImportImage={() => fileInput.click()}
      />
      <div class="draw-stage" tabindex={0} ref={attachStage}>
        <Index each={store.doc().pages}>
          {(_page, i) => (
            <div class="draw-page-zoom" data-page-index={i} style={{ width: `${zoom() * 100}%`, "max-width": `${zoom() * 1400}px` }}>
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
        <IconTextButton icon="Plus" iconSize={14} onClick={() => store.addPage()}>ADD PAGE</IconTextButton>
      </div>
      {/* Hidden picker backing the toolbar's Import-image button. */}
      <input ref={fileInput} type="file" accept="image/*" class="draw-fileinput" onChange={onPickFile} />
    </div>
  );
}

// A PDF opens the same way as an image, but seeds a MULTI-page sidecar (one drawing page per
// rasterized PDF page) rather than a single background.
const PDF_NAME_RE = /\.pdf$/i;

/** Open an image (.png/.jpg/.jpeg/.gif/.webp/.svg) OR a PDF as an ANNOTATABLE surface. Both are
 *  backed by a sidecar `<file>.draw` whose blank page(s) carry the source as full-page background
 *  ImageEl(s) drawn under the ink, so strokes annotate them: an image seeds ONE page; a PDF seeds
 *  one page per PDF page (rasterized client-side). Created on first open and idempotent —
 *  reopening loads the existing sidecar with all prior annotations — then handed to the normal
 *  DrawingPage. */
export function ImageMarkupPage(props: { path: string }) {
  const [sidecar] = createResource(() => props.path, async (src): Promise<string> => {
    const sc = `${src}.draw`;
    // Decide seed-vs-reuse WITHOUT relying on a 404: GET /file returns 200 with an EMPTY body for a
    // missing note (it never 404s a read), so an empty/whitespace body means "no sidecar yet → seed
    // it". A non-empty body is an existing sidecar — reuse it, and even if it's CORRUPT still don't
    // clobber (mount as-is; DrawingPage falls back to a blank doc in memory and only rewrites on an
    // actual edit). A non-2xx/non-404 HTTP error or a network failure is ambiguous → never clobber.
    let missing = false;
    try {
      const r = await fetch(`${apiBase()}/file?path=${encodeURIComponent(sc)}`);
      if (!r.ok && r.status !== 404) return sc; // transient HTTP error → mount as-is, don't clobber
      const text = r.ok ? await r.text() : "";
      if (text.trim()) {
        try { parseDoc(text); } catch { /* corrupt but present → leave it, don't clobber */ }
        return sc; // existing sidecar → reuse (keep annotations)
      }
      missing = true; // empty body (or a 404) → first open
    } catch {
      return sc; // network failure → don't risk clobbering
    }
    if (missing) {
      // First open — seed the sidecar (image → 1 page, PDF → 1 page per rasterized page). A failed
      // write still mounts DrawingPage, which falls back to a blank doc and re-saves on the next edit.
      try { await api.saveDrawing(sc, await seedMarkupDoc(src)); }
      catch (e) { pushToast(`Couldn't open for markup: ${(e as Error).message}`); }
    }
    return sc;
  });
  // A PDF is rasterized inside the seeder (getting worse the more pages it has), so name that
  // wait explicitly instead of the generic image "Loading…".
  const loadingLabel = () => (PDF_NAME_RE.test(props.path) ? "Rasterizing PDF…" : "Loading image…");
  return (
    <Show when={sidecar()} keyed fallback={<Loading>{loadingLabel()}</Loading>}>
      {(sc) => <DrawingPage path={sc} />}
    </Show>
  );
}

/** Seed a markup sidecar for a source file. Branches on extension: PDFs seed one drawing page per
 *  rasterized PDF page; everything else is treated as a single image. */
function seedMarkupDoc(srcPath: string): Promise<DrawingDoc> {
  return PDF_NAME_RE.test(srcPath) ? seedPdfDoc(srcPath) : seedImageDoc(srcPath);
}

/** Seed a markup sidecar: read the image's bytes (GET /asset) into a self-contained `data:`
 *  URL — so the sidecar exports headlessly with zero asset resolution — and place it as a
 *  full-page background on a blank page (the photo IS the surface, so no grid wash). A failed
 *  read still yields a usable blank page. */
async function seedImageDoc(imagePath: string): Promise<DrawingDoc> {
  const doc = emptyDoc();
  doc.paper.bg = "blank";
  try {
    const src = await blobToDataUrl(await (await fetch(api.assetUrl(imagePath))).blob());
    doc.pages[0].images = [await imageElFromSrc(src)];
  } catch (e) {
    pushToast(`Couldn't load image: ${(e as Error).message}`);
  }
  return doc;
}

/** Seed a markup sidecar for a PDF: fetch its bytes, rasterize each page to a self-contained
 *  `data:` URL in the browser (pdfjs is dynamically imported here so it stays off the boot path),
 *  and place each raster as a full-page background on its own blank page — mirroring the single-image
 *  path but multi-page. A read/rasterize failure still yields a usable blank page. */
async function seedPdfDoc(pdfPath: string): Promise<DrawingDoc> {
  const doc = emptyDoc();
  doc.paper.bg = "blank";
  try {
    const bytes = await (await fetch(api.assetUrl(pdfPath))).arrayBuffer();
    const { rasterizePdf } = await import("./pdfRaster");
    const rasters = await rasterizePdf(bytes);
    // Keep the fallback blank page if every page failed to rasterize (rasterizePdf already toasted).
    if (rasters.length) {
      doc.pages = await Promise.all(
        rasters.map(async (src): Promise<Page> => ({ strokes: [], images: [await imageElFromSrc(src)] })),
      );
    }
  } catch (e) {
    pushToast(`Couldn't load PDF: ${(e as Error).message}`);
  }
  return doc;
}
