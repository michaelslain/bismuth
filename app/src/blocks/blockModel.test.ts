// app/src/blocks/blockModel.test.ts
// The lossless gate. parse->serialize MUST be the identity for any markdown; an edit must
// touch only its target block and leave every other block byte-identical.

import { test, expect, describe } from "bun:test";
import {
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
  setBlockText,
  reconcileEditedBlock,
  toggleTaskChecked,
  setHeadingLevel,
  blockTypeForSlashItem,
  SLASH_ITEM_BLOCK_TYPES,
  type Block,
} from "./blockModel";

function roundtrip(md: string): string {
  const { frontmatter, blocks } = parseMarkdownToBlocks(md);
  return serializeBlocksToMarkdown(frontmatter, blocks);
}

// ---------------------------------------------------------------------------------------
// (1) Identity corpus
// ---------------------------------------------------------------------------------------

const CORPUS: Record<string, string> = {
  empty: "",
  blankOnly: "\n",
  blanksOnly: "\n\n\n",
  singleParagraph: "Just a line of text.\n",
  noTrailingNewline: "No trailing newline here.",
  headings: "# Title\n\n## Section\n\nSome body text.\n\n### Sub\nMore text.\n",
  mixedLists:
    "- one\n- two\n  - nested two-a\n  - nested two-b\n- three\n\n1. first\n2. second\n3) third\n",
  tasksNested:
    "- [ ] top task\n  - [x] done child\n  - [ ] open child\n    - [ ] grandchild\n- [x] another done\n",
  fencedCodeWithBlanks:
    "Before code.\n\n```js\nconst a = 1;\n\nconst b = 2;\n\nfunction f() {\n  return a + b;\n}\n```\n\nAfter code.\n",
  fencedNoLang: "```\nplain code\n  indented\n```\n",
  gfmTable:
    "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |\n\nText after table.\n",
  blockquote: "> a quote\n> spanning two lines\n>\n> and a third paragraph\n\nOutside.\n",
  mathBlock: "Inline before.\n\n$$\nE = mc^2\n\n\\sum_{i=0}^n i\n$$\n\nAfter.\n",
  rawHtml: '<div class="note">\n  <span>hello</span>\n</div>\n\nNormal paragraph.\n',
  horizontalRules: "Above.\n\n---\n\nBetween.\n\n***\n\nBelow.\n",
  imageStandalone: "![alt text](https://example.com/x.png)\n\nCaption paragraph.\n",
  withFrontmatter:
    "---\ntitle: My Note\ntags: [a, b]\n---\n\n# Heading\n\nBody text.\n",
  frontmatterNoBlank: "---\nfoo: bar\n---\nImmediately after.\n",
  crlfDoc: "# CRLF\r\n\r\nA line.\r\n- item\r\n",
  everything:
    "---\nx: 1\n---\n# H1\n\npara one\npara two\n\n- a\n- b\n\n1. one\n2. two\n\n- [ ] todo\n- [x] done\n\n> quote\n\n```ts\nlet z = 0;\n```\n\n$$\na^2 + b^2\n$$\n\n| h | k |\n| - | - |\n| 1 | 2 |\n\n<br>\n\n---\n\nlast paragraph\n",
  trailingBlanks: "Paragraph.\n\n\n\n",
  consecutiveStructures: "# H\n## H2\n- x\n> q\n---\ntext\n",
  unclosedFence: "```js\nnever closed\nstill code\n",
  calloutBasic: "> [!note] Heads up\n> Body line one.\n> Body line two.\n\nAfter.\n",
  calloutNoTitle: "> [!tip]\n> Just a tip.\n",
  calloutFoldable: "> [!warning]+ Expanded\n> hidden when collapsed\n",
  calloutCollapsed: "> [!danger]- Collapsed danger\n> body\n",
  calloutAlias: "> [!info] aliased to note\n> body\n",
  calloutHeaderOnly: "> [!bug]\n\nNext.\n",
  calloutThenQuote: "> [!note] A\n> body\n\n> a plain quote\n> still plain\n",
};

