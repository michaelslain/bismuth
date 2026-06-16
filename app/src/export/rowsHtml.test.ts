// app/src/export/rowsHtml.test.ts
import { test, expect, describe } from "bun:test";
import { tableToHtml } from "./rowsHtml";
import type { TableData } from "./baseTable";

describe("tableToHtml", () => {
  test("emits a table with header + rows", () => {
    const t: TableData = { columns: ["name", "author"], rows: [["Dune", "Herbert"]] };
    const out = tableToHtml(t);
    expect(out).toContain("<table>");
    expect(out).toContain("<th>name</th><th>author</th>");
    expect(out).toContain("<td>Dune</td><td>Herbert</td>");
  });
  test("escapes plain cells without markup", () => {
    const t: TableData = { columns: ["name"], rows: [["a & b < c"]] };
    expect(tableToHtml(t)).toContain("<td>a &amp; b &lt; c</td>");
  });
  test("renders inline markdown + math in cells (same as the live Base view)", () => {
    const t: TableData = { columns: ["c"], rows: [["$x^2$"]] };
    const out = tableToHtml(t);
    // The math cell goes through the shared inline renderer (a KaTeX/oa-math span),
    // NOT a literal `$x^2$` — matching what renderValue.tsx shows on screen.
    expect(out).toContain("oa-math");
    expect(out).not.toContain("<td>$x^2$</td>");
  });
});
