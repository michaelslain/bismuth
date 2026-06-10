// app/src/drawing/Toolbar.tsx
import { type JSX } from "solid-js";
import type { PaperBg } from "../../../core/src/drawing/model";
import type { ToolState } from "./DrawingCanvas";
import { ZOOM_MIN, ZOOM_MAX } from "./DrawingPage";
import { Button } from "../ui/Button";
import { SegmentedToggle } from "../ui/SegmentedToggle";
import { Icon } from "../icons/Icon";

const TOOLS: { id: ToolState["tool"]; icon: string; title: string }[] = [
  { id: "pen", icon: "Pen", title: "Pen" },
  { id: "hl", icon: "Highlighter", title: "Highlighter" },
  { id: "eraser", icon: "Eraser", title: "Eraser" },
];

// Five discrete size levels (≈20% steps) replacing the size slider.
const SIZE_LEVELS = [2, 5, 9, 14, 20];
// Smoothing has two modes: a sharp (raw jagged) path vs. a smooth (relaxed) curve.
const SHARP_PATH = "M2 13 L6 3 L10 13 L14 3 L18 13 L22 3";
const SMOOTH_PATH = "M2 9 C8 4 16 14 22 7";

const dotIcon = (size: number) => (
  <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
    <circle cx="11" cy="8" r={2 + (size / 20) * 5} fill="currentColor" />
  </svg>
);
// A color swatch in the identical 22×16 box as dotIcon (a rounded square so it reads as
// a swatch, not a dot) — keeps the color row and size row the same size + spacing.
const colorSwatch = (fill: string) => (
  <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
    <rect x="4.5" y="1.5" width="13" height="13" rx="3" fill={fill} />
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
  zoom: () => number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}) {
  const t = props.tools;
  // Fixed 7-swatch Bismuth ink palette. The first swatch ("fg") is the theme
  // default ink, mapped to the Bismuth default ink color (#E7E8F2).
  const colors = () => ["fg", "#22C6D6", "#5C7BEE", "#8B6CF0", "#43D49A", "#F2C53D", "#F0509B"];
  const swatchColor = (c: string) => (c === "fg" ? "#E7E8F2" : c);

  const toolOpts = TOOLS.map((x) => ({ id: x.id, label: <Icon value={x.icon} size={17} />, title: x.title }));
  // Colors render as filled rounded-square swatches drawn in the SAME 22×16 box as the
  // size dots, so the color row and the line-weight row are identical in size + spacing.
  const colorOpts = () => colors().map((c) => ({ id: c, label: colorSwatch(swatchColor(c)), title: c === "fg" ? "Default ink" : c }));
  const sizeOpts = SIZE_LEVELS.map((s) => ({ id: s, label: dotIcon(s), title: `Size ${s}` }));
  const smoothOpts: { id: ToolState["smoothMode"]; label: JSX.Element; title: string }[] = [
    { id: "sharp", label: smoothIcon(SHARP_PATH), title: "Sharp (raw)" },
    { id: "smooth", label: smoothIcon(SMOOTH_PATH), title: "Smooth (relax on release)" },
  ];
  const paperOpts = (["blank", "lines", "grid", "dots"] as PaperBg[]).map((p) => ({ id: p, label: paperIcon(p), title: p[0].toUpperCase() + p.slice(1) }));

  const zoomPct = () => Math.round(props.zoom() * 100);

  return (
    <div class="draw-toolbar">
      {/* Two-row dock: most groups stack into a 2-row column to keep the bar narrow.
          tools | colors/sizes | smooth/paper | undo-redo/zoom. */}
      <div class="draw-row">
        <div class="draw-group">
          <SegmentedToggle options={toolOpts} value={t().tool} onChange={(id) => props.setTools({ tool: id })} segmentClass="draw-iconseg" />
        </div>
        {/* Colors on top, line-weight directly below — same box size + spacing. */}
        <div class="draw-group">
          <div class="draw-vstack">
            <SegmentedToggle options={colorOpts()} value={t().color} onChange={(c) => props.setTools({ color: c })} segmentClass="draw-iconseg" />
            <SegmentedToggle options={sizeOpts} value={t().size} onChange={(s) => props.setTools({ size: s })} segmentClass="draw-iconseg" />
          </div>
        </div>
        {/* Smoothing on top, paper below. */}
        <div class="draw-group">
          <div class="draw-vstack">
            <SegmentedToggle options={smoothOpts} value={t().smoothMode} onChange={(v) => props.setTools({ smoothMode: v })} segmentClass="draw-iconseg" />
            <SegmentedToggle options={paperOpts} value={props.bg()} onChange={(id) => props.setBackground(id)} segmentClass="draw-iconseg" />
          </div>
        </div>
        {/* Undo/redo on top, zoom below. */}
        <div class="draw-group">
          <div class="draw-vstack">
            <div class="segmented">
              <Button kind="text" state="unselected" class="draw-iconseg" title="Undo" aria-label="Undo" onClick={() => props.onUndo()}>
                <Icon value="Undo2" size={17} />
              </Button>
              <Button kind="text" state="unselected" class="draw-iconseg" title="Redo" aria-label="Redo" onClick={() => props.onRedo()}>
                <Icon value="Redo2" size={17} />
              </Button>
            </div>
            <div class="segmented">
              <Button kind="text" state="unselected" class="draw-iconseg" title="Zoom out" aria-label="Zoom out"
                disabled={props.zoom() <= ZOOM_MIN} onClick={() => props.onZoomOut()}>
                <Icon value="ZoomOut" size={17} />
              </Button>
              <Button kind="text" state="unselected" class="draw-iconseg draw-zoompct" title="Reset zoom" aria-label="Reset zoom" onClick={() => props.onResetZoom()}>
                {zoomPct()}%
              </Button>
              <Button kind="text" state="unselected" class="draw-iconseg" title="Zoom in" aria-label="Zoom in"
                disabled={props.zoom() >= ZOOM_MAX} onClick={() => props.onZoomIn()}>
                <Icon value="ZoomIn" size={17} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
