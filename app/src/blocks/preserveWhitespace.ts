// app/src/blocks/preserveWhitespace.ts
// A `$remark` transformer that RECOVERS the leading + trailing inline whitespace of a paragraph
// that CommonMark strips at parse time — so a visual edit of `"foo   "` round-trips to `"foo   "`
// (not `"foo"`), matching the verbatim block model + the CodeMirror Editor.
//
// WHY parse-time, not serialize-time: mdast-util-from-markdown / micromark drop the leading and
// trailing run of spaces/tabs around a paragraph's inline content (CommonMark normalization). By
// the time the text reaches the ProseMirror doc the bytes are already gone, so the serializer has
// nothing to emit. They are NOT in any `text` node — but they ARE still locatable, because the
// `paragraph` node's `position` spans the FULL source (incl. the stripped affixes) while its first
// / last child's `position` covers only the kept content. The gap between the two = the stripped
// whitespace, which we read back out of the source `vfile` and re-attach as explicit `text` nodes
// so it lives in the doc model and survives the round-trip.
//
//   "foo   "      paragraph [0..6]   text "foo" [0..3]   → trailing gap source[3..6] = "   "
//   "  bar"       paragraph [2..5]   text "bar" [2..5]   → leading gap source[0..2]  = "  "
//
// ORDERING: registered BEFORE the inline-atom tokenizers (inlineNodes.ts) + Milkdown's own text-
// splitting remark plugins (remarkLineBreak), so every paragraph child still carries its original
// parse `position`. We only ever read positions + APPEND/PREPEND a leaf `text` node; we never move
// or re-split existing nodes, so the downstream tokenizers see a normal tree.
//
// HARD-BREAK SAFETY: 2+ trailing spaces FOLLOWED by more text is a CommonMark hard line break
// (a `break` node) — that path is owned by Shift-Enter / remarkLineBreak and is untouched here:
// we only fill a PURE-whitespace gap at the very START / END of the paragraph's content (i.e. the
// affixes that have NO following/preceding content on their side), never an interior run.

import { $remark } from "@milkdown/utils";
import type { MilkdownPlugin } from "@milkdown/ctx";

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

interface VFileLike {
  value?: unknown;
}

/** Only spaces + tabs (a CommonMark inline whitespace run). A newline would be a block boundary /
 *  hard break, never an affix we own — so it disqualifies the gap. */
function isInlineWhitespace(s: string): boolean {
  return s.length > 0 && /^[ \t]+$/.test(s);
}

/** The offset of the start of the source LINE containing `offset` (walk back to a `\n` or BOL).
 *  Leading whitespace is stripped from the paragraph's OWN position span (a paragraph node starts
 *  AFTER its indent), so to find the leading affix we compare the first child's start against the
 *  start of its line — which, for this inline-only surface, is the start of the (single-line) source. */
function lineStart(source: string, offset: number): number {
  let i = offset;
  while (i > 0 && source[i - 1] !== "\n") i--;
  return i;
}

/** Walk every paragraph and re-attach its stripped leading / trailing whitespace from `source`. */
function recoverAffixes(tree: MdNode, source: string): void {
  // A source that is ENTIRELY inline whitespace (`"   "`) parses to an EMPTY root — CommonMark
  // drops a blank line — so there is no paragraph to fix. Re-seed a paragraph holding the verbatim
  // whitespace so a whitespace-only block round-trips instead of collapsing to "".
  if (tree.type === "root" && (!tree.children || tree.children.length === 0) && isInlineWhitespace(source)) {
    tree.children = [{ type: "paragraph", children: [{ type: "text", value: source }] }];
    return;
  }
  visit(tree);

  function visit(node: MdNode): void {
    if (node.type === "paragraph") restore(node, source);
    if (node.children) for (const child of node.children) visit(child);
  }
}

function restore(para: MdNode, source: string): void {
  const kids = para.children;
  if (!kids || kids.length === 0) return;
  const paraEnd = para.position?.end.offset;

  // Trailing: gap between the last child's end and the paragraph's end (both incl. the affix).
  const last = kids[kids.length - 1];
  const lastEnd = last.position?.end.offset;
  if (paraEnd !== undefined && lastEnd !== undefined && lastEnd < paraEnd) {
    const gap = source.slice(lastEnd, paraEnd);
    if (isInlineWhitespace(gap)) {
      // Merge into a trailing text node if there already is one, else append a fresh leaf.
      if (last.type === "text" && typeof last.value === "string") last.value += gap;
      else kids.push({ type: "text", value: gap });
    }
  }

  // Leading: gap between the first child's start and the start of ITS line (the paragraph's own
  // start is already past the indent, so compare against the line start instead).
  const first = kids[0];
  const firstStart = first.position?.start.offset;
  if (firstStart !== undefined) {
    const gap = source.slice(lineStart(source, firstStart), firstStart);
    if (isInlineWhitespace(gap)) {
      if (first.type === "text" && typeof first.value === "string") first.value = gap + first.value;
      else kids.unshift({ type: "text", value: gap });
    }
  }
}

/** The `$remark` plugin pair: recover paragraph affix whitespace from the source vfile. */
export const preserveAffixWhitespace: MilkdownPlugin[] = $remark(
  "bismuthPreserveAffixWhitespace",
  () => () => (tree: unknown, file: unknown) => {
    const source = (file as VFileLike | undefined)?.value;
    if (typeof source !== "string") return; // no source (shouldn't happen) → no-op
    recoverAffixes(tree as MdNode, source);
  },
) as unknown as MilkdownPlugin[];

// Re-exported for the round-trip test.
export { isInlineWhitespace };