describe("identity corpus", () => {
  for (const [name, md] of Object.entries(CORPUS)) {
    test(`roundtrip: ${name}`, () => {
      expect(roundtrip(md)).toBe(md);
    });
  }
});

// ---------------------------------------------------------------------------------------
// (2) Deterministic fuzz (no Math.random): combine corpus fragments in seeded orders.
// ---------------------------------------------------------------------------------------

const FRAGMENTS: string[] = [
  "# Heading\n",
  "## Subheading\n",
  "Plain paragraph line.\n",
  "Two\nline paragraph.\n",
  "- bullet a\n- bullet b\n",
  "  - nested bullet\n",
  "1. first\n2. second\n",
  "- [ ] open task\n",
  "- [x] done task\n",
  "  - [ ] nested task\n",
  "> a quote line\n",
  "```js\nx = 1;\n```\n",
  "```\n\nblank in code\n\n```\n",
  "$$\na = b\n$$\n",
  "| a | b |\n| - | - |\n| 1 | 2 |\n",
  "<div>html</div>\n",
  "---\n",
  "![img](u.png)\n",
  "\n",
  "\n\n",
];

const GAPS = ["", "\n", "\n\n"];

describe("deterministic fuzz", () => {
  test("200 seeded bodies round-trip", () => {
    let checked = 0;
    for (let seed = 0; seed < 200; seed++) {
      // Build a body by picking 2-6 fragments interleaved with gaps, indices derived from
      // the seed via cheap LCG-style mixing (fully deterministic, no Math.random).
      const count = 2 + (seed % 5);
      let s = seed * 2654435761 + 12345;
      let body = "";
      for (let n = 0; n < count; n++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const frag = FRAGMENTS[s % FRAGMENTS.length];
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const gap = GAPS[s % GAPS.length];
        body += frag + gap;
      }
      // Optionally prepend frontmatter on even seeds.
      const md = seed % 2 === 0 ? body : "---\nseed: " + seed + "\n---\n" + body;
      expect(roundtrip(md)).toBe(md);
      checked++;
    }
    expect(checked).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------
// (3) Edit round-trip: only the targeted block changes; the rest stay byte-identical.
// ---------------------------------------------------------------------------------------

/** Assert that editing block at `idx` (via `edit`) leaves every OTHER block's raw unchanged,
 *  the targeted block's raw DID change, and the targeted block re-parses to the same type. */
function assertSurgicalEdit(md: string, idx: number, edit: (b: Block) => Block) {
  const { frontmatter, blocks } = parseMarkdownToBlocks(md);
  const before = blocks.map((b) => b.raw);
  const edited = blocks.slice();
  edited[idx] = edit(blocks[idx]);

  // Every untouched block byte-identical.
  edited.forEach((b, i) => {
    if (i !== idx) expect(b.raw).toBe(before[i]);
  });
  // Target changed.
  expect(edited[idx].raw).not.toBe(before[idx]);

  // Re-serialize + re-parse: targeted block keeps its type, others unchanged.
  const out = serializeBlocksToMarkdown(frontmatter, edited);
  const reparsed = parseMarkdownToBlocks(out);
  expect(reparsed.blocks[idx].type).toBe(blocks[idx].type);
  reparsed.blocks.forEach((b, i) => {
    if (i !== idx) expect(b.raw).toBe(before[i]);
  });
  return { out, reparsed, edited };
}

describe("edit round-trip", () => {
  test("change a paragraph's text", () => {
    const md = "# Title\n\nold paragraph text.\n\n- a list item\n";
    const { blocks } = parseMarkdownToBlocks(md);
    const pIdx = blocks.findIndex((b) => b.type === "paragraph");
    const { reparsed } = assertSurgicalEdit(md, pIdx, (b) => setBlockText(b, "new paragraph text."));
    expect(reparsed.blocks[pIdx].text).toBe("new paragraph text.");
    // The blank line between blocks is its own block; the paragraph's raw is just its line.
    expect(reparsed.blocks[pIdx].raw).toBe("new paragraph text.\n");
  });

  test("toggle a task", () => {
    const md = "- [ ] do the thing\n- [x] already done\n";
    const { blocks } = parseMarkdownToBlocks(md);
    const tIdx = blocks.findIndex((b) => b.type === "task" && !b.checked);
    const { reparsed } = assertSurgicalEdit(md, tIdx, (b) => toggleTaskChecked(b));
    expect(reparsed.blocks[tIdx].checked).toBe(true);
    expect(reparsed.blocks[tIdx].raw).toBe("- [x] do the thing\n");
  });

  test("toggle a nested task preserves indent", () => {
    const md = "- [ ] top\n    - [ ] child\n";
    const { blocks } = parseMarkdownToBlocks(md);
    const childIdx = blocks.findIndex((b) => b.type === "task" && (b.indent ?? "").length > 0);
    const { reparsed } = assertSurgicalEdit(md, childIdx, (b) => toggleTaskChecked(b));
    expect(reparsed.blocks[childIdx].raw).toBe("    - [x] child\n");
    expect(reparsed.blocks[childIdx].indent).toBe("    ");
  });

  test("change heading level", () => {
    const md = "# top\n\n## section\n\nbody\n";
    const { blocks } = parseMarkdownToBlocks(md);
    const hIdx = blocks.findIndex((b) => b.type === "heading" && b.level === 2);
    const { reparsed } = assertSurgicalEdit(md, hIdx, (b) => setHeadingLevel(b, 4));
    expect(reparsed.blocks[hIdx].level).toBe(4);
    expect(reparsed.blocks[hIdx].raw).toBe("#### section\n");
  });

  test("edit a code block body", () => {
    const md = "```ts\nold();\n```\n\nafter\n";
    const { blocks } = parseMarkdownToBlocks(md);
    const cIdx = blocks.findIndex((b) => b.type === "code");
    const { reparsed } = assertSurgicalEdit(md, cIdx, (b) => setBlockText(b, "next();\nmore();"));
    expect(reparsed.blocks[cIdx].type).toBe("code");
    expect(reparsed.blocks[cIdx].lang).toBe("ts");
    expect(reparsed.blocks[cIdx].text).toBe("next();\nmore();");
  });

  test("edit a list item text", () => {
    const md = "- alpha\n- beta\n- gamma\n";
    const { blocks } = parseMarkdownToBlocks(md);
    const { reparsed } = assertSurgicalEdit(md, 1, (b) => setBlockText(b, "BETA"));
    expect(reparsed.blocks[1].raw).toBe("- BETA\n");
  });

  test("edit within a frontmatter'd note leaves frontmatter verbatim", () => {
    const md = "---\ntitle: Keep Me\ntags: [x]\n---\n\npara to edit.\n";
    const { frontmatter, blocks } = parseMarkdownToBlocks(md);
    expect(frontmatter).toBe("---\ntitle: Keep Me\ntags: [x]\n---\n");
    const pIdx = blocks.findIndex((b) => b.type === "paragraph");
    const edited = blocks.slice();
    edited[pIdx] = setBlockText(blocks[pIdx], "edited para.");
    const out = serializeBlocksToMarkdown(frontmatter, edited);
    expect(out.startsWith("---\ntitle: Keep Me\ntags: [x]\n---\n")).toBe(true);
    expect(out).toContain("edited para.");
  });
});

// ---------------------------------------------------------------------------------------
// Block classification + slash mapping sanity
// ---------------------------------------------------------------------------------------

describe("classification", () => {
  test("recognises each block type", () => {
    const { blocks } = parseMarkdownToBlocks(CORPUS.everything);
    const types = new Set(blocks.map((b) => b.type));
    for (const t of ["heading", "paragraph", "bulletItem", "orderedItem", "task", "quote", "code", "mathBlock", "table", "html", "divider", "blank"]) {
      expect(types.has(t as any)).toBe(true);
    }
  });

  test("heading level captured", () => {
    const { blocks } = parseMarkdownToBlocks("# a\n## b\n### c\n");
    expect(blocks.filter((b) => b.type === "heading").map((b) => b.level)).toEqual([1, 2, 3]);
  });

  test("frontmatter prefix is verbatim and excluded from blocks", () => {
    const { frontmatter, blocks } = parseMarkdownToBlocks("---\na: 1\n---\nbody\n");
    expect(frontmatter).toBe("---\na: 1\n---\n");
    expect(blocks.every((b) => b.type !== "frontmatter")).toBe(true);
  });
});

describe("callouts", () => {
  test("a callout header parses to a `callout` block, not a `quote`", () => {
    const { blocks } = parseMarkdownToBlocks("> [!note] Title\n> body\n");
    expect(blocks[0].type).toBe("callout");
    expect(blocks[0].calloutType).toBe("note");
    expect(blocks[0].calloutTitle).toBe("Title");
    expect(blocks[0].text).toBe("body");
  });

  test("an alias folds to its canonical type but the header line stays verbatim", () => {
    const { blocks } = parseMarkdownToBlocks("> [!info] x\n> y\n");
    expect(blocks[0].calloutType).toBe("note"); // info → note
    expect(blocks[0].calloutHeaderRaw).toBe("> [!info] x"); // verbatim, un-normalised
  });

  test("fold markers are captured", () => {
    expect(parseMarkdownToBlocks("> [!warning]+ e\n> b\n").blocks[0]).toMatchObject({ foldable: true, collapsed: false });
    expect(parseMarkdownToBlocks("> [!warning]- c\n> b\n").blocks[0]).toMatchObject({ foldable: true, collapsed: true });
    expect(parseMarkdownToBlocks("> [!warning] n\n> b\n").blocks[0]).toMatchObject({ foldable: false });
  });

  test("a plain blockquote is still a `quote` block", () => {
    expect(parseMarkdownToBlocks("> just a quote\n> line two\n").blocks[0].type).toBe("quote");
  });

  test("editing a callout body re-emits a callout of the same type (surgical edit)", () => {
    const md = "> [!warning]+ Heads up\n> old body\n\nAfter.\n";
    const { blocks } = parseMarkdownToBlocks(md);
    const { reparsed } = assertSurgicalEdit(md, 0, (b) => setBlockText(b, "new body"));
    expect(reparsed.blocks[0].type).toBe("callout");
    expect(reparsed.blocks[0].calloutType).toBe("warning");
    expect(reparsed.blocks[0].text).toBe("new body");
    // Header preserved byte-for-byte through the edit.
    expect(reparsed.blocks[0].raw.startsWith("> [!warning]+ Heads up\n")).toBe(true);
  });

  test("emptying a callout body leaves just the header line", () => {
    const { blocks } = parseMarkdownToBlocks("> [!note] T\n> body\n");
    const r = reconcileEditedBlock(setBlockText(blocks[0], ""));
    expect(r.length).toBe(1);
    expect(r[0].type).toBe("callout");
    expect(r[0].raw.replace(/\n+$/, "")).toBe("> [!note] T");
  });
});

describe("slash-item mapping", () => {
  test("known ids map to expected block types", () => {
    expect(blockTypeForSlashItem("h1")).toBe("heading");
    expect(blockTypeForSlashItem("ul")).toBe("bulletItem");
    expect(blockTypeForSlashItem("ol")).toBe("orderedItem");
    expect(blockTypeForSlashItem("task")).toBe("task");
    expect(blockTypeForSlashItem("quote")).toBe("quote");
    expect(blockTypeForSlashItem("callout")).toBe("callout");
    expect(blockTypeForSlashItem("table")).toBe("table");
    expect(blockTypeForSlashItem("code")).toBe("code");
    expect(blockTypeForSlashItem("query")).toBe("code");
    expect(blockTypeForSlashItem("math")).toBe("mathBlock");
    expect(blockTypeForSlashItem("divider")).toBe("divider");
    expect(blockTypeForSlashItem("embed")).toBe("image");
    expect(blockTypeForSlashItem("properties")).toBe("frontmatter");
  });

  test("SLASH_ITEM_BLOCK_TYPES covers the whole catalog", () => {
    expect(Object.keys(SLASH_ITEM_BLOCK_TYPES).length).toBeGreaterThan(0);
    expect(SLASH_ITEM_BLOCK_TYPES["h2"]).toBe("heading");
  });
});

// ---------------------------------------------------------------------------------------
// (4) Edit reconciliation — the model must never diverge from what the .md re-parses to.
//     An edit that introduces a newline (Shift+Enter / paste) or a markdown prefix changes
//     the block structure; reconcileEditedBlock realigns the in-memory blocks with disk
//     WITHOUT losing bytes, so the note never silently restructures on reload.
// ---------------------------------------------------------------------------------------

describe("edit reconciliation", () => {
  const first = (md: string): Block => parseMarkdownToBlocks(md).blocks[0];
  // The invariant: re-parsing the reconciled blocks' raw yields the SAME types (model == disk).
  function modelMatchesDisk(blocks: Block[]): void {
    const md = blocks.map((b) => b.raw).join("");
    const reparsed = parseMarkdownToBlocks(md).blocks;
    expect(reparsed.map((b) => b.type)).toEqual(blocks.map((b) => b.type));
  }

  test("heading with a pasted newline splits into heading + paragraph", () => {
    const h = first("# Title\n");
    const r = reconcileEditedBlock({ ...h, text: "Title\nsubtitle" });
    expect(r.map((b) => b.type)).toEqual(["heading", "paragraph"]);
    expect(r[0].id).toBe(h.id); // first keeps id → textarea stays focused
    modelMatchesDisk(r);
  });

  test("list item with a newline splits (2nd line escapes the list)", () => {
    const b = first("- one\n");
    const r = reconcileEditedBlock({ ...b, text: "one\ntwo" });
    expect(r.length).toBeGreaterThan(1);
    expect(r[0].type).toBe("bulletItem");
    modelMatchesDisk(r);
  });

  test("paragraph gaining a '# ' prefix becomes a heading (markdown shortcut)", () => {
    const p = first("hello\n");
    const r = reconcileEditedBlock({ ...p, text: "# hello" });
    expect(r.map((b) => b.type)).toEqual(["heading"]);
    expect(r[0].id).toBe(p.id);
    expect(r[0].level).toBe(1);
    modelMatchesDisk(r);
  });

  test("paragraph gaining a '- ' prefix becomes a bullet", () => {
    const p = first("hello\n");
    const r = reconcileEditedBlock({ ...p, text: "- hello" });
    expect(r.map((b) => b.type)).toEqual(["bulletItem"]);
    modelMatchesDisk(r);
  });

  test("unchanged-structure edit keeps the block (same id, single result)", () => {
    const p = first("hello\n");
    const r = reconcileEditedBlock({ ...p, text: "hello there" });
    expect(r.length).toBe(1);
    expect(r[0].type).toBe("paragraph");
    expect(r[0].id).toBe(p.id);
    expect(r[0].text).toBe("hello there");
  });

  test("emptying a block keeps it an editable block of its own type", () => {
    const h = first("## Section\n");
    const r = reconcileEditedBlock({ ...h, text: "" });
    expect(r.length).toBe(1);
    expect(r[0].type).toBe("heading");
  });

  test("code block containing a ``` line stays ONE code block (fence lengthened)", () => {
    const c = first("```\nx\n```\n");
    expect(c.type).toBe("code");
    const r = reconcileEditedBlock({ ...c, text: "A\n```\nB" });
    expect(r.length).toBe(1);
    expect(r[0].type).toBe("code");
    // The serialized raw re-parses to a single code block whose body still holds the inner fence.
    const reparsed = parseMarkdownToBlocks(r.map((b) => b.raw).join("")).blocks;
    expect(reparsed.length).toBe(1);
    expect(reparsed[0].type).toBe("code");
    expect(reparsed[0].text).toContain("```");
  });

  test("a ```` fenced block containing a shorter ``` round-trips by identity", () => {
    const md = "````\ncode with ``` inside\nmore\n````\n";
    expect(roundtrip(md)).toBe(md);
    const blocks = parseMarkdownToBlocks(md).blocks;
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("code");
  });

  test("reconciled split blocks get unique ids (no keyed-render collision)", () => {
    const h = first("# Title\n");
    const r = reconcileEditedBlock({ ...h, text: "Title\nsub\nmore" });
    const ids = r.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
