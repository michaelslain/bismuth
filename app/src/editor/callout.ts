// app/src/editor/callout.ts
// Shared, DOM-free core for Obsidian-style `> [!type] Title` blockquote callouts. This is the
// SINGLE source of truth for the three surfaces that render them:
//   • HTML / PDF export + every renderMarkdown surface (bases/markdown.ts marked extension),
//   • the CodeMirror live-preview block widget (livePreview.ts),
//   • the lossless block model (blocks/blockModel.ts).
// Pure string work only — NO CodeMirror / DOM / marked imports — so it runs under `bun test`
// like slashMenu.ts / thematicBreak.ts. The only dependency is the canonical HTML escaper.
import { escapeHtml, escapeAttr } from "../htmlEscape";

/** A parsed callout header (`> [!type][+/-] Title`). `null` from parseCalloutHeader = not one. */
export interface CalloutHeader {
  /** Canonical type, folded from aliases; an unknown type folds to "note". */
  type: string;
  /** Header title text (raw, may contain inline markdown). "" → the type label is shown. */
  title: string;
  /** Header carried a fold marker (`+`/`-`) → the callout is collapsible. */
  foldable: boolean;
  /** Header carried `-` → starts collapsed (only meaningful when `foldable`). */
  collapsed: boolean;
}

export interface CalloutMeta {
  /** Title shown when the header has no explicit title (capitalised canonical name). */
  label: string;
  /** Lucide icon NAME — for any surface that wants the component (the SVG below is what HTML uses). */
  icon: string;
  /** Concrete accent hex. A CSS var would be cleaner in-app, but the PDF rasterizer (html2canvas)
   *  needs a real color, so a fixed per-type palette is the single source for every surface. */
  color: string;
}

// Canonical types → metadata. Aliases below fold onto these keys.
export const CALLOUT_TYPES: Record<string, CalloutMeta> = {
  note: { label: "Note", icon: "Pencil", color: "#448aff" },
  tip: { label: "Tip", icon: "Lightbulb", color: "#00bfa5" },
  success: { label: "Success", icon: "Check", color: "#21c065" },
  question: { label: "Question", icon: "CircleHelp", color: "#e0a526" },
  warning: { label: "Warning", icon: "TriangleAlert", color: "#ef8e2c" },
  failure: { label: "Failure", icon: "CircleX", color: "#e5484d" },
  danger: { label: "Danger", icon: "Zap", color: "#e93147" },
  bug: { label: "Bug", icon: "Bug", color: "#e93147" },
  example: { label: "Example", icon: "List", color: "#a371f7" },
  quote: { label: "Quote", icon: "MessageSquare", color: "#9aa0a6" },
  abstract: { label: "Abstract", icon: "ClipboardList", color: "#00b8d4" },
  todo: { label: "Todo", icon: "CircleCheck", color: "#448aff" },
  important: { label: "Important", icon: "Flame", color: "#00b8d4" },
};

// Aliases → canonical type. Anything not here (and not a canonical key) folds to "note".
const CALLOUT_ALIASES: Record<string, string> = {
  info: "note",
  hint: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  fail: "failure",
  error: "danger",
  cite: "quote",
  summary: "abstract",
  tldr: "abstract",
};

/** Fold a raw type string (case-insensitive) onto a canonical type; unknown → "note". */
export function canonicalCalloutType(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (CALLOUT_TYPES[t]) return t;
  return CALLOUT_ALIASES[t] ?? "note";
}

/** Metadata for a (canonical or alias) type; always defined (falls back to "note"). */
export function calloutMeta(type: string): CalloutMeta {
  return CALLOUT_TYPES[canonicalCalloutType(type)] ?? CALLOUT_TYPES.note;
}

// `> [!type][+|-] title` — the leading `>` is optional so callers may pass a line that has
// already been blockquote-stripped (blockModel) or one that still carries the marker (livePreview).
const HEADER_RE = /^[ \t]{0,3}(?:>[ \t]?)?\[!([A-Za-z][\w-]*)\]([-+]?)[ \t]*(.*?)[ \t]*$/;

/** Parse a callout header line. Returns null when the line isn't a `[!type]` callout header. */
export function parseCalloutHeader(firstLine: string): CalloutHeader | null {
  const m = HEADER_RE.exec(firstLine);
  if (!m) return null;
  return {
    type: canonicalCalloutType(m[1]),
    title: m[3] ?? "",
    foldable: m[2] === "+" || m[2] === "-",
    collapsed: m[2] === "-",
  };
}

