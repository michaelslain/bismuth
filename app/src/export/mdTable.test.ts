// app/src/export/mdTable.test.ts
import { test, expect, describe } from "bun:test";
import { tableToMarkdown } from "./mdTable";
import type { TableData } from "./baseTable";

describe("tableToMarkdown", () => {
  test("renders a GFM table", () => {
    const t: TableData = { columns: ["name", "author"], rows: [["Dune", "Herbert"]] };
    expect(tableToMarkdown(t)).toBe(
      "| name | author |\n| --- | --- |\n| Dune | Herbert |\n",
    );
  });
  test("escapes pipes and renders missing/array cells", () => {
    const t: TableData = { columns: ["name", "note", "tags"], rows: [["a|b", "", "x, y"]] };
    const out = tableToMarkdown(t);
    expect(out.split("\n")[0]).toBe("| name | note | tags |");
    expect(out).toContain("| a\\|b |  | x, y |");
  });
  test("escapes pipes in column labels so the header stays a valid GFM row", () => {
    const t: TableData = { columns: ["a|b", "c"], rows: [] };
    expect(tableToMarkdown(t).split("\n")[0]).toBe("| a\\|b | c |");
  });
  test("empty columns fall back to a name header", () => {
    expect(tableToMarkdown({ columns: [], rows: [] })).toBe("| name |\n| --- |\n");
  });
});
