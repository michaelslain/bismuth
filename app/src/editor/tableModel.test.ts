// app/src/editor/tableModel.test.ts
import { test, expect } from "bun:test";
import { Text } from "@codemirror/state";
import {
  parseTableRow,
  parseAlign,
  parseTableBlock,
  groupTableBlocks,
  serializeTable,
  formatTable,
  prettifyTableBlock,
  displayWidth,
  decideCellKey,
  cellListContinuation,
  isSeparatorRow,
  insertRow,
  deleteRow,
  insertColumn,
  deleteColumn,
  appendToCell,
  type TableGrid,
  type CellKeyEvent,
} from "./tableModel";

// A small 2-col grid: header + two body rows.
const grid = (): TableGrid => ({
  cells: [
    ["Name", "Age"],
    ["Alice", "30"],
    ["Bob", "40"],
  ],
  aligns: ["left", "right"],
});

test("parseTableRow strips outer rails and trims cells", () => {
  expect(parseTableRow("| a | b | c |")).toEqual(["a", "b", "c"]);
  expect(parseTableRow("a | b")).toEqual(["a", "b"]);
  expect(parseTableRow("|x|y|")).toEqual(["x", "y"]);
});

test("parseTableRow unescapes \\| to a literal pipe", () => {
  expect(parseTableRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
});

test("serializeTable re-escapes literal pipes in cells", () => {
  const md = serializeTable([["a | b"], ["c"]], ["none"]);
  const back = parseTableBlock(md.split("\n"));
  expect(back.cells).toEqual([["a | b"], ["c"]]);
});

test("parseAlign maps separator cells", () => {
  expect(parseAlign("---")).toBe("none");
  expect(parseAlign(":--")).toBe("left");
  expect(parseAlign("--:")).toBe("right");
  expect(parseAlign(":-:")).toBe("center");
});

test("isSeparatorRow requires a dashed row preceded by a pipe line", () => {
  expect(isSeparatorRow("| --- | --- |", "| a | b |")).toBe(true);
  expect(isSeparatorRow("| --- |", "no pipes here")).toBe(false);
  expect(isSeparatorRow("just text", "| a |")).toBe(false);
});

test("parseTableBlock builds a grid + aligns, padding ragged rows", () => {
  const { cells, aligns } = parseTableBlock([
    "| Name | Age |",
    "| :--- | --: |",
    "| Alice | 30 |",
    "| Bob |", // ragged — missing a cell
  ]);
  expect(cells).toEqual([
    ["Name", "Age"],
    ["Alice", "30"],
    ["Bob", ""],
  ]);
  expect(aligns).toEqual(["left", "right"]);
});

test("groupTableBlocks finds a block and maps its lines", () => {
  const doc = Text.of([
    "# Title",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "| 3 | 4 |",
    "",
    "after",
  ]);
  const { blocks, byLine } = groupTableBlocks(doc);
  expect(blocks.length).toBe(1);
  expect(blocks[0].startLine).toBe(3);
  expect(blocks[0].endLine).toBe(6);
  expect(blocks[0].cells).toEqual([
    ["A", "B"],
    ["1", "2"],
    ["3", "4"],
  ]);
  expect(byLine.get(3)).toBe(blocks[0]);
  expect(byLine.get(6)).toBe(blocks[0]);
  expect(byLine.get(7)).toBeUndefined();
});

test("groupTableBlocks finds multiple blocks", () => {
  const doc = Text.of([
    "| A |",
    "| - |",
    "| 1 |",
    "",
    "| X | Y |",
    "| - | - |",
    "| 9 | 8 |",
  ]);
  const { blocks } = groupTableBlocks(doc);
  expect(blocks.length).toBe(2);
  expect(blocks[1].cells[0]).toEqual(["X", "Y"]);
});

test("serializeTable pads columns and writes alignment markers", () => {
  const md = serializeTable(
    [
      ["Name", "Age"],
      ["Alice", "30"],
    ],
    ["left", "right"],
  );
  expect(md).toBe(["| Name  | Age |", "| :---- | --: |", "| Alice |  30 |"].join("\n"));
});

test("parse → serialize round-trips a normalized table", () => {
  const lines = ["| Name  | Age |", "| :---- | --: |", "| Alice |  30 |"];
  const { cells, aligns } = parseTableBlock(lines);
  expect(serializeTable(cells, aligns)).toBe(lines.join("\n"));
});

// #25: "Edit source" must show GENUINELY column-aligned markdown. prettifyTableBlock takes the
// user's ragged, hand-authored pipes and re-emits every row — header, SEPARATOR, and body — padded
// to the per-column max DISPLAY width so the pipes line up in a monospace view. Exact-output
// assertion so a regression that leaves any row unpadded (the "looks fucked" bug) fails loudly.
test("prettifyTableBlock aligns a ragged hand-authored table (header + separator + every body row)", () => {
  const ragged = [
    "| Name | Description | Qty |",
    "|--|--|--|",
    "| Apple | A red fruit | 3 |",
    "| Fig | tiny | 100 |",
  ];
  expect(prettifyTableBlock(ragged)).toBe(
    [
      "| Name  | Description | Qty |",
      "| ----- | ----------- | --- |",
      "| Apple | A red fruit | 3   |",
      "| Fig   | tiny        | 100 |",
    ].join("\n"),
  );
});

test("prettifyTableBlock keeps alignment markers while padding ragged alignment columns", () => {
  const ragged = ["|a|bee|c|", "|:-|-:|:-:|", "|1|22|333|", "|x|y|z|"];
  expect(prettifyTableBlock(ragged)).toBe(
    [
      "| a   | bee |  c  |",
      "| :-- | --: | :-: |",
      "| 1   |  22 | 333 |",
      "| x   |   y |  z  |",
    ].join("\n"),
  );
});

// ── Structural row/column ops ─────────────────────────────────────────────────

test("insertRow inserts a blank body row above (at = r) and below (at = r + 1)", () => {
  const above = insertRow(grid(), 1); // above the first body row
  expect(above.cells).toEqual([
    ["Name", "Age"],
    ["", ""],
    ["Alice", "30"],
    ["Bob", "40"],
  ]);
  const below = insertRow(grid(), 2); // below the first body row
  expect(below.cells).toEqual([
    ["Name", "Age"],
    ["Alice", "30"],
    ["", ""],
    ["Bob", "40"],
  ]);
  expect(below.aligns).toEqual(["left", "right"]);
});

test("insertRow never inserts above the header and does not mutate its input", () => {
  const g = grid();
  const out = insertRow(g, 0); // clamped to 1 — header stays first
  expect(out.cells[0]).toEqual(["Name", "Age"]);
  expect(out.cells[1]).toEqual(["", ""]);
  expect(g.cells.length).toBe(3); // input untouched
});

test("deleteRow removes a body row but never the header or the last body row", () => {
  expect(deleteRow(grid(), 1).cells).toEqual([
    ["Name", "Age"],
    ["Bob", "40"],
  ]);
  expect(deleteRow(grid(), 0).cells).toEqual(grid().cells); // header guarded
  const oneBody: TableGrid = { cells: [["H"], ["only"]], aligns: ["none"] };
  expect(deleteRow(oneBody, 1).cells).toEqual(oneBody.cells); // last body row kept
});

test("insertColumn inserts a blank column + none align left (at = c) and right (at = c + 1)", () => {
  const left = insertColumn(grid(), 0);
  expect(left.cells).toEqual([
    ["", "Name", "Age"],
    ["", "Alice", "30"],
    ["", "Bob", "40"],
  ]);
  expect(left.aligns).toEqual(["none", "left", "right"]);
  const right = insertColumn(grid(), 1);
  expect(right.cells[0]).toEqual(["Name", "", "Age"]);
  expect(right.aligns).toEqual(["left", "none", "right"]);
});

test("deleteColumn removes the column + its align but keeps the last column", () => {
  const out = deleteColumn(grid(), 1);
  expect(out.cells).toEqual([["Name"], ["Alice"], ["Bob"]]);
  expect(out.aligns).toEqual(["left"]);
  const oneCol: TableGrid = { cells: [["H"], ["x"]], aligns: ["none"] };
  expect(deleteColumn(oneCol, 0).cells).toEqual(oneCol.cells); // last column kept
});

test("row/column ops keep the serialized markdown valid (round-trips through parse)", () => {
  const ops: TableGrid[] = [
    insertRow(grid(), 2),
    deleteRow(grid(), 1),
    insertColumn(grid(), 1),
    deleteColumn(grid(), 0),
  ];
  for (const g of ops) {
    const md = serializeTable(g.cells, g.aligns);
    const back = parseTableBlock(md.split("\n"));
    expect(back.cells).toEqual(g.cells);
    expect(back.aligns).toEqual(g.aligns);
  }
});

// ── appendToCell (#30 — drop an image into a table cell) ──────────────────────

test("appendToCell puts the addition into an EMPTY cell as-is", () => {
  const g: TableGrid = { cells: [["A", "B"], ["", "x"]], aligns: ["none", "none"] };
  const out = appendToCell(g, 1, 0, "![[cat.png]]");
  expect(out.cells).toEqual([["A", "B"], ["![[cat.png]]", "x"]]);
  expect(g.cells[1][0]).toBe(""); // input not mutated
});

test("appendToCell joins onto existing cell content with a <br>", () => {
  const g: TableGrid = { cells: [["A"], ["hello"]], aligns: ["none"] };
  expect(appendToCell(g, 1, 0, "![[cat.png]]").cells).toEqual([["A"], ["hello<br>![[cat.png]]"]]);
});

test("appendToCell can target the header row", () => {
  const g: TableGrid = { cells: [["A", "B"], ["1", "2"]], aligns: ["none", "none"] };
  expect(appendToCell(g, 0, 1, "![[d.pdf]]").cells[0]).toEqual(["A", "B<br>![[d.pdf]]"]);
});

test("appendToCell returns an unchanged copy for an out-of-range coordinate", () => {
  const g: TableGrid = { cells: [["A"], ["x"]], aligns: ["none"] };
  expect(appendToCell(g, 5, 0, "![[a.png]]").cells).toEqual(g.cells); // row out of range
  expect(appendToCell(g, 0, 9, "![[a.png]]").cells).toEqual(g.cells); // col out of range
  expect(appendToCell(g, 0, -1, "![[a.png]]").cells).toEqual(g.cells);
});

test("appendToCell keeps the serialized markdown valid (round-trips through parse)", () => {
  const g = appendToCell({ cells: [["Name", "Pic"], ["Bob", ""]], aligns: ["left", "none"] }, 1, 1, "![[bob.png]]");
  const md = serializeTable(g.cells, g.aligns);
  const back = parseTableBlock(md.split("\n"));
  expect(back.cells).toEqual(g.cells);
});

// ── Prettifier (#25) ──────────────────────────────────────────────────────────

test("formatTable column-pads a grid so pipes align (matches serializeTable)", () => {
  const g: TableGrid = { cells: [["Name", "Age"], ["Alice", "30"]], aligns: ["left", "right"] };
  expect(formatTable(g)).toBe(["| Name  | Age |", "| :---- | --: |", "| Alice |  30 |"].join("\n"));
  expect(formatTable(g)).toBe(serializeTable(g.cells, g.aligns));
});

test("prettifyTableBlock aligns hand-authored (ragged) table source", () => {
  const ugly = ["|a|b|", "|-|-|", "|longvalue|x|"];
  expect(prettifyTableBlock(ugly)).toBe(
    ["| a         | b   |", "| --------- | --- |", "| longvalue | x   |"].join("\n"),
  );
});

test("prettifyTableBlock is idempotent on already-tidy source", () => {
  const tidy = ["| Name  | Age |", "| :---- | --: |", "| Alice |  30 |"];
  expect(prettifyTableBlock(tidy)).toBe(tidy.join("\n"));
});

// ── Cell keydown decision (#22 — global shortcuts pass through) ────────────────

const key = (over: Partial<CellKeyEvent>): CellKeyEvent => ({
  key: "x",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...over,
});

test("decideCellKey lets Cmd/Ctrl app shortcuts PASS THROUGH to App's global handler", () => {
  // The crux of #22: Cmd+O (quick switcher) must not be swallowed by the cell.
  expect(decideCellKey(key({ key: "o", metaKey: true }))).toBe("pass-through");
  expect(decideCellKey(key({ key: "f", ctrlKey: true }))).toBe("pass-through");
  expect(decideCellKey(key({ key: "p", metaKey: true }))).toBe("pass-through");
  expect(decideCellKey(key({ key: "d", metaKey: true, shiftKey: true }))).toBe("pass-through");
});

test("decideCellKey keeps the cell-local Cmd combos it owns", () => {
  expect(decideCellKey(key({ key: "a", metaKey: true }))).toBe("select-cell");
  expect(decideCellKey(key({ key: "A", metaKey: true }))).toBe("select-cell");
  for (const k of ["b", "i", "u"]) expect(decideCellKey(key({ key: k, ctrlKey: true }))).toBe("block-format");
});

test("decideCellKey classifies navigation + editing keys", () => {
  expect(decideCellKey(key({ key: "Tab" }))).toBe("tab-next");
  expect(decideCellKey(key({ key: "Tab", shiftKey: true }))).toBe("tab-prev");
  expect(decideCellKey(key({ key: "Enter" }))).toBe("next-row");
  expect(decideCellKey(key({ key: "Enter", shiftKey: true }))).toBe("newline");
  expect(decideCellKey(key({ key: "Escape" }))).toBe("leave");
  expect(decideCellKey(key({ key: "x" }))).toBe("edit");
  expect(decideCellKey(key({ key: "ArrowLeft" }))).toBe("edit");
});

// ── In-cell list continuation (#15) ───────────────────────────────────────────

test("cellListContinuation opens the next unordered marker", () => {
  expect(cellListContinuation("- apple")).toEqual({ marker: "- " });
  expect(cellListContinuation("* apple")).toEqual({ marker: "* " });
});

test("cellListContinuation increments an ordered marker (keeping its delimiter)", () => {
  expect(cellListContinuation("1. first")).toEqual({ marker: "2. " });
  expect(cellListContinuation("9. ninth")).toEqual({ marker: "10. " });
  expect(cellListContinuation("2) second")).toEqual({ marker: "3) " });
});

test("cellListContinuation exits on an empty marker and ignores non-list lines", () => {
  expect(cellListContinuation("- ")).toBe("exit");
  expect(cellListContinuation("3. ")).toBe("exit");
  expect(cellListContinuation("plain text")).toBeNull();
  expect(cellListContinuation("-nospace")).toBeNull(); // a lone dash isn't a list marker
  expect(cellListContinuation("")).toBeNull();
});

// ── Pretty (aligned) source (#25) ─────────────────────────────────────────────
// The raw table source is shown in a monospace view, so alignment is done by DISPLAY
// column width. These assert the EXACT aligned string (not just "it ran") so a
// padding-math regression is caught, and cover the wide-character case that plain
// `String.length` gets wrong.

test("displayWidth counts CJK/fullwidth/emoji as 2, combining marks as 0", () => {
  expect(displayWidth("abc")).toBe(3);
  expect(displayWidth("日本語")).toBe(6); // 3 wide CJK glyphs
  expect(displayWidth("😀")).toBe(2); // astral emoji (surrogate pair, .length===2)
  expect(displayWidth("ｱ")).toBe(1); // halfwidth katakana
  expect(displayWidth("Ａ")).toBe(2); // fullwidth latin A
  expect(displayWidth("é")).toBe(1); // e + combining acute → one column
});

test("prettifyTableBlock aligns a RAGGED hand-authored table into padded columns", () => {
  const ragged = [
    "| Name | Age | City |",
    "|-|-|-|",
    "| Alice | 30 | New York |",
    "| Bob | 5 | LA |",
    "| Charlie | 100 | San Francisco |",
  ];
  expect(prettifyTableBlock(ragged)).toBe(
    [
      "| Name    | Age | City          |",
      "| ------- | --- | ------------- |",
      "| Alice   | 30  | New York      |",
      "| Bob     | 5   | LA            |",
      "| Charlie | 100 | San Francisco |",
    ].join("\n"),
  );
});

test("prettifyTableBlock sizes separator dashes + colons to each column's alignment", () => {
  const src = [
    "| Left | Center | Right |",
    "| :--- | :---: | ---: |",
    "| a | bb | ccc |",
    "| dddd | e | f |",
  ];
  expect(prettifyTableBlock(src)).toBe(
    [
      "| Left | Center | Right |",
      "| :--- | :----: | ----: |",
      "| a    |   bb   |   ccc |",
      "| dddd |   e    |     f |",
    ].join("\n"),
  );
});

test("serializeTable pads WIDE (CJK/emoji) cells so the pipes line up by display width", () => {
  const out = serializeTable(
    [
      ["Name", "Note"],
      ["日本語", "ok"],
      ["a", "中文"],
      ["😀x", "z"],
    ],
    ["none", "none"],
  );
  // Column 0 max display width = 6 ("日本語"); column 1 = 4 ("Note"/"中文"). Note the wide
  // cells carry FEWER literal spaces than an ASCII cell of the same visual width — that's
  // the whole point: padding is by display column, not `.length`.
  expect(out).toBe(
    [
      "| Name   | Note |",
      "| ------ | ---- |",
      "| 日本語 | ok   |",
      "| a      | 中文 |",
      "| 😀x    | z    |",
    ].join("\n"),
  );
  // Every emitted line has the SAME display width (columns genuinely align in monospace).
  const lines = out.split("\n");
  const w0 = displayWidth(lines[0]);
  for (const l of lines) expect(displayWidth(l)).toBe(w0);
});
