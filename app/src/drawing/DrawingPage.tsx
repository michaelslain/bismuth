// app/src/drawing/DrawingPage.tsx
import { createResource, createSignal, Index, Show } from "solid-js";
import { api } from "../api";
import { settings } from "../settings";
import { debounce } from "../debounce";
import { emptyDoc, parseDoc, type DrawingDoc, type PaperBg } from "../../../core/src/drawing/model";
import { createDrawingStore } from "./store";
import { DrawingCanvas, type ToolState } from "./DrawingCanvas";
import { Toolbar } from "./Toolbar";
import { TextButton } from "../ui/TextButton";
import { Icon } from "../icons/Icon";
import "./Drawing.css";

// size + smoothing default to one of the 5 discrete toolbar levels so a button reads as active.
const DEFAULT_TOOLS: ToolState = {
  tool: "pen", color: "fg", size: 5, smoothing: 0.55, holdToStraighten: true, holdDelayMs: 480,
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
  const theme = (): "dark" | "light" => (settings.appearance.theme === "light" ? "light" : "dark");

  return (
    <div class="draw-app">
      <Toolbar
        tools={tools}
        setTools={setTools}
        bg={() => store.doc().paper.bg}
        setBackground={(bg: PaperBg) => store.setBackground(bg)}
        onUndo={() => store.undo()}
        onRedo={() => store.redo()}
      />
      <div class="draw-stage">
        <Index each={store.doc().pages}>
          {(_page, i) => (
            <DrawingCanvas
              doc={store.doc}
              pageIndex={i}
              tools={tools}
              theme={theme}
              onCommit={(s) => store.commitStroke(i, s)}
              onEraseStroke={(idx) => store.eraseStroke(i, idx)}
            />
          )}
        </Index>
        <TextButton class="draw-add-page" onClick={() => store.addPage()}><Icon value="Plus" size={14} />ADD PAGE</TextButton>
      </div>
    </div>
  );
}
