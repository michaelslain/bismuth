import { test, expect } from "bun:test";
import { upsertRow, deleteRow } from "../../src/bases/rowOps";

const FILE = ["---", "type: base", "view: table", "---", "", "| id | title |", "| --- | --- |", "| 1 | A |"].join("\n");
const META = { name: "T", path: "T.md" };

test("upsertRow appends a new row preserving frontmatter", () => {
  const out = upsertRow(FILE, META, null, { id: 2, title: "B" });
  expect(out).toContain("| 2 | B |");
  expect(out).toContain("| 1 | A |");
  expect(out.startsWith("---")).toBe(true);
  expect(out).toContain("type: base");
});

test("upsertRow edits an existing row by index", () => {
  const out = upsertRow(FILE, META, 0, { id: 1, title: "Z" });
  expect(out).toContain("| 1 | Z |");
  expect(out).not.toContain("| 1 | A |");
});

test("deleteRow removes a row by index", () => {
  const two = upsertRow(FILE, META, null, { id: 2, title: "B" });
  const out = deleteRow(two, META, 0);
  expect(out).not.toContain("| 1 | A |");
  expect(out).toContain("| 2 | B |");
});

test("deleteRow preserves a column even when remaining rows have it empty", () => {
  const file = [
    "---", "type: base", "view: table", "---", "",
    "| id | name | status |",
    "| --- | --- | --- |",
    "| 1 | Alice | active |",
    "| 2 | Bob |  |",
  ].join("\n");
  const out = deleteRow(file, META, 0); // remove Alice; Bob has empty status
  expect(out).toContain("| id | name | status |"); // status column not lost
  expect(out).toContain("| 2 | Bob |  |");
});

test("upsertRow keeps the existing header column order", () => {
  const file = ["---", "type: base", "---", "", "| id | name |", "| --- | --- |", "| 1 | A |"].join("\n");
  const out = upsertRow(file, META, null, { name: "B", id: 2 }); // keys in reverse order
  expect(out.split("\n").find((l) => l.startsWith("| id"))).toBe("| id | name |");
});

test("upsertRow into an empty (table-less) base creates the table", () => {
  const empty = ["---", "type: base", "view: table", "---", ""].join("\n");
  const out = upsertRow(empty, META, null, { id: 1, title: "A" });
  expect(out).toContain("| id | title |");
  expect(out).toContain("| 1 | A |");
});