// ── Icon SVGs (Lucide, path/circle only so DOMPurify's svg profile keeps them) ───────────────
// `currentColor` → the icon inherits the title color (set per type by the callout CSS), so a
// single SVG works on every surface (in-app theme + rasterized PDF) with no per-type recolor.
const ICON_PATHS: Record<string, string> = {
  note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  tip: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z"/>',
  success: '<path d="M20 6 9 17l-5-5"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  warning: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  failure: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  danger: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  bug: '<path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Z"/><path d="M12 20v-9"/><path d="m8 2 1.5 1.9"/><path d="M16 2l-1.5 1.9"/><path d="M6 13H3"/><path d="M21 13h-3"/>',
  example: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  quote: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  abstract: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  todo: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  important: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
};

/** Inline SVG for a callout type (stroke = currentColor). Safe for innerHTML once sanitized
 *  with DOMPurify's svg profile enabled (sanitizeHtml.ts). */
export function calloutIconSvg(type: string): string {
  const inner = ICON_PATHS[canonicalCalloutType(type)] ?? ICON_PATHS.note;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/**
 * Build a callout's HTML from its header + already-rendered body/title HTML. Shared by the marked
 * export extension and the CodeMirror widget so every surface emits the SAME markup. `bodyHtml`
 * and `titleHtml` are expected to ALREADY be safe HTML (rendered by the caller); the result is
 * still run through sanitizeHtml by the caller before injection. A foldable header → <details>.
 */
export function renderCalloutHtml(header: CalloutHeader, bodyHtml: string, titleHtml?: string): string {
  const meta = calloutMeta(header.type);
  const titleInner = titleHtml && titleHtml.trim() ? titleHtml : escapeHtml(meta.label);
  const icon = `<span class="callout-icon">${calloutIconSvg(header.type)}</span>`;
  const titleHtmlBlock = `${icon}<span class="callout-title-inner">${titleInner}</span>`;
  const content = bodyHtml.trim() ? `<div class="callout-content">${bodyHtml}</div>` : "";
  const cls = `callout callout-${header.type}`;
  const data = escapeAttr(header.type);
  // Emit the per-type accent as an inline `--callout-color` custom property so THIS module is
  // the single source of the color for every in-app rendered surface (cards / transclusion /
  // live-preview widget): the CSS reads var(--callout-color) generically, with no per-type hex
  // list to keep in sync. `meta.color` is a controlled hex from CALLOUT_TYPES. (The standalone
  // export doc still carries its own concrete per-type rules via htmlTemplate.ts, unaffected.)
  const style = ` style="--callout-color:${meta.color}"`;
  if (header.foldable) {
    const open = header.collapsed ? "" : " open";
    return `<details class="${cls}" data-callout="${data}"${style}${open}><summary class="callout-title">${titleHtmlBlock}</summary>${content}</details>`;
  }
  return `<div class="${cls}" data-callout="${data}"${style}><div class="callout-title">${titleHtmlBlock}</div>${content}</div>`;
}

// ── Scanning (for the CodeMirror live-preview surface) ───────────────────────────────────────

export interface CalloutScan {
  /** 0-based first line index (the `> [!type]` header line). */
  fromLine: number;
  /** 0-based last line index (inclusive — the final `>` body line). */
  toLine: number;
  header: CalloutHeader;
  /** Body markdown (blockquote-stripped, header line excluded). */
  body: string;
}

const FENCE_RE = /^[ \t]*(?:```|~~~)/;
const QUOTE_LINE_RE = /^[ \t]{0,3}>/;

/**
 * Find callout blockquote runs in a document given its lines (0-based, no terminators). A run is a
 * maximal block of `>`-prefixed lines whose FIRST line is a callout header. Lines inside fenced
 * code are skipped (a `> [!x]` there is literal). Pure — the CodeMirror surface maps the returned
 * line indices back onto document offsets.
 */
export function scanCallouts(lines: string[]): CalloutScan[] {
  const out: CalloutScan[] = [];
  let inFence = false;
  let i = 0;
  // Skip a leading YAML frontmatter block (`---` … `---` at the very top) so a stray `>`-prefixed
  // YAML line is never mistaken for a callout. Only when a matching close exists (else the opening
  // `---` is an ordinary thematic break and the body starts at line 0).
  if (lines.length > 0 && /^---[ \t]*$/.test(lines[0])) {
    let c = 1;
    while (c < lines.length && !/^---[ \t]*$/.test(lines[c])) c++;
    if (c < lines.length) i = c + 1;
  }
  while (i < lines.length) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      i++;
      continue;
    }
    if (!inFence && QUOTE_LINE_RE.test(lines[i])) {
      const header = parseCalloutHeader(lines[i]);
      if (header) {
        let j = i;
        while (j + 1 < lines.length && QUOTE_LINE_RE.test(lines[j + 1])) j++;
        const body = lines
          .slice(i + 1, j + 1)
          .map((l) => l.replace(/^[ \t]{0,3}>[ \t]?/, ""))
          .join("\n");
        out.push({ fromLine: i, toLine: j, header, body });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}
