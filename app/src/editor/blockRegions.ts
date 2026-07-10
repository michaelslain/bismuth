// app/src/editor/blockRegions.ts
//
// Pure (no CodeMirror `view` / DOM / JSX) scan of a document into the block regions live-preview
// decorates: fenced code blocks, YAML frontmatter, GFM tables, blank-line HTML blocks, and
// Obsidian callouts. Extracted out of livePreview.ts so this logic — which decides EXACTLY which
// lines are a block's opening/closing fence vs. its body (the data bug #10's card top/mid/bottom
// classification is built from) — can be unit-tested directly under `bun test`, without mounting a
// real CodeMirror `EditorView`.
//
// Why this had to move: livePreview.ts statically imports two Solid/JSX widgets (TaskCheckbox.tsx,
// CodeHeader.tsx). `bun test`'s bundler can't resolve Solid's `jsxImportSource` for those (Solid
// has no runtime `jsx-runtime` module — it's a compile-time-only transform, unlike React/Preact),
// so ANYTHING that imports livePreview.ts — even just for its pure helpers — fails to even load
// under `bun test`. This file has none of that, so it (and its tests) run headless with no DOM.
import type { Text } from "@codemirror/state";
import { extractFrontmatterBoundary } from "./frontmatterUtils";
import { type TableBlock, groupTableBlocks } from "./tableModel";
import { scanHtmlBlocks } from "./htmlPreview";
import { scanCallouts, type CalloutHeader } from "./callout";

export interface CodeBlock {
  open: number; // line number of the opening ``` fence
  close: number; // line number of the closing ``` fence
  lang: string; // info string after the opening fence
  body: string; // the code lines joined with "\n" (for the copy button)
}

/** A callout blockquote run located in the document (1-based line range + parsed header + body). */
export interface CalloutLineBlock {
  fromLine: number;
  toLine: number;
  header: CalloutHeader;
  body: string;
}

export interface BlockRegions {
  frontmatterLines: Set<number>;
  // The `---` delimiter line numbers of the frontmatter block (null if no
  // frontmatter). Hidden like a code fence until the cursor enters the block.
  frontmatterOpen: number | null;
  frontmatterClose: number | null;
  fenceLines: Set<number>;
  codeLines: Set<number>;
  // GFM pipe tables grouped into blocks, plus a line → block lookup. A block renders
  // as the editable <table> widget unless it is the "active" (raw-source) block.
  tableBlocks: TableBlock[];
  tableBlockByLine: Map<number, TableBlock>;
  // Every line that belongs to a (closed) fenced code block → its block.
  codeBlockByLine: Map<number, CodeBlock>;
  // Line numbers covered by a blank-line-delimited HTML block. The block itself
  // is rendered by htmlBlockField (a StateField widget); the per-line pass skips
  // these lines so it neither double-decorates nor misreads the raw HTML.
  htmlBlockLines: Set<number>;
  // Obsidian `> [!type]` callout blocks → a line→block lookup. Each (non-active) block renders as
  // the CalloutWidget (calloutWidgetField); the per-line pass skips its lines unless the block is
  // the active (revealed-for-editing) one, in which case the lines render as a raw blockquote.
  calloutBlockByLine: Map<number, CalloutLineBlock>;
}

// Fenced-code-fence detection, shared by computeBlockRegions() (open + close) and
// livePreview.ts's findCodeBlock() (double-click / active-block tracking).
export const FENCE_OPEN_RE = /^\s*```(.*)$/;
export const FENCE_RE = /^\s*```/;

// A `Text` doc is immutable and shared across selection-only transactions, so this whole-document
// callout scan is a pure function of `doc`. Memoize by doc identity: it runs once per document
// VERSION instead of the 2-3 times a single keystroke or cursor move fans out to (computeBlockRegions
// + activeCalloutField's calloutBlockAt + buildCalloutWidgets), and a pure cursor move (same doc
// object) reuses the previous scan for free. WeakMap-keyed so old doc versions are GC'd. Every caller
// only iterates the result read-only.
const calloutBlockCache = new WeakMap<Text, CalloutLineBlock[]>();

/** All callout blocks in `doc` (1-based line ranges). Shared by computeBlockRegions, the widget
 *  field, and the active-block lookup so every callout consumer agrees on the same ranges.
 *  Memoized by doc identity (see calloutBlockCache). */
