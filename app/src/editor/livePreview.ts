// app/src/editor/livePreview.ts
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { type Range, type Text, StateField, StateEffect, type EditorState } from "@codemirror/state";
import { createSignal, type Setter } from "solid-js";
import { render } from "solid-js/web";
import katex from "katex";
import { extractFrontmatterBoundary } from "./frontmatterUtils";
import { wikilinkVisibleRange } from "./wikilink";
import { TaskCheckbox, charToStatus, type TaskStatus } from "./TaskCheckbox";
import { CodeHeader } from "./CodeHeader";

const hide = Decoration.mark({ class: "cm-hidden-syntax" });
const strong = Decoration.mark({ class: "cm-strong" });
const em = Decoration.mark({ class: "cm-em" });
const strike = Decoration.mark({ class: "cm-strike" });
const code = Decoration.mark({ class: "cm-inline-code" });
const link = Decoration.mark({ class: "cm-link" });
const wikilink = Decoration.mark({ class: "cm-wikilink" });
const tag = Decoration.mark({ class: "cm-tag" });
const headingLines = [1, 2, 3, 4, 5, 6].map((l) => Decoration.line({ class: `cm-h${l}` }));
const quoteLine = Decoration.line({ class: "cm-quote" });
const taskDoneMark = Decoration.mark({ class: "cm-task-done" });
// On the cursor line a list/task marker shows raw; render it in the mono font.
const listMarkerMark = Decoration.mark({ class: "cm-list-marker" });
const codeBlockLine = Decoration.line({ class: "cm-codeblock" });
const codeHeaderLine = Decoration.line({ class: "cm-code-headerline" });
const codeHiddenLine = Decoration.line({ class: "cm-code-hidden" });
const frontmatterLine = Decoration.line({ class: "cm-frontmatter" });
const fmKeyMark = Decoration.mark({ class: "cm-fm-key" });
const tableLine = Decoration.line({ class: "cm-table" });

// Notion-style hanging indent for lists. Off the cursor line we replace the whole
// list prefix (indent + marker + spaces) with a single widget and drive ALL spacing
// from CSS instead of the literal markdown whitespace: the text sits at (depth+1)*STEP
// from the margin and the bullet/checkbox hangs in a GUTTER-wide column to its left.
// This keeps the marker→text gap and per-level indent consistent regardless of how the
// source happens to be spaced.
const LIST_STEP = 1.6; // em added to the text indent per nesting level
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
    span.innerHTML = katex.renderToString(this.expr, {
      throwOnError: false,
      displayMode: this.displayMode,
    });
    return span;
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
    }
  }
}

/** Style each `[[wikilink]]` on a line — revealing only the basename/alias and hiding
 *  the brackets + folder path off the cursor line. Used for both body and frontmatter
 *  lines so links in properties get the same treatment. Click handling lives in Editor.tsx. */
function pushWikilinks(deco: Range<Decoration>[], text: string, lineFrom: number, onCursor: boolean) {
  for (const m of text.matchAll(/\[\[([^\]]+?)\]\]/g)) {
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
  fenceLines: Set<number>;
  codeLines: Set<number>;
  tableLineSet: Set<number>;
  // Every line that belongs to a (closed) fenced code block → its block.
  codeBlockByLine: Map<number, CodeBlock>;
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
  const fmRange = extractFrontmatterBoundary(doc.toString());
  if (fmRange) {
    const firstLine = doc.lineAt(fmRange.from).number;     // line after the opening fence
    const lastBodyLine = fmRange.to > fmRange.from ? doc.lineAt(fmRange.to).number : firstLine - 1;
    // include the opening fence line, the body lines, and the closing fence line
    for (let i = firstLine - 1; i <= lastBodyLine + 1; i++) {
      if (i >= 1 && i <= doc.lines) frontmatterLines.add(i);
    }
  }

  // precompute GFM table line sets (scan whole doc)
  const tableLineSet = new Set<number>();
  // A table separator line: starts with optional whitespace, then |?[:-| chars]+
  const sepRe = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
  for (let i = 1; i <= doc.lines; i++) {
    const lineText = doc.line(i).text;
    const prevLineText = i > 1 ? doc.line(i - 1).text : "";
    // check if this is a separator row
    if (sepRe.test(lineText) && prevLineText.includes("|")) {
      // mark the header line (i-1), the separator (i), and following contiguous pipe lines
      if (!tableLineSet.has(i - 1)) tableLineSet.add(i - 1);
      tableLineSet.add(i);
      // collect following rows
      for (let j = i + 1; j <= doc.lines; j++) {
        if (doc.line(j).text.includes("|")) {
          tableLineSet.add(j);
        } else {
          break;
        }
      }
    }
  }

  return { frontmatterLines, fenceLines, codeLines, tableLineSet, codeBlockByLine };
}

