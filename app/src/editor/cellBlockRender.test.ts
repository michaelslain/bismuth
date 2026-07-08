// Pure tests for the table-cell BLOCK display face (#15 "the block thing"): the cell's stored
// <br>-joined source renders through the SAME full markdown engine a note body uses
// (bases/markdown.ts renderNoteBody), so lists/paragraphs in a cell match reading mode exactly.
// (sanitizeHtml passes through headlessly — these assert the reader's raw output.)
import { test, expect, describe } from "bun:test";
import { cellSourceToBlockMarkdown, renderCellBlockHtml } from "./cellBlockRender";

describe("#15 cellSourceToBlockMarkdown — the <br> → newline bridge", () => {
  test("every <br> marker variant becomes a real newline", () => {
    expect(cellSourceToBlockMarkdown("- a<br>- b")).toBe("- a\n- b");
    expect(cellSourceToBlockMarkdown("a<br/>b<BR />c<Br>d")).toBe("a\nb\nc\nd");
    expect(cellSourceToBlockMarkdown("no breaks")).toBe("no breaks");
  });
});

describe("#15 renderCellBlockHtml — block engine output", () => {
  test("a bullet cell renders a REAL <ul> with 3 <li>, like a note body", () => {
    const html = renderCellBlockHtml("- milk<br>- eggs<br>- bread");
    expect(html).toContain("<ul>");
    expect((html.match(/<li>/g) ?? []).length).toBe(3);
    expect(html).toContain("milk");
    expect(html).toContain("bread");
  });

  test("an ordered cell renders a REAL <ol>", () => {
    const html = renderCellBlockHtml("1. mix<br>2. bake");
    expect(html).toContain("<ol>");
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
  });

  test("a NESTED list renders nested (the block engine understands indentation)", () => {
    const html = renderCellBlockHtml("- a<br>  - a1<br>- b");
    // outer list with an inner <ul> inside the first item
    expect((html.match(/<ul>/g) ?? []).length).toBe(2);
    expect(html).toContain("a1");
  });

  test("plain two-line content keeps its soft break (breaks:true), no word-merge", () => {
    const html = renderCellBlockHtml("line one<br>line two");
    expect(html).not.toContain("<ul>");
    expect(html).toContain("<br"); // marked breaks:true renders the newline as <br>
  });

  test("bold spanning inline math renders styled (the reader engine has no #58 bug)", () => {
    const html = renderCellBlockHtml("**Case 1: $hk \\in H$.**");
    expect(html).toContain("<strong>");
    expect(html).toContain("bismuth-math"); // the reader's math span (placeholder pre-KaTeX)
    expect(html).not.toContain("**");
  });

  test("wikilinks and tags render as the reader's chips", () => {
    const html = renderCellBlockHtml("see [[Note]] and #work");
    expect(html).toContain('class="bismuth-wikilink"');
    expect(html).toContain('data-href="Note.md"');
    expect(html).toContain('class="bismuth-tag"');
  });

  test("embeds become sanitize-surviving slots (upgraded to media after innerHTML)", () => {
    const wiki = renderCellBlockHtml("![[cat.png]]");
    expect(wiki).toContain('class="cm-cell-embed-slot"');
    expect(wiki).toContain('data-wiki="1"');
    expect(wiki).toContain('data-target="cat.png"');
    const md = renderCellBlockHtml("![alt text](img/pic.jpg)");
    expect(md).toContain('data-wiki="0"');
    expect(md).toContain('data-target="img/pic.jpg"');
    expect(md).toContain('data-alt="alt text"');
  });

  test("an embed-looking string inside a code span stays literal (code masked)", () => {
    const html = renderCellBlockHtml("`![[not-an-embed.png]]`");
    expect(html).not.toContain("cm-cell-embed-slot");
    expect(html).toContain("<code>");
  });

  test("a lone-line cell renders a paragraph, exactly like a one-line note body", () => {
    const html = renderCellBlockHtml("just text");
    expect(html).toContain("<p>just text</p>");
  });
});
