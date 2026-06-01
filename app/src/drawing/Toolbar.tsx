// app/src/drawing/Toolbar.tsx
import { For, type JSX } from "solid-js";
import type { PaperBg } from "../../../core/src/drawing/model";
import type { ToolState } from "./DrawingCanvas";
import { Button } from "../ui/Button";
import { SegmentedToggle } from "../ui/SegmentedToggle";
import { Icon } from "../icons/Icon";
import { settings, DEFAULT_ACCENT_PALETTE } from "../settings";

const TOOLS: { id: ToolState["tool"]; icon: string; title: string }[] = [
  { id: "pen", icon: "Pen", title: "Pen" },
  { id: "hl", icon: "Highlighter", title: "Highlighter" },
  { id: "eraser", icon: "Eraser", title: "Eraser" },
];

// Five discrete levels (≈20% steps) replacing the size + smoothing sliders.
const SIZE_LEVELS = [2, 5, 9, 14, 20];
const SMOOTH_LEVELS = [0.18, 0.37, 0.55, 0.74, 0.92];
const SMOOTH_ICONS = [
  "M2 13 L6 3 L10 13 L14 3 L18 13 L22 3",
  "M2 12 L6 5 L10 12 L14 5 L18 12 L22 5",
  "M2 11 Q6 4 10 8 Q14 12 18 8 Q20 6 22 8",
  "M2 10 C6 3 10 13 14 8 C17 5 20 9 22 8",
  "M2 9 C8 5 16 11 22 8",
];

const dotIcon = (size: number) => (
  <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
    <circle cx="11" cy="8" r={2 + (size / 20) * 5} fill="currentColor" />
  </svg>
);
const smoothIcon = (d: string) => (
  <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);
// Paper-type icons depict the actual background (blank sheet / ruled / grid / dot grid).
const paperIcon = (bg: PaperBg): JSX.Element => {
  const stroke = { fill: "none", stroke: "currentColor", "stroke-width": "1.4", "stroke-linecap": "round" } as const;
  if (bg === "blank") return (<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="3.5" y="2.5" width="11" height="13" rx="1.5" {...stroke} /></svg>);
  if (bg === "lines") return (<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g {...stroke}><line x1="3" y1="6" x2="15" y2="6" /><line x1="3" y1="9" x2="15" y2="9" /><line x1="3" y1="12" x2="15" y2="12" /></g></svg>);
  if (bg === "grid") return (<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g {...stroke} stroke-width="1.2"><line x1="3" y1="7" x2="15" y2="7" /><line x1="3" y1="11" x2="15" y2="11" /><line x1="7" y1="3" x2="7" y2="15" /><line x1="11" y1="3" x2="11" y2="15" /></g></svg>);
  return (<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g fill="currentColor">{[5, 9, 13].flatMap((y) => [5, 9, 13].map((x) => <circle cx={x} cy={y} r="1" />))}</g></svg>);
};

export function Toolbar(props: {
  tools: () => ToolState;
  setTools: (patch: Partial<ToolState>) => void;
  bg: () => PaperBg;
  setBackground: (bg: PaperBg) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const t = props.tools;
  // Ink colors from the centralized Oxide accent palette (reactive to
  // settings.appearance.accentPalette), with "fg" (theme default ink) first.
  const colors = () => {
    const ap = settings.appearance.accentPalette;
    return ["fg", ...(ap?.length ? ap : DEFAULT_ACCENT_PALETTE)];
  };
  const swatchColor = (c: string) => (c === "fg" ? "var(--fg)" : c);

  const toolOpts = TOOLS.map((x) => ({ id: x.id, label: <Icon value={x.icon} size={17} />, title: x.title }));
  const sizeOpts = SIZE_LEVELS.map((s) => ({ id: s, label: dotIcon(s), title: `Size ${s}` }));
  const smoothOpts = SMOOTH_LEVELS.map((v, i) => ({ id: v, label: smoothIcon(SMOOTH_ICONS[i]), title: `Smoothing ${Math.round(v * 100)}%` }));
  const paperOpts = (["blank", "lines", "grid", "dots"] as PaperBg[]).map((p) => ({ id: p, label: paperIcon(p), title: p[0].toUpperCase() + p.slice(1) }));

  return (
    <div class="draw-toolbar">
      <div class="draw-group">
        <SegmentedToggle options={toolOpts} value={t().tool} onChange={(id) => props.setTools({ tool: id })} segmentClass="draw-seg draw-iconseg" />
      </div>
      <div class="draw-group">
        <For each={colors()}>{(c) => (
          <button class="draw-swatch" classList={{ active: t().color === c }}
            style={{ background: swatchColor(c) }} title={c === "fg" ? "Default ink" : c}
            onClick={() => props.setTools({ color: c })} />
        )}</For>
      </div>
      <div class="draw-group">
        <span class="draw-label">Size</span>
        <SegmentedToggle options={sizeOpts} value={t().size} onChange={(s) => props.setTools({ size: s })} segmentClass="draw-seg draw-iconseg" />
      </div>
      <div class="draw-group">
        <span class="draw-label">Smooth</span>
        <SegmentedToggle options={smoothOpts} value={t().smoothing} onChange={(v) => props.setTools({ smoothing: v })} segmentClass="draw-seg draw-iconseg" />
      </div>
      <div class="draw-group">
        <span class="draw-label">Paper</span>
        <SegmentedToggle options={paperOpts} value={props.bg()} onChange={(id) => props.setBackground(id)} segmentClass="draw-seg draw-iconseg" />
      </div>
      <div class="draw-group">
        <Button variant="plain" class="draw-iconseg" title="Undo" onClick={() => props.onUndo()}><Icon value="Undo2" size={17} /></Button>
        <Button variant="plain" class="draw-iconseg" title="Redo" onClick={() => props.onRedo()}><Icon value="Redo2" size={17} /></Button>
      </div>
    </div>
  );
}
