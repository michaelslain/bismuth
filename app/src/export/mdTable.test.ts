// app/src/export/mdTable.test.ts
import { test, expect, describe } from "bun:test";
import { deriveColumns, rowsToMarkdownTable } from "./mdTable";
import type { Row } from "../../../core/src/bases/types";

function row(name: string, note: Record<string, unknown>): Row {
  return { file: { name } as any, note, formula: {} };
}

describe("deriveColumns", () => {
  test("name first, then sorted union of note keys", () => {
    const rows = [row("a", { author: "x", year: 2020 }), row("b", { genre: "sci-fi" })];
    expect(deriveColumns(rows)).toEqual(["name", "author", "genre", "year"]);
  });
  test("empty rows -> just name", () => {
    expect(deriveColumns([])).toEqual(["name"]);
  });
});

describe("rowsToMarkdownTable", () => {
  test("renders a GFM table", () => {
    const out = rowsToMarkdownTable([row("Dune", { author: "Herbert" })]);
    expect(out).toBe(
      "| name | author |\n| --- | --- |\n| Dune | Herbert |\n",
    );
  });
  test("escapes pipes and renders missing/array values", () => {
    const out = rowsToMarkdownTable([row("a|b", { tags: ["x", "y"], note: undefined })]);
    expect(out.split("\n")[0]).toBe("| name | note | tags |");
    expect(out).toContain("| a\\|b |  | x, y |");
  });
});
