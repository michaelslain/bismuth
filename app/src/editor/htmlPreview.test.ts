// app/src/editor/htmlPreview.test.ts
import { test, expect } from "bun:test";
import { Text } from "@codemirror/state";
import {
  classifyTag,
  groupInlineHtml,
  scanHtmlBlocks,
  startsHtmlBlock,
  type InlineTag,
} from "./htmlPreview";

const doc = (s: string) => Text.of(s.split("\n"));

// Build an InlineTag list from raw tag strings laid out left-to-right with no
// gaps — offsets are just running lengths, which is all grouping cares about.
function tags(...texts: string[]): InlineTag[] {
  let pos = 0;
  return texts.map((text) => {
    const t = { from: pos, to: pos + text.length, text };
    pos += text.length;
    return t;
  });
}

test("classifyTag distinguishes open / close / void / self-closing / comment", () => {
  expect(classifyTag("<b>")).toBe("open");
  expect(classifyTag('<span style="color: red">')).toBe("open");
  expect(classifyTag("</b>")).toBe("close");
  expect(classifyTag("</span>")).toBe("close");
  expect(classifyTag("<br>")).toBe("void"); // void element by name
  expect(classifyTag("<br/>")).toBe("void"); // self-closing
  expect(classifyTag("<br />")).toBe("void");
  expect(classifyTag("<hr>")).toBe("void");
  expect(classifyTag('<img src="x.png">')).toBe("void");
  expect(classifyTag("<custom/>")).toBe("void"); // explicit self-close
  expect(classifyTag("<!-- note -->")).toBe("comment");
});

test("groupInlineHtml pairs a simple open/close into one span", () => {
  const spans = groupInlineHtml(tags("<b>", "</b>"));
  // <b> is [0,3), </b> is [3,7) → span covers the whole [0,7)
  expect(spans).toEqual([{ from: 0, to: 7 }]);
});

test("groupInlineHtml keeps nested pairs inside the outer span", () => {
  // <b> <i> </i> </b>  → one outer span, nested handled by depth
  const spans = groupInlineHtml(tags("<b>", "<i>", "</i>", "</b>"));
  expect(spans.length).toBe(1);
  expect(spans[0].from).toBe(0);
  expect(spans[0].to).toBe("<b><i></i></b>".length);
});

test("groupInlineHtml emits a standalone void tag as its own span", () => {
  const spans = groupInlineHtml(tags("<br>"));
  expect(spans).toEqual([{ from: 0, to: 4 }]);
});

test("groupInlineHtml does not split out a void tag nested inside an open element", () => {
  // <div> <br> </div> → just the one outer span (the <br> is inside it)
  const spans = groupInlineHtml(tags("<div>", "<br>", "</div>"));
  expect(spans.length).toBe(1);
  expect(spans[0]).toEqual({ from: 0, to: "<div><br></div>".length });
});

test("groupInlineHtml handles two sibling pairs as two spans", () => {
  const spans = groupInlineHtml(tags("<sub>", "</sub>", "<sup>", "</sup>"));
  expect(spans.length).toBe(2);
  expect(spans[0]).toEqual({ from: 0, to: "<sub></sub>".length });
});

test("groupInlineHtml ignores an unmatched close tag", () => {
  expect(groupInlineHtml(tags("</b>"))).toEqual([]);
  // open with no close → no completed span
  expect(groupInlineHtml(tags("<b>"))).toEqual([]);
});

test("startsHtmlBlock recognizes block tags but not inline ones", () => {
  expect(startsHtmlBlock("<div align=\"center\">x</div>")).toBe(true);
  expect(startsHtmlBlock("  <details>")).toBe(true); // leading whitespace ok
  expect(startsHtmlBlock("</div>")).toBe(true); // a closing block tag also opens a block
  expect(startsHtmlBlock("<!-- a comment -->")).toBe(true);
  expect(startsHtmlBlock("<table>")).toBe(true);
  // inline-only tags do NOT start a block
  expect(startsHtmlBlock('<span style="color:red">hi</span>')).toBe(false);
  expect(startsHtmlBlock("<b>bold</b>")).toBe(false);
  expect(startsHtmlBlock("a line of <br> prose")).toBe(false); // not at line start
  expect(startsHtmlBlock("plain text")).toBe(false);
});

test("scanHtmlBlocks finds a single-line div block", () => {
  const blocks = scanHtmlBlocks(doc('<div align="center">centered</div>\n\nnext'));
  expect(blocks.length).toBe(1);
  expect(blocks[0].fromLine).toBe(1);
  expect(blocks[0].toLine).toBe(1);
});

test("scanHtmlBlocks groups a multi-line block until the blank line", () => {
  const blocks = scanHtmlBlocks(
    doc("# Title\n\n<details>\n<summary>Click</summary>\nHidden\n</details>\n\nafter"),
  );
  expect(blocks.length).toBe(1);
  expect(blocks[0].fromLine).toBe(3);
  expect(blocks[0].toLine).toBe(6); // through </details>, stops at the blank line
});

test("scanHtmlBlocks treats two blank-separated blocks as separate", () => {
  const blocks = scanHtmlBlocks(doc("<div>a</div>\n\n<div>b</div>"));
  expect(blocks.length).toBe(2);
});

test("scanHtmlBlocks does not start a block inside a fenced code region", () => {
  const blocks = scanHtmlBlocks(doc("```html\n<div>not a block</div>\n```\n\ntext"));
  expect(blocks.length).toBe(0);
});

test("scanHtmlBlocks runs an unterminated block to EOF", () => {
  const blocks = scanHtmlBlocks(doc("<ul>\n<li>one</li>\n<li>two</li>"));
  expect(blocks.length).toBe(1);
  expect(blocks[0].fromLine).toBe(1);
  expect(blocks[0].toLine).toBe(3);
});
