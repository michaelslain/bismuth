// app/src/editor/latexHighlight.ts
//
// Syntax highlighting for LaTeX/TeX math SOURCE while it's being edited. Off the cursor
// line, `$…$` / `$$…$$` math is replaced by a rendered KaTeX widget (livePreview.ts,
// mathBlock.ts); ON the cursor line the raw source is shown so you can edit it — this
// module colors that raw source so editing math reads like code instead of flat prose.
//
// `tokenizeLatex` is pure + DOM-free (unit-tested in latexHighlight.test.ts).
// `latexTokenDecorations` wraps it into CodeMirror mark decorations; the two reveal
// sites push those alongside their existing decorations. Colors live in the theme below,
// matching the One Dark palette used by fenced code (codeHighlight.ts) so math source
// and code blocks read consistently.

import { Decoration, EditorView } from "@codemirror/view";
import type { Range } from "@codemirror/state";

export type LatexToken = { from: number; to: number; cls: string };

const LETTER = /[A-Za-z]/;

/** Tokenize a LaTeX/TeX fragment for highlighting. Offsets are RELATIVE to `src`.
 *  Lexically LaTeX is tiny: control sequences (`\frac`, `\,`, `\\`), grouping (`{}[]`),
 *  sub/superscript markers (`^` `_`), `%` line comments, and numbers; everything else
 *  (letters, operators) inherits the editor foreground. Pure — no CodeMirror imports. */
export function tokenizeLatex(src: string): LatexToken[] {
  const toks: LatexToken[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    // `%` line comment → to end of line (LaTeX comments; `\%` is an escaped percent and
    // is consumed by the control-sequence branch below, so a bare `%` here is a comment).
    if (c === "%") {
      let j = i + 1;
      while (j < n && src[j] !== "\n") j++;
      toks.push({ from: i, to: j, cls: "cm-tex-comment" });
      i = j;
      continue;
    }
    // Control sequence: `\` + letters (`\frac`, `\alpha`) OR `\` + one non-letter
    // (`\{`, `\\`, `\,`, `\%`) — the escaped-single-char form.
    if (c === "\\") {
      let j = i + 1;
      if (j < n && LETTER.test(src[j])) {
        while (j < n && LETTER.test(src[j])) j++;
      } else if (j < n) {
        j++;
      }
      toks.push({ from: i, to: j, cls: "cm-tex-command" });
      i = j;
      continue;
    }
    // Grouping + optional-argument brackets.
    if (c === "{" || c === "}" || c === "[" || c === "]") {
      toks.push({ from: i, to: i + 1, cls: "cm-tex-bracket" });
      i++;
      continue;
    }
    // Sub/superscript markers.
    if (c === "^" || c === "_") {
      toks.push({ from: i, to: i + 1, cls: "cm-tex-script" });
      i++;
      continue;
    }
    // Numbers (a run of digits, with interior dots: `3`, `3.14`).
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && ((src[j] >= "0" && src[j] <= "9") || (src[j] === "." && src[j + 1] >= "0" && src[j + 1] <= "9"))) j++;
      toks.push({ from: i, to: j, cls: "cm-tex-number" });
      i = j;
      continue;
    }
    i++;
  }
  return toks;
}

// One Decoration.mark per class, cached (CM dedupes identical marks anyway, but this
// avoids reallocating on every rebuild).
const markCache = new Map<string, Decoration>();
function mark(cls: string): Decoration {
  let m = markCache.get(cls);
  if (!m) {
    m = Decoration.mark({ class: cls });
    markCache.set(cls, m);
  }
  return m;
}

/** Dim mark for the `$` / `$$` delimiters, mirroring how livePreview reveals other
 *  syntax marks (`**`, `` ` ``) on the cursor line. */
export const texDelim = mark("cm-tex-delim");

/** Covering mono-font mark for the WHOLE revealed math source (the inner `$…$` range),
 *  layered UNDER the per-token color marks. The token marks (cm-tex-*) only color the
 *  delimiters/commands/braces; the gaps between them (letters, operators) would otherwise
 *  inherit the body serif. This mark gives the whole revealed range Monaspace so editing
 *  LaTeX reads as code — color marks layered on top still apply (font outer, color inner). */
export const mathSrcMark = Decoration.mark({ class: "cm-math-src" });

/** LaTeX token mark decorations for `src`, offset so range starts at `offset`.
 *  Caller pushes these into its decoration array (ranges are pre-offset, unsorted —
 *  rely on `Decoration.set(decos, true)` to sort). */
export function latexTokenDecorations(offset: number, src: string): Range<Decoration>[] {
  return tokenizeLatex(src).map((tok) => mark(tok.cls).range(offset + tok.from, offset + tok.to));
}

/** Colors for the `cm-tex-*` token classes — sourced from the theme CSS vars
 *  (settingsCssVars.ts) so math source re-tints per theme, matching codeHighlight.ts.
 *  CodeMirror's theme accepts `color: "var(--x)"` (proven by codeHighlight's propertyName). */
export const latexHighlightTheme = EditorView.theme({
  ".cm-tex-command": { color: "var(--accent-purple)" }, // \frac, \alpha … (keyword purple)
  ".cm-tex-bracket": { color: "var(--text-muted)" }, // { } [ ]            (punctuation grey)
  ".cm-tex-script": { color: "var(--teal)" }, //  ^ _                  (escape teal)
  ".cm-tex-number": { color: "var(--gold)" }, //  0-9                  (number gold)
  ".cm-tex-comment": { color: "var(--text-muted)", fontStyle: "italic" }, // % …  (comment grey)
  // `$` / `$$` delimiters — a dim color that recedes. No `--faint`-equiv color var ships,
  // so mix the foreground toward transparent (matches settingsCssVars' --faint formula).
  ".cm-tex-delim": { color: "color-mix(in srgb, var(--fg) 45%, transparent)" },
  // Covering mono font for revealed math source (mathSrcMark), so the gaps between
  // colored tokens read as code instead of the body serif.
  ".cm-math-src": { fontFamily: "'Monaspace Xenon', ui-monospace, monospace" },
});
