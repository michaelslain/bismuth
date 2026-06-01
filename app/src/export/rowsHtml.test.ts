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
  test("escapes html in cells", () => {
    const t: TableData = { columns: ["name"], rows: [["<b>x</b>"]] };
    expect(tableToHtml(t)).toContain("<td>&lt;b&gt;x&lt;/b&gt;</td>");
  });
});