export function scanCalloutLineBlocks(doc: Text): CalloutLineBlock[] {
  const cached = calloutBlockCache.get(doc);
  if (cached) return cached;
  const lines: string[] = [];
  for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
  const result = scanCallouts(lines).map((c) => ({
    fromLine: c.fromLine + 1,
    toLine: c.toLine + 1,
    header: c.header,
    body: c.body,
  }));
  calloutBlockCache.set(doc, result);
  return result;
}

/** Scan the whole document once and return the block-region sets.
 *  Called only when the document content changes (or on first construction). */
export function computeBlockRegions(doc: Text): BlockRegions {
  const fenceLines = new Set<number>(); // the ``` marker lines
  const codeLines = new Set<number>();  // lines inside a fence
  // Group fences into closed blocks so we can hide the ``` lines / show a header.
  const codeBlockByLine = new Map<number, CodeBlock>();
  // Materialize the doc once; reused for the fence/HTML fast-path checks and the frontmatter
  // boundary below (which previously did its own doc.toString()).
  const full = doc.toString();
  // Fast path: without "```" anywhere there are no fenced code blocks, so skip the per-line fence
  // scan — the dominant cost of this per-keystroke function on a large note — leaving the three
  // code sets empty exactly as the loop would. (Absence of the substring is a sound guarantee;
  // its presence still runs the precise line-by-line matcher.)
  if (full.indexOf("```") !== -1) {
    let i = 1;
    while (i <= doc.lines) {
      const m = doc.line(i).text.match(FENCE_OPEN_RE);
      if (m) {
        const open = i;
        const bodyLines: string[] = [];
        let j = i + 1;
        while (j <= doc.lines && !FENCE_RE.test(doc.line(j).text)) {
          bodyLines.push(doc.line(j).text);
          j++;
        }
        if (j <= doc.lines) {
          // ```query is owned by queryBlock.ts, which replaces the whole fence with the
          // rendered view. Skip it here so livePreview doesn't ALSO render it as a code
          // block (which would collide with that block replace and leak the raw query).
          // Still advance past its lines so the body isn't re-processed as markdown.
          if (m[1].trim() === "query") {
            i = j + 1;
            continue;
          }
          // closed block: record it and mark all its lines
          const block: CodeBlock = { open, close: j, lang: m[1].trim(), body: bodyLines.join("\n") };
          fenceLines.add(open);
          fenceLines.add(j);
          for (let k = open + 1; k < j; k++) codeLines.add(k);
          for (let k = open; k <= j; k++) codeBlockByLine.set(k, block);
          i = j + 1;
          continue;
        }
        // unclosed fence: treat the opener as an ordinary line
      }
      i++;
    }
  }

  // precompute YAML frontmatter lines from the shared boundary helper (single source
  // of truth for the fence range, also used by validation + autocomplete + Harper).
  const frontmatterLines = new Set<number>();
  let frontmatterOpen: number | null = null;
  let frontmatterClose: number | null = null;
  const fmRange = extractFrontmatterBoundary(full);
  if (fmRange) {
    const firstLine = doc.lineAt(fmRange.from).number;     // line after the opening fence
    const lastBodyLine = fmRange.to > fmRange.from ? doc.lineAt(fmRange.to).number : firstLine - 1;
    // include the opening fence line, the body lines, and the closing fence line
    for (let i = firstLine - 1; i <= lastBodyLine + 1; i++) {
      if (i >= 1 && i <= doc.lines) frontmatterLines.add(i);
    }
    frontmatterOpen = firstLine - 1;     // the opening `---`
    frontmatterClose = lastBodyLine + 1; // the closing `---`
  }

  // precompute GFM table blocks (header + separator + contiguous body rows)
  const { blocks: tableBlocks, byLine: tableBlockByLine } = groupTableBlocks(doc);

  // precompute blank-line-delimited HTML blocks (rendered by htmlBlockField). Fast path: an HTML
  // block needs a "<", so skip the scan entirely when the document contains none.
  const htmlBlockLines = new Set<number>();
  if (full.indexOf("<") !== -1) {
    for (const b of scanHtmlBlocks(doc)) {
      for (let k = b.fromLine; k <= b.toLine; k++) htmlBlockLines.add(k);
    }
  }

  // precompute callout blocks (rendered by calloutWidgetField)
  const calloutBlockByLine = new Map<number, CalloutLineBlock>();
  for (const c of scanCalloutLineBlocks(doc)) {
    for (let k = c.fromLine; k <= c.toLine; k++) calloutBlockByLine.set(k, c);
  }

  return { frontmatterLines, frontmatterOpen, frontmatterClose, fenceLines, codeLines, tableBlocks, tableBlockByLine, codeBlockByLine, htmlBlockLines, calloutBlockByLine };
}
