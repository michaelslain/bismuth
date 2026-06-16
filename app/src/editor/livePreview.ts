// app/src/editor/livePreview.ts
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { type Range, type Text, StateField, StateEffect, type EditorState } from "@codemirror/state";
import { createSignal, type Setter } from "solid-js";
import { render } from "solid-js/web";
import { renderMath, onMathReady } from "./katexLoader";
import { latexTokenDecorations } from "./latexHighlight";
import { extractFrontmatterBoundary } from "./frontmatterUtils";
import { wikilinkVisibleRange } from "./wikilink";
import { findBareUrls } from "./urls";
import { TaskCheckbox, charToStatus, type TaskStatus } from "./TaskCheckbox";
import { openTaskStatusMenu } from "../taskStatusMenu";
import { LIST_STEP } from "./listLayout";
import { CodeHeader } from "./CodeHeader";
import { type TableBlock, groupTableBlocks } from "./tableModel";
import { TableWidget } from "./tableWidget";
import { activeTableField, notePathFacet, setActiveTableEffect } from "./tableState";
import { htmlBlockField, pushInlineHtml, scanHtmlBlocks } from "./htmlPreview";
import { numberedLine, codeLineNumberTheme } from "./codeLineNumbers";
import { isThematicBreak } from "./thematicBreak";

// The editor's mono face: Monaspace Xenon, falling back to the platform ui-monospace.
// Shared across every mono region in the live-preview theme (and reused by embedBlock).
export const MONO_FONT = "'Monaspace Xenon', ui-monospace, monospace";

// Indent depth from leading whitespace: tab = 2 spaces, then depth = floor(indentCols / 2).
function indentDepth(indent: string): number {
  return Math.floor(indent.replace(/\t/g, "  ").length / 2);
}

const hide = Decoration.mark({ class: "cm-hidden-syntax" });
const strong = Decoration.mark({ class: "cm-strong" });
const em = Decoration.mark({ class: "cm-em" });
const strike = Decoration.mark({ class: "cm-strike" });
const code = Decoration.mark({ class: "cm-inline-code" });
const link = Decoration.mark({ class: "cm-link" });
const wikilink = Decoration.mark({ class: "cm-wikilink" });
const tag = Decoration.mark({ class: "cm-tag" });
const headingLines = [1, 2, 3, 4, 5, 6].map((l) => Decoration.line({ class: `cm-h${l}` }));
// The leading `#`s, revealed on the cursor line, render in the mono accent font
// (matching the inline note title) rather than the serif heading face.
const headingMark = Decoration.mark({ class: "cm-heading-mark" });
// Every other markdown delimiter revealed on the cursor line (`**`, `*`, `~~`,
// `` ` ``, `>`, link/wikilink brackets) renders in dim Monaspace Xenon so the
// raw syntax never shows in the serif prose face.
const syntaxMark = Decoration.mark({ class: "cm-syntax-mark" });
const quoteLine = Decoration.line({ class: "cm-quote" });
const taskDoneMark = Decoration.mark({ class: "cm-task-done" });
// On the cursor line a list/task marker shows raw; render it in the mono font.
const listMarkerMark = Decoration.mark({ class: "cm-list-marker" });
const codeBlockLine = Decoration.line({ class: "cm-codeblock" });
// A code-block / frontmatter body line carries its 1-based in-block line number via
// `numberedLine` (shared with queryBlock); CSS draws it in the left gutter through
// `.cm-code-numbered::before { content: attr(data-codeline) }` (codeLineNumbers.ts).
const codeHeaderLine = Decoration.line({ class: "cm-code-headerline" });
const codeHiddenLine = Decoration.line({ class: "cm-code-hidden" });
// A fully collapsed line (zero height): used to hide the frontmatter `---`
// delimiters off the cursor block, the way a code fence's close line collapses.
const collapsedLine = Decoration.line({ class: "cm-collapsed-line" });
const frontmatterLine = Decoration.line({ class: "cm-frontmatter" });
const fmKeyMark = Decoration.mark({ class: "cm-fm-key" });
const tableLine = Decoration.line({ class: "cm-table" });
// A body-level `---` / `***` / `___` thematic break: off the cursor line the literal
// dashes hide and CSS draws a horizontal rule; on it the raw markers show (mono).
const hrLine = Decoration.line({ class: "cm-hr" });

// Notion-style hanging indent for lists. Off the cursor line we replace the whole
// list prefix (indent + marker + spaces) with a single widget and drive ALL spacing
// from CSS instead of the literal markdown whitespace: the text sits at (depth+1)*STEP
// from the margin and the bullet/checkbox hangs in a GUTTER-wide column to its left.
// This keeps the marker→text gap and per-level indent consistent regardless of how the
// source happens to be spaced.
// em added to the text indent per nesting level (shared leaf — see ./listLayout).
const LIST_GUTTER = 1.6; // em — width of the marker gutter (== one step, so text aligns)
const LIST_LINE_HEIGHT = "1.55"; // tighter than prose (1.65) for a cleaner list rhythm
const indentLineCache = new Map<string, Decoration>();
/** A line decoration giving a list line a depth-based hanging indent. */
function indentLine(cls: string, depth: number): Decoration {
  const key = `${cls}:${depth}`;
  let d = indentLineCache.get(key);
  if (!d) {
    const pad = (depth + 1) * LIST_STEP;
    d = Decoration.line({
      class: cls,
      attributes: { style: `padding-left:${pad}em;text-indent:-${LIST_GUTTER}em;line-height:${LIST_LINE_HEIGHT}` },
    });
    indentLineCache.set(key, d);
  }
  return d;
}

// Bullet glyph widget — replaces the raw marker character (-, *, +) off the cursor line.
// Depth-varied glyph: 0 → "•", 1 → "◦", 2+ → "▪"
// NOTE: Task-list lines (- [ ] / - [x]) also match the bullet regex. A follow-up task
// will render those as checkboxes. That checkbox renderer must guard lines BEFORE this
// bullet rule runs (i.e. skip the bullet widget for task lines).
class BulletWidget extends WidgetType {
  private readonly depth: number;

  constructor(depth: number) {
    super();
    this.depth = depth;
  }

