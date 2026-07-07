// app/src/editor/livePreview.ts
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { type Range, StateField, StateEffect, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { createSignal, type Setter } from "solid-js";
import { render } from "solid-js/web";
import { renderMath, onMathReady } from "./katexLoader";
import { latexTokenDecorations, mathSrcMark } from "./latexHighlight";
import { mathField } from "./mathBlock";
import { wikilinkVisibleRange } from "./wikilink";
import { findBareUrls } from "./urls";
import { TaskCheckbox, charToStatus, type TaskStatus } from "./TaskCheckbox";
import { reorderAroundLine } from "./taskFold";
import { openTaskStatusMenu } from "../taskStatusMenu";
import { LIST_STEP } from "./listLayout";
import { CodeHeader } from "./CodeHeader";
import { groupTableBlocks } from "./tableModel";
import { TableWidget } from "./tableWidget";
import { activeTableField, notePathFacet, setActiveTableEffect } from "./tableState";
import { htmlBlockField, pushInlineHtml } from "./htmlPreview";
import { numberedLine, codeLineNumberTheme } from "./codeLineNumbers";
import { isThematicBreak } from "./thematicBreak";
import { renderCalloutHtml, CALLOUT_TYPES, type CalloutHeader } from "./callout";
import { renderNoteBody, renderInline } from "../bases/markdown";
import { findBismuthWords } from "./bismuthWord";
import { sanitizeHtml } from "../sanitizeHtml";
import { computeBlockRegions, scanCalloutLineBlocks, FENCE_RE, type BlockRegions } from "./blockRegions";

// The editor's mono face: Monaspace Xenon, falling back to the platform ui-monospace.
// Shared across every mono region in the live-preview theme (and reused by embedBlock).
export const MONO_FONT = "'Monaspace Xenon', ui-monospace, monospace";

// List nesting depth read from the parse tree, not the raw space count, so it's right
// regardless of how wide each indent step is (2 spaces in legacy notes, 4 in new ones, a
// child clearing a `1. ` marker, …). `pos` should sit on the line's marker. Depth is the
// count of enclosing ListItems minus the item itself (top-level = 0). For legacy 2-space
// notes this equals the old floor(cols/2), so their rendering is unchanged.
// Derive the parse-node type from syntaxTree's return so we don't depend on @lezer/common
// being a direct dependency (it's only present transitively).
type ParseNode = NonNullable<ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>["parent"]>;
// Visual nesting depth for a list line. Structural (parse-tree) depth handles normal
// nesting and keeps legacy 2-space + new 4-space notes correct. But a first/sole item
// indented with no parent to nest under is structurally depth 0, so Tab on it would be
// invisible — fall back to the raw indent (one level per 4-col Tab) so an indent always
// shows. max() never lowers a properly-nested item's depth: for 2-space content
// structural (cols/2) ≥ raw (cols/4), so legacy rendering is unchanged.
function listDepth(state: EditorState, pos: number, indent: string): number {
  let count = 0;
  for (let n: ParseNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "ListItem") count++;
  }
  const structural = Math.max(0, count - 1);
  const raw = Math.floor(indent.replace(/\t/g, "    ").length / 4);
  return Math.max(structural, raw);
}

const hide = Decoration.mark({ class: "cm-hidden-syntax" });
const strong = Decoration.mark({ class: "cm-strong" });
const em = Decoration.mark({ class: "cm-em" });
const strike = Decoration.mark({ class: "cm-strike" });
const code = Decoration.mark({ class: "cm-inline-code" });
const link = Decoration.mark({ class: "cm-link" });
const wikilink = Decoration.mark({ class: "cm-wikilink" });
const tag = Decoration.mark({ class: "cm-tag" });
// Every whole-word "bismuth" in prose gets the iridescent bismuth-crystal gradient
// (styled by `.cm-bismuth` in App.css, shared with the reading-mode `.bismuth-word`).
const bismuthWord = Decoration.mark({ class: "cm-bismuth" });
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
// A code-block / frontmatter body line carries its 1-based in-block line number via
// `numberedLine` (shared with queryBlock); CSS draws it in the left gutter through
// `.cm-code-numbered::before { content: attr(data-codeline) }` (codeLineNumbers.ts).
// Bug #10 (4th round — a SPEC CHANGE, not a bug): rounds 2-3 tried a hairline edge, then a full
// rounded-corner bordered CARD spanning every line of a frontmatter panel / fenced code block (grey
// fill + left accent + right edge on every line, top/bottom rounding on the fences). The user saw
// round 3 in their real app and dialed it back: "just the --- lines should have a dark grey
// background, while the rest should have the background as before... this should apply to the left
// line as well." So now ONLY the fence line itself (frontmatter's opening/closing `---`, a code
// block's opening/closing ```) gets any chrome at all — a single self-contained grey bar (fill +
// left accent edge, rounded on all four corners since it no longer joins a taller card). Body lines
// revert to plain text: no fill, no left/right edge, nothing — see `.cm-frontmatter`/`.cm-codeblock`
// below, which now carry ONLY font/size, no box-shadow. `cm-fence-bar` is the one class used for
// every fence line (open AND close — both render identically now that there's no card roof/floor to
// distinguish). Colors are `color-mix` off `var(--fg)` (never accent) so the bar reads correctly,
// and never washes out, on light AND dark themes. The left edge is an INSET box-shadow (not a real
// CSS `border`), so nothing shifts the text layout. This class is ALWAYS applied — never keyed off
// cursor/reveal state — so the bar never flickers when the caret enters or leaves the block; only
// the raw fence text (the `---`/backticks) brightens for editing when the caret is on that line.
const fenceBar = Decoration.line({ class: "cm-fence-bar" });
// The fence text itself (frontmatter `---`, a code block's closing ```) renders ALWAYS VISIBLE in
// very dim mono — never `display:none`-hidden. Two reasons: (1) the original #10 ask, pixel-matched
// by the user's reference: the em dashes are faintly visible INSIDE the bar; (2) load-bearing
// layout — a fully-hidden line collapses to zero height, which erased the `cm-fence-bar`'s rounded
// corners (the bar looked cut off). On the caret line the fence brightens to `cm-syntax-mark`.
const fenceMark = Decoration.mark({ class: "cm-fence-syntax" });
const fmKeyMark = Decoration.mark({ class: "cm-fm-key" });
const tableLine = Decoration.line({ class: "cm-table" });
// A body-level `---` / `***` / `___` thematic break: off the cursor line the literal
// dashes hide and CSS draws a horizontal rule; on it the raw markers show (mono).
const hrLine = Decoration.line({ class: "cm-hr" });

