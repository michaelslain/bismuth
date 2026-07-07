// Whole-word, case-insensitive matcher for the literal word "bismuth" — shared by the
// reading-mode markdown renderer (a masking pre-pass in bases/markdown.ts) and the live-preview
// editor decoration (livePreview.ts), so both surfaces agree on exactly what counts as a stylable
// "bismuth" token. Each wraps the match in an iridescent bismuth-crystal gradient span (see
// `.bismuth-word` / `.cm-bismuth` in App.css).
//
// A match is bounded by a non-letter / non-number on BOTH sides (Unicode-aware), so "bismuth" and
// "bismuth-crystal" match, while "bismuths", "embismuth", and "bismuth2" do not. Case is preserved
// by the caller (the matched substring is re-emitted verbatim).

// The canonical pattern. Stateless copies are minted per use so no `lastIndex` state leaks.
const BISMUTH_SRC = "(?<![\\p{L}\\p{N}])bismuth(?![\\p{L}\\p{N}])";

// "Does this text contain the word at all?" form (no `g` flag → `.test()`/`.search()` are safe to
// call repeatedly). Used as a cheap gate (e.g. Base-cell markup detection).
export const BISMUTH_SCAN_RE = new RegExp(BISMUTH_SRC, "iu");

export interface BismuthSpan {
  from: number; // offset of the first char of the match within `text`
  to: number; // offset just past the last char
}

/** Every whole-word "bismuth" occurrence in `text` (offsets within `text`). Pure. */
export function findBismuthWords(text: string): BismuthSpan[] {
  const re = new RegExp(BISMUTH_SRC, "giu");
  const out: BismuthSpan[] = [];
  for (const m of text.matchAll(re)) {
    const from = m.index ?? 0;
    out.push({ from, to: from + m[0].length });
  }
  return out;
}

/** Replace every whole-word "bismuth" in `text` via `wrap(word)`, leaving all other text (and the
 *  original casing of each match) untouched. Used by the reading-mode renderer to inject the
 *  iridescent span into already-protected (code/URL/anchor-masked) prose. */
export function wrapBismuthWords(text: string, wrap: (word: string) => string): string {
  return text.replace(new RegExp(BISMUTH_SRC, "giu"), (m) => wrap(m));
}

/** Wrap every whole-word "bismuth" in a raw markdown/HTML SOURCE via `wrap(word)`, while never
 *  touching a protected region — the mask → wrap → restore transform shared by every surface that
 *  injects the iridescent span into raw source (reading-mode `bases/markdown.ts`, the editable
 *  table-cell renderer `editor/inlineMarkdown.ts`). Each caller passes its OWN `protectRe` (a
 *  global-flagged regex matching the spans it must not touch — code / links / URLs / wikilinks /
 *  tags / HTML), so the two surfaces can protect slightly different things while sharing the
 *  error-prone masking boilerplate. Every masked span is restored verbatim before the result is
 *  handed to the markdown engine, so over-masking only ever SKIPS the effect on an edge — it never
 *  corrupts output. Cheap-gated (no whole-word match → the input is returned untouched). Pure. */
export function bismuthWrapSource(src: string, protectRe: RegExp, wrap: (word: string) => string): string {
  if (!BISMUTH_SCAN_RE.test(src)) return src;
  const codes: string[] = [];
  // A private-use sentinel (built at runtime so no raw control char lives in the source) brackets
  // each masked index; unlike a bare number/space token it can't collide with real prose (a lone
  // "5" or a literal `<…>`), and it's restored verbatim before the markdown engine ever sees it.
  const S = String.fromCharCode(0xe000);
  const masked = src.replace(protectRe, (m) => S + (codes.push(m) - 1) + S);
  const wrapped = wrapBismuthWords(masked, wrap);
  return wrapped.replace(new RegExp(S + "(\\d+)" + S, "g"), (_m, i) => codes[Number(i)] ?? "");
}