  eq(other: BulletWidget): boolean {
    return other.depth === this.depth;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    const glyph = this.depth === 0 ? "•" : this.depth === 1 ? "◦" : "▪";
    span.textContent = glyph;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// DOM node carrying the Solid dispose fn + a status setter, so updateDOM can push
// a new status into the already-mounted component (keeps the node → CSS transitions
// animate instead of snapping on recreate).
type CheckboxDom = HTMLElement & { __dispose?: () => void; __setStatus?: Setter<TaskStatus> };

// Checkbox widget — mounts the <TaskCheckbox> Solid component in place of the
// "- [ ]" / "- [x]" / "- [/]" / "- [-]" prefix off the cursor line.
class CheckboxWidget extends WidgetType {
  constructor(private readonly status: TaskStatus) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.status === this.status;
  }

  toDOM(): HTMLElement {
    // Gutter span so the box sits in the same hanging column as bullets.
    const wrap = document.createElement("span") as CheckboxDom;
    wrap.className = "cm-checkbox";
    const [status, setStatus] = createSignal<TaskStatus>(this.status);
    wrap.__dispose = render(() => TaskCheckbox({ status }), wrap);
    wrap.__setStatus = setStatus;
    return wrap;
  }

  // Only the status changed: drive it through the signal so Solid updates the
  // mounted component in place and the CSS transition runs.
  updateDOM(dom: HTMLElement): boolean {
    const setStatus = (dom as CheckboxDom).__setStatus;
    if (!setStatus) return false;
    setStatus(this.status);
    return true;
  }

  destroy(dom: HTMLElement): void {
    (dom as CheckboxDom).__dispose?.();
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Header shown in place of the opening ```lang fence when the cursor is outside
// the block: language label + copy button. Mounts the <CodeHeader> component.
class CodeHeaderWidget extends WidgetType {
  constructor(private readonly lang: string, private readonly body: string) {
    super();
  }

  eq(other: CodeHeaderWidget): boolean {
    return other.lang === this.lang && other.body === this.body;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div") as HTMLElement & { __dispose?: () => void };
    wrap.className = "cm-code-headerwrap";
    wrap.__dispose = render(() => CodeHeader({ lang: this.lang, body: this.body }), wrap);
    return wrap;
  }

  destroy(dom: HTMLElement): void {
    (dom as HTMLElement & { __dispose?: () => void }).__dispose?.();
  }

  ignoreEvent(): boolean {
    return true; // let the button handle its own clicks
  }
}

// KaTeX widget for math rendering
class MathWidget extends WidgetType {
  private readonly expr: string;
  private readonly displayMode: boolean;
  private _unsub?: () => void;

  constructor(expr: string, displayMode: boolean) {
    super();
    this.expr = expr;
    this.displayMode = displayMode;
  }

  eq(other: MathWidget): boolean {
    return other.expr === this.expr && other.displayMode === this.displayMode;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-math";
    span.innerHTML = renderMath(this.expr, this.displayMode);
    // KaTeX not loaded yet → fill in once the lazy chunk lands (same output). Keep the
    // unsubscribe so a widget destroyed before KaTeX loads drops its pending callback.
    if (!span.innerHTML) this._unsub = onMathReady(() => { span.innerHTML = renderMath(this.expr, this.displayMode); });
    return span;
  }

  destroy(): void {
    this._unsub?.();
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Hide the delimiters of an inline token (off the cursor line) and style the inner text. */
function pushInline(
  deco: Range<Decoration>[], text: string, lineFrom: number, onCursor: boolean,
  re: RegExp, markLen: number, mark: Decoration,
) {
  for (const m of text.matchAll(re)) {
    const s = lineFrom + (m.index ?? 0);
    const end = s + m[0].length;
    const innerStart = s + markLen, innerEnd = end - markLen;
    if (innerEnd <= innerStart) continue;
    deco.push(mark.range(innerStart, innerEnd));
    if (!onCursor) {
      deco.push(hide.range(s, innerStart));
      deco.push(hide.range(innerEnd, end));
    } else {
      // Revealed: the delimiters render in dim Monaspace, not the prose serif.
      deco.push(syntaxMark.range(s, innerStart));
      deco.push(syntaxMark.range(innerEnd, end));
    }
  }
}

/** Style each `[[wikilink]]` on a line — revealing only the basename/alias and hiding
 *  the brackets + folder path off the cursor line. Used for both body and frontmatter
 *  lines so links in properties get the same treatment. Click handling lives in Editor.tsx. */
function pushWikilinks(deco: Range<Decoration>[], text: string, lineFrom: number, onCursor: boolean) {
  // `(?<!!)` skips EMBEDS (`![[...]]`) — they're rendered by embedBlock, not styled as
  // links here (mirrors the graph's extractWikilinks exclusion in core/src/wikilinks.ts).
  for (const m of text.matchAll(/(?<!!)\[\[([^\]]+?)\]\]/g)) {
    const s = lineFrom + (m.index ?? 0);
    const end = s + m[0].length;
    const { from: visFrom, to: visTo } = wikilinkVisibleRange(m[1], s);
    if (visTo <= visFrom) {
      // Degenerate token (e.g. empty basename like "[[#heading]]"): underline the whole thing.
      deco.push(wikilink.range(s, end));
      continue;
    }
    deco.push(wikilink.range(visFrom, visTo));
    if (!onCursor) {
      if (visFrom > s) deco.push(hide.range(s, visFrom));
      if (end > visTo) deco.push(hide.range(visTo, end));
    } else {
      // Revealed: the `[[`, folder path, and `]]` render in dim Monaspace.
      if (visFrom > s) deco.push(syntaxMark.range(s, visFrom));
      if (end > visTo) deco.push(syntaxMark.range(visTo, end));
    }
  }
}

/** Tint body `#tag` spans (incl. the leading `#`) in --teal. A tag is `#` at
 *  start-of-line or after whitespace + tag chars (letters/digits/`/`/`_`/`-`). The
 *  mark only colors text and hides nothing, so the cursor-line reveal stays consistent
 *  with raw source either way. Heading `#`s never match (callers skip heading lines). */
function pushTags(deco: Range<Decoration>[], text: string, lineFrom: number) {
  for (const m of text.matchAll(/(^|\s)(#[\p{L}\d/_-]+)/gu)) {
    const tagStart = lineFrom + (m.index ?? 0) + m[1].length;
    deco.push(tag.range(tagStart, tagStart + m[2].length));
  }
}

interface CodeBlock {
  open: number; // line number of the opening ``` fence
  close: number; // line number of the closing ``` fence
  lang: string; // info string after the opening fence
  body: string; // the code lines joined with "\n" (for the copy button)
}

interface BlockRegions {
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
}

/** Scan the whole document once and return the block-region sets.
 *  Called only when the document content changes (or on first construction). */
function computeBlockRegions(doc: Text): BlockRegions {
  const fenceLines = new Set<number>(); // the ``` marker lines
  const codeLines = new Set<number>();  // lines inside a fence
  // Group fences into closed blocks so we can hide the ``` lines / show a header.
  const codeBlockByLine = new Map<number, CodeBlock>();
  {
    let i = 1;
    while (i <= doc.lines) {
      const m = doc.line(i).text.match(/^\s*```(.*)$/);
      if (m) {
        const open = i;
        const bodyLines: string[] = [];
        let j = i + 1;
        while (j <= doc.lines && !/^\s*```/.test(doc.line(j).text)) {
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
  const fmRange = extractFrontmatterBoundary(doc.toString());
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

  // precompute blank-line-delimited HTML blocks (rendered by htmlBlockField)
  const htmlBlockLines = new Set<number>();
  for (const b of scanHtmlBlocks(doc)) {
    for (let k = b.fromLine; k <= b.toLine; k++) htmlBlockLines.add(k);
  }

  return { frontmatterLines, frontmatterOpen, frontmatterClose, fenceLines, codeLines, tableBlocks, tableBlockByLine, codeBlockByLine, htmlBlockLines };
}

/** Run the per-visible-line decoration pass using pre-computed block regions.
 *  This is cheap: it only iterates view.visibleRanges and must run on every
 *  update (including cursor moves) so that the cursor-line reveal stays correct. */
function buildDecorations(view: EditorView, regions: BlockRegions): DecorationSet {
  const { frontmatterLines, frontmatterOpen, frontmatterClose, tableBlockByLine, codeBlockByLine, htmlBlockLines } = regions;
  const deco: Range<Decoration>[] = [];
  const doc = view.state.doc;
  // Lines touched by any selection range. A line "reveals" its raw markdown (instead
  // of the rendered live-preview) when the cursor is on it OR when it falls inside a
  // selection — so highlighting text exposes its markdown across the whole range, not
  // just the caret line. Spans are precomputed per range (cheap) to avoid a doc.lineAt
  // per visible line.
  const selSpans = view.state.selection.ranges.map((r) => [doc.lineAt(r.from).number, doc.lineAt(r.to).number] as const);
  const isRevealed = (n: number) => selSpans.some(([a, b]) => n >= a && n <= b);
  // The table block (by header line) currently shown as raw source, if any. The
  // rendered <table> block widgets themselves come from tableWidgetField (a StateField)
  // — block decorations may not be provided by a ViewPlugin. Here we only need the
  // active-block id so the per-line pass below renders the raw source for it.
  const activeTableOpen = view.state.field(activeTableField, false) ?? null;
  // The frontmatter `---` fences stay collapsed until the cursor is inside the
  // block (i.e. you start editing it) — mirroring how code fences hide off-block.
  const editingFrontmatter =
    frontmatterOpen != null && frontmatterClose != null &&
    selSpans.some(([a, b]) => a <= frontmatterClose && b >= frontmatterOpen);
  // The code block (by opening-fence line) currently in edit mode, if any.
  const activeCodeOpen = view.state.field(activeCodeField, false) ?? null;

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const onCursor = isRevealed(line.number);
      const text = line.text;

      // frontmatter: dim lines and skip inline markdown — but still highlight any
      // wikilinks (e.g. a `source: "[[Note]]"` property) so they read as links.
      if (frontmatterLines.has(line.number)) {
        // The `---` delimiters collapse to nothing until the cursor enters the
        // block; only the property rows show (a clean "properties" panel).
        const isDelim = line.number === frontmatterOpen || line.number === frontmatterClose;
        if (isDelim) {
          if (!editingFrontmatter) {
            deco.push(collapsedLine.range(line.from));
            if (line.to > line.from) deco.push(hide.range(line.from, line.to));
            pos = line.to + 1;
            continue;
          }
          // Revealed: force both `---` to the same dim Monaspace. (The markdown
          // highlighter tokenizes the closing `---` but not the opening one, so
          // without this the two delimiters render at different lightness.)
          deco.push(frontmatterLine.range(line.from));
          if (line.to > line.from) deco.push(syntaxMark.range(line.from, line.to));
          pos = line.to + 1;
          continue;
        }
        // Property rows carry their 1-based in-block line number (the `---` delimiters
        // never do), matching fenced code. `frontmatterOpen` is non-null here.
        deco.push(numberedLine("cm-frontmatter", line.number - (frontmatterOpen ?? 0)).range(line.from));
        // Tint the `key:` portion in --accent (design .fm keys), leaving values --fg.
        const km = /^(\s*)([A-Za-z0-9_$.-]+)\s*:/.exec(text);
        if (km) {
          const start = line.from + km[1].length;
          deco.push(fmKeyMark.range(start, start + km[2].length));
        }
        pushWikilinks(deco, text, line.from, onCursor);
        pos = line.to + 1;
        continue;
      }

      // fenced code block. It stays "rendered" (``` fences hidden: opening fence →
      // header, closing fence collapsed) until the block is the active edit-mode
      // block (entered by double-click or by typing in it), then shows raw.
      const codeBlock = codeBlockByLine.get(line.number);
      if (codeBlock) {
        const revealed = activeCodeOpen === codeBlock.open;
        // Body lines (strictly between the fences) carry their 1-based in-block
        // line number; the fence lines never do, whether rendered or revealed.
        const isBody = line.number > codeBlock.open && line.number < codeBlock.close;
        if (revealed) {
          deco.push(isBody ? numberedLine("cm-codeblock", line.number - codeBlock.open).range(line.from) : codeBlockLine.range(line.from));
        } else if (line.number === codeBlock.open) {
          deco.push(codeHeaderLine.range(line.from));
          if (line.to > line.from) {
            deco.push(Decoration.replace({ widget: new CodeHeaderWidget(codeBlock.lang, codeBlock.body) }).range(line.from, line.to));
          }
        } else if (line.number === codeBlock.close) {
          deco.push(codeHiddenLine.range(line.from));
          if (line.to > line.from) deco.push(hide.range(line.from, line.to));
        } else {
          deco.push(numberedLine("cm-codeblock", line.number - codeBlock.open).range(line.from));
        }
        pos = line.to + 1;
        continue;
      }

      // GFM table. A non-active block is covered by the block-replace widget pushed
      // above, so its lines need no per-line decoration (skip them). The active
      // (raw-source) block shows monospace pipes for structural / power edits.
      const tableBlock = tableBlockByLine.get(line.number);
      if (tableBlock) {
        if (tableBlock.startLine === activeTableOpen) deco.push(tableLine.range(line.from));
        pos = line.to + 1;
        continue;
      }

      // HTML block: rendered by htmlBlockField (or shown raw when the cursor is
      // inside it). Either way the per-line markdown pass must leave these lines
      // alone — skip so we don't misread raw HTML as headings/lists/etc.
      if (htmlBlockLines.has(line.number)) {
        pos = line.to + 1;
        continue;
      }

      // headings: size the whole line, hide the leading "#"s off the cursor line
      const hm = text.match(/^(#{1,6})\s+/);
      if (hm) {
        deco.push(headingLines[hm[1].length - 1].range(line.from));
        if (!onCursor) deco.push(hide.range(line.from, line.from + hm[0].length));
        // Revealed: keep the `#`s in the mono accent face (not the serif heading).
        else deco.push(headingMark.range(line.from, line.from + hm[1].length));
      }

      // blockquote
      const qm = text.match(/^>\s?/);
      if (qm) {
        deco.push(quoteLine.range(line.from));
        if (!onCursor) deco.push(hide.range(line.from, line.from + qm[0].length));
        else deco.push(syntaxMark.range(line.from, line.from + qm[0].length));
      }

      // ---- thematic break / horizontal rule: --- / *** / ___ / - - - on its own line ----
      // Same marker char, 3+ times, optional spaces between. Frontmatter `---` fences are
      // handled above (they `continue` before reaching here), so any match is a body-level
      // HR. Off the cursor line it renders as a rule (CSS draws the line, the dashes hide);
      // on it the raw markers show. `continue` so it never falls through to bullet/inline.
      if (isThematicBreak(text)) {
        if (onCursor) {
          deco.push(syntaxMark.range(line.from, line.to));
        } else {
          deco.push(hrLine.range(line.from));
          if (line.to > line.from) deco.push(hide.range(line.from, line.to));
        }
        pos = line.to + 1;
        continue;
      }

      // ---- task list lines (- [ ] / - [x]) ----
      // Must run BEFORE the bullet block so task lines never get a bullet glyph.
      let isTaskLine = false;
      // Inner char: space=todo, x/X=done, "/" or "\"=in-progress, "-"=cancelled.
      const taskMatch = text.match(/^(\s*)([-*+])(\s+)\[([ xX/\\-])\](\s)/);
      if (taskMatch) {
        isTaskLine = true;
        const status = charToStatus(taskMatch[4]);
        const struck = status === "done" || status === "cancelled";
        const taskDepth = indentDepth(taskMatch[1]);
        if (struck) {
          // strike only the task text, not the indentation/checkbox
          const textStart = line.from + taskMatch[0].length;
          if (line.to > textStart) deco.push(taskDoneMark.range(textStart, line.to));
        }
        if (onCursor) {
          // Raw, but indent like the rendered view (hide the literal leading
          // whitespace, drive indent from the same hanging-indent decoration) and
          // show the "- [ ]" marker in the mono font.
          deco.push(indentLine("cm-task", taskDepth).range(line.from));
          const indentLen = taskMatch[1].length;
          if (indentLen > 0) deco.push(hide.range(line.from, line.from + indentLen));
          deco.push(listMarkerMark.range(line.from + indentLen, line.from + taskMatch[0].length));
        } else {
          // Replace the WHOLE prefix (indent + marker + spaces + [x] + trailing space)
          // with the checkbox; the gutter + gap come from CSS, not the literal whitespace.
          deco.push(indentLine("cm-task", taskDepth).range(line.from));
          deco.push(Decoration.replace({ widget: new CheckboxWidget(status) }).range(line.from, line.from + taskMatch[0].length));
        }
      }

      // ---- bullet list lines ----
      // Thematic breaks (--- / *** / - - -) are handled + `continue`d above, so a line
      // reaching here is never one; only task lines need guarding off the bullet path.
      const bulletMatch = isTaskLine ? null : text.match(/^(\s*)([-*+])(\s+)/);
      if (bulletMatch) {
        const depth = indentDepth(bulletMatch[1]);
        if (onCursor) {
          // Raw, but indent like the rendered view and show the "- " marker in mono.
          deco.push(indentLine("cm-li", depth).range(line.from));
          const indentLen = bulletMatch[1].length;
          if (indentLen > 0) deco.push(hide.range(line.from, line.from + indentLen));
          deco.push(listMarkerMark.range(line.from + indentLen, line.from + bulletMatch[0].length));
        } else {
          // Replace the WHOLE prefix (indent + marker + spaces) with the bullet glyph
          // and drive indent + gap from CSS via the hanging-indent line decoration.
          deco.push(indentLine("cm-li", depth).range(line.from));
          deco.push(Decoration.replace({ widget: new BulletWidget(depth) }).range(line.from, line.from + bulletMatch[0].length));
        }
      }

      // inline HTML (<br>, <b>…</b>, <span style=…>…</span>, …): off the cursor
      // line each grouped span becomes a rendered widget; on it the raw tags dim.
      // Returns the covered spans so math (the other inline REPLACE) can skip them
      // — two overlapping replace decorations would throw.
      const htmlSpans = pushInlineHtml(deco, view.state, line.from, line.to, onCursor);
      const inHtmlSpan = (s: number, e: number) => htmlSpans.some((h) => s < h.to && e > h.from);

      // math: process $$...$$ (block) before $...$ (inline) — skip if cursor is on this line
      if (!onCursor) {
        // block math: $$...$$  (single-line, non-empty inner)
        const blockMathRe = /\$\$([^$]+)\$\$/g;
        for (const m of text.matchAll(blockMathRe)) {
          const s = line.from + (m.index ?? 0);
          const end = s + m[0].length;
          if (inHtmlSpan(s, end)) continue;
          const expr = m[1];
          deco.push(Decoration.replace({ widget: new MathWidget(expr, true) }).range(s, end));
        }

        // inline math: $...$ (not $$, at least one non-$ char inside)
        // negative lookbehind/ahead for $ to avoid matching $$
        // Render it display-STYLE (\displaystyle — full-size fractions/sums/limits, the
        // same typography as a $$ block) but still INLINE (displayMode:false → flows in the
        // text, no jarring centered line break mid-sentence). So `$\frac{a}{b}$` looks like
        // the block instead of the cramped default inline style. `\displaystyle` is a valid
        // KaTeX switch; throwOnError:false in renderMath shrugs off anything malformed.
        const inlineMathRe = /(?<!\$)\$([^$\n]+)\$(?!\$)/g;
        for (const m of text.matchAll(inlineMathRe)) {
          const s = line.from + (m.index ?? 0);
          const end = s + m[0].length;
          if (inHtmlSpan(s, end)) continue;
          const expr = `\\displaystyle ${m[1]}`;
          deco.push(Decoration.replace({ widget: new MathWidget(expr, false) }).range(s, end));
        }
      } else {
        // Cursor on this line → the $…$ / $$…$$ source shows raw (no widget), so
        // syntax-highlight the LaTeX (\commands, braces, ^/_, %comments, numbers) and dim
        // the $ delimiters the way revealed **/`` ` `` marks are dimmed. Mirrors the
        // off-cursor regexes so the same spans that would render as math get highlighted.
        for (const m of text.matchAll(/\$\$([^$]+)\$\$/g)) {
          const s = line.from + (m.index ?? 0);
          const end = s + m[0].length;
          if (inHtmlSpan(s, end)) continue;
          deco.push(syntaxMark.range(s, s + 2), syntaxMark.range(end - 2, end));
          for (const d of latexTokenDecorations(s + 2, m[1])) deco.push(d);
        }
        for (const m of text.matchAll(/(?<!\$)\$([^$\n]+)\$(?!\$)/g)) {
          const s = line.from + (m.index ?? 0);
          const end = s + m[0].length;
          if (inHtmlSpan(s, end)) continue;
          deco.push(syntaxMark.range(s, s + 1), syntaxMark.range(end - 1, end));
          for (const d of latexTokenDecorations(s + 1, m[1])) deco.push(d);
        }
      }

      // inline tokens
      pushInline(deco, text, line.from, onCursor, /\*\*([^*]+)\*\*/g, 2, strong);
      pushInline(deco, text, line.from, onCursor, /__([^_]+)__/g, 2, strong);
      pushInline(deco, text, line.from, onCursor, /(?<![*\w])\*(?!\*)([^*\n]+?)\*(?![*\w])/g, 1, em);
      pushInline(deco, text, line.from, onCursor, /~~([^~]+)~~/g, 2, strike);
      pushInline(deco, text, line.from, onCursor, /`([^`]+)`/g, 1, code);

      // markdown links [text](url): show text as a link, hide the brackets/url off the cursor line
      for (const m of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
        const s = line.from + (m.index ?? 0);
        const end = s + m[0].length;
        const textStart = s + 1, textEnd = s + 1 + m[1].length;
        deco.push(link.range(textStart, textEnd));
        if (!onCursor) {
          deco.push(hide.range(s, textStart));
          deco.push(hide.range(textEnd, end));
        } else {
          // Revealed: the `[`, `](url)` syntax renders in dim Monaspace.
          deco.push(syntaxMark.range(s, textStart));
          deco.push(syntaxMark.range(textEnd, end));
        }
      }

      // bare (inexplicit) URLs — a plain https://… typed without [text](url) syntax.
      // Style them as clickable links; nothing is hidden (the URL *is* the visible text).
      for (const { start, end } of findBareUrls(text)) {
        deco.push(link.range(line.from + start, line.from + end));
      }

      // wikilinks [[target#heading|alias]] — reveal only the basename (or alias).
      pushWikilinks(deco, text, line.from, onCursor);

      // body #hashtags — tint TEAL. Skipped on heading lines so heading "#"s
      // are never tinted (frontmatter/code/table lines already `continue` above).
      if (!hm) pushTags(deco, text, line.from);

      pos = line.to + 1;
    }
  }
  // sort=true: CodeMirror sorts the ranges (avoids manual add-order constraints)
  return Decoration.set(deco, true);
}

// --- code-block "edit mode" ---------------------------------------------------
// A code block normally renders its ``` fences hidden. It only reveals the raw
// source when the user double-clicks inside it OR starts typing in it; it
// collapses again as soon as the selection leaves that block. We track the
// "active" block by its opening-fence line number (or null) in editor state.
const setActiveCodeEffect = StateEffect.define<number | null>();

/** Find the fenced code block containing `lineNumber`, or null. */
function findCodeBlock(state: EditorState, lineNumber: number): { open: number; close: number } | null {
  const doc = state.doc;
  let open = -1;
  for (let i = 1; i <= doc.lines; i++) {
    if (/^\s*```/.test(doc.line(i).text)) {
      if (open === -1) {
        open = i;
      } else {
        if (lineNumber >= open && lineNumber <= i) return { open, close: i };
        open = -1;
      }
    }
  }
  return null;
}

const activeCodeField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    // Explicit request (double-click) wins.
    for (const e of tr.effects) if (e.is(setActiveCodeEffect)) return e.value;
    const head = tr.state.selection.main.head;
    const block = findCodeBlock(tr.state, tr.state.doc.lineAt(head).number);
    // Typing inside a block reveals it.
    if (tr.docChanged) return block ? block.open : null;
    // Selection-only move: stay revealed only while still inside the active block;
    // a single click into a different/rendered block does NOT reveal it.
    if (tr.selection) return block && block.open === value ? value : null;
    return value;
  },
});

// Block-level decorations (here: the editable <table> widget that replaces a whole
// table block) MUST be provided by a StateField — CodeMirror forbids block decorations
// from a ViewPlugin. We rebuild this set whenever the doc changes, the selection moves,
// or the active (raw) table changes (all of which can flip a block between rendered and
// raw). Each non-active table block is replaced by one TableWidget spanning its source.
function buildTableWidgets(state: EditorState): DecorationSet {
  const doc = state.doc;
  const activeOpen = state.field(activeTableField, false) ?? null;
  const notePath = state.facet(notePathFacet);
  const { blocks } = groupTableBlocks(doc);
  const deco: Range<Decoration>[] = [];
  for (const b of blocks) {
    if (b.startLine === activeOpen) continue;
    const from = doc.line(b.startLine).from;
    const to = doc.line(b.endLine).to;
    deco.push(Decoration.replace({ widget: new TableWidget(b.cells, b.aligns, notePath), block: true }).range(from, to));
  }
  return Decoration.set(deco, true);
}

const tableWidgetField = StateField.define<DecorationSet>({
  create: (state) => buildTableWidgets(state),
  update(value, tr) {
    const activeChanged = tr.effects.some((e) => e.is(setActiveTableEffect));
    if (tr.docChanged || tr.selection || activeChanged) return buildTableWidgets(tr.state);
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const livePreview = [
  activeCodeField,
  activeTableField,
  tableWidgetField,
  htmlBlockField,
  codeLineNumberTheme,
  EditorView.domEventHandlers({
    dblclick: (e, view) => {
      const pos = view.posAtCoords({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
      if (pos == null) return false;
      const block = findCodeBlock(view.state, view.state.doc.lineAt(pos).number);
      if (!block) return false;
      view.dispatch({ effects: setActiveCodeEffect.of(block.open) });
      return false; // let the default word-selection happen too
    },
    mousedown: (e, view) => {
      const target = e.target as HTMLElement;
      // Left-click only for the toggle. A right-click also fires mousedown (button 2) — without
      // this guard it would toggle the task BEFORE the contextmenu handler reads its status.
      // When that right-click lands on a checkbox, also preventDefault so the browser doesn't
      // place the caret on that line (which would move the cursor + reveal the raw source);
      // the status menu then opens without disturbing the cursor.
      if ((e as MouseEvent).button !== 0) {
        if (target.closest(".cm-task-checkbox")) e.preventDefault();
        return false;
      }
      // Click a rendered HTML block → drop the cursor into it so it reveals raw
      // source for editing (the field collapses the widget while the cursor is
      // inside). Ignore clicks on links inside it (let them navigate).
      const htmlBlock = target.closest(".cm-html-block") as HTMLElement | null;
      if (htmlBlock && !target.closest("a")) {
        const from = Number(htmlBlock.getAttribute("data-from"));
        if (Number.isFinite(from)) {
          e.preventDefault();
          view.dispatch({ selection: { anchor: from } });
          view.focus();
          return true;
        }
      }
      const box = target.closest(".cm-task-checkbox");
      if (!box) return false;
      e.preventDefault(); // keep cursor put so the line stays in preview mode
      // posAtDOM returns the replace-widget's anchor (markerStart), which is enough to identify the line.
      const pos = view.posAtDOM(box as HTMLElement);
      const line = view.state.doc.lineAt(pos);
      const m = line.text.match(/^(\s*[-*+]\s+\[)([ xX/\\-])(\])/);
      if (!m) return false;
      const innerPos = line.from + m[1].length;
      // Clicking only toggles done ⇄ not-done. In-progress ([/]) and cancelled ([-])
      // are set via the right-click status menu (contextmenu handler below).
      const next = (m[2] === "x" || m[2] === "X") ? " " : "x";
      view.dispatch({ changes: { from: innerPos, to: innerPos + 1, insert: next } });
      return true;
    },
    // Right-click a checkbox → status menu (To do / In progress / Done / Cancelled, current
    // omitted). Edits the box char in-buffer (the editor persists it), so it round-trips every
    // status — unlike the click toggle, which only flips done ⇄ todo.
    contextmenu: (e, view) => {
      const target = e.target as HTMLElement;
      const box = target.closest(".cm-task-checkbox");
      if (!box) return false; // not a checkbox — let the normal (pane) context menu handle it
      const pos = view.posAtDOM(box as HTMLElement);
      const line = view.state.doc.lineAt(pos);
      const m = line.text.match(/^(\s*[-*+]\s+\[)([ xX/\\-])(\])/);
      if (!m) return false;
      const innerPos = line.from + m[1].length;
      e.preventDefault();
      e.stopPropagation(); // don't also open the pane's context menu
      openTaskStatusMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY, m[2], (char) => {
        view.dispatch({ changes: { from: innerPos, to: innerPos + 1, insert: char } });
      });
      return true;
    },
  }),
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** Cached block-region sets — recomputed only when the document changes. */
      private blockRegions: BlockRegions;

      constructor(view: EditorView) {
        this.blockRegions = computeBlockRegions(view.state.doc);
        this.decorations = buildDecorations(view, this.blockRegions);
      }

      update(u: ViewUpdate) {
        const activeChanged =
          u.startState.field(activeCodeField, false) !== u.state.field(activeCodeField, false) ||
          u.startState.field(activeTableField, false) !== u.state.field(activeTableField, false);
        if (u.docChanged || u.viewportChanged || u.selectionSet || activeChanged) {
          // Refresh the block-region cache only when document content changes.
          // On selectionSet / viewportChanged alone, reuse the cached sets —
          // the per-line decoration pass (which handles cursor-line reveal) still runs every time.
          if (u.docChanged) {
            this.blockRegions = computeBlockRegions(u.view.state.doc);
          }
          this.decorations = buildDecorations(u.view, this.blockRegions);
        }
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.theme({
    ".cm-hidden-syntax": { display: "none" },
    ".cm-strong": { "font-weight": "bold" },
    ".cm-em": { "font-style": "italic" },
    ".cm-strike": { "text-decoration": "line-through", opacity: "0.7" },
    // Monaspace renders visually larger than Lora at the same px; the --mono-scale
    // factor (settings: appearance.monoScale, default 0.85) makes mono code optically
    // match the surrounding serif body. This is an OPTICAL correction for mono-next-to-
    // serif, so it lives only where mono sits inside prose (code regions here + the
    // flashcard .card-md code in App.css) — NOT on the all-mono UI chrome, which has no
    // serif to match. Keep all mono regions (inline code, blocks, frontmatter, tables) on it.
    // Inline code + the same inline-code marks rendered inside a table cell (inlineMarkdown.ts
    // emits a native <code>): byte-identical styling, so they share one rule.
    ".cm-inline-code, .cm-table-rendered code": { "font-family": MONO_FONT, "font-size": "calc(1em * var(--mono-scale, 0.85))", background: "rgba(140,140,140,0.18)", padding: "0 3px", "border-radius": "3px" },
    // Links + wikilinks: accent with a SOFT underline (a faint accent rule that
    // sits below the text) rather than a hard text-decoration line.
    ".cm-link": { color: "var(--accent)", cursor: "pointer", "text-decoration": "none", "border-bottom": "1px solid var(--accent-soft)" },
    ".cm-wikilink": { color: "var(--accent)", cursor: "pointer", "text-decoration": "none", "border-bottom": "1px solid var(--accent-soft)" },
    // Body #hashtags read teal (design §1: prose tags use --teal).
    ".cm-tag": { color: "var(--teal)", "font-family": MONO_FONT },
    // Revealed heading `#`s: mono accent (matches the inline note-title hash),
    // weight 500, so the syntax never renders in the serif heading face.
    // Revealed markdown delimiters (heading `#`, `**`, `*`, `` ` ``, `>`, link/
    // wikilink brackets, frontmatter `---`) render in normal-text-color Monaspace.
    // Only the inline note-title `#` is accented; in-editor syntax is not.
    // The `> span` rules also style the inner markdown-highlighter token span
    // (e.g. `<span class="cm-heading-mark"><span class="ͼ…">#</span></span>`),
    // which would otherwise override the color/font with its own token color.
    ".cm-heading-mark, .cm-heading-mark > span": { "font-family": MONO_FONT, color: "var(--fg)", "font-weight": "500" },
    ".cm-syntax-mark, .cm-syntax-mark > span": { "font-family": MONO_FONT, color: "var(--fg)" },
    // Serif headings (design: title 600 with tight tracking; h2 ≈ 20px/1.5em serif).
    ".cm-h1": { "font-size": "1.94em", "font-weight": "600", "line-height": "1.1", "letter-spacing": "-0.015em" },
    ".cm-h2": { "font-size": "1.5em", "font-weight": "600", "line-height": "1.25", "letter-spacing": "-0.01em" },
    ".cm-h3": { "font-size": "1.3em", "font-weight": "600" },
    ".cm-h4": { "font-size": "1.15em", "font-weight": "600" },
    ".cm-h5": { "font-size": "1.05em", "font-weight": "600" },
    ".cm-h6": { "font-size": "1em", "font-weight": "600", opacity: "0.85" },
    ".cm-quote": { "border-left": "3px solid #555", "padding-left": "8px", opacity: "0.85" },
    // Rendered horizontal rule: the line's dashes are hidden, so draw a centered rule
    // via a pseudo-element. Theme-agnostic grey (matches inline-code's neutral tint).
    ".cm-hr": { position: "relative", height: "1.2em" },
    ".cm-hr::before": { content: '""', position: "absolute", left: "0", right: "0", top: "calc(50% - 1px)", "border-top": "2px solid rgba(140,140,140,0.45)" },
    ".cm-li": { "padding-left": "2px", "line-height": "1.55" },
    // Bullet glyph sits in the hanging gutter (right-aligned, with a fixed gap to the text).
    ".cm-bullet": {
      display: "inline-block",
      width: "1.6em",
      "box-sizing": "border-box",
      "text-align": "right",
      "padding-right": "0.62em",
      color: "color-mix(in srgb, var(--fg) 50%, transparent)",
    },
    // Code blocks: no background; just monospace text with a faint left rule. The ``` fences
    // are hidden off-cursor (replaced by a header + collapsed close line).
    ".cm-codeblock": { "font-family": MONO_FONT, "font-size": "calc(1em * var(--mono-scale, 0.85))", "line-height": "1.5" },
    // In-block line numbers (`.cm-code-numbered`) are styled by `codeLineNumberTheme`
    // (codeLineNumbers.ts), shared with the ```query source view.
    ".cm-code-headerline": { "font-family": MONO_FONT },
    ".cm-code-hidden": { "font-size": "0", "line-height": "0" },
    ".cm-collapsed-line": { "font-size": "0", "line-height": "0" },
    ".cm-code-headerwrap": { display: "block", width: "100%" },
    ".cm-code-header": {
      display: "flex",
      width: "100%",
      "justify-content": "space-between",
      "align-items": "center",
      "font-size": "0.78em",
    },
    ".cm-code-lang": {
      "font-family": MONO_FONT,
      color: "color-mix(in srgb, var(--fg) 42%, transparent)",
      "letter-spacing": "0.04em",
    },
    // The copy button is an <IconButton> (.btn.btn--icon), which already supplies the
    // browser-reset chrome (background:transparent, border:none, cursor:pointer); only the
    // genuinely-overriding props live here.
    ".cm-code-copy": {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      color: "color-mix(in srgb, var(--fg) 45%, transparent)",
      padding: "2px",
      opacity: "0.8",
      transition: "color 120ms, opacity 120ms",
    },
    ".cm-code-copy:hover": { color: "var(--accent)", opacity: "1" },
    // Frontmatter (.fm in the redesign): a raised --surface-2 band with a 2px
    // accent left bar (via inset shadow, so no text shift), keeping the text and
    // validation squiggles at full strength. Keys render in --accent, values in
    // --fg, the `---` delimiters dim (see codeHighlight / markdown tokens).
    ".cm-frontmatter": {
      "font-family": MONO_FONT,
      "font-size": "calc(1em * var(--mono-scale, 0.85))",
      // No surface fill — just the accent left rule + monospace, matching fenced code
      // blocks. A line background sits ABOVE CodeMirror's selection layer, so any fill
      // (even translucent) hides the selection where it starts in the frontmatter,
      // making a code-block→body drag look only half-highlighted.
      "box-shadow": "inset 2px 0 0 var(--accent)",
    },
    ".cm-fm-key": { color: "var(--accent)" },
    // Raw (active) table source — monospace pipes for structural / power edits.
    ".cm-table": { "font-family": MONO_FONT, "font-size": "calc(1em * var(--mono-scale, 0.85))" },
    // Rendered editable table (the block-replace widget). Cells are contenteditable.
    // `fit-content` so the wrap hugs the table — the hover toolbar then aligns to the
    // table's top-right corner instead of floating off in the full-width line box.
    ".cm-table-wrap": { position: "relative", width: "fit-content", "max-width": "100%", margin: "0.6em 0 1.4em 0" },
    ".cm-table-rendered": { "border-collapse": "collapse", "table-layout": "auto" },
    ".cm-table-rendered th, .cm-table-rendered td": {
      border: "1px solid color-mix(in srgb, var(--fg) 18%, transparent)",
      padding: "0.32em 0.6em",
      "text-align": "left",
      "vertical-align": "top",
      "line-height": "1.5",
      "min-width": "2.5em",
    },
    ".cm-table-rendered th": { "font-weight": "600", background: "var(--surface-2)" },
    // Inline markdown rendered INSIDE a cell's display face (see inlineMarkdown.ts).
    // `marked` emits native <code>/<a>/<del>; mirror the prose inline-mark styling so a
    // cell looks the same as the same marks elsewhere in the editor. <strong>/<em> use
    // the browser defaults (bold / italic), and wikilinks reuse the `.cm-wikilink` rule.
    // The cell <code> shares the `.cm-inline-code` rule above (identical styling).
    ".cm-table-rendered a": { color: "var(--accent)", "text-decoration": "none", "border-bottom": "1px solid var(--accent-soft)" },
    ".cm-table-rendered del": { opacity: "0.7" },
    ".cm-td:focus": { outline: "none", "box-shadow": "inset 0 0 0 2px var(--accent)", "border-radius": "2px" },
    // `+` edge bars: a thin add-column bar just off the right border and an add-row bar
    // just below the bottom border. Faint, fade in on hover, accent on their own hover.
    ".cm-table-edge": {
      position: "absolute",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      padding: "0",
      color: "color-mix(in srgb, var(--fg) 45%, transparent)",
      background: "color-mix(in srgb, var(--fg) 6%, transparent)",
      border: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
      cursor: "pointer",
      "font-family": MONO_FONT,
      "font-size": "0.85em",
      "line-height": "1",
      opacity: "0",
      transition: "opacity 120ms, background 120ms, color 120ms",
    },
    ".cm-table-wrap:hover .cm-table-edge": { opacity: "1" },
    ".cm-table-edge:hover": { background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--accent)" },
    // Add-column: full-height bar hugging the right border. Add-row: full-width bar under it.
    ".cm-table-add-col": { top: "0", bottom: "0", right: "-0.95em", width: "0.8em", "border-radius": "0 5px 5px 0" },
    ".cm-table-add-row": { left: "0", right: "0", bottom: "-0.95em", height: "0.8em", "border-radius": "0 0 5px 5px" },
    // Drag-to-resize: an absolutely-positioned overlay of thin grab strips centered on
    // each column/row border. Pointer-transparent except the strips, invisible until a
    // strip is hovered (then a faint accent fill cues the resize zone).
    ".cm-table-overlay": { position: "absolute", top: "0", right: "0", bottom: "0", left: "0", "pointer-events": "none", "z-index": "4" },
    ".cm-col-resize": { position: "absolute", width: "7px", transform: "translateX(-50%)", cursor: "col-resize", "pointer-events": "auto" },
    ".cm-row-resize": { position: "absolute", height: "7px", transform: "translateY(-50%)", cursor: "row-resize", "pointer-events": "auto" },
    ".cm-col-resize:hover, .cm-row-resize:hover": { background: "color-mix(in srgb, var(--accent) 35%, transparent)" },
    ".cm-task": { "padding-left": "2px", "line-height": "1.55" },
    // Checkbox sits in the same hanging gutter as bullets, right-aligned with a fixed gap.
    ".cm-checkbox": {
      display: "inline-block",
      width: "1.6em",
      "box-sizing": "border-box",
      "text-align": "right",
      "padding-right": "0.5em",
    },
    // Custom checkbox. The box + three glyph layers (check / slash / dash) all
    // transition on data-status change; updateDOM() keeps the node alive so the
    // CSS transitions actually animate when you click. Click toggles done⇄todo;
    // doing/cancelled are display-only (set by typing [/] or [-]).
    ".cm-task-checkbox": {
      display: "inline-block",
      position: "relative",
      width: "1.08em",
      height: "1.08em",
      "box-sizing": "border-box",
      border: "1.5px solid color-mix(in srgb, var(--fg) 34%, transparent)",
      "border-radius": "0.32em",
      "vertical-align": "-0.18em",
      background: "transparent",
      cursor: "pointer",
      transition: "background 160ms ease, border-color 160ms ease",
    },
    ".cm-task-checkbox:hover": { "border-color": "color-mix(in srgb, var(--accent) 70%, transparent)" },
    ".cm-task-checkbox[data-status='done']": { background: "var(--accent)", "border-color": "var(--accent)", color: "#fff" },
    ".cm-task-checkbox[data-status='doing']": { "border-color": "var(--accent-purple)" },
    ".cm-task-checkbox[data-status='cancelled']": { "border-color": "color-mix(in srgb, var(--fg) 28%, transparent)", opacity: "0.65" },
    // Glyph layers all overlap and self-center (flex over inset:0); the theme fades
    // in the one matching data-status. The check is a Lucide <Icon>; the slash and
    // dash are CSS bars (their ::before is the flex-centered shape).
    ".cm-ck-glyph": {
      position: "absolute",
      inset: "0",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      opacity: "0",
      transform: "scale(0.55)",
      transition: "opacity 150ms ease, transform 150ms ease",
      "pointer-events": "none",
    },
    ".cm-task-checkbox[data-status='done'] .cm-ck-check": { opacity: "1", transform: "scale(1)" },
    ".cm-task-checkbox[data-status='doing'] .cm-ck-slash": { opacity: "1", transform: "scale(1)" },
    ".cm-task-checkbox[data-status='cancelled'] .cm-ck-dash": { opacity: "1", transform: "scale(1)" },
    ".cm-ck-slash::before": {
      content: "''",
      width: "0.13em",
      height: "0.66em",
      "border-radius": "0.07em",
      background: "var(--accent-purple)",
      transform: "rotate(45deg)",
    },
    ".cm-ck-dash::before": {
      content: "''",
      width: "0.5em",
      height: "0.13em",
      "border-radius": "0.07em",
      background: "color-mix(in srgb, var(--fg) 60%, transparent)",
    },
    ".cm-task-done": { "text-decoration": "line-through", opacity: "0.55", color: "color-mix(in srgb, var(--fg) 52%, transparent)" },
    // Raw "- " / "- [ ]" marker on the cursor line, shown in the mono font.
    ".cm-list-marker": { "font-family": MONO_FONT },
    ".cm-math": { display: "inline-block", "vertical-align": "middle" },
    ".cm-math .katex-display": { "text-align": "left", margin: "0.4em 0" },
    // Rendered raw HTML. Inline spans flow with the prose; block elements get a
    // little breathing room. Images stay responsive. Links inherit the editor's
    // accent link styling. Both are sanitized before injection (sanitizeHtml.ts).
    ".cm-html-inline": { "white-space": "normal" },
    ".cm-html-block": { margin: "0.4em 0", "line-height": "1.55" },
    ".cm-html-inline img, .cm-html-block img": { "max-width": "100%", height: "auto" },
    ".cm-html-inline a, .cm-html-block a": { color: "var(--accent)", "text-decoration": "none", "border-bottom": "1px solid var(--accent-soft)" },
    ".cm-diagnostic-error": { "border-left": "3px solid #e5484d" },
    ".cm-diagnostic-warning": { "border-left": "3px solid #f5a623" },
    // Squiggles are colored by CATEGORY (via each diagnostic's markClass), not by
    // severity — so the severity-based cm-lintRange backgrounds are neutralized and
    // the smooth pastel sine wave is drawn per mark: red=spelling, blue=grammar,
    // purple=properties/settings (3rd-brain).
    ".cm-lintRange-error": { background: "none" },
    ".cm-lintRange-warning": { background: "none" },
    ".cm-lintRange-info": { background: "none" },
    ".spell-mark": { "background": "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"4\"><path d=\"M0 3 Q2 1 4 3 T8 3\" fill=\"none\" stroke=\"%23ff9ea0\" stroke-width=\"1.1\"/></svg>') left bottom repeat-x" },
    ".grammar-mark": { "background": "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"4\"><path d=\"M0 3 Q2 1 4 3 T8 3\" fill=\"none\" stroke=\"%238fb4ff\" stroke-width=\"1.1\"/></svg>') left bottom repeat-x" },
    ".property-mark": { "background": "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"4\"><path d=\"M0 3 Q2 1 4 3 T8 3\" fill=\"none\" stroke=\"%23b89cff\" stroke-width=\"1.1\"/></svg>') left bottom repeat-x" },
  }),
];
