// app/src/editor/mathBlock.ts
//
// StateField extension for the two math shapes a ViewPlugin can't own (both need
// block/cross-line replace decorations, which CM forbids from plugins — same reason as
// queryBlock.ts):
//   1. Multi-line `$$ ... $$` display blocks.
//   2. Multi-line INLINE `$ ... $` spans whose closing `$` sits on a LATER line (a single
//      inline span that soft-wrapped across source lines). Single-LINE `$…$` stays owned by
//      livePreview.ts; the two never overlap (a single-line match can't cross a newline).
// Off the caret the range renders as a KaTeX widget; on it the raw source is revealed with
// the shared LaTeX highlighting so it stays editable (indent visible).

import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { renderMath, onMathReady } from "./katexLoader";
import { latexTokenDecorations, texDelim, mathSrcMark } from "./latexHighlight";

/** Matches a line whose entire trimmed content is exactly `$$`. */
const MATH_FENCE = /^\s*\$\$\s*$/;

/** Matches the start of a fenced code block (``` or ~~~ with optional info string). */
const CODE_FENCE = /^\s*(```|~~~)/;

/** Matches a blank (whitespace-only) line. */
const BLANK_LINE = /^\s*$/;

/** Cap on how many source lines a multi-line inline `$…$` span may cross before we give up
 *  and leave the `$` literal. Guards against an unclosed `$` (e.g. a "$5" price) swallowing
 *  the rest of the document; blank-line + code/math-fence boundaries (below) are the primary
 *  stop, this is the belt-and-braces upper bound. */
const MAX_INLINE_MATH_LINES = 10;

/** True when `pos` sits within a `$$ … $$` display-math block (inclusive of the two fence lines).
 *  The Enter keymap uses this to DECLINE list-markup continuation inside a math block: a `$$` block
 *  written directly under a list item is parsed by CommonMark as lazy paragraph continuation INSIDE
 *  the ListItem, so `insertNewlineContinueMarkup` reads the closing `$$` line as an empty list line
 *  and its "delete a markup level" branch removes the closing `$$`. Pairs `$$` fences the same way
 *  the block scan does (skipping fences inside ``` code blocks). O(caretLine) in the common case. */
export function isInMathBlock(state: EditorState, pos: number): boolean {
  const caretLine = state.doc.lineAt(pos).number;
  let inCode = false;
  let openFence = 0; // line of a pending opening `$$`, or 0 when none is open
  for (let n = 1; n <= state.doc.lines; n++) {
    // Fast path for the common (not-in-math) case: once we're past the caret with no pending open
    // fence, the caret can't be inside any block. (A pending open fence must keep scanning for its
    // close, which may sit below the caret.)
    if (openFence === 0 && n > caretLine) return false;
    const text = state.doc.line(n).text;
    if (CODE_FENCE.test(text)) { inCode = !inCode; continue; }
    if (inCode || !MATH_FENCE.test(text)) continue;
    if (openFence === 0) {
      openFence = n; // opening fence
    } else {
      if (caretLine >= openFence && caretLine <= n) return true; // caret within a COMPLETE `$$…$$` pair
      openFence = 0; // pair closed; keep scanning
    }
  }
  // Only a CLOSED `$$…$$` pair is a block. A trailing UNCLOSED `$$` is not — so a stray/opening `$$`
  // never disables list continuation (or the closing-fence guard) for the lines below it.
  return false;
}

class MathBlockWidget extends WidgetType {
  private readonly expr: string;
  private _unsub?: () => void;

  constructor(expr: string) {
    super();
    this.expr = expr;
  }

  eq(other: MathBlockWidget): boolean {
    return other.expr === this.expr;
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-math-block";
    div.innerHTML = renderMath(this.expr, true);
    // If KaTeX wasn't loaded yet, renderMath returned "" and kicked off the lazy
    // load — fill the node in once the library is ready (same final output). Keep the
    // unsubscribe so a widget destroyed before KaTeX loads drops its pending callback.
    if (!div.innerHTML) this._unsub = onMathReady(() => { div.innerHTML = renderMath(this.expr, true); });
    return div;
  }