// Regex literals evaluated per visible line by buildDecorations() and its helpers
// (pushInline/pushWikilinks/pushMarkdownLinks/pushTags/computeBlockRegions/findCodeBlock).
// Hoisted to module scope so a fresh RegExp isn't allocated for every visible line on
// every keystroke/cursor-move/viewport change. Source + flags are unchanged from their
// former inline literals; every use below is via .match()/.matchAll()/.test()/.exec(),
// none of which leak lastIndex state across calls for these patterns.
const HEADING_RE = /^(#{1,6})\s+/;
const BLOCKQUOTE_RE = /^>\s?/;
const TASK_LINE_RE = /^(\s*)([-*+])(\s+)\[([ xX/\\-])\](\s)/;
const BULLET_LINE_RE = /^(\s*)([-*+])(\s+)/;
const ORDERED_LINE_RE = /^(\s*)(\d+)([.)])(\s+)/;
const BLOCK_MATH_RE = /\$\$([^$]+)\$\$/g;
const INLINE_MATH_RE = /(?<!\$)\$([^$\n]+)\$(?!\$)/g;
const INLINE_CODE_RE = /(`+)((?:(?!\1)[^\n])*?)\1/g;
const FM_KEY_RE = /^(\s*)([A-Za-z0-9_$.-]+)\s*:/;
const STRONG_STAR_RE = /\*\*([^*]+)\*\*/g;
const STRONG_UNDERSCORE_RE = /__([^_]+)__/g;
const EM_RE = /(?<![*\w])\*(?!\*)([^*\n]+?)\*(?![*\w])/g;
const STRIKE_RE = /~~([^~]+)~~/g;
const WIKILINK_RE = /(?<!!)\[\[([^\]]+?)\]\]/g;
const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const TAG_RE = /(^|\s)(#[\p{L}\d/_-]+)/gu;
// Fenced-code-fence detection (FENCE_RE) is imported from ./blockRegions, shared with
// computeBlockRegions() (open + close) there and findCodeBlock() below.

// Notion-style hanging indent for lists. Off the cursor line we replace the whole
// list prefix (indent + marker + spaces) with a single widget and drive ALL spacing
// from CSS instead of the literal markdown whitespace: the text sits at (depth+1)*STEP
// from the margin and the bullet/checkbox hangs in a GUTTER-wide column to its left.
// This keeps the marker→text gap and per-level indent consistent regardless of how the
// source happens to be spaced.
// em added to the text indent per nesting level (shared leaf — see ./listLayout).
const LIST_GUTTER = LIST_STEP; // em — width of the marker gutter (== one step, so text aligns)
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
// Depth-varied glyph alternates by parity: even depth → • (filled), odd depth → ◦ (hollow)
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
    const glyph = this.depth % 2 === 0 ? "•" : "◦";
    span.textContent = glyph;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// Ordered-list marker ("1." / "2)" …). Same hanging gutter as BulletWidget so numbered
// and bulleted lists share identical spacing — only the glyph differs (the real number
// stays visible). The min-width keeps single/double digits in the bullet gutter while
// letting bigger numbers grow rather than overlap the text.
class OrderedWidget extends WidgetType {
  constructor(private readonly marker: string, private readonly depth: number) {
    super();
  }

  eq(other: OrderedWidget): boolean {
    return other.marker === this.marker && other.depth === this.depth;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ol-number";
    span.textContent = this.marker;
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
    // Display math ($$…$$) needs a full-width block wrapper so KaTeX's equation tags /
    // auto-numbers (\tag, numbered align/equation) can sit at the right margin instead of
    // overlapping the equation; inline math ($…$) stays inline-block.
    span.className = this.displayMode ? "cm-math cm-math-display" : "cm-math";
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
  deco: Range<Decoration>[], text: string, lineFrom: number, reveals: (from: number, to: number) => boolean,
  re: RegExp, markLen: number, mark: Decoration, skip?: (from: number, to: number) => boolean,
) {
  for (const m of text.matchAll(re)) {
    const s = lineFrom + (m.index ?? 0);
    const end = s + m[0].length;
    // Skip tokens overlapping a protected span (e.g. inline/block math): markdown
    // emphasis must never touch `*`/`_`/`~` that live inside `$…$` (those are LaTeX).
    if (skip && skip(s, end)) continue;
    // Reveal raw syntax only when the caret/selection touches THIS token — not the
    // whole line. So `**bold** *italic*` reveals only the span the cursor is inside.
    const onCursor = reveals(s, end);
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
function pushWikilinks(deco: Range<Decoration>[], text: string, lineFrom: number, reveals: (from: number, to: number) => boolean) {
  // `(?<!!)` skips EMBEDS (`![[...]]`) — they're rendered by embedBlock, not styled as
  // links here (mirrors the graph's extractWikilinks exclusion in core/src/wikilinks.ts).
  for (const m of text.matchAll(WIKILINK_RE)) {
    const s = lineFrom + (m.index ?? 0);
    const end = s + m[0].length;
    // Per-token reveal: only the wikilink the caret touches shows its brackets/path.
    const onCursor = reveals(s, end);
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

/** Style each markdown link `[text](url)` on a line — showing the link text and hiding the
 *  `[`, `](url)` syntax off the cursor line (revealed in dim Monaspace when the caret touches
 *  it). Used for both body and frontmatter lines so links in properties read as links.
 *  Click handling (open the URL) lives in Editor.tsx. */
function pushMarkdownLinks(deco: Range<Decoration>[], text: string, lineFrom: number, reveals: (from: number, to: number) => boolean) {
  for (const m of text.matchAll(MD_LINK_RE)) {
    const s = lineFrom + (m.index ?? 0);
    const end = s + m[0].length;
    const onCursor = reveals(s, end);
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
}

/** Style each bare (inexplicit) URL — a plain `https://…` typed without `[text](url)`
 *  syntax — as a clickable link. Nothing is hidden (the URL *is* the visible text). Shared
 *  by body and frontmatter lines; click handling lives in Editor.tsx. */
function pushBareUrls(deco: Range<Decoration>[], text: string, lineFrom: number) {
  for (const { start, end } of findBareUrls(text)) {
    deco.push(link.range(lineFrom + start, lineFrom + end));
  }
}

/** Tint body `#tag` spans (incl. the leading `#`) in --teal. A tag is `#` at
 *  start-of-line or after whitespace + tag chars (letters/digits/`/`/`_`/`-`). The
 *  mark only colors text and hides nothing, so the cursor-line reveal stays consistent
 *  with raw source either way. Heading `#`s never match (callers skip heading lines). */
function pushTags(deco: Range<Decoration>[], text: string, lineFrom: number) {
  for (const m of text.matchAll(TAG_RE)) {
    const tagStart = lineFrom + (m.index ?? 0) + m[1].length;
    deco.push(tag.range(tagStart, tagStart + m[2].length));
  }
}

/** Style every whole-word "bismuth" on a body line with the iridescent gradient — skipping any
 *  occurrence that overlaps a protected span (inline code, math, raw-HTML, markdown links, bare
 *  URLs, wikilinks, or a #tag) so the effect never lands inside code / URLs / wikilinks. `math`
 *  and `html` spans are already computed by the caller; the rest are re-scanned here with the same
 *  module regexes the per-line pass uses (cheap — viewport-gated, only when the line has a match). */
function pushBismuth(
  deco: Range<Decoration>[], text: string, lineFrom: number,
  math: { from: number; to: number }[], html: { from: number; to: number }[],
) {
  const words = findBismuthWords(text);
  if (words.length === 0) return;
  const prot: { from: number; to: number }[] = [...math, ...html];
  const add = (a: number, len: number) => prot.push({ from: lineFrom + a, to: lineFrom + a + len });
  for (const m of text.matchAll(INLINE_CODE_RE)) add(m.index ?? 0, m[0].length);
  for (const m of text.matchAll(WIKILINK_RE)) add(m.index ?? 0, m[0].length);
  for (const m of text.matchAll(MD_LINK_RE)) add(m.index ?? 0, m[0].length);
  for (const { start, end } of findBareUrls(text)) add(start, end - start);
  for (const m of text.matchAll(TAG_RE)) add((m.index ?? 0) + m[1].length, m[2].length);
  for (const w of words) {
    const from = lineFrom + w.from, to = lineFrom + w.to;
    if (prot.some((p) => from < p.to && p.from < to)) continue;
    deco.push(bismuthWord.range(from, to));
  }
}

// `CodeBlock`, `BlockRegions`, `CalloutLineBlock`, `scanCalloutLineBlocks`, and
// `computeBlockRegions` live in `./blockRegions` (a pure, DOM/JSX-free module) so the block-region
// scan — which decides exactly which lines are a block's opening/closing fence vs. its body — is
// unit-testable under `bun test` without mounting a real `EditorView` (see `blockRegions.test.ts`
// and the import comment there for why that split was necessary).

/** Run the per-visible-line decoration pass using pre-computed block regions.
 *  This is cheap: it only iterates view.visibleRanges and must run on every
 *  update (including cursor moves) so that the cursor-line reveal stays correct. */
function buildDecorations(view: EditorView, regions: BlockRegions): DecorationSet {
  const { frontmatterLines, frontmatterOpen, frontmatterClose, tableBlockByLine, codeBlockByLine, htmlBlockLines, calloutBlockByLine } = regions;
  const deco: Range<Decoration>[] = [];
  const doc = view.state.doc;
  // Lines touched by any selection range. A line "reveals" its raw markdown (instead
  // of the rendered live-preview) when the cursor is on it OR when it falls inside a
  // selection — so highlighting text exposes its markdown across the whole range, not
  // just the caret line. Spans are precomputed per range (cheap) to avoid a doc.lineAt
  // per visible line.
  // An UNFOCUSED editor reveals nothing — every line renders as live-preview. This matters for
  // multi-editor surfaces like the Bases cards grid: each card's editor keeps its caret at offset
  // 0, so without the focus gate every unfocused card would expose its first line as raw markdown.
  // (The update() trigger below re-runs this pass on focus change so the reveal flips in/out.)
  const selSpans = view.hasFocus
    ? view.state.selection.ranges.map((r) => [doc.lineAt(r.from).number, doc.lineAt(r.to).number] as const)
    : [];
  const isRevealed = (n: number) => selSpans.some(([a, b]) => n >= a && n <= b);
  // Per-token reveal: an INLINE token (bold/italic/code/link/wikilink/math) shows its raw
  // markdown only when a selection range touches that specific token's character span —
  // not merely because the caret is somewhere on the same line. Touching the boundary
  // counts (caret right before/after the markers), matching Obsidian's live preview.
  // Line-level structure (headings, lists, blockquotes, …) still keys on `isRevealed`.
  // Gate per-token reveal by focus too (like the line-level `selSpans` above): an unfocused
  // editor reveals nothing and renders fully. Without this, a card editor whose default caret
  // sits at offset 0 reveals line 1's task prefix → the first `- [ ]` shows raw instead of a
  // checkbox. update() re-runs on focusChanged, so reveal flips correctly on focus enter/leave.
  const selRanges = view.hasFocus ? view.state.selection.ranges : [];
  const revealsRange = (from: number, to: number) => selRanges.some((r) => r.from <= to && r.to >= from);
  // A line-prefix marker (list bullet / task checkbox) reveals its raw `- ` / `- [ ]`
  // ONLY when the caret sits within the marker itself — not when it's anywhere on the
  // line. Half-open `[from, to)` so Home (start of the text, just past the marker) keeps
  // the bullet/checkbox rendered; you must click onto the marker to edit it raw.
  const revealsPrefix = (from: number, to: number) => selRanges.some((r) => r.from < to && r.to >= from);
  // The table block (by header line) currently shown as raw source, if any. The
  // rendered <table> block widgets themselves come from tableWidgetField (a StateField)
  // — block decorations may not be provided by a ViewPlugin. Here we only need the
  // active-block id so the per-line pass below renders the raw source for it.
  const activeTableOpen = view.state.field(activeTableField, false) ?? null;
  // The code block (by opening-fence line) currently in edit mode, if any.
  const activeCodeOpen = view.state.field(activeCodeField, false) ?? null;
  // The callout block (by its header line) currently revealed for raw editing, if any. A rendered
  // (non-active) callout is covered by the CalloutWidget block-replace, so the per-line pass skips
  // its lines; the active one falls through to render as a raw blockquote.
  const activeCalloutOpen = view.state.field(activeCalloutField, false) ?? null;

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const onCursor = isRevealed(line.number);
      const text = line.text;

      // frontmatter: dim lines and skip inline markdown — but still highlight any
      // wikilinks, markdown links, and bare URLs (e.g. a `source: "[[Note]]"`,
      // `link: "[x](url)"`, or `homepage: https://…` property) so they read as links.
      if (frontmatterLines.has(line.number)) {
        // The `---` delimiters ALWAYS render as a self-contained `cm-fence-bar` (grey fill + left
        // accent, rounded on all four corners) — bug #10, 4th round: the user dialed the 3rd-round
        // whole-card fill back to JUST the fence line (see the `fenceBar` comment above). The literal
        // dashes stay VISIBLE in very dim mono (`fenceMark`) inside the bar; a hidden line would
        // collapse to zero height, erasing the bar's rounded corners (see the fenceMark comment). On
        // the caret line they brighten (`syntaxMark`) for editing.
        const isDelim = line.number === frontmatterOpen || line.number === frontmatterClose;
        if (isDelim) {
          deco.push(fenceBar.range(line.from));
          if (line.to > line.from) deco.push((onCursor ? syntaxMark : fenceMark).range(line.from, line.to));
          pos = line.to + 1;
          continue;
        }
        // Property rows carry their 1-based in-block line number (the `---` delimiters never do).
        // Plain `cm-frontmatter` only — no shared chrome with the fence bar; a body row reverts to
        // the normal editor background, no fill, no side edges (bug #10, 4th round).
        deco.push(numberedLine("cm-frontmatter", line.number - (frontmatterOpen ?? 0)).range(line.from));
        // Mark the `key:` portion (`.cm-fm-key` → a dimmed neutral grey, not accent), leaving values --fg.
        const km = FM_KEY_RE.exec(text);
        if (km) {
          const start = line.from + km[1].length;
          deco.push(fmKeyMark.range(start, start + km[2].length));
        }
        pushWikilinks(deco, text, line.from, revealsRange);
        pushMarkdownLinks(deco, text, line.from, revealsRange);
        pushBareUrls(deco, text, line.from);
        pos = line.to + 1;
        continue;
      }

      // fenced code block. The ``` fences ALWAYS render as a self-contained `cm-fence-bar` (grey
      // fill + left accent, rounded on all four corners) — on AND off cursor (bug #10, 4th round:
      // dialed back from the 3rd-round whole-card fill to just the fence line). The opening fence
      // also shows the lang + copy header widget (riding the bar) when rendered; the closing ```
      // stays dim-visible. Entering edit mode (double-click / typing) reveals the raw ``` on both
      // fences without disturbing the bar, which never keys off reveal state. Body lines carry no
      // chrome at all — plain `cm-codeblock` text, same as the surrounding editor background.
      const codeBlock = codeBlockByLine.get(line.number);
      if (codeBlock) {
        const revealed = activeCodeOpen === codeBlock.open;
        const isOpen = line.number === codeBlock.open;
        const isClose = line.number === codeBlock.close;
        if (isOpen) {
          // Opening fence: the bar always; header widget when rendered, raw ``` when revealed.
          deco.push(fenceBar.range(line.from));
          if (!revealed && line.to > line.from) {
            deco.push(Decoration.replace({ widget: new CodeHeaderWidget(codeBlock.lang, codeBlock.body) }).range(line.from, line.to));
          }
        } else if (isClose) {
          // Closing fence: the bar always. The raw ``` stays VISIBLE in very dim mono (`fenceMark`)
          // — "same with code blocks" in the #10 ask, and hiding it would collapse the line and
          // erase the bar's rounded corners (see the fenceMark comment). In edit mode (revealed) it
          // renders unmarked at full mono contrast.
          deco.push(fenceBar.range(line.from));
          if (!revealed && line.to > line.from) deco.push(fenceMark.range(line.from, line.to));
        } else {
          // Body line: 1-based in-block number in the gutter. No fill, no left/right edge (bug #10,
          // 4th round) — reads as plain monospace text, same background as the rest of the editor.
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

      // Callout block: rendered as the CalloutWidget unless it's the active (revealed) block.
      // When rendered, skip the line entirely (the block-replace covers it). When active, fall
      // through so the lines render as a normal (raw) blockquote for editing.
      const calloutBlock = calloutBlockByLine.get(line.number);
      if (calloutBlock && calloutBlock.fromLine !== activeCalloutOpen) {
        pos = line.to + 1;
        continue;
      }

      // headings: size the whole line, hide the leading "#"s off the cursor line
      const hm = text.match(HEADING_RE);
      if (hm) {
        deco.push(headingLines[hm[1].length - 1].range(line.from));
        if (!onCursor) deco.push(hide.range(line.from, line.from + hm[0].length));
        // Revealed: keep the `#`s in the mono accent face (not the serif heading).
        else deco.push(headingMark.range(line.from, line.from + hm[1].length));
      }

      // blockquote
      const qm = text.match(BLOCKQUOTE_RE);
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
      const taskMatch = text.match(TASK_LINE_RE);
      if (taskMatch) {
        isTaskLine = true;
        const status = charToStatus(taskMatch[4]);
        const struck = status === "done" || status === "cancelled";
        const taskDepth = listDepth(view.state, line.from + taskMatch[1].length, taskMatch[1]);
        if (struck) {
          // strike only the task text, not the indentation/checkbox
          const textStart = line.from + taskMatch[0].length;
          if (line.to > textStart) deco.push(taskDoneMark.range(textStart, line.to));
        }
        // An EMPTY item (nothing after the marker) with the caret on it must render the raw
        // marker, not the atomic checkbox widget: a whole-line replace leaves the end-of-line
        // caret unanchored and it renders at the far left (B2). Showing raw keeps it anchored.
        const prefixEnd = line.from + taskMatch[0].length;
        const emptyActive = prefixEnd === line.to && onCursor;
        if (emptyActive || revealsPrefix(line.from, prefixEnd)) {
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
      const bulletMatch = isTaskLine ? null : text.match(BULLET_LINE_RE);
      if (bulletMatch) {
        const depth = listDepth(view.state, line.from + bulletMatch[1].length, bulletMatch[1]);
        // Empty active item → render raw marker so the end-of-line caret stays anchored
        // (a whole-line widget replace would place it at the far left). See B2 / task branch.
        const prefixEnd = line.from + bulletMatch[0].length;
        const emptyActive = prefixEnd === line.to && onCursor;
        if (emptyActive || revealsPrefix(line.from, prefixEnd)) {
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

      // ---- ordered list lines (1. / 2) / etc.) ----
      // Mirror the bullet treatment so numbers share the same hanging gutter + text
      // alignment; the number stays visible (no glyph swap). Task and bullet lines were
      // matched above (and thematic breaks `continue`d), so they never reach here.
      const orderedMatch = isTaskLine || bulletMatch ? null : text.match(ORDERED_LINE_RE);
      if (orderedMatch) {
        const depth = listDepth(view.state, line.from + orderedMatch[1].length, orderedMatch[1]);
        // Empty active item → render raw marker so the end-of-line caret stays anchored
        // (a whole-line widget replace would place it at the far left). See B2 / task branch.
        const prefixEnd = line.from + orderedMatch[0].length;
        const emptyActive = prefixEnd === line.to && onCursor;
        if (emptyActive || revealsPrefix(line.from, prefixEnd)) {
          // Raw, but indent like the rendered view and show the "1. " marker in mono.
          deco.push(indentLine("cm-li", depth).range(line.from));
          const indentLen = orderedMatch[1].length;
          if (indentLen > 0) deco.push(hide.range(line.from, line.from + indentLen));
          deco.push(listMarkerMark.range(line.from + indentLen, line.from + orderedMatch[0].length));
        } else {
          // Replace the WHOLE prefix (indent + number + delimiter + spaces) with the
          // number widget; indent + gap come from the hanging-indent line decoration.
          deco.push(indentLine("cm-li", depth).range(line.from));
          const marker = orderedMatch[2] + orderedMatch[3];
          deco.push(Decoration.replace({ widget: new OrderedWidget(marker, depth) }).range(line.from, line.from + orderedMatch[0].length));
        }
      }

      // inline HTML (<br>, <b>…</b>, <span style=…>…</span>, …): off the cursor
      // line each grouped span becomes a rendered widget; on it the raw tags dim.
      // Returns the covered spans so math (the other inline REPLACE) can skip them
      // — two overlapping replace decorations would throw.
      const htmlSpans = pushInlineHtml(deco, view.state, line.from, line.to, onCursor);
      const inHtmlSpan = (s: number, e: number) => htmlSpans.some((h) => s < h.to && e > h.from);

      // math: process $$...$$ (block) before $...$ (inline). Each token renders as a widget
      // UNLESS the caret/selection touches it (per-token, not line-wide) — then that one token
      // shows its raw source with the LaTeX syntax-highlighted ($ delimiters dimmed, \commands /
      // braces / ^_ etc. marked), the same per-token reveal the inline **/`` ` `` tokens use.
      const mathSpans: { from: number; to: number }[] = [];
      const inMathSpan = (s: number, e: number) => mathSpans.some((h) => s < h.to && e > h.from);
      // Multi-line inline `$…$` spans are owned by the mathBlock StateField (a ViewPlugin
      // can't hold cross-line replace decorations). Seed them so (a) we never emit our own
      // single-line `$…$` replace overlapping one (overlapping replaces throw) and (b) inline
      // emphasis (`**`/`*`/…) inside the math source is skipped. Absolute doc offsets.
      const mlSpans = view.state.field(mathField, false)?.spans ?? [];
      const inMlSpan = (s: number, e: number) => mlSpans.some((h) => s < h.to && e > h.from);
      for (const s of mlSpans) mathSpans.push({ from: s.from, to: s.to });
      {
        // block math: $$...$$  (single-line, non-empty inner)
        for (const m of text.matchAll(BLOCK_MATH_RE)) {
          const s = line.from + (m.index ?? 0);
          const end = s + m[0].length;
          if (inHtmlSpan(s, end)) continue;
          mathSpans.push({ from: s, to: end });
          if (revealsRange(s, end)) {
            // Cover the whole revealed inner range in mono FIRST (layered under the color
            // token marks) so the gaps between LaTeX tokens don't fall back to the body serif.
            deco.push(mathSrcMark.range(s + 2, end - 2));
            deco.push(syntaxMark.range(s, s + 2), syntaxMark.range(end - 2, end));
            for (const d of latexTokenDecorations(s + 2, m[1])) deco.push(d);
          } else {
            deco.push(Decoration.replace({ widget: new MathWidget(m[1], true) }).range(s, end));
          }
        }

        // inline math: $...$ (not $$, at least one non-$ char inside)
        // negative lookbehind/ahead for $ to avoid matching $$
        // Render it display-STYLE (\displaystyle — full-size fractions/sums/limits, the
        // same typography as a $$ block) but still INLINE (displayMode:false → flows in the
        // text, no jarring centered line break mid-sentence). So `$\frac{a}{b}$` looks like
        // the block instead of the cramped default inline style. `\displaystyle` is a valid
        // KaTeX switch; throwOnError:false in renderMath shrugs off anything malformed.
        for (const m of text.matchAll(INLINE_MATH_RE)) {
          const s = line.from + (m.index ?? 0);
          const end = s + m[0].length;
          if (inHtmlSpan(s, end)) continue;
          // A `$` on this line that is actually a delimiter of a multi-line span (owned by
          // mathBlock) must not be re-claimed here — its replace would overlap mathBlock's.
          if (inMlSpan(s, end)) continue;
          mathSpans.push({ from: s, to: end });
          if (revealsRange(s, end)) {
            // Cover the whole revealed inner range in mono FIRST (under the color marks) so
            // letters/operators between tokens read as code, not the body serif.
            deco.push(mathSrcMark.range(s + 1, end - 1));
            deco.push(syntaxMark.range(s, s + 1), syntaxMark.range(end - 1, end));
            for (const d of latexTokenDecorations(s + 1, m[1])) deco.push(d);
          } else {
            deco.push(Decoration.replace({ widget: new MathWidget(`\\displaystyle ${m[1]}`, false) }).range(s, end));
          }
        }
      }

      // inline tokens
      pushInline(deco, text, line.from, revealsRange, STRONG_STAR_RE, 2, strong, inMathSpan);
      pushInline(deco, text, line.from, revealsRange, STRONG_UNDERSCORE_RE, 2, strong, inMathSpan);
      pushInline(deco, text, line.from, revealsRange, EM_RE, 1, em, inMathSpan);
      pushInline(deco, text, line.from, revealsRange, STRIKE_RE, 2, strike, inMathSpan);
      // inline code: run-length-aware so a backtick can live INSIDE a span. A run of N
      // backticks opens a span that closes only on the next run of EXACTLY N backticks
      // (mirrors core/src/wikilinks.ts stripCode + CommonMark). The single-backtick regex
      // (/`([^`]+)`/) couldn't do this — it closed on the first inner backtick. Kept in the
      // SAME inline-token position (before links/wikilinks) so `[[x]]` inside a code span
      // isn't styled as a wikilink. Mirrors pushInline's hide/syntaxMark fence logic.
      for (const m of text.matchAll(INLINE_CODE_RE)) {
        const s = line.from + (m.index ?? 0);
        const end = s + m[0].length;
        const fenceLen = m[1].length;
        const innerStart = s + fenceLen, innerEnd = end - fenceLen;
        if (innerEnd <= innerStart) continue;
        const onCursor = revealsRange(s, end);
        deco.push(code.range(innerStart, innerEnd));
        if (!onCursor) {
          deco.push(hide.range(s, innerStart));
          deco.push(hide.range(innerEnd, end));
        } else {
          // Revealed: the backtick fences render in dim Monaspace, not the prose serif.
          deco.push(syntaxMark.range(s, innerStart));
          deco.push(syntaxMark.range(innerEnd, end));
        }
      }

      // markdown links [text](url) + bare https://… URLs: show the link text, hide the
      // brackets/url unless the caret touches THIS link (per-token reveal). Shared with the
      // frontmatter branch so links in properties get the same treatment.
      pushMarkdownLinks(deco, text, line.from, revealsRange);
      pushBareUrls(deco, text, line.from);

      // wikilinks [[target#heading|alias]] — reveal only the basename (or alias).
      pushWikilinks(deco, text, line.from, revealsRange);

      // body #hashtags — tint TEAL. Skipped on heading lines so heading "#"s
      // are never tinted (frontmatter/code/table lines already `continue` above).
      if (!hm) pushTags(deco, text, line.from);

      // iridescent "bismuth": tint every whole-word occurrence, skipping any that sit inside
      // code / math / raw-HTML / links / URLs / wikilinks / tags (frontmatter + fenced code
      // lines already `continue`d above, so this only runs on prose lines).
      pushBismuth(deco, text, line.from, mathSpans, htmlSpans);

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
    if (FENCE_RE.test(doc.line(i).text)) {
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
  // Provide the rendered-table block ranges as BOTH decorations and atomic ranges.
  // A block `Decoration.replace` is NOT atomic for cursor motion by default, so without
  // this an arrow-key press or selection drag from the paragraph below the table sinks the
  // caret INTO the table's hidden source lines (cursor jumps/disappears, typing lands in
  // the wrong place). Marking the range atomic makes CM step over the whole table as one
  // unit. The active (raw-source) table is excluded from this set, so it stays editable.
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f, false) ?? Decoration.none)],
});

// --- callout "edit mode" ------------------------------------------------------
// A callout normally renders as the CalloutWidget block (icon + title + rendered body). Like a
// code block it reveals its raw blockquote source when DOUBLE-CLICKED (or while you type inside an
// already-revealed one), and collapses back once the caret leaves the block. Tracked by the
// callout's header line number (1-based), or null.
const setActiveCalloutEffect = StateEffect.define<number | null>();

/** The callout block containing `lineNumber` (1-based), returning its header line, or null. */
function calloutBlockAt(state: EditorState, lineNumber: number): number | null {
  for (const c of scanCalloutLineBlocks(state.doc)) {
    if (lineNumber >= c.fromLine && lineNumber <= c.toLine) return c.fromLine;
  }
  return null;
}

const activeCalloutField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    // Explicit request (double-click) wins.
    for (const e of tr.effects) if (e.is(setActiveCalloutEffect)) return e.value;
    const head = tr.state.selection.main.head;
    const at = calloutBlockAt(tr.state, tr.state.doc.lineAt(head).number);
    // Typing inside a callout reveals/keeps it.
    if (tr.docChanged) return at;
    // Selection-only move: stay revealed only while still inside the active block; a single click
    // into a different/rendered callout does NOT reveal it (double-click does).
    if (tr.selection) return at != null && at === value ? value : null;
    return value;
  },
});

// The block widget shown in place of a (non-active) callout's raw blockquote source.
class CalloutWidget extends WidgetType {
  constructor(private readonly header: CalloutHeader, private readonly body: string) {
    super();
  }

  eq(other: CalloutWidget): boolean {
    return (
      other.header.type === this.header.type &&
      other.header.title === this.header.title &&
      other.header.foldable === this.header.foldable &&
      other.header.collapsed === this.header.collapsed &&
      other.body === this.body
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-callout-wrap";
    const titleHtml = renderInline(this.header.title);
    const bodyHtml = renderNoteBody(this.body);
    wrap.innerHTML = sanitizeHtml(renderCalloutHtml(this.header, bodyHtml, titleHtml));
    return wrap;
  }

  ignoreEvent(): boolean {
    return true; // atomic block: enter via double-click, not a stray click
  }
}

// Block decorations must come from a StateField (not a ViewPlugin). Each non-active callout block
// is replaced by one CalloutWidget spanning its source; the active block is excluded so it stays
// editable as a raw blockquote.
function buildCalloutWidgets(state: EditorState): DecorationSet {
  const doc = state.doc;
  const active = state.field(activeCalloutField, false) ?? null;
  const deco: Range<Decoration>[] = [];
  for (const c of scanCalloutLineBlocks(doc)) {
    if (c.fromLine === active) continue;
    const from = doc.line(c.fromLine).from;
    const to = doc.line(c.toLine).to;
    deco.push(Decoration.replace({ widget: new CalloutWidget(c.header, c.body), block: true }).range(from, to));
  }
  return Decoration.set(deco, true);
}

const calloutWidgetField = StateField.define<DecorationSet>({
  create: (state) => buildCalloutWidgets(state),
  update(value, tr) {
    const activeChanged = tr.startState.field(activeCalloutField) !== tr.state.field(activeCalloutField);
    if (tr.docChanged || tr.selection || activeChanged) return buildCalloutWidgets(tr.state);
    return value.map(tr.changes);
  },
  // Provide the rendered-callout ranges as decorations AND atomic ranges so the caret steps over a
  // rendered callout as one unit (the active/raw block is excluded → still editable).
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f, false) ?? Decoration.none)],
});

