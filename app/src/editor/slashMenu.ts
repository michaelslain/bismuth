// app/src/editor/slashMenu.ts
// Pure, DOM-free core of the `/` slash-insertion menu (Notion-style). NO CodeMirror
// imports here, so the matcher + item table + filter run under `bun test` without a
// browser — mirroring wikilink.ts / tag.ts. The CodeMirror wiring lives in slashComplete.ts.

/** One insertable thing offered by the `/` menu. `snippet` is the literal text to insert,
 *  with a single `$0` marking where the caret lands (see parseSnippet); `keywords` widen
 *  what the user can type after `/` to find it; `reTrigger` re-opens autocomplete after the
 *  insert (so e.g. a fresh `[[` hands off to the wikilink source); `when: "docStart"` limits
 *  the item to the very top of the document (frontmatter must be the first thing in a file). */
export interface SlashItem {
  id: string;
  label: string;
  icon: string; // Lucide icon NAME (resolved lazily by the completion display)
  info: string; // tooltip shown beside the row
  keywords: string[];
  snippet: string;
  reTrigger?: boolean;
  when?: "docStart";
}

// The trigger: ignoring leading indentation and an optional list/number marker, the `/`
// must be the FIRST content character on the line (Notion-style). This is what keeps the
// menu from firing on mid-text slashes — `and/or`, file paths, `TODO: 6/9` — while still
// working after a `- ` bullet or `1. ` number. The query after the `/` is word chars only,
// so a space (or any non-word char) closes the menu.
const SLASH = /^(\s*(?:[-*+]\s+|\d+[.)]\s+)?)\/(\w*)$/;

/** Match the text before the caret against the slash trigger. `from` is the column of the
 *  `/` itself (so the replaced range covers `/query`); `query` is the word typed after it. */
export function matchSlashPrefix(textBefore: string): { from: number; query: string } | null {
  const m = textBefore.match(SLASH);
  if (!m) return null;
  return { from: m[1].length, query: m[2] };
}

/** Split a snippet on its `$0` caret marker into the literal text + the caret offset into
 *  that text. No marker ⇒ caret at the end. Pure, so it's unit-tested directly. */
export function parseSnippet(raw: string): { text: string; caret: number } {
  const i = raw.indexOf("$0");
  if (i === -1) return { text: raw, caret: raw.length };
  return { text: raw.slice(0, i) + raw.slice(i + 2), caret: i };
}

/** Are we inside a fenced code block at line `index`? Counts fence lines strictly ABOVE the
 *  current one — an odd count means we're in a block, so the slash menu (which inserts
 *  markdown) should stay quiet. Covers both ``` and ~~~ fences (CommonMark allows either,
 *  and `stripCode` in core treats them alike), plus ```query fences; indented fences too. */
