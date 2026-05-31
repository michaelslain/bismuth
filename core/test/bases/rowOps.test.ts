import { test, expect } from "bun:test";
import { upsertRow, deleteRow } from "../../src/bases/rowOps";
import { parseBaseFile } from "../../src/bases/parse";

const FILE = ["---", "type: base", "view: table", "---", "", "- id: 1", "  title: A"].join("\n");
const META = { name: "T", path: "T.md" };

function rows(text: string) {
  return parseBaseFile(text, META).rows;
}

test("upsertRow appends a new row preserving frontmatter", () => {
  const out = upsertRow(FILE, META, null, { id: 2, title: "B" });
  expect(out.startsWith("---")).toBe(true);
  expect(out).toContain("type: base");
  const rs = rows(out);
  expect(rs.map((r) => r.note.title)).toEqual(["A", "B"]);
});

test("upsertRow edits an existing row by index", () => {
  const out = upsertRow(FILE, META, 0, { id: 1, title: "Z" });
  const rs = rows(out);
  expect(rs.length).toBe(1);
  expect(rs[0].note.title).toBe("Z");
});

test("deleteRow removes a row by index", () => {
  const two = upsertRow(FILE, META, null, { id: 2, title: "B" });
  const out = deleteRow(two, META, 0);
  const rs = rows(out);
  expect(rs.map((r) => r.note.title)).toEqual(["B"]);
});

test("deleteRow throws on an out-of-range index", () => {
  expect(() => deleteRow(FILE, META, 5)).toThrow();
});

test("upsertRow into a body-less base creates the YAML rows", () => {
  const empty = ["---", "type: base", "view: table", "---", ""].join("\n");
  const out = upsertRow(empty, META, null, { id: 1, title: "A" });
  expect(rows(out)[0].note.title).toBe("A");
});

test("rowOps migrates a legacy markdown-table base to YAML on write", () => {
  const legacy = ["---", "type: base", "---", "", "| id | title |", "| --- | --- |", "| 1 | A |"].join("\n");
  const out = upsertRow(legacy, META, null, { id: 2, title: "B" });
  expect(out).not.toContain("| --- |"); // table gone
  expect(out).toContain("- id:"); // YAML rows
  expect(rows(out).map((r) => r.note.title)).toEqual(["A", "B"]);
});
