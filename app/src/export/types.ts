// app/src/export/types.ts
import type { Row, SourceSpec } from "../../../core/src/bases/types";

export type ExportFormat = "html" | "pdf" | "md" | "png" | "csv";

export type ExportTheme = "dark" | "light";

// How a `type: base` md file is exported. "data" = the chosen view's flat table
// (markdown/csv/html table — the historical behavior); "visual" = the view rendered
// AS ITS KIND (calendar grid / cards / kanban / list). Ignored for non-base files
// (prose md / sheet / draw always behave as before).
export type RenderMode = "visual" | "data";

// Calendar visual-export span (mirrors the live calendar's ViewType).
export type CalSpan = "month" | "week" | "3day" | "day";

export type PaletteToken = "accent" | "teal" | "blue" | "violet" | "green" | "gold" | "rose";

// Concrete (already-resolved) theme values the export inlines so it matches the live app.
// Built in the browser from the app's runtime CSS vars (which settingsCssVars projects from
// the active theme + settings); the export doc can't reference var()/color-mix, so every
// value here is a literal color/font. Headless callers (CLI) fall back to DEFAULT_PALETTE.
export interface ThemePalette {
  scheme: ExportTheme;                       // "dark" mirrors the app chrome; "light" = print paper
  bg: string;
  fg: string;
  muted: string;
  border: string;
  cell: string;                              // calendar cell / card background
  head: string;                              // header-row / column-head background
  accent: string;
  tokens: Record<PaletteToken, string>;      // category/status palette
  font: string;                              // body font-family stack (the app's font)
}

// Per-export choices layered on top of (path, format, theme). All fields are
// BASE-ONLY except where noted; non-base files ignore them entirely.
export interface ExportOptions {
  // Which view of the base to export — index into BaseConfig.views. Default 0
  // (the first view, the historical hardcoded behavior).
  viewIndex: number;
  // Data table vs rendered view. Default is derived per view kind in the UI
  // (calendar/cards/kanban/list → "visual"; table/charts/etc → "data").
  mode: RenderMode;
  // Calendar visual export only (mode === "visual" && view.type === "calendar").
  calSpan: CalSpan;             // default "month"
  calStart: string;             // anchor date "YYYY-MM-DD"; "" = today (resolved in the renderer)
  weekStartsOnMonday: boolean;  // week/month grid start; default true
  militaryTime: boolean;        // 24h vs 12h event times; default false

  // Resolved live-theme palette so the export matches the app (colors + font). Undefined
  // headlessly (CLI) → the renderer uses DEFAULT_PALETTE for the chosen theme.
  palette?: ThemePalette;
}

// What the export tab displays. Cheap to compute — never generates export bytes
// (in particular never runs the heavy html->pdf pipeline), so switching formats
// in the UI stays instant and side-effect-free.
export interface ExportPreview {
  previewHtml?: string;   // shown in an <iframe srcdoc> (isolated document)
  previewImg?: string;    // data: URL, shown in an <img> (drawings)
}

export interface ExportResult {
  bytes: Uint8Array;
  mime: string;
  filename: string;       // e.g. "note.html"
  previewHtml?: string;
  previewImg?: string;
}

// Impure dependencies injected so exporters.ts stays unit-testable.
export interface ExportDeps {
  read: (path: string) => Promise<string>;
  resolveRows: (spec: SourceSpec) => Promise<Row[]>;
  htmlToPdf: (html: string) => Promise<Uint8Array>;
  htmlToPng: (html: string) => Promise<{ bytes: Uint8Array; dataUrl: string }>;
  drawingToPng: (docText: string, theme: ExportTheme) => Promise<{ bytes: Uint8Array; dataUrl: string }>;
  // Inline KaTeX stylesheet (CSS + base64 woff2 fonts) for exports that contain rendered math.
  // Injected because the impl is environment-specific: the app supplies the Vite `?inline`-bundled
  // module (./katexCss), while headless/bun consumers (cli) can't resolve those Vite imports — so
  // routing it through deps keeps katexCss.ts OUT of any bun-compiled bundle (e.g. the cli binary).
  katexCss: () => Promise<string>;
}