/** Run the per-visible-line decoration pass using pre-computed block regions.
 *  This is cheap: it only iterates view.visibleRanges and must run on every
 *  update (including cursor moves) so that the cursor-line reveal stays correct. */
function buildDecorations(view: EditorView, regions: BlockRegions): DecorationSet {
  const { frontmatterLines, tableLineSet, codeBlockByLine } = regions;
  const deco: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const cursorLine = doc.lineAt(view.state.selection.main.head).number;
  // The code block (by opening-fence line) currently in edit mode, if any.
  const activeCodeOpen = view.state.field(activeCodeField, false) ?? null;

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const onCursor = line.number === cursorLine;
      const text = line.text;

      // frontmatter: dim lines and skip inline markdown — but still highlight any
      // wikilinks (e.g. a `source: "[[Note]]"` property) so they read as links.
      if (frontmatterLines.has(line.number)) {
        deco.push(frontmatterLine.range(line.from));
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
        if (revealed) {
          deco.push(codeBlockLine.range(line.from));
        } else if (line.number === codeBlock.open) {
          deco.push(codeHeaderLine.range(line.from));
          if (line.to > line.from) {
            deco.push(Decoration.replace({ widget: new CodeHeaderWidget(codeBlock.lang, codeBlock.body) }).range(line.from, line.to));
          }
        } else if (line.number === codeBlock.close) {
          deco.push(codeHiddenLine.range(line.from));
          if (line.to > line.from) deco.push(hide.range(line.from, line.to));
        } else {
          deco.push(codeBlockLine.range(line.from));
        }
        pos = line.to + 1;
        continue;
      }

      // GFM table: monospace and skip inline rules
      if (tableLineSet.has(line.number)) {
        deco.push(tableLine.range(line.from));
        pos = line.to + 1;
        continue;
      }

      // headings: size the whole line, hide the leading "#"s off the cursor line
      const hm = text.match(/^(#{1,6})\s+/);
      if (hm) {
        deco.push(headingLines[hm[1].length - 1].range(line.from));
        if (!onCursor) deco.push(hide.range(line.from, line.from + hm[0].length));
      }

      // blockquote
      const qm = text.match(/^>\s?/);
      if (qm) {
        deco.push(quoteLine.range(line.from));
        if (!onCursor) deco.push(hide.range(line.from, line.from + qm[0].length));
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
        const taskDepth = Math.floor(taskMatch[1].replace(/\t/g, "  ").length / 2);
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
      // A thematic break (--- / *** / - - - / * * *) also starts with a marker+space;
      // don't render it as a bullet. Same marker char, 3+ times, optional spaces between.
      const isThematicBreak = /^\s*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(text);
      const bulletMatch = (isThematicBreak || isTaskLine) ? null : text.match(/^(\s*)([-*+])(\s+)/);
      if (bulletMatch) {
        // Compute indent depth: tab = 2 spaces, then depth = floor(indentCols / 2)
        const depth = Math.floor(bulletMatch[1].replace(/\t/g, "  ").length / 2);
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

      // math: process $$...$$ (block) before $...$ (inline) — skip if cursor is on this line
      if (!onCursor) {
        // block math: $$...$$  (single-line, non-empty inner)
        const blockMathRe = /\$\$([^$]+)\$\$/g;
        for (const m of text.matchAll(blockMathRe)) {
          const s = line.from + (m.index ?? 0);
          const end = s + m[0].length;
          const expr = m[1];
          deco.push(Decoration.replace({ widget: new MathWidget(expr, true) }).range(s, end));
        }

        // inline math: $...$ (not $$, at least one non-$ char inside)
        // negative lookbehind/ahead for $ to avoid matching $$
        const inlineMathRe = /(?<!\$)\$([^$\n]+)\$(?!\$)/g;
        for (const m of text.matchAll(inlineMathRe)) {
          const s = line.from + (m.index ?? 0);
          const end = s + m[0].length;
          const expr = m[1];
          deco.push(Decoration.replace({ widget: new MathWidget(expr, false) }).range(s, end));
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
        }
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

export const livePreview = [
  activeCodeField,
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
      // are display-only states set by typing — a click never produces them.
      const next = (m[2] === "x" || m[2] === "X") ? " " : "x";
      view.dispatch({ changes: { from: innerPos, to: innerPos + 1, insert: next } });
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
        const activeChanged = u.startState.field(activeCodeField, false) !== u.state.field(activeCodeField, false);
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
    ".cm-inline-code": { "font-family": "'Monaspace Xenon', ui-monospace, monospace", background: "rgba(140,140,140,0.18)", padding: "0 3px", "border-radius": "3px" },
    // Links + wikilinks: accent with a SOFT underline (a faint accent rule that
    // sits below the text) rather than a hard text-decoration line.
    ".cm-link": { color: "var(--accent)", cursor: "pointer", "text-decoration": "none", "border-bottom": "1px solid var(--accent-soft)" },
    ".cm-wikilink": { color: "var(--accent)", cursor: "pointer", "text-decoration": "none", "border-bottom": "1px solid var(--accent-soft)" },
    // Body #hashtags read teal (design §1: prose tags use --teal).
    ".cm-tag": { color: "var(--teal)" },
    // Serif headings (design: title 600 with tight tracking; h2 ≈ 20px/1.5em serif).
    ".cm-h1": { "font-size": "1.94em", "font-weight": "600", "line-height": "1.1", "letter-spacing": "-0.015em" },
    ".cm-h2": { "font-size": "1.5em", "font-weight": "600", "line-height": "1.25", "letter-spacing": "-0.01em" },
    ".cm-h3": { "font-size": "1.3em", "font-weight": "600" },
    ".cm-h4": { "font-size": "1.15em", "font-weight": "600" },
    ".cm-h5": { "font-size": "1.05em", "font-weight": "600" },
    ".cm-h6": { "font-size": "1em", "font-weight": "600", opacity: "0.85" },
    ".cm-quote": { "border-left": "3px solid #555", "padding-left": "8px", opacity: "0.85" },
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
    ".cm-codeblock": { "font-family": "'Monaspace Xenon', ui-monospace, monospace", "font-size": "0.9em", "line-height": "1.5" },
    ".cm-code-headerline": { "font-family": "'Monaspace Xenon', ui-monospace, monospace" },
    ".cm-code-hidden": { "font-size": "0", "line-height": "0" },
    ".cm-code-headerwrap": { display: "block", width: "100%" },
    ".cm-code-header": {
      display: "flex",
      width: "100%",
      "justify-content": "space-between",
      "align-items": "center",
      "font-size": "0.78em",
    },
    ".cm-code-lang": {
      "font-family": "'Monaspace Xenon', ui-monospace, monospace",
      color: "color-mix(in srgb, var(--fg) 42%, transparent)",
      "letter-spacing": "0.04em",
    },
    ".cm-code-copy": {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      color: "color-mix(in srgb, var(--fg) 45%, transparent)",
      background: "none",
      border: "none",
      padding: "2px",
      cursor: "pointer",
      opacity: "0.8",
      transition: "color 120ms, opacity 120ms",
    },
    ".cm-code-copy:hover": { color: "var(--accent)", opacity: "1" },
    // Frontmatter (.fm in the redesign): a raised --surface-2 band with a 2px
    // accent left bar (via inset shadow, so no text shift), keeping the text and
    // validation squiggles at full strength. Keys render in --accent, values in
    // --fg, the `---` delimiters dim (see codeHighlight / markdown tokens).
    ".cm-frontmatter": {
      "font-family": "'Monaspace Xenon', ui-monospace, monospace",
      background: "var(--surface-2)",
      "box-shadow": "inset 2px 0 0 var(--accent)",
    },
    ".cm-fm-key": { color: "var(--accent)" },
    ".cm-table": { "font-family": "'Monaspace Xenon', ui-monospace, monospace" },
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
    ".cm-list-marker": { "font-family": "'Monaspace Xenon', ui-monospace, monospace" },
    ".cm-math": { display: "inline-block", "vertical-align": "middle" },
    ".cm-math .katex-display": { "text-align": "left", margin: "0.4em 0" },
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