// Double-click a rendered callout → reveal its raw blockquote source for editing.
const calloutDomHandlers = EditorView.domEventHandlers({
  dblclick: (e, view) => {
    const pos = view.posAtCoords({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
    if (pos == null) return false;
    const at = calloutBlockAt(view.state, view.state.doc.lineAt(pos).number);
    if (at == null) return false;
    view.dispatch({ effects: setActiveCalloutEffect.of(at), selection: { anchor: view.state.doc.line(at).from } });
    view.focus();
    return false;
  },
});

// Callout chrome for the editor widget. Scoped under `.cm-callout-wrap` (and EditorView.theme
// already scopes to this editor) so it's self-contained; the per-type accent is generated from the
// shared palette (callout.ts) so it matches the export + in-app rendered surfaces.
const calloutThemeSpec: Record<string, Record<string, string>> = {
  ".cm-callout-wrap": { display: "block", margin: "0.3em 0" },
  ".cm-callout-wrap .callout": {
    margin: "0.4em 0",
    border: "1px solid color-mix(in srgb, var(--fg) 16%, transparent)",
    "border-left-width": "4px",
    "border-radius": "6px",
    background: "color-mix(in srgb, var(--fg) 4%, transparent)",
    padding: "0.5em 0.8em",
  },
  ".cm-callout-wrap .callout-title": { display: "flex", "align-items": "center", gap: "0.45em", "font-weight": "600" },
  ".cm-callout-wrap .callout-icon": { display: "inline-flex", flex: "0 0 auto" },
  ".cm-callout-wrap .callout-icon svg": { width: "1.1em", height: "1.1em" },
  ".cm-callout-wrap .callout-content": { "margin-top": "0.4em" },
  ".cm-callout-wrap .callout-content > :first-child": { "margin-top": "0" },
  ".cm-callout-wrap .callout-content > :last-child": { "margin-bottom": "0" },
  ".cm-callout-wrap details.callout > summary": { cursor: "pointer", "list-style": "none" },
};
for (const [type, meta] of Object.entries(CALLOUT_TYPES)) {
  calloutThemeSpec[`.cm-callout-wrap .callout-${type}`] = { "border-left-color": meta.color };
  calloutThemeSpec[`.cm-callout-wrap .callout-${type} > .callout-title`] = { color: meta.color };
}
const calloutTheme = EditorView.theme(calloutThemeSpec);

export const livePreview = [
  activeCodeField,
  activeTableField,
  tableWidgetField,
  htmlBlockField,
  activeCalloutField,
  calloutWidgetField,
  calloutDomHandlers,
  calloutTheme,
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
      // Newly-completed tasks sink to the bottom of their list (mirrors the server's
      // /tasks/toggle reorder, which the in-editor checkbox bypasses).
      const reorder = reorderAroundLine(view.state, view.state.doc.lineAt(innerPos).number);
      if (reorder) view.dispatch(reorder);
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
        const reorder = reorderAroundLine(view.state, view.state.doc.lineAt(innerPos).number);
        if (reorder) view.dispatch(reorder);
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
          u.startState.field(activeTableField, false) !== u.state.field(activeTableField, false) ||
          u.startState.field(activeCalloutField, false) !== u.state.field(activeCalloutField, false);
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || activeChanged) {
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
    // Rendered horizontal rule (a `---` / `***` "em-dash" break): off the cursor line the dashes
    // are hidden, so draw a centered rule via a pseudo-element. It must be ALWAYS clearly visible on
    // EVERY theme — the earlier fixed `rgba(128,128,128,·)` mid-grey WAS the "dashes still not always
    // visible" bug: on a light theme (bg ≈ #F1EFF7) a 128-grey line at 0.6α renders as faint light
    // grey over near-white (~rgb(173) on ~rgb(243) — low contrast, near-invisible), and on any bg
    // near mid-grey it disappears outright. `color-mix` off `var(--fg)` (the readable text color —
    // always high-contrast with the bg on light AND dark themes) guarantees a visible rule, the same
    // theme-aware technique the bullets / list numbers / frontmatter key already use. The line height
    // never collapses (fixed 1.2em) so the rule always has a box to sit in. On the cursor line the raw
    // `---` shows in full-contrast mono (`.cm-syntax-mark` = var(--fg)) — the dashes are visible there too.
    ".cm-hr": { position: "relative", height: "1.2em" },
    ".cm-hr::before": { content: '""', position: "absolute", left: "0", right: "0", top: "calc(50% - 1px)", "border-top": "2px solid color-mix(in srgb, var(--fg) 45%, transparent)" },
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
    // Ordered marker: same gutter geometry as the bullet so spacing matches exactly.
    // min-width (not fixed width) lets 10+/100+ numbers grow instead of overlapping text.
    ".cm-ol-number": {
      display: "inline-block",
      "min-width": "1.6em",
      "box-sizing": "border-box",
      "text-align": "right",
      "padding-right": "0.62em",
      color: "color-mix(in srgb, var(--fg) 70%, transparent)",
    },
    // Code blocks: plain monospace text — no fill, no border, no left/right edge (bug #10, 4th
    // round: the user dialed the whole-block card fill back to JUST the fence line — see the
    // `fenceBar` comment near the top of the file). A body line looks exactly like ordinary editor
    // background now; only `.cm-fence-bar` below carries any chrome.
    ".cm-codeblock": { "font-family": MONO_FONT, "font-size": "calc(1em * var(--mono-scale, 0.85))", "line-height": "1.5" },
    // In-block line numbers (`.cm-code-numbered`) are styled by `codeLineNumberTheme`
    // (codeLineNumbers.ts), shared with the ```query source view. Positioned relative to the
    // line's own padding box (`left: -2.7em`), unaffected by the (now absent) body padding.
    //
    // The ONE bar class shared by every fence line — frontmatter's opening/closing `---`, a code
    // block's opening/closing ``` (bug #10, 4th round — see the `fenceBar` comment near the top of
    // the file for the full history). A subtle grey fill + a GREY (never accent) left accent edge,
    // both `color-mix` off `var(--fg)` so they read correctly on light AND dark themes, rounded on
    // all four corners since this is now a self-contained bar rather than one wall of a taller card.
    // The left edge is an INSET box-shadow (not a real CSS `border`), so nothing shifts the text
    // layout. Open and close fences render IDENTICALLY — there's no card roof/floor left to
    // distinguish, so a single class covers both (`fenceBar` in the ViewPlugin above is pushed at
    // both the opening and the closing fence line).
    ".cm-fence-bar": {
      "font-family": MONO_FONT,
      "font-size": "calc(1em * var(--mono-scale, 0.85))",
      background: "color-mix(in srgb, var(--fg) 8%, transparent)",
      padding: "0.15em 0.6em",
      margin: "1px 0",
      "border-radius": "6px",
      "box-shadow": "inset 3px 0 0 color-mix(in srgb, var(--fg) 40%, transparent)",
    },
    // The always-visible fence text inside the bar (frontmatter `---`, code closing ```): very
    // dim — clearly quieter than the block's content, matching the reference's faint dashes —
    // but never hidden (a hidden line collapses and erases the bar's rounded corners). The
    // `> span` override is load-bearing (mirrors `.cm-fm-key`): CodeMirror nests syntax-highlighter
    // token spans inside the mark, and their own token color would win without it.
    ".cm-fence-syntax, .cm-fence-syntax > span": { color: "color-mix(in srgb, var(--fg) 30%, transparent)" },
    // The header widget sits inside the opening fence's `cm-fence-bar` — it inherits that line's
    // padding (its line carries the class) so the lang label/copy button sit inset from the left
    // accent edge like the raw ``` text would, with no styling of its own needed here.
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
    // Frontmatter: plain monospace property rows — no fill, no border, no left/right edge (bug #10,
    // 4th round, mirroring `.cm-codeblock` above). Only the opening/closing `---` (`.cm-fence-bar`)
    // carry any chrome; a property row looks exactly like ordinary editor background.
    ".cm-frontmatter": {
      "font-family": MONO_FONT,
      "font-size": "calc(1em * var(--mono-scale, 0.85))",
    },
    // Property KEYS (date / tags / icon …): a dimmed neutral grey, NOT a theme-accent color, so the
    // frontmatter panel stays theme-agnostic dark grey (was `var(--accent)` — the re-flagged bug).
    // Theme-aware (dims --fg toward the background) so it reads grey on both light + dark themes.
    // The `> span` is load-bearing (mirrors `.cm-syntax-mark`/`.cm-heading-mark` above): CodeMirror
    // nests the YAML syntax-highlighter token INSIDE this mark —
    // `<span class="cm-fm-key"><span class="ͼ…">key</span></span>` — and that inner token is
    // `t.propertyName → var(--accent)` (codeHighlight.ts). Coloring only `.cm-fm-key` leaves the
    // inner accent token to win, so the key STILL renders accent; this is exactly why the earlier
    // "change the key to grey" fix showed no visible effect. Overriding the child span forces grey through.
    ".cm-fm-key, .cm-fm-key > span": { color: "color-mix(in srgb, var(--fg) 55%, transparent)" },
    // Raw (active) table source — monospace pipes for structural / power edits (#25). The
    // serializer column-pads every row to align the pipes in a monospace column view, but the
    // editor runs with line-wrapping (`white-space: pre-wrap`), so a table wider than the pane
    // SOFT-WRAPS mid-row and the alignment collapses into a jumble ("looks fucked as hell").
    // Force `white-space: pre` on the revealed source lines so each row stays on ONE line and the
    // padded columns actually line up; `overflow-x: auto` lets a too-wide row scroll instead of
    // clipping. A table that fits the pane is unaffected (no wrap needed either way).
    ".cm-table": {
      "font-family": MONO_FONT,
      "font-size": "calc(1em * var(--mono-scale, 0.85))",
      "white-space": "pre",
      "overflow-x": "auto",
    },
    // Rendered editable table (the block-replace widget). Cells are contenteditable.
    // The vertical spacing lives on the OUTER `.cm-table-block` as PADDING, not as a margin
    // on the wrap: CodeMirror measures a block widget's height with getBoundingClientRect,
    // which excludes margins (see measureVisibleLineHeights in @codemirror/view). A margin
    // here would be left out of CM's height model, compressing every line below the table by
    // ~one line, so a click/keystroke under the table landed (and drew the caret) one line
    // too low. Padding is inside the measured box, so the model matches the real layout.
    ".cm-table-block": { padding: "0.6em 0 1.4em 0" },
    // `fit-content` so the wrap hugs the table — the hover toolbar then aligns to the
    // table's top-right corner instead of floating off in the full-width line box.
    ".cm-table-wrap": { position: "relative", width: "fit-content", "max-width": "100%" },
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
    // text-indent:0 — list lines carry a negative hanging text-indent (it's inherited);
    // without resetting it the KaTeX content shifts left and, when math is the first thing
    // after a list marker, lands on top of (hides) the bullet/number.
    ".cm-math": { display: "inline-block", "vertical-align": "baseline", "text-indent": "0" },
    // Full-width block for $$…$$ so KaTeX can lay out equation tags / numbers (\tag,
    // numbered align/equation) flush right of the line instead of on top of the equation.
    ".cm-math-display": { display: "block", width: "100%" },
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
