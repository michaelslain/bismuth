import { test, expect } from "bun:test";
import { upsertRow, deleteRow, reorderRow } from "../../src/bases/rowOps";
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

test("reorderRow moves a row forward, rewriting order", () => {
  let t = FILE;
  t = upsertRow(t, META, null, { id: 2, title: "B" });
  t = upsertRow(t, META, null, { id: 3, title: "C" });
  const out = reorderRow(t, META, 0, 2); // A,B,C -> B,C,A
  expect(rows(out).map((r) => r.note.title)).toEqual(["B", "C", "A"]);
});

test("reorderRow moves a row backward", () => {
  let t = FILE;
  t = upsertRow(t, META, null, { id: 2, title: "B" });
  t = upsertRow(t, META, null, { id: 3, title: "C" });
  const out = reorderRow(t, META, 2, 0); // A,B,C -> C,A,B
  expect(rows(out).map((r) => r.note.title)).toEqual(["C", "A", "B"]);
});

test("reorderRow throws on an out-of-range index", () => {
  expect(() => reorderRow(FILE, META, 0, 5)).toThrow();
});

test("upsertRow into a body-less base creates the YAML rows", () => {
  const empty = ["---", "type: base", "view: table", "---", ""].join("\n");
  const out = upsertRow(empty, META, null, { id: 1, title: "A" });
  expect(rows(out)[0].note.title).toBe("A");
});

test("grouped view with groupOrder (no order) serializes real row properties, not empty rows", () => {
  // Regression: a grouped view's `columns:` (group-key order, e.g. ["todo","done"])
  // must NOT be treated as display-column property ids. Doing so made serializeRows
  // emit empty rows (data loss). With no explicit `order:`, rows keep their own keys.
  const grouped = [
    "---", "type: base", "view: kanban",
    "groupBy: { property: status }",
    "columns: [todo, done]",
    "---", "",
    "- id: 1", "  title: A", "  status: todo",
  ].join("\n");
  const out = upsertRow(grouped, META, null, { id: 2, title: "B", status: "done" });
  const rs = rows(out);
  expect(rs.map((r) => r.note.title)).toEqual(["A", "B"]);
  expect(rs.map((r) => r.note.status)).toEqual(["todo", "done"]);
});

test("rowOps migrates a legacy markdown-table base to YAML on write", () => {
  const legacy = ["---", "type: base", "---", "", "| id | title |", "| --- | --- |", "| 1 | A |"].join("\n");
  const out = upsertRow(legacy, META, null, { id: 2, title: "B" });
  expect(out).not.toContain("| --- |"); // table gone
  expect(out).toContain("- id:"); // YAML rows
  expect(rows(out).map((r) => r.note.title)).toEqual(["A", "B"]);
});
