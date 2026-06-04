// app/src/editor/tableModel.test.ts
import { test, expect } from "bun:test";
import { Text } from "@codemirror/state";
import {
  parseTableRow,
  parseAlign,
  parseTableBlock,
  groupTableBlocks,
  serializeTable,
  isSeparatorRow,
} from "./tableModel";

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
