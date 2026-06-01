// app/src/drawing/Toolbar.tsx
import { For } from "solid-js";
import type { PaperBg } from "../../../core/src/drawing/model";
import type { ToolState } from "./DrawingCanvas";

const COLORS = ["fg", "#e23b3b", "#2f7bff", "#15a34a", "#f59e0b", "#9b59ff"];
const TOOLS: { id: ToolState["tool"]; label: string }[] = [
  { id: "pen", label: "Pen" }, { id: "hl", label: "Marker" }, { id: "eraser", label: "Eraser" },
];
const PAPERS: PaperBg[] = ["blank", "lines", "grid", "dots"];

export function Toolbar(props: {
  tools: () => ToolState;
  setTools: (patch: Partial<ToolState>) => void;
  bg: () => PaperBg;
  setBackground: (bg: PaperBg) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const t = props.tools;
  const swatchColor = (c: string) => (c === "fg" ? "var(--fg)" : c);
  return (
    <div class="draw-toolbar">
      <div class="draw-group">
        <For each={TOOLS}>{(tool) => (
          <button class="draw-btn" classList={{ active: t().tool === tool.id }}
            onClick={() => props.setTools({ tool: tool.id })}>{tool.label}</button>
        )}</For>
      </div>
      <div class="draw-group">
        <For each={COLORS}>{(c) => (
          <button class="draw-swatch" classList={{ active: t().color === c }}
            style={{ background: swatchColor(c) }} title={c === "fg" ? "Default ink" : c}
            onClick={() => props.setTools({ color: c })} />
        )}</For>
      </div>
      <div class="draw-group">
        <span class="draw-label">Size</span>
        <input type="range" min="1" max="24" value={t().size}
          onInput={(e) => props.setTools({ size: +e.currentTarget.value })} />
      </div>
      <div class="draw-group">
        <span class="draw-label">Smooth</span>
        <input type="range" min="0" max="92" value={Math.round(t().smoothing * 100)}
          onInput={(e) => props.setTools({ smoothing: +e.currentTarget.value / 100 })} />
      </div>
      <div class="draw-group">
        <span class="draw-label">Paper</span>
        <For each={PAPERS}>{(p) => (
          <button class="draw-btn" classList={{ active: props.bg() === p }}
            onClick={() => props.setBackground(p)}>{p}</button>
        )}</For>
      </div>
      <div class="draw-group">
        <button class="draw-btn" onClick={() => props.onUndo()}>Undo</button>
        <button class="draw-btn" onClick={() => props.onRedo()}>Redo</button>
      </div>
    </div>
  );
}