  destroy(): void {
    this._unsub?.();
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Inline (displayMode:false) KaTeX widget for a multi-line `$…$` span. Rendered
 *  `\displaystyle` inline to match livePreview.ts's single-line inline math, so a `$…$`
 *  that soft-wrapped looks identical to one on a single line (KaTeX ignores the interior
 *  whitespace once rendered, so the source indentation question is moot). */
class InlineMathWidget extends WidgetType {
  private readonly expr: string;
  private _unsub?: () => void;

  constructor(expr: string) {
    super();
    this.expr = expr;
  }

  eq(other: InlineMathWidget): boolean {
    return other.expr === this.expr;
  }

  private render(): string {
    return renderMath(`\\displaystyle ${this.expr}`, false);
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-math";
    span.innerHTML = this.render();
    if (!span.innerHTML) this._unsub = onMathReady(() => { span.innerHTML = this.render(); });
    return span;
  }

  destroy(): void {
    this._unsub?.();
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** A doc-absolute half-open range `[from, to)` of a multi-line inline `$…$` span (the
 *  delimiters included). Exposed on the field value so livePreview.ts can skip re-decorating
 *  the same range (overlapping replace decorations throw) and skip inline emphasis inside it. */
export interface MathSpan {
  from: number;
  to: number;
}

/** Whether `[s, e)` overlaps any span in `spans`. */
function overlapsAny(s: number, e: number, spans: readonly MathSpan[]): boolean {
  return spans.some((r) => s < r.to && e > r.from);
}

/** Scan `text` for multi-line inline `$…$` spans — a single `$` (not `$$`, honoring `\$`
 *  escapes and the no-space-just-inside-the-delimiter rule) whose matching closing `$` is on
 *  a LATER line. Returns doc-absolute `[from, to)` ranges (delimiters included), in order and
 *  non-overlapping. Single-line spans are intentionally omitted (livePreview owns them); `$$`
 *  delimiters, code fences, blank lines and the line cap bound the scan so an unclosed `$`
 *  can't run away. Pure + DOM-free (unit-tested in mathBlock.test.ts). */
export function scanMultilineInlineMath(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  const lines = text.split("\n");

  // Per line: absolute start offset, code-fence membership (a ``` / ~~~ delimiter line and
  // everything between two of them — `$` inside is literal), and `$$` display-block membership
  // (a lone `$$` line + everything up to its pair — owned by the $$ path, never inline). Both
  // regions are skipped whole so the inline scan never opens a delimiter inside them.
  const lineStart: number[] = new Array(lines.length);
  const fenced: boolean[] = new Array(lines.length);
  const inDisplay: boolean[] = new Array(lines.length);
  {
    let off = 0;
    let inFence = false;
    let inMath = false;
    for (let k = 0; k < lines.length; k++) {
      lineStart[k] = off;
      off += lines[k].length + 1;
      if (CODE_FENCE.test(lines[k])) {
        fenced[k] = true; // the delimiter line itself is a boundary
        inFence = !inFence;
        inDisplay[k] = inMath;
      } else {
        fenced[k] = inFence;
        if (!inFence && MATH_FENCE.test(lines[k])) {
          inDisplay[k] = true; // the `$$` fence line itself
          inMath = !inMath;
        } else {
          inDisplay[k] = inMath;
        }
      }
    }
  }

  const n = text.length;
  let i = 0;
  let li = 0;
  while (i < n) {
    // Keep `li` pointing at the line containing `i`.
    while (li + 1 < lines.length && i >= lineStart[li + 1]) li++;
    // Skip whole code-fence + `$$`-display lines/regions.
    if (fenced[li] || inDisplay[li]) {
      i = lineStart[li] + lines[li].length + 1;
      continue;
    }
    const ch = text[i];
    if (ch === "\n") { i++; continue; }
    if (ch === "\\") { i += 2; continue; } // escaped char (\$) — skip both
    if (ch !== "$") { i++; continue; }
    if (text[i + 1] === "$") { i += 2; continue; } // `$$` never opens inline math
    // Opening rule: the char just inside must exist on THIS line and not be whitespace.
    const after = text[i + 1];
    if (after === undefined || after === " " || after === "\t" || after === "\n") { i++; continue; }

    const close = findClose(text, lines, fenced, li, i);
    if (close < 0) { i++; continue; } // no valid close in window → leave `$` literal
    // `close` is the absolute index of the closing `$`. Only claim it when it lands on a
    // LATER line (single-line spans belong to livePreview). Either way resume AFTER it so
    // we never re-open inside a span we already resolved.
    let closeLi = li;
    while (closeLi + 1 < lines.length && close >= lineStart[closeLi + 1]) closeLi++;
    if (closeLi > li) spans.push({ from: i, to: close + 1 });
    i = close + 1;
  }
  return spans;
}

/** From an opening `$` at absolute index `open` (on line `openLi`), find its matching closing
 *  `$`'s absolute index, or -1. The inner content may cross newlines but not a blank line,
 *  code fence, math fence, or another `$` (a single unescaped `$` inside isn't allowed — it's
 *  the closer), and must stay within `MAX_INLINE_MATH_LINES`. The closing `$` must not be
 *  immediately preceded by whitespace (mirrors bases/markdown.ts's no-space-inside rule). */
function findClose(
  text: string,
  lines: string[],
  fenced: boolean[],
  openLi: number,
  open: number,
): number {
  let li = openLi;
  for (let j = open + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\n") {
      li++;
      if (li - openLi > MAX_INLINE_MATH_LINES) return -1;
      if (li >= lines.length) return -1;
      // A blank line, code fence, or math fence closes the paragraph → no match.
      if (fenced[li] || BLANK_LINE.test(lines[li]) || MATH_FENCE.test(lines[li])) return -1;
      continue;
    }
    if (c === "\\") { j++; continue; } // escaped char — never a delimiter
    if (c === "$") {
      if (text[j + 1] === "$") return -1; // `$$` — a display delimiter can't sit inside inline math
      const prev = text[j - 1];
      if (prev === " " || prev === "\t" || prev === "\n") return -1; // space-just-inside → invalid close
      return j;
    }
  }
  return -1;
}

function build(state: EditorState): { decos: DecorationSet; spans: MathSpan[]; atomic: DecorationSet } {
  const doc = state.doc;
  // A math widget reveals its raw source when the selection OVERLAPS it (half-open, so the caret can
  // rest exactly at either delimiter without flipping) — matching livePreview's single-line inline
  // math. A head-only rule broke drag/shift selection: the whole span flipped to raw source mid-drag
  // and the caret couldn't rest right after the math.
  const reveals = (from: number, to: number) =>
    state.selection.ranges.some((r) => r.from < to && r.to > from);
  const decos: Range<Decoration>[] = [];
  // Inactive (widget-rendered) replace ranges — also registered as EditorView.atomicRanges (see
  // mathField.provide) so the caret steps OVER the whole widget instead of falling into its hidden
  // range (which made selection stick / jump). Revealed ranges are NOT atomic → source stays editable.
  const atomic: Range<Decoration>[] = [];
  // Ranges already claimed by the `$$` block pass — the inline pass skips any span that
  // overlaps one (two replace decorations that overlap throw).
  const claimed: MathSpan[] = [];

  let inFence = false;
  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);

    // Track fenced code blocks so $$ lines inside them are ignored.
    if (CODE_FENCE.test(line.text)) {
      inFence = !inFence;
      i++;
      continue;
    }

    if (!inFence && MATH_FENCE.test(line.text)) {
      // Found an opening $$. Search forward for the matching closing $$.
      let found = false;
      for (let j = i + 1; j <= doc.lines; j++) {
        const jLine = doc.line(j);

        // A code fence inside the $$ search — treat opener as plain text, stop searching.
        if (CODE_FENCE.test(jLine.text)) break;

        if (MATH_FENCE.test(jLine.text)) {
          // Collect inner lines (between open and close, exclusive).
          const innerLines: string[] = [];
          for (let k = i + 1; k < j; k++) {
            innerLines.push(doc.line(k).text);
          }
          const expr = innerLines.join("\n");

          const blockFrom = line.from;
          const blockTo = jLine.to;
          const cursorInside = reveals(blockFrom, blockTo);
          claimed.push({ from: blockFrom, to: blockTo });

          if (!cursorInside) {
            const d = Decoration.replace({ widget: new MathBlockWidget(expr), block: true }).range(blockFrom, blockTo);
            decos.push(d);
            atomic.push(d);
          } else {
            // Editing the block → no widget, so highlight the LaTeX on each inner line and
            // dim the $$ fences (mirrors livePreview's cursor-line treatment of inline math).
            // Cover every revealed line (fences + inner) in the mono font (mathSrcMark) so
            // the gaps between colored tokens read as code, not the body serif — layered
            // under the color/delim marks (font outer, color inner). Guard empty lines:
            // a zero-length range (from === to) is an invalid mark.
            decos.push(texDelim.range(line.from, line.to), texDelim.range(jLine.from, jLine.to));
            if (line.to > line.from) decos.push(mathSrcMark.range(line.from, line.to));
            if (jLine.to > jLine.from) decos.push(mathSrcMark.range(jLine.from, jLine.to));
            for (let k = i + 1; k < j; k++) {
              const kl = doc.line(k);
              if (kl.to > kl.from) decos.push(mathSrcMark.range(kl.from, kl.to));
              for (const d of latexTokenDecorations(kl.from, kl.text)) decos.push(d);
            }
          }

          i = j + 1;
          found = true;
          break;
        }
      }
      if (!found) i++;
    } else {
      i++;
    }
  }

  // Multi-line inline `$…$` (closing `$` on a later line). The scanner already avoids `$$`
  // delimiters, code fences and blank lines; also drop any span overlapping a claimed `$$`
  // range as a hard guard against overlapping replace decorations.
  const spans = scanMultilineInlineMath(doc.toString()).filter((s) => !overlapsAny(s.from, s.to, claimed));
  for (const span of spans) {
    const inner = doc.sliceString(span.from + 1, span.to - 1);
    const cursorInside = reveals(span.from, span.to);
    if (!cursorInside) {
      const d = Decoration.replace({ widget: new InlineMathWidget(inner) }).range(span.from, span.to);
      decos.push(d);
      atomic.push(d);
    } else {
      // Editing the span → reveal raw source: dim the `$` delimiters, cover the inner text
      // (per line) in the mono font and syntax-highlight the LaTeX, so the indentation stays
      // visible and editable (mirrors the $$ cursor-inside branch above).
      const openLine = doc.lineAt(span.from).number;
      const closeLine = doc.lineAt(span.to - 1).number;
      decos.push(texDelim.range(span.from, span.from + 1), texDelim.range(span.to - 1, span.to));
      for (let k = openLine; k <= closeLine; k++) {
        const kl = doc.line(k);
        const segFrom = k === openLine ? span.from + 1 : kl.from;
        const segTo = k === closeLine ? span.to - 1 : kl.to;
        if (segTo > segFrom) {
          decos.push(mathSrcMark.range(segFrom, segTo));
          for (const d of latexTokenDecorations(segFrom, doc.sliceString(segFrom, segTo))) decos.push(d);
        }
      }
    }
  }

  return { decos: Decoration.set(decos, true), spans, atomic: Decoration.set(atomic, true) };
}

/** The math StateField. Its value carries both the decoration set and the raw multi-line
 *  inline-math spans (read by livePreview.ts). Module-level so livePreview can `state.field`
 *  it. Cross-line/block replace decorations must live in a StateField, not a ViewPlugin. */
export const mathField = StateField.define<{ decos: DecorationSet; spans: MathSpan[]; atomic: DecorationSet }>({
  create(state) {
    return build(state);
  },
  update(value, tr) {
    // Selection changes flip the caret in/out of a span (widget ↔ raw source), so rebuild
    // on selection too; otherwise just map the existing decorations through the changes.
    if (tr.docChanged || tr.selection) {
      return build(tr.state);
    }
    return { decos: value.decos.map(tr.changes), spans: value.spans, atomic: value.atomic.map(tr.changes) };
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decos),
    // Make each rendered math widget atomic so the caret steps OVER it (a bare block/inline replace
    // is NOT atomic for cursor motion, so selection would otherwise land in the hidden range).
    EditorView.atomicRanges.of((view) => view.state.field(f, false)?.atomic ?? Decoration.none),
  ],
});

/**
 * CodeMirror Extension that replaces multi-line `$$ ... $$` blocks and multi-line inline
 * `$ ... $` spans with rendered KaTeX widgets when the cursor is outside them.
 */
export function mathBlock(): Extension {
  return [
    mathField,
    EditorView.theme({
      ".cm-math-block": { display: "block", "text-align": "left", margin: "0.4em 0" },
      ".cm-math-block .katex-display": { "text-align": "left", margin: "0" },
      ".cm-math-block .katex-display > .katex": { "text-align": "left" },
    }),
  ];
}
