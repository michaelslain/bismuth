// app/src/drawing/Toolbar.tsx
import { Show, type JSX } from "solid-js";
import type { PaperBg } from "../../../core/src/drawing/model";
import type { ToolState } from "./DrawingCanvas";
import { ZOOM_MIN, ZOOM_MAX } from "./DrawingPage";
import { Button } from "../ui/Button";
import { SegmentedToggle } from "../ui/SegmentedToggle";
import { Icon } from "../icons/Icon";
import { CATEGORY_SWATCHES, resolveAppearance } from "../themes";
import { settings } from "../settings";

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
// A color swatch in the identical 22×16 box as dotIcon — a FLAT 16px square (no
// rounding), matching the register's "token swatches, butted in a single --border
// frame" (design/ascii-extended PORTING.md §2c / view-sheets-draw.card.html .sw-c).
const colorSwatch = (fill: string) => (
  <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
    <rect x="3" y="0" width="16" height="16" fill={fill} />
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
  // Paper background, zoom, and image import are page-drawing concerns; the note-ink overlay
  // reuses this bar without them (no paper, no zoom, attachments already handle images), so
  // each group is optional — DrawingPage passes everything and is unchanged.
  bg?: () => PaperBg;
  setBackground?: (bg: PaperBg) => void;
  onUndo: () => void;
  onRedo: () => void;
  zoom?: () => number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  onImportImage?: () => void;
}) {
  const t = props.tools;
  // The five-swatch ink set the register specifies: default ink + accent + three
  // category hues (design/ascii-extended PORTING.md §2c: "--fg --accent --rose --gold
  // --green"). The STORED value stays either the "fg" sentinel (resolved live to the
  // active theme's ink at render time — core/src/drawing/theme.ts resolveInkColor) or a
  // literal hex, exactly as before: a stroke's color is persisted into the .draw JSON
  // and re-rendered by the HEADLESS server-side exporter (core/src/drawing/render2d.ts,
  // no DOM/CSS engine there) as well as this canvas, so anything but "fg" must already
  // be a concrete color — never a CSS var() and never a bare id like "accent"/"rose".
  // "fg"/accent are read off the LIVE active scope (settings.appearance.theme), not a
  // frozen DEFAULT_THEME snapshot, so the swatch preview follows a theme switch; the
  // three category hues are intentionally scope-INVARIANT (CATEGORY_SWATCHES is the one
  // fixed teal→rose ramp every categorical surface in the app shares — tokens.ts).
  const activeTheme = () => resolveAppearance(settings.appearance);
  const SWATCHES = () => [
    { id: "fg", name: "Default ink" },
    { id: activeTheme().accent ?? activeTheme().foreground, name: "accent" },
    { id: CATEGORY_SWATCHES.rose, name: "rose" },
    { id: CATEGORY_SWATCHES.gold, name: "gold" },
    { id: CATEGORY_SWATCHES.green, name: "green" },
  ];
  const swatchColor = (c: string) => (c === "fg" ? activeTheme().foreground : c);

  const toolOpts = TOOLS.map((x) => ({ id: x.id, label: <Icon value={x.icon} size={17} />, title: x.title }));
  // Colors render as filled flat-square swatches drawn in the SAME 22×16 box as the
  // size dots, so the color row and the line-weight row are identical in size + spacing.
  const colorOpts = () => SWATCHES().map((s) => ({ id: s.id, label: colorSwatch(swatchColor(s.id)), title: s.name }));
  const sizeOpts = SIZE_LEVELS.map((s) => ({ id: s, label: dotIcon(s), title: `Size ${s}` }));
  const smoothOpts: { id: ToolState["smoothMode"]; label: JSX.Element; title: string }[] = [
    { id: "sharp", label: smoothIcon(SHARP_PATH), title: "Sharp (raw)" },
    { id: "smooth", label: smoothIcon(SMOOTH_PATH), title: "Smooth (relax on release)" },
  ];
  const paperOpts = (["blank", "lines", "grid", "dots"] as PaperBg[]).map((p) => ({ id: p, label: paperIcon(p), title: p[0].toUpperCase() + p.slice(1) }));

  const zoomPct = () => Math.round((props.zoom?.() ?? 1) * 100);

  return (
    <div class="draw-toolbar">
      {/* Two-row dock: most groups stack into a 2-row column to keep the bar narrow.
          tools | colors/sizes | smooth/paper | undo-redo/zoom. */}
      <div class="draw-row">
        <div class="draw-group">
          <SegmentedToggle options={toolOpts} value={t().tool} onChange={(id) => props.setTools({ tool: id })} segmentClass="draw-iconseg" />
          {/* Place a picture into the drawing (also reachable via paste + drag-drop onto the stage). */}
          <Show when={props.onImportImage}>
            <Button kind="text" state="unselected" class="draw-iconseg" title="Import image" aria-label="Import image" onClick={() => props.onImportImage!()}>
              <Icon value="ImagePlus" size={17} />
            </Button>
          </Show>
        </div>
        {/* Colors on top, line-weight directly below — same box size + spacing. */}
        <div class="draw-group">
          <div class="draw-vstack">
            <SegmentedToggle options={colorOpts()} value={t().color} onChange={(c) => props.setTools({ color: c })} class="draw-colorrow" segmentClass="draw-colorseg" />
            <SegmentedToggle options={sizeOpts} value={t().size} onChange={(s) => props.setTools({ size: s })} segmentClass="draw-iconseg" />
          </div>
        </div>
        {/* Smoothing on top, paper below (paper only when the surface has one — not note ink). */}
        <div class="draw-group">
          <div class="draw-vstack">
            <SegmentedToggle options={smoothOpts} value={t().smoothMode} onChange={(v) => props.setTools({ smoothMode: v })} segmentClass="draw-iconseg" />
            <Show when={props.bg && props.setBackground}>
              <SegmentedToggle options={paperOpts} value={props.bg!()} onChange={(id) => props.setBackground!(id)} segmentClass="draw-iconseg" />
            </Show>
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
            <Show when={props.zoom && props.onZoomIn && props.onZoomOut && props.onResetZoom}>
              <div class="segmented">
                <Button kind="text" state="unselected" class="draw-iconseg" title="Zoom out" aria-label="Zoom out"
                  disabled={props.zoom!() <= ZOOM_MIN} onClick={() => props.onZoomOut!()}>
                  <Icon value="ZoomOut" size={17} />
                </Button>
                <Button kind="text" state="unselected" class="draw-iconseg draw-zoompct" title="Reset zoom" aria-label="Reset zoom" onClick={() => props.onResetZoom!()}>
                  {zoomPct()}%
                </Button>
                <Button kind="text" state="unselected" class="draw-iconseg" title="Zoom in" aria-label="Zoom in"
                  disabled={props.zoom!() >= ZOOM_MAX} onClick={() => props.onZoomIn!()}>
                  <Icon value="ZoomIn" size={17} />
                </Button>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