export function inCodeFence(lines: string[], index: number): boolean {
  let inBlock = false;
  for (let i = 0; i < index; i++) {
    if (/^\s*(?:```|~~~)/.test(lines[i])) inBlock = !inBlock;
  }
  return inBlock;
}

// Is `needle` a subsequence of `hay` (chars in order, gaps allowed)? Both lowercased by the
// caller. This is the loosest match tier, so `tbl` finds "table" and `h1` finds "Heading 1".
function isSubsequence(needle: string, hay: string): boolean {
  let j = 0;
  for (let i = 0; i < hay.length && j < needle.length; i++) {
    if (hay[i] === needle[j]) j++;
  }
  return j === needle.length;
}

/** Rank + filter the items for a typed query. We do our own matching (not CM's label-only
 *  filter) so keywords count too. Tiers: exact label/keyword (0) > prefix (1) > subsequence
 *  (2); ties keep declared order. Empty query returns everything in declared order. */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.toLowerCase();
  if (!q) return items.slice();
  const scored: Array<{ item: SlashItem; score: number; idx: number }> = [];
  items.forEach((item, idx) => {
    const cands = [item.label.toLowerCase(), ...item.keywords.map((k) => k.toLowerCase())];
    let best = Infinity;
    for (const c of cands) {
      if (c === q) best = Math.min(best, 0);
      else if (c.startsWith(q)) best = Math.min(best, 1);
      else if (isSubsequence(q, c)) best = Math.min(best, 2);
    }
    if (best !== Infinity) scored.push({ item, score: best, idx });
  });
  scored.sort((a, b) => a.score - b.score || a.idx - b.idx);
  return scored.map((s) => s.item);
}

// The catalog. `$0` marks the caret. Order here is the order shown for an empty `/`.
export const SLASH_ITEMS: SlashItem[] = [
  { id: "h1", label: "Heading 1", icon: "Heading1", info: "Big section heading.", keywords: ["heading", "h1", "title"], snippet: "# $0" },
  { id: "h2", label: "Heading 2", icon: "Heading2", info: "Medium section heading.", keywords: ["heading", "h2", "subtitle"], snippet: "## $0" },
  { id: "h3", label: "Heading 3", icon: "Heading3", info: "Small section heading.", keywords: ["heading", "h3"], snippet: "### $0" },
  { id: "ul", label: "Bullet list", icon: "List", info: "Unordered list item.", keywords: ["bullet", "list", "unordered", "ul"], snippet: "- $0" },
  { id: "ol", label: "Numbered list", icon: "ListOrdered", info: "Ordered list item.", keywords: ["numbered", "list", "ordered", "ol"], snippet: "1. $0" },
  { id: "task", label: "To-do", icon: "ListChecks", info: "Checkbox task.", keywords: ["task", "todo", "checkbox", "check"], snippet: "- [ ] $0" },
  { id: "quote", label: "Quote", icon: "TextQuote", info: "Block quote.", keywords: ["quote", "blockquote", "citation"], snippet: "> $0" },
  { id: "callout", label: "Callout", icon: "Megaphone", info: "Obsidian-style admonition callout.", keywords: ["callout", "admonition", "note", "warning", "info", "tip", "aside"], snippet: "> [!note] $0" },
  { id: "table", label: "Table", icon: "Table", info: "Markdown table.", keywords: ["table", "grid", "tbl"], snippet: "| $0 |  |\n| --- | --- |\n|  |  |" },
  { id: "code", label: "Code block", icon: "Code", info: "Fenced code block.", keywords: ["code", "fence", "codeblock", "snippet"], snippet: "```\n$0\n```" },
  { id: "query", label: "Query block", icon: "Database", info: "Embedded base / query block.", keywords: ["query", "base", "view", "dataview", "db"], snippet: "```query\n$0\n```", reTrigger: true },
  { id: "math", label: "Math block", icon: "Sigma", info: "Block LaTeX equation.", keywords: ["math", "latex", "equation", "tex", "formula"], snippet: "$$\n$0\n$$" },
  // Leading "\n" so the rule is preceded by a blank line — a "---" directly under a non-blank
  // paragraph is a SETEXT H2 underline in CommonMark/GFM (it would turn that paragraph into a
  // heading on export), not a thematic break. The blank line forces a real <hr>.
  { id: "divider", label: "Divider", icon: "Minus", info: "Horizontal rule.", keywords: ["divider", "rule", "separator", "hr", "horizontal"], snippet: "\n---\n$0" },
  // A lone `<!-- pagebreak -->` comment line: invisible on screen + in Obsidian, but the PDF
  // exporter (htmlToPdf) slices a new page at it. Becomes a real <div> before sanitize (which
  // strips comments) via bases/markdown.ts so the page-break survives into the rendered HTML.
  { id: "pagebreak", label: "Page break", icon: "SeparatorHorizontal", info: "Forces a new page in PDF export.", keywords: ["page", "break", "pagebreak", "pdf", "print"], snippet: "<!-- pagebreak -->\n$0" },
  { id: "wikilink", label: "Link to note", icon: "Link", info: "Insert a [[wikilink]].", keywords: ["link", "wikilink", "internal", "ref", "note"], snippet: "[[$0]]", reTrigger: true },
  { id: "embed", label: "Embed", icon: "Image", info: "Embed a note, image, or file.", keywords: ["embed", "image", "attachment", "file", "transclude"], snippet: "![[$0]]", reTrigger: true },
  { id: "properties", label: "Properties", icon: "FileText", info: "Add a frontmatter / properties block (top of the note).", keywords: ["properties", "frontmatter", "yaml", "metadata", "props", "tags"], snippet: "---\ntags: $0\n---\n", when: "docStart" },
];
